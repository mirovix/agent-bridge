// Claude Code and Codex working together on one task, in one folder.
//
//   review   the lead does the task, the partner reviews it without editing files,
//            and (optionally) the lead applies the fixes in the same conversation.
//   compare  both answer the same prompt at the same time, read-only.
//
// A duo is only a plan of ordinary jobs: every step runs through JobManager, so
// permissions, limits, timeouts and the audit log work exactly as for a single prompt.
import { spawnSync } from 'node:child_process';
import crypto from 'node:crypto';
import { EventEmitter } from 'node:events';
import { audit } from './auth.js';

export const DUO_KINDS = ['review', 'compare'];
// Modes that never write to disk, used for reviewers and comparisons.
export const READ_ONLY_MODE = { claude: 'manual', codex: 'read-only' };
export const AGENT_NAMES = { claude: 'Claude', codex: 'Codex' };
const MAX_CONTEXT = 12000;
const MAX_INSTRUCTION = 4000;
const MAX_DUOS = 30;
const MAX_DIFF = 40000;

export const DEFAULT_REVIEW_INSTRUCTION = 'Review it: read the diff and, where needed, the surrounding code. List concrete problems (bugs, missing cases, risky changes) from most to least severe, each with file:line and a fix. If the work is correct, say so in one line. Do not edit files.';
export const DEFAULT_APPLY_INSTRUCTION = 'Apply the fixes you agree with. Then say in a few lines what you changed and what you skipped, and why.';

const clipText = (text, n = MAX_CONTEXT) => {
  const s = String(text ?? '').trim();
  return s.length > n ? `${s.slice(0, n)}\n… [${s.length - n} characters omitted]` : s;
};

/** Final answer of a job: the assistant messages of this turn, joined. */
export function jobReply(events = []) {
  return clipText(events.filter((e) => e.role === 'assistant' && e.text).map((e) => e.text).join('\n\n'));
}

/** Last answer in a transcript: assistant messages after the last real user prompt. */
export function lastReply(messages = []) {
  let start = 0;
  messages.forEach((m, i) => { if (m.role === 'user' && !m.meta) start = i + 1; });
  const tail = messages.slice(start).filter((m) => m.role === 'assistant' && m.text);
  const pick = tail.length ? tail : messages.filter((m) => m.role === 'assistant' && m.text).slice(-1);
  return clipText(pick.map((m) => m.text).join('\n\n'));
}

export function cleanInstruction(value, fallback) {
  if (value == null || value === '') return fallback;
  if (typeof value !== 'string') throw new Error('Invalid instruction');
  const s = value.trim();
  if (s.length > MAX_INSTRUCTION) throw new Error('Instruction too long');
  return s || fallback;
}

// ---------- what the lead changed (git) ----------

function git(cwd, args) {
  const r = spawnSync('git', ['-C', cwd, ...args], { encoding: 'utf8', timeout: 15000, maxBuffer: 16 * 1024 * 1024, windowsHide: true });
  return r.status === 0 ? r.stdout : null;
}

/**
 * Snapshot of the working tree before the lead starts, without touching it:
 * `git stash create` writes a dangling commit (or prints nothing when clean).
 */
export function gitSnapshot(cwd) {
  if (git(cwd, ['rev-parse', '--is-inside-work-tree'])?.trim() !== 'true') return null;
  const base = git(cwd, ['stash', 'create'])?.trim() || git(cwd, ['rev-parse', '--verify', '-q', 'HEAD'])?.trim() || null;
  const untracked = new Set((git(cwd, ['ls-files', '--others', '--exclude-standard', '-z']) || '').split('\0').filter(Boolean));
  return { base, untracked };
}

/** The lead's own changes since the snapshot, as a (clipped) unified diff. */
export function gitChanges(cwd, snap) {
  if (!snap) return '';
  const parts = [];
  if (snap.base) {
    const diff = git(cwd, ['diff', '--no-color', '--no-ext-diff', snap.base]);
    if (diff) parts.push(diff.trimEnd());
  }
  const added = (git(cwd, ['ls-files', '--others', '--exclude-standard', '-z']) || '').split('\0').filter((f) => f && !snap.untracked.has(f));
  const empty = process.platform === 'win32' ? 'NUL' : '/dev/null';
  for (const file of added.slice(0, 20)) {
    // --no-index exits with 1 when the files differ: read stdout whatever the status.
    const r = spawnSync('git', ['-C', cwd, 'diff', '--no-color', '--no-index', '--', empty, file], { encoding: 'utf8', timeout: 15000, maxBuffer: 4 * 1024 * 1024, windowsHide: true });
    if (r.stdout) parts.push(r.stdout.trimEnd());
  }
  if (added.length > 20) parts.push(`… and ${added.length - 20} more new files`);
  return clipText(parts.join('\n'), MAX_DIFF);
}

