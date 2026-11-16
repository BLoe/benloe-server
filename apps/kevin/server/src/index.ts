import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { config, startupProblems } from './config.js';
import { runtime } from './core/index.js';
import { createHttp } from './http.js';
import { JobRunner, recoverFromRestart } from './jobs.js';
import { createKevin } from './kevin.js';
import { logUnhandledRejections } from './process.js';

logUnhandledRejections();
const problems = startupProblems();
if (problems.length) {
  for (const p of problems) console.error(`kevin cannot start: ${p}`);
  process.exit(1);
}
// Everything this process creates (database, documents, uploads, backups) is for its own uid only.
process.umask(0o077);
for (const d of ['', 'documents', 'uploads', 'backups']) mkdirSync(join(config.dataDir, d), { recursive: true, mode: 0o700 });

const kevin = await createKevin();
const recovered = await recoverFromRestart(kevin);
if (recovered.turns || recovered.jobRuns.length || recovered.attachments) {
  console.log(`after the last stop: ${recovered.turns} turn(s) closed, ${recovered.jobRuns.length} job run(s) closed (${recovered.jobRuns.join(', ') || 'none'}), ${recovered.attachments} unread upload(s) marked failed`);
}

const runner = new JobRunner(kevin);
runtime.runner = runner;
runner.start();

createHttp(kevin).listen(config.port, '127.0.0.1', () => {
  console.log(`kevin listening on 127.0.0.1:${config.port}; ${kevin.tools.list().length} tools, ${kevin.domains.length} domains, data in ${config.dataDir}`);
});

process.on('SIGTERM', () => {
  runner.stop();
  kevin.db.close();
  process.exit(0);
});
