import { existsSync, realpathSync } from 'node:fs';
import { dirname, isAbsolute, resolve } from 'node:path';

/** §6 — autonomy is a property of the action. 4=auto, 3=notify, 2=approve, 1=human-only, 0=blocked. */
export type Tier = 0 | 1 | 2 | 3 | 4;

export interface Classification {
  tier: Tier;
  /** Stable id for standing-order promotions and audit, e.g. 'bash:git-push'. */
  actionClass: string;
  reason: string;
}

export interface TierPolicy {
  /** Never readable or writable through any tool (Tier 0). */
  denyAlways: string[];
  /** Writable Tier-0 (reads fine): the agent must not modify these. */
  denyWrite: string[];
  /** Tier-3 write roots. */
  writeAllow: string[];
  /** Tier-2 write roots (approval): reviewed config surfaces. */
  writeApprove: string[];
}

export const DEFAULT_POLICY: TierPolicy = {
  denyAlways: [
    '/srv/benloe/.env',
    '/root',
    '/home/claude-worker/.ssh',
    '/home/claude-worker/.pals-claude',
    '/etc/sudoers',
    '/etc/sudoers.d',
    '/usr/local/sbin/pals-privops',
  ],
  denyWrite: [
    '/srv/benloe/apps/artanis',
    '/srv/benloe/apps/pals/server',
    '/srv/benloe/infra/systemd',
    '/srv/benloe/infra/scripts/pals-privops.sh',
    '/etc',
    '/usr',
    '/var',
    '/boot',
    '/opt',
  ],
  writeAllow: ['/srv/benloe/apps', '/srv/benloe/static', '/srv/benloe/docs', '/srv/benloe/data/pals', '/tmp'],
  writeApprove: ['/srv/benloe/infra/caddy'],
};

/** Resolve symlinks for the deepest existing ancestor so link tricks can't dodge prefix checks. */
export function canonicalize(path: string, cwd = '/srv/benloe'): string {
  let p = isAbsolute(path) ? path : resolve(cwd, path);
  let suffix = '';
  while (p !== '/') {
    if (existsSync(p)) {
      try {
        return resolve(realpathSync(p) + suffix);
      } catch {
        break;
      }
    }
    suffix = '/' + p.split('/').pop() + suffix;
    p = dirname(p);
  }
  return resolve(path);
}

const within = (p: string, roots: string[]) => roots.some((r) => p === r || p.startsWith(r + '/'));

export function classifyRead(path: string, policy = DEFAULT_POLICY): Classification {
  const p = canonicalize(path);
  if (within(p, policy.denyAlways) || /\/\.env(\.|$)/.test(p)) {
    return { tier: 0, actionClass: 'read-secret', reason: `read of protected path ${p}` };
  }
  return { tier: 4, actionClass: 'read', reason: 'read-only' };
}

export function classifyWrite(path: string, policy = DEFAULT_POLICY): Classification {
  const p = canonicalize(path);
  if (within(p, policy.denyAlways) || /\/\.env(\.|$)/.test(p)) {
    return { tier: 0, actionClass: 'write-secret', reason: `write to protected path ${p}` };
  }
  if (within(p, policy.denyWrite)) {
    return { tier: 0, actionClass: 'write-denied', reason: `write to Tier-0 path ${p}` };
  }
  if (within(p, policy.writeApprove)) {
    return { tier: 2, actionClass: 'caddy-config', reason: 'reviewed config surface' };
  }
  if (within(p, policy.writeAllow)) {
    return { tier: 3, actionClass: 'workspace-write', reason: 'workspace write' };
  }
  return { tier: 0, actionClass: 'write-outside', reason: `write outside allowed roots: ${p}` };
}

// ---------------------------------------------------------------------------
// Bash classification. Conservative by construction: unknown ⇒ Tier 2,
// compound commands take the max tier of their parts.
// ---------------------------------------------------------------------------

const READONLY_BIN = new Set([
  'ls', 'cat', 'head', 'tail', 'less', 'grep', 'rg', 'find', 'wc', 'pwd', 'echo', 'printf', 'which',
  'du', 'df', 'ps', 'stat', 'file', 'date', 'env', 'id', 'whoami', 'uname', 'sort', 'uniq', 'cut',
  'tr', 'diff', 'jq', 'sqlite3', 'true', 'test', 'realpath', 'basename', 'dirname', 'md5sum', 'sha256sum',
]);
const GIT_READONLY = new Set(['status', 'log', 'diff', 'show', 'branch', 'blame', 'remote', 'rev-parse', 'ls-files', 'check-ignore', 'stash']);
const GIT_LOCAL = new Set(['add', 'commit', 'checkout', 'switch', 'restore', 'mv', 'rm', 'init', 'merge', 'rebase', 'tag', 'cherry-pick']);
const BUILD_BIN = new Set(['npm', 'npx', 'node', 'tsx', 'tsc', 'vitest', 'make']);

