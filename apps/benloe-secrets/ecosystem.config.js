// benloe-secrets — the server's secret store.
//
// THIS APP IS THE ONE THAT CANNOT READ ITS OWN STORE. Every other service on
// the box gets its configuration from /run/benloe-secrets/<app>.env, which this
// process renders. Bootstrapping from its own output would be circular, so the
// one value it needs comes from /etc/benloe/benloe-secrets.conf — root-owned,
// tiny, and permanent by design.
//
// The interpreter is a root-owned setpriv shim that drops to the
// benloe-secrets uid before exec'ing node, so PM2 stays root while no app code
// here ever evaluates with privilege. See infra/scripts/node-as.template.sh.
const fs = require('fs');

const conf = {};
for (const line of fs.readFileSync('/etc/benloe/benloe-secrets.conf', 'utf8').split('\n')) {
  const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
  if (m) conf[m[1]] = m[2].trim();
}

module.exports = {
  apps: [
    {
      name: 'benloe-secrets',
      script: 'dist/index.js',
      interpreter: '/usr/local/lib/benloe/node-as-benloe-secrets',
      cwd: '/srv/benloe/apps/benloe-secrets',
      instances: 1,
      exec_mode: 'fork',
      env: {
        NODE_ENV: 'production',
        PORT: 3011,
        BENLOE_OWNER_EMAIL: conf.BENLOE_OWNER_EMAIL,
      },
      error_file: '/srv/benloe/logs/benloe-secrets-err.log',
      out_file: '/srv/benloe/logs/benloe-secrets-out.log',
      log_date_format: 'YYYY-MM-DD HH:mm:ss Z',
      time: true,
      watch: false,
      max_memory_restart: '300M',
    },
  ],
};
