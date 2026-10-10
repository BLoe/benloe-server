// Tipoff's only process: the auth gate in front of the static board, and the
// owner-only screenshot drop box. No secrets: auth is artanis's cookie checked
// on localhost, and the owner's email is not a secret.
module.exports = {
  apps: [
    {
      name: 'tipoff-api',
      script: 'server.mjs',
      cwd: '/srv/benloe/apps/tipoff',
      instances: 1,
      exec_mode: 'fork',
      env: {
        NODE_ENV: 'production',
        PORT: 3014,
        TIPOFF_UPLOAD_DIR: '/srv/benloe/data/tipoff/uploads',
        AUTH_SERVICE_URL: 'http://localhost:3002',
        TIPOFF_OWNER_EMAIL: 'below413@gmail.com',
      },
      error_file: '/srv/benloe/logs/tipoff-api-err.log',
      out_file: '/srv/benloe/logs/tipoff-api-out.log',
      log_date_format: 'YYYY-MM-DD HH:mm:ss Z',
      time: true,
      watch: false,
      max_memory_restart: '200M',
    },
  ],
};
