// Written 2026-08-02 during the privilege-separation audit. This service had
// no ecosystem config at all — it was started ad-hoc from an interactive shell
// and had inherited that shell's environment (SSH_TTY, TMUX, CLAUDE_* and all),
// which is both fragile and impossible to reproduce after a daemon restart.
//
// PM2 loads this from /etc/benloe/ecosystem/, never from here; promote changes
// with `cabinet-privops install-ecosystem yahoo-fantasy-mcp` as real root.
const fs = require('fs');
const envFile = fs.readFileSync('/run/benloe-secrets/yahoo-fantasy-mcp.env', 'utf8');
const env = {};
envFile.split('\n').forEach((line) => {
  const match = line.match(/^([^#=]+)=(.*)$/);
  if (match) env[match[1].trim()] = match[2].trim();
});

module.exports = {
  apps: [
    {
      name: 'yahoo-fantasy-mcp',
      script: 'dist/server.js',
      // Unprivileged as benloe-apps via the root-owned setpriv shim.
      interpreter: '/usr/local/lib/benloe/node-as-benloe-apps',
      cwd: '/srv/benloe/apps/yahoo-fantasy-mcp',
      instances: 1,
      exec_mode: 'fork',
      env: {
        NODE_ENV: 'production',
        PORT: 3006,
        MCP_SERVER_URL: 'https://yahoomcp.benloe.com',
        MCP_YAHOO_CALLBACK_URL: 'https://yahoomcp.benloe.com/yahoo/callback',
        DATABASE_PATH: '/srv/benloe/data/yahoo-fantasy-mcp.db',
        YAHOO_CLIENT_ID: env.YAHOO_CLIENT_ID,
        YAHOO_CLIENT_SECRET: env.YAHOO_CLIENT_SECRET,
        MCP_TOKEN_ENCRYPTION_KEY: env.MCP_TOKEN_ENCRYPTION_KEY,
        MCP_TOKEN_SECRET: env.MCP_TOKEN_SECRET,
      },
      error_file: '/srv/benloe/logs/yahoo-fantasy-mcp-err.log',
      out_file: '/srv/benloe/logs/yahoo-fantasy-mcp-out.log',
      log_date_format: 'YYYY-MM-DD HH:mm:ss Z',
      time: true,
      watch: false,
      max_memory_restart: '500M',
    },
  ],
};
