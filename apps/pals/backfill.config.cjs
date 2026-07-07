// One-shot title backfill — same privilege model and env injection as the
// service (ecosystem.config.js). PM2 (root) reads /srv/benloe/.env here and
// injects exactly what the SDK needs; the forked process self-drops to
// claude-worker and never sees the secrets file. Run once, then delete:
//
//   pm2 start backfill.config.cjs && pm2 logs pals-backfill --lines 100
//   pm2 delete pals-backfill
const fs = require('fs');
const envFile = fs.readFileSync('/srv/benloe/.env', 'utf8');
const env = {};
envFile.split('\n').forEach((line) => {
  const match = line.match(/^([^#=]+)=(.*)$/);
  if (match) env[match[1].trim()] = match[2].trim();
});

module.exports = {
  apps: [
    {
      name: 'pals-backfill',
      script: './server/dist/scripts/backfill-titles.js',
      cwd: '/srv/benloe/apps/pals',
      interpreter: '/usr/local/bin/node',
      instances: 1,
      exec_mode: 'fork',
      autorestart: false, // one-shot: it exits when done
      env: {
        NODE_ENV: 'production',
        HOME: '/home/claude-worker',
        CLAUDE_CONFIG_DIR: '/home/claude-worker/.pals-claude', // Appendix B: mandatory isolation
        PALS_DATA_DIR: '/srv/benloe/data/pals',
        PALS_MODELS_DIR: '/srv/benloe/data/pals/models',
        PALS_CLAUDE_AUTH: env.PALS_CLAUDE_AUTH,
        CLAUDE_CODE_OAUTH_TOKEN: env.CLAUDE_CODE_OAUTH_TOKEN,
        ANTHROPIC_API_KEY: env.ANTHROPIC_API_KEY, // runtime strips the unused one
        PATH: '/usr/local/bin:/usr/bin:/bin',
      },
      error_file: '/srv/benloe/logs/pals-backfill-err.log',
      out_file: '/srv/benloe/logs/pals-backfill-out.log',
      log_date_format: 'YYYY-MM-DD HH:mm:ss Z',
      time: true,
    },
  ],
};