function extractPathTokens(part: string): string[] {
  return part
    .split(/\s+/)
    .slice(1)
    .map((t) => t.replace(/[`'"();]/g, ''))
    .filter((t) => t.startsWith('/') || t.startsWith('./') || t.startsWith('../') || t.startsWith('~'))
    .map((t) => t.replace(/^~/, '/home/claude-worker'));
}

function classifyBashPart(part: string, policy: TierPolicy): Classification {
  const trimmed = part.trim();
  if (!trimmed) return { tier: 4, actionClass: 'bash:noop', reason: 'empty' };
  const words = trimmed.split(/\s+/);
  const bin = words[0]!.replace(/^.*\//, '');

  // sudo is dispatched before the path screen: the privops binary lives on a
  // protected path by design, and everything else under sudo is blocked anyway.
  if (bin !== 'sudo') {
    // Any referenced protected path sinks the whole part, whatever the binary.
    for (const tok of extractPathTokens(trimmed)) {
      const c = canonicalize(tok);
      if (within(c, policy.denyAlways) || /\/\.env(\.|$)/.test(c)) {
        return { tier: 0, actionClass: 'bash:protected-path', reason: `references protected path ${c}` };
      }
    }
  }

  if (bin === 'sudo') {
    if (words[1] === '/usr/local/sbin/pals-privops' || words[1] === 'pals-privops') {
      const sub = words[2] ?? '';
      if (sub === 'pm2-list') return { tier: 4, actionClass: 'privops:pm2-list', reason: 'privops read' };
      if (sub === 'pm2-restart') return { tier: 3, actionClass: 'privops:pm2-restart', reason: 'restart existing app' };
      if (sub === 'pm2-save') return { tier: 3, actionClass: 'privops:pm2-save', reason: 'persist pm2 state' };
      if (sub === 'pm2-start') return { tier: 2, actionClass: 'privops:pm2-start', reason: 'new service' };
      if (sub === 'caddy-reload') return { tier: 2, actionClass: 'privops:caddy-reload', reason: 'ingress change' };
      return { tier: 0, actionClass: 'privops:unknown', reason: `unknown privops subcommand ${sub}` };
    }
    return { tier: 0, actionClass: 'bash:sudo', reason: 'sudo outside privops is blocked' };
  }

  if (bin === 'git') {
    // Find the subcommand, skipping global option-with-value flags (-C <dir>, -c k=v, …).
    const OPT_WITH_ARG = new Set(['-C', '-c', '--git-dir', '--work-tree', '--namespace']);
    let sub = '';
    for (let i = 1; i < words.length; i++) {
      const w = words[i]!;
      if (OPT_WITH_ARG.has(w)) {
        i++; // skip the flag's value
        continue;
      }
      if (w.startsWith('-')) continue;
      sub = w;
      break;
    }
    if (sub === 'push') return { tier: 2, actionClass: 'bash:git-push', reason: 'publishes to public repo' };
    if (sub === 'reset' && trimmed.includes('--hard')) return { tier: 2, actionClass: 'bash:git-destructive', reason: 'discards work' };
    if (sub === 'clean') return { tier: 2, actionClass: 'bash:git-destructive', reason: 'deletes untracked files' };
    if (GIT_READONLY.has(sub)) return { tier: 4, actionClass: 'bash:git-read', reason: 'git read' };
    if (GIT_LOCAL.has(sub)) return { tier: 3, actionClass: 'bash:git-local', reason: 'local vcs' };
    return { tier: 2, actionClass: 'bash:git-other', reason: `unclassified git ${sub}` };
  }

  if (bin === 'pm2') {
    return { tier: 0, actionClass: 'bash:pm2-direct', reason: 'pm2 only via privops' };
  }
  if (bin === 'rm' || bin === 'rmdir' || bin === 'unlink') {
    return { tier: 2, actionClass: 'file-delete', reason: 'deletion is approval-gated' };
  }
  if (bin === 'curl' || bin === 'wget') {
    const local = /https?:\/\/(localhost|127\.0\.0\.1)/.test(trimmed);
    return local
      ? { tier: 3, actionClass: 'bash:curl-local', reason: 'local endpoint test' }
      : { tier: 2, actionClass: 'bash:curl-external', reason: 'external network side effects' };
  }
  if (bin === 'apt' || bin === 'apt-get' || bin === 'dpkg' || bin === 'snap' || bin === 'ufw' || bin === 'systemctl' || bin === 'reboot' || bin === 'shutdown') {
    return { tier: 1, actionClass: 'bash:os-admin', reason: 'OS administration is human-only' };
  }
  if (BUILD_BIN.has(bin)) {
    return { tier: 3, actionClass: 'bash:build', reason: 'build/test toolchain' };
  }
  if (READONLY_BIN.has(bin)) {
    return { tier: 4, actionClass: 'bash:readonly', reason: 'read-only command' };
  }
  if (bin === 'mkdir' || bin === 'touch' || bin === 'cp' || bin === 'mv' || bin === 'tee' || bin === 'sed' || bin === 'chmod' || bin === 'chown' || bin === 'ln') {
    // File mutations: tier by target paths (already screened for protected).
    const targets = extractPathTokens(trimmed);
    if (targets.length === 0) return { tier: 3, actionClass: 'workspace-write', reason: 'relative workspace mutation' };
    const cls = targets.map((t) => classifyWrite(t, policy));
    const worst = cls.reduce((a, b) => (b.tier < a.tier ? b : a));
    return worst;
  }
  return { tier: 2, actionClass: 'bash:unknown', reason: `unclassified command '${bin}'` };
}

export function classifyBash(command: string, policy = DEFAULT_POLICY): Classification {
  // Split on control operators; backticks/$( ) make a part unclassifiable → Tier 2 floor.
  const hasSubshell = /`|\$\(/.test(command);
  const parts = command.split(/&&|\|\||[;|\n]/g).filter((p) => p.trim());
  if (parts.length === 0) return { tier: 4, actionClass: 'bash:noop', reason: 'empty command' };
  let worst: Classification = { tier: 4, actionClass: 'bash:readonly', reason: 'all parts read-only' };
  for (const part of parts) {
    const c = classifyBashPart(part, policy);
    if (c.tier < worst.tier) worst = c;
  }
  if (hasSubshell && worst.tier > 2) {
    return { tier: 2, actionClass: 'bash:subshell', reason: 'command substitution defeats static classification' };
  }
  return worst;
}

// ---------------------------------------------------------------------------
// Top-level tool classification (§6 table).
// ---------------------------------------------------------------------------

const MCP_TIERS: [RegExp, Tier, string][] = [
  [/^mcp__pals__enqueue_approval$/, 4, 'pals-internal'],
  [/^mcp__pals__/, 4, 'pals-tool'],
  [/^mcp__yahoo__.*(set_lineup|edit_lineup)/, 3, 'fantasy-lineup'],
  [/^mcp__yahoo__.*(waiver|claim|trade)/, 2, 'fantasy-transaction'],
  [/^mcp__yahoo__/, 4, 'fantasy-read'],
  [/^mcp__google__.*gmail.*send/, 2, 'gmail-send'],
  [/^mcp__google__.*(create|update|delete|insert)/, 3, 'calendar-write'],
  [/^mcp__google__/, 4, 'google-read'],
  [/^mcp__plaid__/, 4, 'money-read'],
  [/^mcp__health__/, 4, 'health-read'],
];

export function classifyToolUse(toolName: string, input: Record<string, unknown>, policy = DEFAULT_POLICY): Classification {
  switch (toolName) {
    case 'Read':
    case 'Glob':
    case 'Grep':
      return classifyRead(String(input.file_path ?? input.path ?? input.pattern ?? '/srv/benloe'), policy);
    case 'Write':
    case 'Edit':
    case 'NotebookEdit':
      return classifyWrite(String(input.file_path ?? input.path ?? ''), policy);
    case 'Bash':
      return classifyBash(String(input.command ?? ''), policy);
    case 'WebSearch':
    case 'WebFetch':
      return { tier: 4, actionClass: 'web', reason: 'read-only web' };
    default: {
      for (const [pattern, tier, cls] of MCP_TIERS) {
        if (pattern.test(toolName)) return { tier, actionClass: cls, reason: `mcp rule ${cls}` };
      }
      if (toolName.startsWith('mcp__')) {
        return { tier: 2, actionClass: 'mcp:unknown', reason: `unknown MCP tool ${toolName}` };
      }
      return { tier: 2, actionClass: `tool:${toolName}`, reason: `unclassified tool ${toolName}` };
    }
  }
}

/** Parse PROMOTE lines from STANDING_ORDERS.md → action classes lifted 2→3. */
export function parsePromotions(standingOrders: string): Set<string> {
  const out = new Set<string>();
  for (const line of standingOrders.split('\n')) {
    const m = /^PROMOTE:\s*([a-z0-9:_-]+)/i.exec(line.trim());
    if (m) out.add(m[1]!.toLowerCase());
  }
  return out;
}

/** Apply promotions: an approved standing order turns approve-before into notify-after. */
export function applyPromotions(c: Classification, promotions: Set<string>): Classification {
  if (c.tier === 2 && promotions.has(c.actionClass.toLowerCase())) {
    return { ...c, tier: 3, reason: `${c.reason} (promoted by standing order)` };
  }
  return c;
}
