// cabinet-secrets — the credential broker.
//
// Note what is NOT in this env block: the encryption key. It is read from
// /etc/benloe/cabinet-secrets.key (root:cabinet-secrets 0640) by the process
// itself. That is a deliberate departure from every other app here, which take
// their secrets from .env via PM2.
//
// The reason: an environment variable is inherited by every child process and
// is readable from the process's own /proc/<pid>/environ. Cabinet had to add a
// startup scrub to work around exactly that, and the scrub was a line in
// agent-writable source. A file readable only by this uid has neither problem,
// and rotating the key means replacing a file rather than editing a PM2 config
// and restarting through a privop.
//
// PM2 loads this from /etc/benloe/ecosystem/, never from here; promote changes
// with `cabinet-privops install-ecosystem cabinet-secrets` as real root.
const fs = require('fs');
const envFile = fs.readFileSync('/srv/benloe/.env', 'utf8');
const env = {};
envFile.split('\n').forEach((line) => {
  const match = line.match(/^([^#=]+)=(.*)$/);
  if (match) env[match[1].trim()] = match[2].trim();
});

module.exports = {
  apps: [
    {
      name: 'cabinet-secrets',
      script: 'dist/index.js',
      // Its own uid, via the root-owned setpriv shim. index.ts additionally
      // refuses to start if it ever finds itself running as root.
      interpreter: '/usr/local/lib/benloe/node-as-cabinet-secrets',
      cwd: '/srv/benloe/apps/cabinet-secrets',
      instances: 1,
      exec_mode: 'fork',
      env: {
        NODE_ENV: 'production',
        PORT: 3011,
        CABINET_OWNER_EMAIL: env.CABINET_OWNER_EMAIL,
        PLAID_ENV: env.PLAID_ENV || 'sandbox',
      },
      error_file: '/srv/benloe/logs/cabinet-secrets-err.log',
      out_file: '/srv/benloe/logs/cabinet-secrets-out.log',
      log_date_format: 'YYYY-MM-DD HH:mm:ss Z',
      time: true,
      watch: false,
      max_memory_restart: '300M',
    },
  ],
};
