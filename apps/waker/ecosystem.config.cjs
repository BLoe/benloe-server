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
      name: 'waker-api',
      // TypeScript run through tsx; only the browser bundle has a build step.
      script: './node_modules/.bin/tsx',
      args: 'src/server/index.ts',
      cwd: '/srv/benloe/apps/waker',
      instances: 1,
      exec_mode: 'fork',
      env: {
        NODE_ENV: 'production',
        PORT: 3012,
        WAKER_SOURCE: 'live',
        WAKER_CACHE_DIR: '/srv/benloe/data/waker-cache',
        // Signs the per-visitor session cookie and encrypts stored Sleeper tokens.
        JWT_SECRET: env.JWT_SECRET,
        // Same twelve-manager gate as sleeper-ui.
        SLEEPER_LOGIN_ENABLED: env.SLEEPER_LOGIN_ENABLED || 'true',
        SLEEPER_LOGIN_ALLOW: env.SLEEPER_LOGIN_ALLOW || '',
      },
      error_file: '/srv/benloe/logs/waker-api-err.log',
      out_file: '/srv/benloe/logs/waker-api-out.log',
      log_date_format: 'YYYY-MM-DD HH:mm:ss Z',
      time: true,
      watch: false,
      // Holds the Sleeper player index plus several third-party tables.
      max_memory_restart: '700M',
    },
  ],
};
