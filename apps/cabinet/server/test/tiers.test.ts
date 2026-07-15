import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openDb, type CabinetDb } from '../src/db/index.js';
import { classifyBash, classifyToolUse, parsePromotions, applyPromotions } from '../src/tiers/classify.js';
import { ApprovalQueue } from '../src/tiers/approvals.js';
import { buildGate, type GateContext } from '../src/tiers/gate.js';

const ctx: GateContext = { chatId: 't1', sessionKind: 'user', standingOrders: '' };

// ---------------------------------------------------------------------------
// §6 tier table, row by row.
// ---------------------------------------------------------------------------
describe('classification table (§6)', () => {
  it.each<[string, Record<string, unknown>, number]>([
    // Tier 4 — autonomous
    ['Read', { file_path: '/srv/benloe/apps/gamenight/api/src/index.ts' }, 4],
    ['Grep', { pattern: 'jwt', path: '/srv/benloe/apps/weights-api' }, 4],
    ['Bash', { command: 'git -C /srv/benloe status' }, 4],
    ['Bash', { command: 'ls -la /srv/benloe/apps' }, 4],
    ['Bash', { command: 'sudo /usr/local/sbin/cabinet-privops pm2-list' }, 4],
    ['Bash', { command: 'sqlite3 /srv/benloe/data/gamenight.db "SELECT 1"' }, 4],
    ['WebSearch', { query: 'sqlite-vec docs' }, 4],
    // Tier 3 — notify-after
    ['Write', { file_path: '/srv/benloe/static/benloe.com/games/new.html' }, 3],
    ['Edit', { file_path: '/srv/benloe/apps/dada-api/src/server.ts' }, 3],
    ['Write', { file_path: '/srv/benloe/apps/cabinet/web/src/App.tsx' }, 3], // web ok; server is not
    ['Bash', { command: 'npm run build' }, 3],
    ['Bash', { command: 'git add -A && git commit -m "x"' }, 3],
    ['Bash', { command: 'sudo /usr/local/sbin/cabinet-privops pm2-restart dada-api' }, 3],
    ['Bash', { command: 'curl -s http://localhost:3004/api/health' }, 3],
    // Tier 2 — approve-before
    ['Bash', { command: 'git push origin main' }, 2],
    ['Write', { file_path: '/srv/benloe/infra/caddy/cabinet.benloe.com' }, 2],
    ['Bash', { command: 'sudo /usr/local/sbin/cabinet-privops pm2-start /srv/benloe/apps/newapp/ecosystem.config.js' }, 2],
    ['Bash', { command: 'sudo /usr/local/sbin/cabinet-privops caddy-reload' }, 2],
    ['Bash', { command: 'rm -rf /srv/benloe/apps/dada-api/dist' }, 2],
    ['Bash', { command: 'curl https://api.example.com -d x=1' }, 2],
    ['Bash', { command: 'frobnicate --yes' }, 2], // unknown binary
    ['mcp__yahoo__submit_waiver_claim', {}, 2],
    ['mcp__google__gmail_send', {}, 2],
    // Tier 1 — human-only
    ['Bash', { command: 'apt install cowsay' }, 1],
    ['Bash', { command: 'systemctl restart caddy' }, 1],
    ['Bash', { command: 'ufw allow 9999' }, 1],
    // Tier 0 — blocked
    ['Read', { file_path: '/srv/benloe/.env' }, 0],
    ['Read', { file_path: '/root/.claude/.credentials.json' }, 0],
    ['Write', { file_path: '/srv/benloe/apps/artanis/src/server.ts' }, 0],
    ['Edit', { file_path: '/srv/benloe/apps/cabinet/server/src/tiers/gate.ts' }, 0], // self-modification
    ['Write', { file_path: '/etc/passwd' }, 0],
    ['Write', { file_path: '/srv/benloe/infra/systemd/cabinet.service' }, 0],
    ['Bash', { command: 'cat /srv/benloe/.env' }, 0],
    ['Bash', { command: 'sudo systemctl stop caddy' }, 0],
    ['Bash', { command: 'pm2 delete artanis-auth' }, 0],
    ['Bash', { command: 'echo pwned > /home/claude-worker/.ssh/authorized_keys' }, 0],
  ])('%s %j → tier %i', (tool, input, tier) => {
    expect(classifyToolUse(tool, input).tier).toBe(tier);
  });

  it('mcp catch-alls: cabinet tools are 4, unknown MCP is 2, yahoo reads are 4, lineup is 3', () => {
    expect(classifyToolUse('mcp__cabinet__log_food', {}).tier).toBe(4);
    expect(classifyToolUse('mcp__mystery__do_thing', {}).tier).toBe(2);
    expect(classifyToolUse('mcp__yahoo__get_league_standings', {}).tier).toBe(4);
    expect(classifyToolUse('mcp__yahoo__set_lineup', {}).tier).toBe(3);
  });
});

