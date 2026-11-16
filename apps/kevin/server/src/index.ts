import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { config } from './config.js';
import { runtime } from './core/index.js';
import { createHttp } from './http.js';
import { JobRunner } from './jobs.js';
import { createKevin } from './kevin.js';
import { logUnhandledRejections } from './process.js';

logUnhandledRejections();
// Everything this process creates (database, documents, uploads, backups) is for its own uid only.
process.umask(0o077);
for (const d of ['', 'documents', 'uploads', 'backups']) mkdirSync(join(config.dataDir, d), { recursive: true, mode: 0o700 });

const kevin = await createKevin();
// A turn that was running when the process last stopped can never finish.
kevin.db.prepare("UPDATE turns SET status = 'error', error = 'interrupted by a restart', ended_at = ? WHERE status = 'running'").run(new Date().toISOString());

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
