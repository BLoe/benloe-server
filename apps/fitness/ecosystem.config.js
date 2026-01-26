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
      name: 'fitness-api',
      script: './api/dist/server.js',
      cwd: '/srv/benloe/apps/fitness',
      instances: 1,
      exec_mode: 'fork',
      env: {
        NODE_ENV: 'production',
        PORT: 3007,
        DATABASE_URL: 'file:/srv/benloe/data/fitness.db',
        AUTH_SERVICE_URL: 'http://localhost:3002',
        WEIGHTS_API_URL: 'http://localhost:3003',
        JWT_SECRET: env.JWT_SECRET,
      },
      error_file: '/srv/benloe/logs/fitness-api-err.log',
      out_file: '/srv/benloe/logs/fitness-api-out.log',
      log_date_format: 'YYYY-MM-DD HH:mm:ss Z',
      time: true,
      watch: false,
      max_memory_restart: '500M',
    },
  ],
};