export function reviewPrompt({ lead, task, report, cwd, diff = '', instruction = DEFAULT_REVIEW_INSTRUCTION }) {
  return [
    `${AGENT_NAMES[lead] || lead} just worked on this project (${cwd}).`,
    '',
    `Task given to ${AGENT_NAMES[lead] || lead}:`,
    '<task>', clipText(task), '</task>',
    '',
    `${AGENT_NAMES[lead] || lead}'s final report:`,
    '<report>', report || '(no written report)', '</report>',
    '',
    ...(diff ? ['Changes made to the files:', '<diff>', diff, '</diff>', ''] : []),
    instruction,
  ].join('\n');
}

export function applyPrompt({ partner, review, instruction = DEFAULT_APPLY_INSTRUCTION }) {
  return [
    `${AGENT_NAMES[partner] || partner} reviewed your work:`,
    '<review>', review || '(empty review)', '</review>',
    '',
    instruction,
  ].join('\n');
}

export function handoffPrompt({ from, reply, instruction }) {
  return [
    instruction,
    '',
    `Context: this is the latest reply from ${AGENT_NAMES[from] || from} in the same project.`,
    '<reply>', reply || '(empty reply)', '</reply>',
  ].join('\n');
}

const other = (agent) => (agent === 'claude' ? 'codex' : 'claude');

/** Resolves once the job is no longer running (also when it failed to start). */
function whenDone(job) {
  if (!job) return Promise.resolve({ status: 'cancelled', events: [] });
  if (job.status !== 'running') return Promise.resolve(job);
  return new Promise((resolve) => job.once('end', () => resolve(job)));
}

class Duo extends EventEmitter {
  constructor(spec) {
    super();
    Object.assign(this, spec);
    this.id = crypto.randomUUID();
    this.status = 'running';
    this.started = Date.now();
    this.ended = null;
    this.error = null;
  }

  summary() {
    return {
      id: this.id, kind: this.kind, cwd: this.cwd, lead: this.lead, partner: this.partner, apply: !!this.apply,
      status: this.status, started: this.started, ended: this.ended, error: this.error,
      promptPreview: this.prompt.slice(0, 120),
      steps: this.steps.map(({ agent, role, jobId, status }) => ({ agent, role, jobId: jobId || null, status })),
    };
  }
}

export class DuoManager extends EventEmitter {
  /**
   * @param jobs JobManager
   * @param hooks.conversation (agent, cwd) => sessionId | null  — the canonical chat to continue
   * @param hooks.started (job, { remember }) => void            — lets the server track a new job
   */
  constructor(jobs, hooks = {}) {
    super();
    this.jobs = jobs;
    this.hooks = hooks;
    this.duos = new Map();
  }

  list() {
    return [...this.duos.values()].sort((a, b) => b.started - a.started).map((d) => d.summary());
  }

  get(id) {
    return this.duos.get(id) || null;
  }

  start({ kind, cwd, prompt, lead, apply, options = {}, reviewInstruction, applyInstruction }, who) {
    if (!DUO_KINDS.includes(kind)) throw new Error('Unknown duo kind');
    if (!['claude', 'codex'].includes(lead)) throw new Error('The lead must be Claude or Codex');
    const partner = other(lead);
    const enabled = new Set(this.jobs.agents().map((a) => a.id));
    if (!enabled.has('claude') || !enabled.has('codex')) throw new Error('Duo needs both Claude Code and Codex enabled');
    const needed = kind === 'compare' ? 2 : 1;
    if (this.jobs.running().length + needed > this.jobs.cfg.maxConcurrentJobs) throw new Error('Too many jobs running');
    const pick = (o) => ({ model: typeof o?.model === 'string' ? o.model : '', effort: typeof o?.effort === 'string' ? o.effort : '', mode: typeof o?.mode === 'string' ? o.mode : '' });
    const duo = new Duo({
      kind, cwd, prompt, lead, partner, apply: kind === 'review' && !!apply,
      options: { [lead]: pick(options[lead]), [partner]: pick(options[partner]) },
      reviewInstruction: cleanInstruction(reviewInstruction, DEFAULT_REVIEW_INSTRUCTION),
      applyInstruction: cleanInstruction(applyInstruction, DEFAULT_APPLY_INSTRUCTION),
      who,
    });
    duo.steps = kind === 'compare'
      ? [{ agent: lead, role: 'answer', status: 'waiting' }, { agent: partner, role: 'answer', status: 'waiting' }]
      : [{ agent: lead, role: 'work', status: 'waiting' }, { agent: partner, role: 'review', status: 'waiting' },
        ...(duo.apply ? [{ agent: lead, role: 'apply', status: 'waiting' }] : [])];
    this.duos.set(duo.id, duo);
    this.prune();
    audit('duo_start', { duo: duo.id, kind, lead, partner, apply: duo.apply, cwd, promptChars: prompt.length, ...who });
    const run = kind === 'compare' ? this.runCompare(duo) : this.runReview(duo);
    run.catch((e) => this.finish(duo, 'failed', e.message));
    this.changed(duo);
    return duo;
  }

