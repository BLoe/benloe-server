import express, { type Request, type Response, type NextFunction } from 'express';
import cookieParser from 'cookie-parser';
import { randomUUID } from 'node:crypto';
import type Database from 'better-sqlite3';
import type { EventEmitter } from 'node:events';
import type { AgentRuntime, TurnEvent } from '../runtime/agent.js';
import type { ApprovalQueue, ApprovalPacket } from '../tiers/approvals.js';
import { encodeSse, SSE_HEARTBEAT } from './sse.js';
import { foldEvent, type MessagePart } from './fold.js';
import { registerSurfaceRoutes } from './surfaces.js';

export interface GatewayDeps {
  db: Database.Database;
  runtime: Pick<AgentRuntime, 'run' | 'interrupt' | 'authMode' | 'titleFor'> & { queue: { depth: number } };
  approvals: ApprovalQueue;
  widgetBus: EventEmitter;
  ownerEmail: string;
  /** Injectable for tests; production uses global fetch → artanis. */
  authFetch?: typeof fetch;
  authServiceUrl?: string;
  /** healthz extras */
  embedderAlive?: () => boolean;
  /** curated memory store, for the Brain surface (GET/PUT /api/memory) */
  memory?: { list(): string[]; read(file: string): string; update(file: string, content: string, reason: string): void };
}

interface AuthedRequest extends Request {
  userEmail?: string;
}

