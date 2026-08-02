module.exports = {
  apps: [
    {
      name: 'dada-api',
      // Runs unprivileged as benloe-apps (2026-08-02 privilege-separation
      // audit). The interpreter is a root-owned setpriv shim, so node starts
      // already-dropped and no app code ever evaluates as root. PM2's own uid
      // option cannot do this — its fork wrapper lives under /root (700) and
      // must stay readable to the target uid after the fork. Full reasoning:
      // infra/scripts/node-as.template.sh.
      //
      // Both the shim and this config are root-owned deliberately: everything
      // under apps/ is agent-writable, so a drop defined there could simply be
      // deleted. PM2 loads this from /etc/benloe/ecosystem/, never from here.
      script: './src/server.js',
      interpreter: '/usr/local/lib/benloe/node-as-benloe-apps',
      cwd: '/srv/benloe/apps/dada-api',
      instances: 1,
      exec_mode: 'fork',
      env: {
        NODE_ENV: 'production',
        PORT: 3004,
        DATABASE_PATH: '/srv/benloe/data/dada.db',
      },
      error_file: '/srv/benloe/logs/dada-api-err.log',
      out_file: '/srv/benloe/logs/dada-api-out.log',
      log_date_format: 'YYYY-MM-DD HH:mm:ss Z',
      merge_logs: true,
      autorestart: true,
      watch: false,
      max_memory_restart: '500M',
    },
  ],
};
