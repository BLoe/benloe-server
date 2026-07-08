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
  const RUN_AS = process.env.PALS_RUN_AS ?? 'claude-worker';
  proc.initgroups?.(RUN_AS, RUN_AS);
  proc.setgid?.(RUN_AS);
  proc.setuid?.(RUN_AS);
}
if (proc.getuid?.() === 0) {
  console.error('refusing to run as root');
  process.exit(1);
}

import { EventEmitter } from 'node:events';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { openDb } from './db/index.js';
import { Embedder } from './embeddings/index.js';
import { EpisodicStore } from './episodic/index.js';
import { MemoryStore } from './memory/index.js';
import { ApprovalQueue } from './tiers/approvals.js';
import { AgentRuntime } from './runtime/agent.js';
import { buildPalsMcpServer, palsAllowedTools } from './mcp/pals-server.js';
import { buildExternalMcpServers } from './mcp/external.js';
import { buildApp } from './gateway/app.js';
import { seedInsurancePlan } from './domains/healthcare.js';
import { Scheduler } from './scheduler/index.js';
import { buildJobs } from './scheduler/jobs.js';

const DATA_DIR = process.env.PALS_DATA_DIR ?? '/srv/benloe/data/pals';
const PORT = Number(process.env.PORT ?? 3008);
const OWNER = process.env.PALS_OWNER_EMAIL;

if (!OWNER) {
  console.error('PALS_OWNER_EMAIL is required — refusing to start without the owner wall.');
  process.exit(1);
}

mkdirSync(DATA_DIR, { recursive: true });
process.env.PALS_MODELS_DIR ??= join(DATA_DIR, 'models');

const pals = openDb(join(DATA_DIR, 'pals.db'));
const episodic = new EpisodicStore(join(DATA_DIR, 'episodic.db'));
const embedder = new Embedder();
const memory = new MemoryStore(join(DATA_DIR, 'memory'));
memory.ensureTemplates();
seedInsurancePlan(pals.db);

const approvals = new ApprovalQueue(pals.db);
const widgetBus = new EventEmitter();

const palsMcp = buildPalsMcpServer({
  db: pals.db,
  readonlyDb: pals.readonlyDb,
  episodic,
  embedder,
  memory,
  approvals,
  widgetBus,
});

const runtime = new AgentRuntime({
  db: pals.db,
  memory,
  approvals,
  widgetBus,
  allowedTools: palsAllowedTools(),
  mcpServers: { pals: palsMcp, ...buildExternalMcpServers(process.env) },
});

const app = buildApp({
  db: pals.db,
  runtime,
  approvals,
  widgetBus,
  ownerEmail: OWNER,
  embedderAlive: () => embedder.alive,
  memory,
});

app.listen(PORT, '127.0.0.1', () => {
  console.log(`pals-api listening on 127.0.0.1:${PORT} (auth mode: ${runtime.authMode})`);
});

// Sweep approvals that expired while we were down (§14).
approvals.expireOverdue();

// Proactive routines (§11) — PALS_SCHEDULER=off for tests/dev.
if (process.env.PALS_SCHEDULER !== 'off') {
  const scheduler = new Scheduler(
    buildJobs({ db: pals.db, runtime, approvals, widgetBus, episodic, embedder, dataDir: DATA_DIR }),
  );
  scheduler.start();
  console.log('scheduler armed:', JSON.stringify(scheduler.nextFireTimes()));
}

process.on('SIGTERM', () => {
  void embedder.close().finally(() => {
    pals.close();
    episodic.close();
    process.exit(0);
  });
});
