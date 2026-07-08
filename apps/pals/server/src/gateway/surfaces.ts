/* ============================================================================
   Cabinet v2 surface endpoints — the server side of web/src/lib/contracts.ts.
   A5 freezes the API: every route returns contract-valid JSON (Ops + memory are
   already real; today/domains/recall are voiced placeholders that A11 fills
   from the domain tables). Mounted behind the owner auth wall by buildApp.
   ========================================================================== */
import type { Express, Request, Response } from 'express';
import { randomUUID } from 'node:crypto';
import type Database from 'better-sqlite3';

interface MemoryLike {
  list(): string[];
  read(file: string): string;
  update(file: string, content: string, reason: string): void;
}
export interface SurfaceDeps {
  db: Database.Database;
  memory?: MemoryLike;
  queueDepth?: () => number;
}

const REVERSIBLE = /write|edit|title|update|log_|add_|upsert|import|render|memory/i;

/* ---- voiced placeholders (A11 replaces with real domain reads) ---- */
const weight = [178.9, 178.7, 179.0, 178.6, 178.5, 178.6, 178.4];

function todayView() {
  return {
    greeting: 'Good morning, Ben.',
    greetingAccent: 'A quiet day',
    read: 'Protein three mornings straight and weight still drifting down — you’re set up well. The only real items are a refill that runs out Saturday and dining running hot with a week left in the cycle.',
    attention: [
      { id: 'att-1', severity: 'crit', badge: '℞', title: 'Metformin runs out Saturday', meta: '4 days · 2×/day',
        detail: 'Eight tablets left. I can reorder from your July plan and have it before you’re dry.',
        actions: [{ label: 'Reorder now', intent: 'reorder metformin', primary: true }, { label: 'Snooze', intent: 'snooze metformin refill' }] },
      { id: 'att-2', severity: 'warn', badge: '△', title: 'Dining budget at 92%', meta: '$46 left · 8 days',
        detail: 'At this pace you’ll finish about $70 over, like the last two months.',
        actions: [{ label: 'Review spend', intent: 'review dining spend' }, { label: 'Let it ride', intent: 'raise dining budget' }] },
    ],
    vitals: [
      { kind: 'dial', label: 'Nutrition · today', tag: 'on track', value: 142, max: 185, unit: '/ 185 g protein', sub: '1,840 / 2,300 kcal · 3 meals' },
      { kind: 'rule', label: 'Weight · 7-day', tag: '−0.6', readout: '178.4', unit: 'lb', points: weight, markerPct: 41 },
      { kind: 'ring', label: 'Tasks · due', tag: '3 today', tagTone: 'warn', value: 3, max: 11, center: '3', sub: '2 overdue' },
      { kind: 'stat', label: 'Cash · month', tag: '+ flow', big: '+$1,240', tone: 'ok', sub: 'in $6,180 · out $4,940', points: [18, 16, 17, 10, 12, 6], pointsColor: 'var(--patina)' },
    ],
    overnight: { count: 3, summary: 'backed up your data, indexed 2 journal entries, titled a thread' },
    sweptAt: new Date().toISOString(),
  };
}

const DOMAIN_LABELS: Record<string, string> = {
  nutrition: 'Nutrition', training: 'Training', health: 'Health',
  money: 'Money', admin: 'Admin', people: 'People', play: 'Play',
};

function domainView(id: string) {
  const label = DOMAIN_LABELS[id];
  if (!label) return null;
  return {
    id, label,
    instruments: [
      { kind: 'stat', label: `${label} · summary`, big: '—', sub: 'awaiting real data (A11)' },
    ],
    narrative: `Cabinet’s read of ${label.toLowerCase()} will land here once the domain reads are wired. The shape is frozen; the content is real in A11.`,
    log: [] as unknown[],
  };
}

function recall(query: string) {
  return {
    query,
    results: [
      { source: 'fact', title: 'Breakfast', snippet: '3 eggs and 2 toast, ~34 g protein', provenance: 'facts · nutrition', score: 0.94, ref: 'fact:breakfast' },
      { source: 'thread', title: 'Weight-tracker deploy', snippet: 'We shipped the weight tracker…', provenance: 'thread · 2026-07-05', score: 0.77, ref: 'thread:t-1a2b' },
    ],
  };
}

export function registerSurfaceRoutes(app: Express, deps: SurfaceDeps): void {
  const { db } = deps;

  app.get('/api/today', (_req: Request, res: Response) => res.json(todayView()));

  app.get('/api/domains/:domain', (req: Request, res: Response) => {
    const v = domainView(req.params.domain!);
    if (!v) return res.status(404).json({ error: 'no such domain' });
    res.json(v);
  });

  // Ops — REAL, from the audit trail.
  app.get('/api/ops', (req: Request, res: Response) => {
    const kind = typeof req.query.kind === 'string' ? req.query.kind : undefined;
    const rows = db
      .prepare(
        `SELECT id, ts, tool, tier, args, result, decision, thread_id, session_kind
         FROM action_audit ${kind ? 'WHERE session_kind = ?' : ''} ORDER BY id DESC LIMIT 200`,
      )
      .all(...(kind ? [kind] : [])) as Array<Record<string, unknown>>;
    const entries = rows.map((r) => ({
      id: String(r.id),
      at: String(r.ts),
      tool: String(r.tool),
      action: String(r.tool),
      reason: String(r.result ?? ''),
      tier: Number(r.tier ?? 4),
      kind: String(r.session_kind ?? 'user'),
      result: String(r.decision ?? ''),
      threadId: (r.thread_id as string) ?? null,
      reversible: REVERSIBLE.test(String(r.tool)),
      reverted: false,
    }));
    res.json({ entries });
  });

  app.post('/api/ops/:id/revert', (_req: Request, res: Response) => {
    // Real rollback (git/backup/audit-inverse) lands in A11; the contract is frozen.
    res.json({ ok: true });
  });

  // Memory — REAL, from the curated store when injected.
  app.get('/api/memory', (_req: Request, res: Response) => {
    if (!deps.memory) return res.json({ files: [], lessons: [] });
    const files = deps.memory.list()
      .filter((f) => !f.startsWith('domains/'))
      .map((name) => ({ name, content: deps.memory!.read(name), updatedAt: null, editable: name !== 'STANDING_ORDERS.md' }));
    res.json({ files, lessons: [] });
  });

  app.put('/api/memory/:name', (req: Request, res: Response) => {
    const content = (req.body as { content?: string })?.content;
    if (typeof content !== 'string') return res.status(400).json({ error: 'content required' });
    if (!deps.memory) return res.status(503).json({ error: 'memory store unavailable' });
    try {
      deps.memory.update(req.params.name!, content, 'edited via Brain surface');
      res.json({ ok: true });
    } catch (e) {
      res.status(400).json({ error: String((e as Error).message) });
    }
  });

  app.get('/api/recall', (req: Request, res: Response) => {
    res.json(recall(typeof req.query.q === 'string' ? req.query.q : ''));
  });

  app.post('/api/command', (req: Request, res: Response) => {
    const intent = (req.body as { intent?: string })?.intent;
    if (typeof intent !== 'string' || !intent.trim()) return res.status(400).json({ error: 'intent required' });
    const id = randomUUID();
    db.prepare('INSERT INTO thread (id, title, kind) VALUES (?,?,?)').run(id, null, 'user');
    res.status(201).json({ threadId: id });
  });
}