export function buildApp(deps: GatewayDeps) {
  const app = express();
  app.use(express.json({ limit: '2mb' }));
  app.use(cookieParser());

  const authFetch = deps.authFetch ?? fetch;
  const authUrl = deps.authServiceUrl ?? 'http://localhost:3002';

  // Public liveness only — everything else sits behind the owner wall.
  app.get('/healthz', (_req, res) => res.json({ ok: true }));

  async function authenticate(req: AuthedRequest, res: Response, next: NextFunction) {
    try {
      const token = req.cookies?.token;
      if (!token) return res.status(401).json({ error: 'Authentication required' });
      const r = await authFetch(`${authUrl}/api/auth/me`, { headers: { Cookie: `token=${token}` } });
      if (!r.ok) return res.status(401).json({ error: 'Authentication failed' });
      const { user } = (await r.json()) as { user?: { email?: string } };
      if (!user?.email || user.email !== deps.ownerEmail) {
        return res.status(403).json({ error: 'Not authorized for PALS' }); // single-user hard wall (§4.2)
      }
      req.userEmail = user.email;
      next();
    } catch {
      res.status(401).json({ error: 'Authentication failed' });
    }
  }
  app.use('/api', authenticate as never);

  // Cabinet v2 surface endpoints (behind the wall). Contract: web/src/lib/contracts.ts.
  registerSurfaceRoutes(app, { db: deps.db, memory: deps.memory, queueDepth: () => deps.runtime.queue.depth });

  // ---------- threads ----------
  app.get('/api/threads', (_req, res) => {
    const rows = deps.db
      .prepare(
        `SELECT t.id, t.title, t.model_override, t.archived, t.updated_at,
                (SELECT COUNT(*) FROM message m WHERE m.thread_id = t.id) AS messages
         FROM thread t WHERE t.kind = 'user' ORDER BY t.updated_at DESC LIMIT 100`,
      )
      .all();
    res.json({ threads: rows });
  });

  app.post('/api/threads', (req, res) => {
    const id = randomUUID();
    deps.db.prepare('INSERT INTO thread (id, title, kind) VALUES (?,?,?)').run(id, req.body?.title ?? null, 'user');
    res.status(201).json({ id });
  });

  app.patch('/api/threads/:id', (req, res) => {
    const { title, archived, model_override } = req.body ?? {};
    const r = deps.db
      .prepare(
        `UPDATE thread SET title = COALESCE(?, title), archived = COALESCE(?, archived),
                model_override = COALESCE(?, model_override), updated_at = datetime('now') WHERE id = ?`,
      )
      .run(title ?? null, archived === undefined ? null : Number(archived), model_override ?? null, req.params.id);
    if (r.changes === 0) return res.status(404).json({ error: 'no such thread' });
    res.json({ ok: true });
  });

  app.get('/api/threads/:id/messages', (req, res) => {
    const limit = Math.min(Number(req.query.limit ?? 50), 200);
    const before = String(req.query.before ?? '9999-12-31');
    const rows = deps.db
      .prepare(
        `SELECT id, role, parts, usage, created_at FROM message
         WHERE thread_id = ? AND created_at < ? ORDER BY created_at DESC LIMIT ?`,
      )
      .all(req.params.id, before, limit) as { parts: string; usage: string | null }[];
    res.json({
      messages: rows.reverse().map((r) => ({ ...r, parts: JSON.parse(r.parts), usage: r.usage ? JSON.parse(r.usage) : null })),
    });
  });

  // ---------- chat (the turn stream) ----------
  app.post('/api/chat', async (req, res) => {
    const { threadId, text } = req.body ?? {};
    if (typeof threadId !== 'string' || typeof text !== 'string' || !text.trim()) {
      return res.status(400).json({ error: 'threadId and text required' });
    }
    const thread = deps.db.prepare('SELECT id, title FROM thread WHERE id = ?').get(threadId) as
      | { id: string; title: string | null }
      | undefined;
    if (!thread) return res.status(404).json({ error: 'no such thread' });

    deps.db
      .prepare('INSERT INTO message (id, thread_id, role, parts) VALUES (?,?,?,?)')
      .run(randomUUID(), threadId, 'user', JSON.stringify([{ type: 'text', text }]));
    deps.db.prepare("UPDATE thread SET updated_at = datetime('now') WHERE id = ?").run(threadId);

    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    });

    const parts: MessagePart[] = [];
    let assistantId: string | null = null;
    let usage: unknown = null;
    const send = (e: TurnEvent) => {
      if (e.type === 'turn-start') assistantId = e.messageId;
      if (e.type === 'turn-end') usage = e.usage;
      foldEvent(parts, e);
      res.write(encodeSse({ event: e.type, data: e }));
    };

    const hb = setInterval(() => res.write(SSE_HEARTBEAT), 25_000);
    try {
      await deps.runtime.run({ threadId, prompt: text, kind: 'user', onEvent: send });
    } catch (err) {
      res.write(encodeSse({ event: 'error', data: { message: String((err as Error).message).slice(0, 300), retryable: true } }));
    } finally {
      clearInterval(hb);
      if (parts.length > 0) {
        deps.db
          .prepare('INSERT INTO message (id, thread_id, role, parts, usage) VALUES (?,?,?,?,?)')
          .run(assistantId ?? randomUUID(), threadId, 'assistant', JSON.stringify(parts), usage ? JSON.stringify(usage) : null);
      }
      // Auto-name a still-"untitled" thread from its opening exchange. Best
      // effort — a titling failure must never surface to the chat turn — and
      // only on the first turn, so an established title is never overwritten.
      if (!thread.title?.trim() && parts.length > 0) {
        const assistantText = parts
          .filter((p): p is Extract<MessagePart, { type: 'text' }> => p.type === 'text')
          .map((p) => p.text)
          .join(' ')
          .trim();
        try {
          const title = await deps.runtime.titleFor(text, assistantText);
          if (title) {
            const upd = deps.db.prepare('UPDATE thread SET title = ? WHERE id = ? AND (title IS NULL OR title = ?)');
            const r = upd.run(title, threadId, '');
            if (r.changes > 0) broadcast('thread-titled', { id: threadId, title });
          }
        } catch { /* leave it untitled; never break the turn */ }
      }
      res.end();
    }
  });

  app.post('/api/interrupt', (req, res) => {
    res.json({ interrupted: deps.runtime.interrupt(req.body?.threadId) });
  });

  // ---------- approvals ----------
  app.get('/api/approvals', (_req, res) => res.json({ approvals: deps.approvals.pending() }));

  app.post('/api/approvals/:id', (req, res) => {
    const { approved, editedPayload, message } = req.body ?? {};
    if (typeof approved !== 'boolean') return res.status(400).json({ error: 'approved: boolean required' });
    const okDecision = deps.approvals.decide(req.params.id!, approved, editedPayload, message);
    if (!okDecision) return res.status(404).json({ error: 'not pending' });
    res.json({ ok: true });
  });

  // ---------- out-of-band event channel ----------
  const ring: { id: number; event: string; data: unknown }[] = [];
  let ringId = 0;
  const pushRing = (event: string, data: unknown) => {
    const entry = { id: ++ringId, event, data };
    ring.push(entry);
    if (ring.length > 200) ring.shift();
    return entry;
  };
  const listeners = new Set<Response>();
  const broadcast = (event: string, data: unknown) => {
    const entry = pushRing(event, data);
    for (const l of listeners) l.write(encodeSse({ event, data, id: String(entry.id) }));
  };
  deps.approvals.on('approval', (p: ApprovalPacket) => broadcast('approval', p));
  deps.approvals.on('decided', (d: { id: string; status: string }) => broadcast('approval-result', d));
  deps.widgetBus.on('push', (n: { event: string; data: unknown }) => broadcast(n.event, n.data));

  app.get('/api/events', (req, res) => {
    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    });
    const lastId = Number(req.headers['last-event-id'] ?? 0);
    for (const entry of ring) {
      if (entry.id > lastId) res.write(encodeSse({ event: entry.event, data: entry.data, id: String(entry.id) }));
    }
    listeners.add(res);
    const hb = setInterval(() => res.write(SSE_HEARTBEAT), 25_000);
    req.on('close', () => {
      clearInterval(hb);
      listeners.delete(res);
    });
  });

  // ---------- usage & health ----------
  app.get('/api/usage', (_req, res) => {
    const byDay = deps.db
      .prepare(
        `SELECT date(ts) day, model, SUM(input_tokens) input, SUM(output_tokens) output,
                SUM(cache_read) cache_read, SUM(COALESCE(cost_usd,0)) cost_usd, COUNT(*) turns
         FROM token_usage WHERE ts > datetime('now','-30 days') GROUP BY day, model ORDER BY day DESC`,
      )
      .all();
    res.json({ authMode: deps.runtime.authMode, byDay });
  });

  app.get('/api/healthz', (_req, res) => {
    let dbOk = false;
    try {
      deps.db.prepare('SELECT 1').get();
      dbOk = true;
    } catch { /* stays false */ }
    const depth = deps.runtime.queue.depth;
    res.json({
      ok: dbOk,
      db: dbOk,
      authMode: deps.runtime.authMode,
      embedder: deps.embedderAlive?.() ?? null,
      queueDepth: depth,
      pendingApprovals: deps.approvals.pending().length,
      // presence for the v2 strip
      presence: depth > 0 ? 'working' : 'idle',
      presenceMeta: `${deps.approvals.pending().length} awaiting sign-off · queue ${depth}`,
    });
  });

  return app;
}
