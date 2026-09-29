// Agent Bridge companion: keeps phone prompts visible in the native Codex/Claude
// chat. It intentionally creates no terminal and executes no agent process.
const vscode = require('vscode');
const http = require('http');
const fs = require('fs');
const os = require('os');
const path = require('path');

const TOKEN_FILE = path.join(process.env.AGENT_BRIDGE_HOME || path.join(os.homedir(), '.agent-bridge'), 'local-token.json');
const AGENTS = { claude: 'Claude Code', codex: 'Codex' };
let status;
let request = null;
let retryTimer = null;
let disposed = false;
let port = 8765;
let lastJob = null;
const cfg = (key) => vscode.workspace.getConfiguration('agentBridge').get(key);

function ownsFolder(job) {
  const folders = (vscode.workspace.workspaceFolders || []).map((folder) => folder.uri.fsPath);
  return folders.some((folder) => job.cwd === folder || String(job.cwd || '').startsWith(folder + path.sep));
}

async function openInChat(job) {
  const id = job?.sessionId || job?.resumeOf;
  if (!id || !/^[0-9a-f-]{36}$/i.test(id)) return false;
  if (job.agent === 'claude') {
    await vscode.commands.executeCommand('claude-vscode.editor.open', id);
    return true;
  }
  if (job.agent === 'codex') {
    await vscode.env.openExternal(vscode.Uri.parse(`${vscode.env.uriScheme}://openai.chatgpt/local/${id}`));
    return true;
  }
  return false;
}

function onJobStart(job) {
  lastJob = job;
  if (cfg('notify')) {
    const shared = job.transport === 'shared-chat' ? ' nella stessa chat' : '';
    vscode.window.showInformationMessage(`📱 Prompt iPhone → ${AGENTS[job.agent] || job.agent}${shared}`, 'Apri chat')
      .then((answer) => answer && openInChat(job));
  }
}

function onJobUpdate(job) {
  if (!lastJob || lastJob.id !== job.id) return;
  lastJob = { ...lastJob, ...job };
  if (job.status === 'running') return;
  if (cfg('openInChat') && ownsFolder(job)) openInChat(lastJob).catch(() => {});
  if (cfg('notify')) {
    const label = job.status === 'done' ? 'completato' : job.status === 'cancelled' ? 'fermato' : 'terminato con errore';
    vscode.window.showInformationMessage(`${AGENTS[job.agent] || job.agent}: prompt ${label}.`, 'Apri chat')
      .then((answer) => answer && openInChat(lastJob));
  }
}

function setStatus(connected, detail) {
  status.text = connected ? '$(link) Agent Bridge' : '$(debug-disconnect) Agent Bridge';
  status.tooltip = connected
    ? 'Collegato: i prompt del telefono entrano nella chat, senza terminali'
    : `Non collegato${detail ? `: ${detail}` : ''}`;
  status.show();
}

function scheduleReconnect(delay = 5000) {
  clearTimeout(retryTimer);
  if (!disposed) retryTimer = setTimeout(connect, delay);
}

function connect() {
  if (disposed) return;
  request?.destroy();
  let token;
  try {
    const saved = JSON.parse(fs.readFileSync(TOKEN_FILE, 'utf8'));
    token = saved.token;
    port = saved.port || port;
  } catch {
    setStatus(false, 'server non ancora avviato');
    return scheduleReconnect(10_000);
  }
  request = http.get({ host: '127.0.0.1', port, path: '/local/events', headers: { Authorization: `Bearer ${token}`, Host: `127.0.0.1:${port}` } }, (response) => {
    if (response.statusCode !== 200) {
      setStatus(false, `risposta ${response.statusCode}`);
      response.resume();
      return scheduleReconnect(10_000);
    }
    setStatus(true);
    response.setEncoding('utf8');
    let buffer = '';
    response.on('data', (chunk) => {
      buffer += chunk;
      let boundary;
      while ((boundary = buffer.indexOf('\n\n')) >= 0) {
        const frame = buffer.slice(0, boundary);
        buffer = buffer.slice(boundary + 2);
        let event = 'message';
        let data = '';
        for (const line of frame.split('\n')) {
          if (line.startsWith('event: ')) event = line.slice(7);
          else if (line.startsWith('data: ')) data += line.slice(6);
        }
        if (!data) continue;
        let message;
        try { message = JSON.parse(data); } catch { continue; }
        if (event === 'job-start') onJobStart(message);
        else if (event === 'job-update') onJobUpdate(message);
        else if (event === 'hello' && message.running?.length) lastJob = message.running.at(-1);
      }
    });
    response.on('end', () => { setStatus(false, 'connessione chiusa'); scheduleReconnect(); });
    response.on('error', () => { setStatus(false, 'connessione persa'); scheduleReconnect(); });
  });
  request.on('error', () => { setStatus(false, 'server spento'); scheduleReconnect(); });
}

function activate(context) {
  status = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 100);
  status.command = 'agentBridge.showLast';
  context.subscriptions.push(
    status,
    vscode.commands.registerCommand('agentBridge.showLast', () => {
      if (lastJob) openInChat(lastJob);
      else vscode.window.showInformationMessage('Nessun prompt ricevuto dal telefono in questa sessione.');
    }),
    vscode.commands.registerCommand('agentBridge.openApp', () => vscode.env.openExternal(vscode.Uri.parse(`http://127.0.0.1:${port}/`))),
    vscode.commands.registerCommand('agentBridge.reconnect', connect),
    vscode.commands.registerCommand('agentBridge.openSession', (agent, sessionId) => openInChat({ agent, sessionId })),
    { dispose: () => { disposed = true; clearTimeout(retryTimer); request?.destroy(); } },
  );
  setStatus(false, 'connessione…');
  connect();
}

function deactivate() {
  disposed = true;
  request?.destroy();
}

module.exports = { activate, deactivate };
