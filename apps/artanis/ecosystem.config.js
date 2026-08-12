// Read the rendered secrets by hand — PM2 has no access to the app's node_modules.
// The file is artanis's OWN set merged over 'shared'; nothing another app
// keeps is in it, so a typo here cannot reach a secret artanis has no claim to.
const fs = require('fs');
const envFile = fs.readFileSync('/run/benloe-secrets/artanis.env', 'utf8');
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
      // Runs as its OWN uid (not benloe-apps) via a root-owned setpriv shim —
      // 2026-08-02 privilege-separation audit. Artanis issues the sessions
      // that guard every other app including Cabinet, so it gets the tightest
      // treatment on the box:
      //   - runs unprivileged, under a uid nothing else uses
      //   - its code tree is root-owned, so the agent cannot inject into it
      //   - its database moved to /var/lib/artanis (root:artanis 750), out of
      //     the agent-writable tree entirely
      // Before this, artanis ran as root with agent-writable code, and
      // artanis.db sat in /srv/benloe/data owned by claude-worker mode 600 —
      // the agent could read the users/sessions/api_keys tables directly, no
      // exploit required.
      interpreter: '/usr/local/lib/benloe/node-as-artanis',
      cwd: '/srv/benloe/apps/artanis',
      instances: 1,
      exec_mode: 'fork',
      env: {
        NODE_ENV: 'production',
        PORT: 3002,
        DATABASE_URL: 'file:/var/lib/artanis/artanis.db',
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
