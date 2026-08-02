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
        // Web push (VAPID). The public key is handed to the browser; the
        // private key signs the JWT that identifies this server to the push
        // service. Rotating the pair invalidates every existing subscription,
        // so it lives in .env and is never regenerated on deploy.
        CABINET_VAPID_PUBLIC_KEY: env.CABINET_VAPID_PUBLIC_KEY,
        CABINET_VAPID_PRIVATE_KEY: env.CABINET_VAPID_PRIVATE_KEY,
        CABINET_VAPID_SUBJECT: env.CABINET_VAPID_SUBJECT,
        // GitHub App (cabinet-benloe) — the raw private key is scrubbed from
        // process.env at startup (server/src/integrations/githubApp.ts); agent
        // shells only ever inherit the short-lived GH_TOKEN it mints.
        GITHUB_APP_ID: env.GITHUB_APP_ID,
        GITHUB_APP_INSTALLATION_ID: env.GITHUB_APP_INSTALLATION_ID,
        GITHUB_APP_PRIVATE_KEY_B64: env.GITHUB_APP_PRIVATE_KEY_B64,
        // Master key for the encrypted credential store (migration 016). This
        // is the ONLY secret the money integration needs in .env — Plaid's
        // client_id, API secret and per-bank access tokens are all AES-256-GCM
        // rows in cabinet.db sealed under this key, so they can be added and
        // rotated from the UI without a root shell.
        //
        // Its absence is a supported (degraded) state, not a crash: the store
        // still answers "what is configured?" and refuses every decrypt. That
        // is exactly the state this deployment was silently in until
        // 2026-08-02, because this line did not exist — every credential write
        // would have 503'd and every Plaid call would have found no keys.
        // Generate with: openssl rand -base64 32
        CABINET_CRED_KEY: env.CABINET_CRED_KEY,
        // 'sandbox' (default) or 'production'. Not a secret — it only selects
        // which Plaid hostname to call, and the credentials themselves are
        // environment-specific, so a mismatch fails closed with an auth error
        // rather than reaching the wrong data.
        PLAID_ENV: env.PLAID_ENV,
        // Public origin, used to build the Plaid OAuth redirect_uri and the
        // webhook URL. Must match the "Allowed redirect URIs" entry in the
        // Plaid dashboard exactly.
        CABINET_PUBLIC_ORIGIN: env.CABINET_PUBLIC_ORIGIN || 'https://cabinet.benloe.com',
        // claude-worker's own nvm-managed node (v24.12.0) is the only place a
        // working, correctly-permissioned npm/npx/corepack actually lives on
        // this box — /usr/local/bin/node is a bare interpreter with no npm
        // bundled, and root's nvm install (whatever the Claude Agent SDK's
        // own shell-snapshot bootstrap prepends to PATH — see PLATFORM.md) is
        // root-owned and unreadable to this user, so it resolves to nothing.
        // Prepending the real path here means npm just works for Bash-tool
        // commands and for `npm run build` in the deploy script, without any
        // per-command HOME= prefix hack.
        PATH: '/home/claude-worker/.nvm/versions/node/v24.12.0/bin:/usr/local/bin:/usr/bin:/bin',
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
