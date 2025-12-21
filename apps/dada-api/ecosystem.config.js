module.exports = {
  apps: [
    {
      name: 'dada-api',
      script: './src/server.js',
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
