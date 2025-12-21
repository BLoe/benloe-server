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
      name: 'weights-api',
      script: './dist/server.js',
      cwd: '/srv/benloe/apps/weights-api',
      instances: 1,
      exec_mode: 'fork',
      env: {
        NODE_ENV: 'production',
        PORT: 3003,
        DATABASE_URL: 'file:/srv/benloe/data/weights.db',
        AUTH_SERVICE_URL: 'http://localhost:3002',
        JWT_SECRET: env.JWT_SECRET,
      },
      error_file: '/srv/benloe/logs/weights-api-err.log',
      out_file: '/srv/benloe/logs/weights-api-out.log',
      log_date_format: 'YYYY-MM-DD HH:mm:ss Z',
      time: true,
      watch: false,
      max_memory_restart: '500M',
    },
  ],
};
