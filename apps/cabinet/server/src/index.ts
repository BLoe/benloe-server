// Privilege drop FIRST (§13.2): PM2's own uid switching can't work while PM2
// lives under /root (its fork wrapper is unreadable to the target user), so
// the daemon starts us as root and we immediately become claude-worker.
// Nothing — not even module side effects below — runs with root privileges.
const proc = process as NodeJS.Process & {
  initgroups?(user: string, extraGroup: string): void;
  setgid?(id: string | number): void;
  setuid?(id: string | number): void;
};
if (proc.getuid?.() === 0) {
  const RUN_AS = process.env.CABINET_RUN_AS ?? 'claude-worker';
  proc.initgroups?.(RUN_AS, RUN_AS);
  proc.setgid?.(RUN_AS);
  proc.setuid?.(RUN_AS);
}
if (proc.getuid?.() === 0) {
  console.error('refusing to run as root');
  process.exit(1);
}

// setuid() above drops our effective uid to claude-worker, but Node never
// touches process.env on privilege drop — HOME is still whatever the root
// pm2 daemon had (HOME=/root) when it forked us. The Claude Agent SDK's
// bash tool captures process.env verbatim when it builds a session's shell
// snapshot, so every bash tool call inherited the wrong HOME (wrong ~,
// `git fetch` failing to write .git/FETCH_HEAD, etc.) unless the caller
// prefixed HOME=... by hand. Fix it before AgentRuntime/the SDK is ever
// touched below. os.userInfo().homedir queries the OS user database by
// *effective uid* directly — unlike os.homedir(), it does not consult
// $HOME — so it reports the right directory even though $HOME is still
// wrong at this point.
try {
  const correctHome = userInfo().homedir;
  if (correctHome && process.env.HOME !== correctHome) {
    process.env.HOME = correctHome;
  }
} catch {
  // Best-effort: if the user database lookup fails, leave HOME as-is
  // rather than crash startup over it.
}

import { EventEmitter } from 'node:events';
import { mkdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { userInfo } from 'node:os';
import { openDb } from './db/index.js';
import { Embedder } from './embeddings/index.js';
import { EpisodicStore } from './episodic/index.js';
import { MemoryStore } from './memory/index.js';
import { ApprovalQueue } from './tiers/approvals.js';
import { AgentRuntime } from './runtime/agent.js';
import { buildCabinetMcpServer, cabinetAllowedTools } from './mcp/cabinet-server.js';
import { buildExternalMcpServers } from './mcp/external.js';
import { buildApp } from './gateway/app.js';
import { seedInsurancePlan } from './domains/healthcare.js';
import { Scheduler } from './scheduler/index.js';
import { buildJobs } from './scheduler/jobs.js';
import { schedulePendingDeployConfirmationWatch } from './deploy/pendingConfirmation.js';

const DATA_DIR = process.env.CABINET_DATA_DIR ?? '/srv/benloe/data/cabinet';
const PORT = Number(process.env.PORT ?? 3008);
const OWNER = process.env.CABINET_OWNER_EMAIL;

if (!OWNER) {
  console.error('CABINET_OWNER_EMAIL is required — refusing to start without the owner wall.');
  process.exit(1);
}

mkdirSync(DATA_DIR, { recursive: true });
process.env.CABINET_MODELS_DIR ??= join(DATA_DIR, 'models');

/**
 * Read once at startup — not per healthz request, not a git subprocess in
 * the running server. scripts/write-build-info.mjs bakes this file at build
 * time (npm run build) with the commit that was actually compiled, so
 * healthz.buildMarker (gateway/app.ts) tells you what's really deployed
 * instead of a hand-typed string that goes stale after the next deploy.
 */
function readBuildInfo(): { sha: string; builtAt: string } {
  try {
    return JSON.parse(readFileSync(join(import.meta.dirname, 'build-info.json'), 'utf8'));
  } catch {
    return { sha: 'unknown', builtAt: 'unknown' };
  }
}
const buildInfo = readBuildInfo();

const cabinet = openDb(join(DATA_DIR, 'cabinet.db'));
const episodic = new EpisodicStore(join(DATA_DIR, 'episodic.db'));
const embedder = new Embedder();
const memory = new MemoryStore(join(DATA_DIR, 'memory'));
memory.ensureTemplates();
seedInsurancePlan(cabinet.db);
schedulePendingDeployConfirmationWatch(cabinet.db, DATA_DIR, buildInfo.sha);

const approvals = new ApprovalQueue(cabinet.db);
const widgetBus = new EventEmitter();

const cabinetMcp = buildCabinetMcpServer({
  db: cabinet.db,
  readonlyDb: cabinet.readonlyDb,
  episodic,
  embedder,
  memory,
  approvals,
  widgetBus,
});

const runtime = new AgentRuntime({
  db: cabinet.db,
  memory,
  approvals,
  widgetBus,
  allowedTools: cabinetAllowedTools(),
  mcpServers: { cabinet: cabinetMcp, ...buildExternalMcpServers(process.env) },
});

// Built unconditionally (constructing it arms nothing — only .start() does)
// so it can back both the real cron timers below AND the authenticated
// manual trigger (gateway/app.ts's POST /api/admin/jobs/:name/run), which
// needs the exact same JobSpec array the timers use, not a rebuilt copy.
const scheduler = new Scheduler(
  buildJobs({ db: cabinet.db, runtime, approvals, widgetBus, episodic, embedder, dataDir: DATA_DIR }),
);

const app = buildApp({
  db: cabinet.db,
  runtime,
  approvals,
  widgetBus,
  ownerEmail: OWNER,
  embedderStatus: () => embedder.status(),
  episodic,
  embedder,
  memory,
  scheduler,
  buildMarker: buildInfo.sha,
});

app.listen(PORT, '127.0.0.1', () => {
  console.log(`cabinet-api listening on 127.0.0.1:${PORT} (auth mode: ${runtime.authMode})`);
});

// Sweep approvals that expired while we were down (§14).
approvals.expireOverdue();

// Proactive routines (§11) — CABINET_SCHEDULER=off for tests/dev.
if (process.env.CABINET_SCHEDULER !== 'off') {
  scheduler.start();
  console.log('scheduler armed:', JSON.stringify(scheduler.nextFireTimes()));
}

process.on('SIGTERM', () => {
  void embedder.close().finally(() => {
    cabinet.close();
    episodic.close();
    process.exit(0);
  });
});
