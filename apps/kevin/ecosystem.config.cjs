// Kevin's only process. PM2 loads this from /etc/benloe/ecosystem/kevin.config.js
// (deploy.sh installs it) and runs the release in /opt/kevin/current, never the
// repo. The interpreter is a root-owned shim that drops to the `kevin` uid and
// passes through only the variables named in it.
const fs = require('fs');

/** KEY=value lines of a file, values trimmed and unquoted. A file that cannot be read gives {}. */
function readEnvFile(path) {
  const out = {};
  let text = '';
  try {
    text = fs.readFileSync(path, 'utf8');
  } catch {
    return out;
  }
  for (const line of text.split('\n')) {
    const m = line.match(/^\s*(?:export\s+)?([A-Za-z0-9_]+)\s*=\s*(.*?)\s*$/);
    if (!m) continue;
    let v = m[2];
    if (v.length >= 2 && (v[0] === '"' || v[0] === "'") && v[v.length - 1] === v[0]) v = v.slice(1, -1);
    out[m[1]] = v.trim();
  }
  return out;
}

const env = readEnvFile('/run/benloe-secrets/kevin.env');
if (!Object.keys(env).length) throw new Error('kevin: /run/benloe-secrets/kevin.env is missing or empty');

// Who may sign in. No address is kept in this file (it is in a public repository): it is
// KEVIN_OWNER_EMAIL from the kevin secret set when that key is there, and otherwise the box
// owner's address from the root-owned bootstrap file /etc/benloe/benloe-secrets.conf
// (BENLOE_OWNER_EMAIL). If neither has one, the server refuses to start in production and says why.
const ownerEmail = env.KEVIN_OWNER_EMAIL || readEnvFile('/etc/benloe/benloe-secrets.conf').BENLOE_OWNER_EMAIL || '';

module.exports = {
  apps: [
    {
      name: 'kevin-api',
      script: 'dist/index.js',
      cwd: '/opt/kevin/current/server',
      interpreter: '/usr/local/lib/benloe/node-as-kevin',
      instances: 1,
      exec_mode: 'fork',
      env: {
        NODE_ENV: 'production',
        PORT: 3016,
        AUTH_SERVICE_URL: 'http://localhost:3002',
        // See ownerEmail above.
        ...(ownerEmail ? { KEVIN_OWNER_EMAIL: ownerEmail } : {}),
        KEVIN_PUBLIC_URL: 'https://kevin.benloe.com',
        KEVIN_TZ: 'America/New_York',
        KEVIN_DATA_DIR: '/var/lib/kevin',
        ANTHROPIC_API_KEY: env.ANTHROPIC_API_KEY,
        KEVIN_VAPID_PUBLIC_KEY: env.KEVIN_VAPID_PUBLIC_KEY,
        KEVIN_VAPID_PRIVATE_KEY: env.KEVIN_VAPID_PRIVATE_KEY,
        // Optional: turns on embeddings for recall when present in the kevin set.
        ...(env.OPENAI_API_KEY ? { OPENAI_API_KEY: env.OPENAI_API_KEY } : {}),
      },
      error_file: '/srv/benloe/logs/kevin-api-err.log',
      out_file: '/srv/benloe/logs/kevin-api-out.log',
      log_date_format: 'YYYY-MM-DD HH:mm:ss Z',
      time: true,
      watch: false,
      kill_timeout: 5000,
      max_memory_restart: '600M',
    },
  ],
};
