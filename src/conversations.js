// Remembers the one canonical agent thread for each working directory.
// This lives on the server so every native client continues the same chat.
import fs from 'node:fs';
import path from 'node:path';
import { DATA_DIR, writePrivateJson } from './config.js';

const FILE = path.join(DATA_DIR, 'conversations.json');
const UUID = /^[0-9a-f-]{36}$/i;
const AGENTS = new Set(['claude', 'codex']);
const key = (agent, cwd) => JSON.stringify([agent, cwd]);
const conversations = new Map();

try {
  const saved = JSON.parse(fs.readFileSync(FILE, 'utf8'));
  for (const item of Array.isArray(saved?.conversations) ? saved.conversations : []) {
    if (AGENTS.has(item?.agent) && typeof item.cwd === 'string' && UUID.test(item.sessionId || '')) {
      conversations.set(key(item.agent, item.cwd), item);
    }
  }
} catch { /* first run or invalid stale file */ }

function persist() {
  writePrivateJson(FILE, { version: 1, conversations: [...conversations.values()] });
}

export function getConversation(agent, cwd) {
  return conversations.get(key(agent, cwd))?.sessionId || null;
}

export function setConversation(agent, cwd, sessionId) {
  if (!AGENTS.has(agent) || typeof cwd !== 'string' || !UUID.test(sessionId || '')) return false;
  const k = key(agent, cwd);
  if (conversations.get(k)?.sessionId === sessionId) return true;
  conversations.set(k, { agent, cwd, sessionId, updated: Date.now() });
  persist();
  return true;
}

export function forgetConversation(agent, cwd) {
  if (!conversations.delete(key(agent, cwd))) return false;
  persist();
  return true;
}
