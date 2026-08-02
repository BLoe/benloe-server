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
      name: 'sleeper-ui',
      // The server is TypeScript run through tsx; there is no separate build step
      // for it, only for the browser bundle.
      script: './node_modules/.bin/tsx',
      args: 'src/server/index.ts',
      cwd: '/srv/benloe/apps/sleeper-ui',
      instances: 1,
      exec_mode: 'fork',
      env: {
        NODE_ENV: 'production',
        PORT: 3010,
        SLEEPER_SOURCE: 'live',
        SLEEPER_USERNAME: env.SLEEPER_USERNAME || 'BenLoe',
        SLEEPER_CACHE_DIR: '/srv/benloe/data/sleeper-ui-cache',
        // League chat. Absent token simply disables the Chat section.
        SLEEPER_TOKEN: env.SLEEPER_TOKEN || '',
        // Posting writes to a real league; it stays off unless .env says otherwise.
        SLEEPER_ALLOW_POSTING: env.SLEEPER_ALLOW_POSTING || 'false',
        // Signs the per-visitor session cookie and encrypts stored Sleeper tokens.
        JWT_SECRET: env.JWT_SECRET,
        // Sleeper sign-in. Set to 'false' to close it, or list usernames in
        // SLEEPER_LOGIN_ALLOW to restrict who may connect an account.
        SLEEPER_LOGIN_ENABLED: env.SLEEPER_LOGIN_ENABLED || 'true',
        SLEEPER_LOGIN_ALLOW: env.SLEEPER_LOGIN_ALLOW || '',
      },
      error_file: '/srv/benloe/logs/sleeper-ui-err.log',
      out_file: '/srv/benloe/logs/sleeper-ui-out.log',
      log_date_format: 'YYYY-MM-DD HH:mm:ss Z',
      time: true,
      watch: false,
      // The player index is ~14MB of JSON held in memory; give it headroom.
      max_memory_restart: '600M',
    },
  ],
};
