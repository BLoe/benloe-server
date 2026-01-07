const fs = require('fs');

// Load environment variables from monorepo .env
const envFile = fs.readFileSync('/srv/benloe/.env', 'utf8');
const env = {};
envFile.split('\n').forEach(line => {
  const match = line.match(/^([^#=]+)=(.*)$/);
  if (match) env[match[1].trim()] = match[2].trim();
});

module.exports = {
  apps: [
    {
      name: 'yahoo-fantasy-mcp',
      script: 'dist/server.js',
      cwd: '/srv/benloe/apps/yahoo-fantasy-mcp',
      instances: 1,
      exec_mode: 'fork',
      env: {
        NODE_ENV: 'production',
        PORT: 3006,
        MCP_SERVER_URL: 'https://yahoomcp.benloe.com',
        MCP_YAHOO_CALLBACK_URL: 'https://yahoomcp.benloe.com/yahoo/callback',
        YAHOO_CLIENT_ID: env.YAHOO_CLIENT_ID,
        YAHOO_CLIENT_SECRET: env.YAHOO_CLIENT_SECRET,
        MCP_TOKEN_ENCRYPTION_KEY: env.MCP_TOKEN_ENCRYPTION_KEY,
        MCP_TOKEN_SECRET: env.MCP_TOKEN_SECRET || env.JWT_SECRET,
        DATABASE_PATH: '/srv/benloe/data/yahoo-fantasy-mcp.db',
      },
      log_date_format: 'YYYY-MM-DD HH:mm:ss Z',
      error_file: '/srv/benloe/logs/yahoo-fantasy-mcp-err.log',
      out_file: '/srv/benloe/logs/yahoo-fantasy-mcp-out.log',
      time: true,
      watch: false,
      max_memory_restart: '500M',
      restart_delay: 4000,
    },
  ],
};