describe('bash classifier hardening', () => {
  it('compound commands take the max tier of their parts', () => {
    expect(classifyBash('ls && git push').tier).toBe(2);
    expect(classifyBash('git status; rm -rf dist').tier).toBe(2);
    expect(classifyBash('cat README.md | grep x').tier).toBe(4);
  });

  it('command substitution floors read-only claims to tier 2', () => {
    expect(classifyBash('echo $(cat /srv/benloe/.env)').tier).toBe(0); // protected path wins
    expect(classifyBash('echo `whoami`').tier).toBe(2);
  });

  it('symlinks cannot dodge protected-path checks', () => {
    const dir = mkdtempSync(join(tmpdir(), 'cabinet-link-'));
    const link = join(dir, 'innocent.txt');
    symlinkSync('/srv/benloe/.env', link);
    expect(classifyToolUse('Read', { file_path: link }).tier).toBe(0);
    expect(classifyBash(`cat ${link}`).tier).toBe(0);
    rmSync(dir, { recursive: true, force: true });
  });

  it('relative traversal cannot dodge write roots', () => {
    expect(classifyToolUse('Write', { file_path: '/srv/benloe/static/../.env' }).tier).toBe(0);
    expect(classifyToolUse('Write', { file_path: '/srv/benloe/static/../apps/artanis/x.ts' }).tier).toBe(0);
  });
});

