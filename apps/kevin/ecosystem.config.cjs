// Kevin's only process. PM2 loads this from /etc/benloe/ecosystem/kevin.config.js
// (deploy.sh installs it) and runs the release in /opt/kevin/current, never the
// repo. The interpreter is a root-owned shim that drops to the `kevin` uid and
// passes through only the variables named in it.
const fs = require('fs');

const env = {};
for (const line of fs.readFileSync('/run/benloe-secrets/kevin.env', 'utf8').split('\n')) {
  const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
  if (m) env[m[1]] = m[2].trim();
}

module.exports = {
  apps: [
    {
      name: 'kevin-api',
      script: 'dist/index.js',
      cwd: '/opt/kevin/current/server',
      interpreter: '/usr/local/lib/benloe/node-as-kevin',
      instances: 1,
      exec_mode: 'fork',
      env: {
        NODE_ENV: 'production',
        PORT: 3016,
        AUTH_SERVICE_URL: 'http://localhost:3002',
        KEVIN_OWNER_EMAIL: 'below413@gmail.com',
        KEVIN_PUBLIC_URL: 'https://kevin.benloe.com',
        KEVIN_TZ: 'America/New_York',
        KEVIN_DATA_DIR: '/var/lib/kevin',
        ANTHROPIC_API_KEY: env.ANTHROPIC_API_KEY,
        KEVIN_VAPID_PUBLIC_KEY: env.KEVIN_VAPID_PUBLIC_KEY,
        KEVIN_VAPID_PRIVATE_KEY: env.KEVIN_VAPID_PRIVATE_KEY,
        // Optional: turns on embeddings for recall when present in the kevin set.
        ...(env.OPENAI_API_KEY ? { OPENAI_API_KEY: env.OPENAI_API_KEY } : {}),
      },
      error_file: '/srv/benloe/logs/kevin-api-err.log',
      out_file: '/srv/benloe/logs/kevin-api-out.log',
      log_date_format: 'YYYY-MM-DD HH:mm:ss Z',
      time: true,
      watch: false,
      kill_timeout: 5000,
      max_memory_restart: '600M',
    },
  ],
};
