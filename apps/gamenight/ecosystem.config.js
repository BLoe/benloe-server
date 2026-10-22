// Parse the rendered secrets by hand — PM2 has no access to the app's node_modules.
// The file is gamenight's OWN set merged over 'shared'.
const fs = require('fs');
const envFile = fs.readFileSync('/run/benloe-secrets/gamenight.env', 'utf8');
const env = {};
envFile.split('\n').forEach(line => {
  const match = line.match(/^([^#=]+)=(.*)$/);
  if (match) env[match[1].trim()] = match[2].trim();
});

module.exports = {
  apps: [
    {
      name: 'gamenight-api',
      script: 'api/dist/server.js',
      // Unprivileged as benloe-apps via the root-owned setpriv shim
      // (2026-08-02 privilege-separation audit). See
      // infra/scripts/node-as.template.sh.
      interpreter: '/usr/local/lib/benloe/node-as-benloe-apps',
      cwd: '/srv/benloe/apps/gamenight',
      instances: 1,
      exec_mode: 'fork',
      env: {
        NODE_ENV: 'production',
        PORT: 3001,
        AUTH_SERVICE_URL: 'http://localhost:3002',
        AUTH_DATABASE_URL: 'file:/srv/benloe/data/artanis.db',
        DATABASE_URL: 'file:/srv/benloe/data/gamenight.db',
        RATE_LIMIT_WINDOW_MS: '900000',
        RATE_LIMIT_MAX_REQUESTS: '100',
      },
      log_date_format: 'YYYY-MM-DD HH:mm:ss Z',
      error_file: '/srv/benloe/logs/gamenight-api-err.log',
      out_file: '/srv/benloe/logs/gamenight-api-out.log',
      time: true,
      watch: false,
      max_memory_restart: '1G',
      restart_delay: 4000,
    },
    {
      name: 'gamenight-frontend',
      script: 'serve',
      env: {
        PM2_SERVE_PATH: '/srv/benloe/apps/gamenight/dist',
        PM2_SERVE_PORT: 3000,
        PM2_SERVE_SPA: 'true',
        PM2_SERVE_HOMEPAGE: '/index.html',
      },
      instances: 1,
      exec_mode: 'fork',
      log_date_format: 'YYYY-MM-DD HH:mm:ss Z',
      error_file: '/srv/benloe/logs/gamenight-frontend-err.log',
      out_file: '/srv/benloe/logs/gamenight-frontend-out.log',
      time: true,
      watch: false,
      max_memory_restart: '500M',
    },
  ],
};
