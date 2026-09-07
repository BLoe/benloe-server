// Gavel holds no secrets of its own: authentication is delegated to artanis,
// which issues its cookie on .benloe.com, and every upstream it reads is public
// and read only before a draft. Its rendered secret set is therefore empty, and
// there is nothing here to load from it.
module.exports = {
  apps: [
    {
      name: 'gavel-api',
      script: './node_modules/.bin/tsx',
      args: 'src/server/index.ts',
      cwd: '/srv/benloe/apps/gavel',
      instances: 1,
      exec_mode: 'fork',
      env: {
        NODE_ENV: 'production',
        PORT: 3013,
        GAVEL_DATA_DIR: '/srv/benloe/data/gavel',
        // Which frozen snapshots to load at boot, comma separated.
        GAVEL_LEAGUES: 'columbus',
        AUTH_SERVICE_URL: 'http://localhost:3002',
        GAVEL_OWNER_EMAIL: 'below413@gmail.com',
      },
      error_file: '/srv/benloe/logs/gavel-api-err.log',
      out_file: '/srv/benloe/logs/gavel-api-out.log',
      log_date_format: 'YYYY-MM-DD HH:mm:ss Z',
      time: true,
      watch: false,
      // Holds one snapshot per league in memory; a board is a few MB.
      max_memory_restart: '400M',
    },
  ],
};
