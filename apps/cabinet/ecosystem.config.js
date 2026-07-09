// Cabinet gateway — runs as claude-worker (privilege separation, §13.2).
// The root PM2 daemon reads /srv/benloe/.env (root-only) and injects exactly
// the env Cabinet needs; the process itself can never read the secrets file.
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
      name: 'cabinet-api',
      script: './server/dist/index.js',
      cwd: '/srv/benloe/apps/cabinet',
      interpreter: '/usr/local/bin/node',
      instances: 1,
      exec_mode: 'fork',
      env: {
        NODE_ENV: 'production',
        PORT: 3008,
        HOME: '/home/claude-worker',
        CLAUDE_CONFIG_DIR: '/home/claude-worker/.cabinet-claude', // Appendix B: mandatory isolation
        CABINET_DATA_DIR: '/srv/benloe/data/cabinet',
        CABINET_MODELS_DIR: '/srv/benloe/data/cabinet/models',
        CABINET_OWNER_EMAIL: env.CABINET_OWNER_EMAIL,
        CABINET_CLAUDE_AUTH: env.CABINET_CLAUDE_AUTH,
        CLAUDE_CODE_OAUTH_TOKEN: env.CLAUDE_CODE_OAUTH_TOKEN,
        ANTHROPIC_API_KEY: env.ANTHROPIC_API_KEY, // fallback path; runtime strips the unused one
        CABINET_BACKUP_PASSPHRASE: env.CABINET_BACKUP_PASSPHRASE,
        PATH: '/usr/local/bin:/usr/bin:/bin',
      },
      error_file: '/srv/benloe/logs/cabinet-api-err.log',
      out_file: '/srv/benloe/logs/cabinet-api-out.log',
      log_date_format: 'YYYY-MM-DD HH:mm:ss Z',
      time: true,
      watch: false,
      max_memory_restart: '1200M',
      kill_timeout: 10000,
    },
  ],
};
