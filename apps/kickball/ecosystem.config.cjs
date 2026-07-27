// PM2 does not have access to the app's node_modules, so read .env by hand.
const fs = require('fs');

const env = {};
for (const line of fs.readFileSync('/srv/benloe/.env', 'utf8').split('\n')) {
  const match = line.match(/^([^#=]+)=(.*)$/);
  if (match) env[match[1].trim()] = match[2].trim();
}

module.exports = {
  apps: [
    {
      name: 'kickball-api',
      script: './api/dist/server.js',
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
      max_memory_restart: '400M',
    },
  ],
};
