// Relay's only process. Internet-facing and it parses input from an outside
// agent, so it runs as the unprivileged `relay` user, which owns nothing but
// /var/lib/benloe-relay. No secrets: token hashes live in its database.
module.exports = {
  apps: [
    {
      name: 'relay-api',
      script: 'server.mjs',
      cwd: '/srv/benloe/apps/relay',
      // Root-owned setpriv shim (infra/scripts/node-as.template.sh with
      // __USER__=relay): drops to the relay uid before node starts.
      interpreter: '/usr/local/lib/benloe/node-as-relay',
      node_args: '--disable-warning=ExperimentalWarning',
      instances: 1,
      exec_mode: 'fork',
      env: {
        NODE_ENV: 'production',
        PORT: 3015,
        RELAY_DB: '/var/lib/benloe-relay/relay.db',
      },
      error_file: '/srv/benloe/logs/relay-api-err.log',
      out_file: '/srv/benloe/logs/relay-api-out.log',
      log_date_format: 'YYYY-MM-DD HH:mm:ss Z',
      time: true,
      watch: false,
      max_memory_restart: '200M',
    },
  ],
};
