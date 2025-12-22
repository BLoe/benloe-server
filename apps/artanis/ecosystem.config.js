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
      name: 'artanis-auth',
      script: 'dist/server.js',
      cwd: '/srv/benloe/apps/artanis',
      instances: 1,
      exec_mode: 'fork',
      env: {
        NODE_ENV: 'production',
        PORT: 3002,
        DATABASE_URL: 'file:/srv/benloe/data/artanis.db',
        JWT_SECRET: env.JWT_SECRET,
        JWT_EXPIRES_IN: '30d',
        MAILGUN_API_KEY: env.MAILGUN_API_KEY,
        MAILGUN_DOMAIN: 'mail.benloe.com',
        MAILGUN_BASE_URL: 'https://api.mailgun.net',
        FROM_EMAIL: 'noreply@benloe.com',
        FRONTEND_URL: 'https://auth.benloe.com',
        DOMAIN: 'benloe.com',
        RATE_LIMIT_WINDOW_MS: '900000',
        RATE_LIMIT_MAX_REQUESTS: '10',
        ENCRYPTION_SECRET: env.ENCRYPTION_SECRET,
      },
      log_date_format: 'YYYY-MM-DD HH:mm:ss Z',
      error_file: '/srv/benloe/logs/artanis-err.log',
      out_file: '/srv/benloe/logs/artanis-out.log',
      time: true,
      watch: false,
      max_memory_restart: '1G',
      restart_delay: 4000,
    },
  ],
};