describe('standing-order promotions', () => {
  it('parses PROMOTE lines and lifts exactly tier 2 → 3 for that class', () => {
    const orders = 'header\nPROMOTE: bash:git-push — static sites — 2026-07-07 — trusted\n';
    const promotions = parsePromotions(orders);
    expect(promotions.has('bash:git-push')).toBe(true);
    const pushed = applyPromotions(classifyBash('git push origin main'), promotions);
    expect(pushed.tier).toBe(3);
    // does not touch other classes or other tiers
    expect(applyPromotions(classifyBash('sudo systemctl stop caddy'), promotions).tier).toBe(0);
    expect(applyPromotions(classifyToolUse('Read', { file_path: '/srv/benloe/.env' }), promotions).tier).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// Gate behavior with a real DB-backed approval queue.
// ---------------------------------------------------------------------------
describe('gate + approvals', () => {
  let dir: string;
  let cabinet: CabinetDb;
  let approvals: ApprovalQueue;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'cabinet-gate-'));
    cabinet = openDb(join(dir, 'cabinet.db'));
    approvals = new ApprovalQueue(cabinet.db);
  });

  afterEach(() => {
    cabinet.close();
    rmSync(dir, { recursive: true, force: true });
  });

  const auditRows = () => cabinet.db.prepare('SELECT tool, tier, decision FROM action_audit ORDER BY id').all() as {
    tool: string;
    tier: number;
    decision: string;
  }[];

  it('tier 4 allows and audits', async () => {
    const gate = buildGate({ db: cabinet.db, approvals });
    const r = await gate('Read', { file_path: '/srv/benloe/README.md' }, ctx);
    expect(r.behavior).toBe('allow');
    expect(auditRows()).toEqual([{ tool: 'Read', tier: 4, decision: 'allowed' }]);
  });

  it('tier 3 allows, audits, and notifies', async () => {
    let notified = '';
    const gate = buildGate({ db: cabinet.db, approvals, events: { onNotify: (t) => (notified = t) } });
    const r = await gate('Write', { file_path: '/srv/benloe/static/x/index.html', content: 'x' }, ctx);
    expect(r.behavior).toBe('allow');
    expect(notified).toBe('Write');
  });

  it('tier 0 and tier 1 deny with explanation and audit', async () => {
    const gate = buildGate({ db: cabinet.db, approvals });
    const r0 = await gate('Read', { file_path: '/srv/benloe/.env' }, ctx);
    expect(r0.behavior).toBe('deny');
    const r1 = await gate('Bash', { command: 'apt upgrade' }, ctx);
    expect(r1).toMatchObject({ behavior: 'deny' });
    expect((r1 as { message: string }).message).toContain('Human-only');
    expect(auditRows().map((a) => a.decision)).toEqual(['denied', 'denied']);
  });

  it('tier 2 blocks until approved, then allows with the (possibly edited) input', async () => {
    const gate = buildGate({ db: cabinet.db, approvals });
    const pending = gate('Bash', { command: 'git push origin main' }, ctx);
    // decision arrives 50ms later, as if Ben tapped Approve
    setTimeout(() => {
      const [packet] = approvals.pending();
      approvals.decide(packet!.id, true);
    }, 50);
    const r = await pending;
    expect(r.behavior).toBe('allow');
    expect(auditRows().at(-1)).toMatchObject({ decision: 'approved' });
  });

  it('tier 2 deny prevents execution and carries the owner message', async () => {
    const gate = buildGate({ db: cabinet.db, approvals });
    const pending = gate('Bash', { command: 'git push origin main' }, ctx);
    setTimeout(() => approvals.decide(approvals.pending()[0]!.id, false, undefined, 'not yet'), 50);
    const r = await pending;
    expect(r).toMatchObject({ behavior: 'deny', message: 'not yet' });
  });

  it('tier 2 expires to deny', async () => {
    const shortQueue = new ApprovalQueue(cabinet.db, 80);
    const gate = buildGate({ db: cabinet.db, approvals: shortQueue });
    const r = await gate('Bash', { command: 'git push origin main' }, ctx);
    expect(r).toMatchObject({ behavior: 'deny' });
    const row = cabinet.db.prepare('SELECT status FROM approval').get() as { status: string };
    expect(row.status).toBe('expired');
  });

  it('non-interactive sessions fail fast on tier 2 but leave the packet visible', async () => {
    const gate = buildGate({ db: cabinet.db, approvals });
    const started = Date.now();
    const r = await gate('Bash', { command: 'git push origin main' }, { ...ctx, sessionKind: 'cron' });
    expect(r.behavior).toBe('deny');
    expect(Date.now() - started).toBeLessThan(5000);
  });

  it('expireOverdue sweeps stale pending rows after restart', () => {
    cabinet.db
      .prepare(
        `INSERT INTO approval (id, tier, action, payload, expires_at) VALUES ('stale', 2, 'x', '{}', datetime('now', '-1 hour'))`,
      )
      .run();
    expect(approvals.expireOverdue()).toBe(1);
  });

  describe('autonomy: full', () => {
    const full = () => buildGate({ db: cabinet.db, approvals, autonomy: 'full' });

    it('executes every tier without approval, recording the real tier + an autonomous decision', async () => {
      const gate = full();
      // a would-be tier-2 (git push) runs immediately, no approval enqueued
      const push = await gate('Bash', { command: 'git push origin main' }, ctx);
      expect(push.behavior).toBe('allow');
      // a would-be tier-1 human-only and tier-0 both run too
      const apt = await gate('Bash', { command: 'apt upgrade' }, ctx);
      const pm2 = await gate('Bash', { command: 'pm2 restart cabinet-api' }, ctx);
      expect(apt.behavior).toBe('allow');
      expect(pm2.behavior).toBe('allow');
      expect(approvals.pending()).toHaveLength(0); // nothing was ever gated
      const rows = auditRows();
      expect(rows.every((r) => r.decision === 'autonomous')).toBe(true);
      // the classifier still labels the audit trail with the true tier
      expect(rows.map((r) => r.tier).sort()).toEqual([0, 1, 2]);
    });

    it('does not block or notify — a tier-3 action just runs', async () => {
      let notified = '';
      const gate = buildGate({ db: cabinet.db, approvals, autonomy: 'full', events: { onNotify: (t) => (notified = t) } });
      const r = await gate('Write', { file_path: '/srv/benloe/static/x/index.html', content: 'x' }, ctx);
      expect(r.behavior).toBe('allow');
      expect(notified).toBe(''); // no notify plumbing fires in full mode
    });
  });
});

describe('pm2 ecosystem escalation guard', () => {
  it('writing any ecosystem.config.js is approval-gated (root pm2 evaluates them)', () => {
    expect(classifyToolUse('Write', { file_path: '/srv/benloe/apps/newapp/ecosystem.config.js' }).tier).toBe(2);
    expect(classifyToolUse('Edit', { file_path: '/srv/benloe/apps/dada-api/ecosystem.config.js' }).tier).toBe(2);
    // cabinet' own ecosystem stays Tier 0 via the self-modification denyWrite? No —
    // apps/cabinet root is writable; only server/ is denied. The ecosystem rule wins:
    expect(classifyToolUse('Write', { file_path: '/srv/benloe/apps/cabinet/ecosystem.config.js' }).tier).toBe(2);
  });
});