  // Starts one step. `session`: resume this chat; `readOnly`: force a non-writing mode.
  step(duo, index, prompt, { session = null, readOnly = false, remember = false } = {}) {
    const step = duo.steps[index];
    if (duo.status !== 'running') { step.status = 'skipped'; return null; }
    const o = duo.options[step.agent];
    let job;
    try {
      job = this.jobs.start({
        agent: step.agent, cwd: duo.cwd, prompt, sessionId: session,
        mode: readOnly ? READ_ONLY_MODE[step.agent] : o.mode || undefined,
        model: o.model || undefined, effort: o.effort || undefined,
      }, duo.who);
    } catch (e) {
      step.status = 'failed';
      throw e;
    }
    job.duo = { id: duo.id, role: step.role };
    step.jobId = job.id;
    step.status = 'running';
    this.hooks.started?.(job, { remember });
    job.on('update', () => { step.status = job.status; this.changed(duo); });
    this.changed(duo);
    return job;
  }

  async runReview(duo) {
    const session = this.hooks.conversation?.(duo.lead, duo.cwd) || null;
    const snap = gitSnapshot(duo.cwd);
    const work = await whenDone(this.step(duo, 0, duo.prompt, { session, remember: true }));
    duo.steps[0].status = work.status;
    if (work.status !== 'done') return this.finish(duo, work.status === 'cancelled' ? 'cancelled' : 'failed', `${AGENT_NAMES[duo.lead]} did not finish the task`);

    const review = await whenDone(this.step(duo, 1, reviewPrompt({ lead: duo.lead, task: duo.prompt, report: jobReply(work.events), cwd: duo.cwd, diff: gitChanges(duo.cwd, snap), instruction: duo.reviewInstruction }), { readOnly: true }));
    duo.steps[1].status = review.status;
    if (review.status !== 'done') return this.finish(duo, review.status === 'cancelled' ? 'cancelled' : 'failed', `${AGENT_NAMES[duo.partner]} did not finish the review`);
    if (!duo.apply) return this.finish(duo, 'done');

    const fixes = await whenDone(this.step(duo, 2, applyPrompt({ partner: duo.partner, review: jobReply(review.events), instruction: duo.applyInstruction }), { session: work.sessionId || session, remember: true }));
    duo.steps[2].status = fixes.status;
    return this.finish(duo, fixes.status === 'done' ? 'done' : fixes.status === 'cancelled' ? 'cancelled' : 'failed');
  }

  async runCompare(duo) {
    const started = [];
    try {
      started.push(this.step(duo, 0, duo.prompt, { readOnly: true }));
      started.push(this.step(duo, 1, duo.prompt, { readOnly: true }));
    } catch (e) {
      for (const job of started) this.jobs.kill(job);
      throw e;
    }
    const done = await Promise.all(started.map(whenDone));
    done.forEach((job, i) => { duo.steps[i].status = job.status; });
    const ok = done.filter((j) => j.status === 'done').length;
    return this.finish(duo, ok === done.length ? 'done' : done.some((j) => j.status === 'cancelled') ? 'cancelled' : 'failed');
  }

  finish(duo, status, error = null) {
    if (duo.ended) return;
    if (duo.status === 'cancelled') status = 'cancelled';
    duo.status = status;
    duo.error = status === 'done' ? null : error;
    duo.ended = Date.now();
    for (const s of duo.steps) if (s.status === 'waiting') s.status = 'skipped';
    audit('duo_end', { duo: duo.id, status });
    this.changed(duo);
  }

  cancel(duo) {
    if (duo.status !== 'running') return;
    duo.status = 'cancelled';
    for (const s of duo.steps) {
      const job = s.jobId && this.jobs.get(s.jobId);
      if (job) this.jobs.kill(job);
      if (s.status === 'waiting') s.status = 'skipped';
    }
    this.changed(duo);
  }

  cancelAll() {
    for (const d of this.duos.values()) this.cancel(d);
  }

  changed(duo) {
    const summary = duo.summary();
    duo.emit('update', summary);
    this.emit('update', summary);
  }

  prune() {
    const done = [...this.duos.values()].filter((d) => d.status !== 'running').sort((a, b) => a.started - b.started);
    while (this.duos.size > MAX_DUOS && done.length) this.duos.delete(done.shift().id);
  }
}
