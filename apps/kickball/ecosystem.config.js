// Written 2026-08-02 during the privilege-separation audit — this service had
// no ecosystem config and was running with an interactive shell's inherited
// environment. See infra/scripts/node-as.template.sh for why the interpreter
// is a root-owned shim rather than PM2's own uid option.
//
// PM2 loads this from /etc/benloe/ecosystem/, never from here; promote changes
// with `cabinet-privops install-ecosystem kickball` as real root.
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
      name: 'kickball-api',
      script: 'api/dist/server.js',
      interpreter: '/usr/local/lib/benloe/node-as-benloe-apps',
      cwd: '/srv/benloe/apps/kickball',
      instances: 1,
      exec_mode: 'fork',
      env: {
        NODE_ENV: 'production',
        PORT: 3009,
        KICKBALL_DB: '/srv/benloe/data/kickball.db',
        AUTH_SERVICE_URL: 'http://localhost:3002',
        CABINET_OWNER_EMAIL: env.CABINET_OWNER_EMAIL,
        JWT_SECRET: env.JWT_SECRET,
      },
      error_file: '/srv/benloe/logs/kickball-api-err.log',
      out_file: '/srv/benloe/logs/kickball-api-out.log',
      log_date_format: 'YYYY-MM-DD HH:mm:ss Z',
      time: true,
      watch: false,
      max_memory_restart: '500M',
    },
  ],
};
