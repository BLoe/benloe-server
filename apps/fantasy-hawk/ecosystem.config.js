// Read the rendered secrets by hand — PM2 has no access to the app's node_modules.
// The file is fantasy-hawk's OWN set merged over 'shared'; the Yahoo keys below
// are in it because they live in that set, not because this config selects them.
const fs = require('fs');
const envFile = fs.readFileSync('/run/benloe-secrets/fantasy-hawk.env', 'utf8');
const env = {};
envFile.split('\n').forEach(line => {
  const match = line.match(/^([^#=]+)=(.*)$/);
  if (match) env[match[1].trim()] = match[2].trim();
});

module.exports = {
  apps: [
    {
      name: 'fantasy-hawk-api',
      script: 'backend/dist/server.js',
      // Unprivileged as benloe-apps via the root-owned setpriv shim
      // (2026-08-02 privilege-separation audit). See
      // infra/scripts/node-as.template.sh.
      interpreter: '/usr/local/lib/benloe/node-as-benloe-apps',
      cwd: '/srv/benloe/apps/fantasy-hawk',
      instances: 1,
      exec_mode: 'fork',
      env: {
        NODE_ENV: 'production',
        PORT: 3005,
        YAHOO_CLIENT_ID: env.YAHOO_CLIENT_ID,
        YAHOO_CLIENT_SECRET: env.YAHOO_CLIENT_SECRET,
        YAHOO_CALLBACK_URL: 'https://fantasyhawk.benloe.com/api/oauth/callback',
        AUTH_SERVICE_URL: 'http://localhost:3002',
        DATABASE_PATH: '/srv/benloe/data/fantasy-hawk.db',
        FRONTEND_URL: 'https://fantasyhawk.benloe.com',
      },
      log_date_format: 'YYYY-MM-DD HH:mm:ss Z',
      error_file: '/srv/benloe/logs/fantasy-hawk-err.log',
      out_file: '/srv/benloe/logs/fantasy-hawk-out.log',
      time: true,
      watch: false,
      max_memory_restart: '1G',
      restart_delay: 4000,
    },
  ],
};
