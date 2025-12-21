// Load .env file manually (PM2 doesn't have access to app's node_modules)
const fs = require('fs');
const envFile = fs.readFileSync('/srv/benloe/.env', 'utf8');
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
        JWT_SECRET: env.JWT_SECRET,
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
