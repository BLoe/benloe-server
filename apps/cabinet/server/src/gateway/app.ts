import express, { type Request, type Response, type NextFunction } from 'express';
import cookieParser from 'cookie-parser';
import { randomUUID } from 'node:crypto';
import { readdirSync, statSync, readFileSync } from 'node:fs';
import { join, resolve as resolvePath, sep, extname } from 'node:path';
import type Database from 'better-sqlite3';
import type { EventEmitter } from 'node:events';
import type { AgentRuntime, TurnEvent } from '../runtime/agent.js';
import type { ApprovalQueue, ApprovalPacket } from '../tiers/approvals.js';
import type { Embedder, EmbedderStatus } from '../embeddings/index.js';
import type { EpisodicStore } from '../episodic/index.js';
import { pendingBackfillCount } from '../episodic/index.js';
import { retrievalLogCount } from '../episodic/retrieval-log.js';
import { recallLessons } from '../memory/lessons.js';
import { profileGap } from '../domains/profile.js';
import { encodeSse, SSE_HEARTBEAT } from './sse.js';
import type { MessagePart } from './fold.js';
import { createTranscriptRecorder, persistUserMessage } from './transcript.js';
import { markTurnInFlight, clearTurnInFlightIf } from './pendingTurn.js';
import { registerSurfaceRoutes } from './surfaces.js';
import { AttachmentError, ATTACHMENT_NAME_RE, mimeFromFilename, saveAttachment, type ImageMime } from './attachments.js';

export interface GatewayDeps {
  db: Database.Database;
  runtime: Pick<AgentRuntime, 'run' | 'interrupt' | 'authMode' | 'titleFor'> & {
    queue: { depth: number };
    /** Thread id of the turn executing right now, else null. Optional so
     *  narrow test fakes don't have to care; undefined reads as "no turn". */
    currentThread?: string | null;
  };
  approvals: ApprovalQueue;
  widgetBus: EventEmitter;
  ownerEmail: string;
  /** Injectable for tests; production uses global fetch → artanis. */
  authFetch?: typeof fetch;
  authServiceUrl?: string;
  /** healthz extras */
  embedderStatus?: () => EmbedderStatus;
  /** Auto-recall relevant lessons before a user turn (undefined in tests that don't care). */
  episodic?: EpisodicStore;
  embedder?: Embedder;
  /**
   * Owner/agent-authenticated manual trigger for scheduled jobs (weekly-review,
   * morning-briefing, heartbeat, maintenance) — POST /api/admin/jobs/:name/run.
   * Deliberately the actual Scheduler instance (or a narrow view of it), not a
   * rebuilt copy: firing this proves the scheduler→job wiring itself.
   */
  scheduler?: {
    has(name: string): boolean;
    runNow(name: string): Promise<void>;
    /**
     * Optional (not just for typing convenience): several gateway tests build
     * a narrow scheduler fake for the admin-trigger endpoint that predates
     * this method and has no reason to grow it. The real production
     * Scheduler always implements it — see scheduler/index.ts.
     */
    jobsHealth?(): Record<
      string,
      { lastRun: string | null; lastError: string | null; nextFireAt: string | null; lastResult: unknown }
    >;
  };
  /** healthz.buildMarker — the actually-built commit SHA (index.ts reads dist/build-info.json once at startup, written by scripts/write-build-info.mjs at build time). 'unknown' when absent (e.g. a dev `npm run dev` run, or tests). */
  buildMarker?: string;
  /** curated memory store, for the Brain surface (GET/PUT /api/memory) */
  memory?: { list(): string[]; read(file: string): string; update(file: string, content: string, reason: string): void };
  /** Injectable for tests; production defaults to the real dir. */
  reviewShotsDir?: string;
  /** Composer image attachments (§ vision spike). Injectable for tests; production defaults to the real dir. */
  attachmentsDir?: string;
  /** Where pending-turn.json (interrupted-turn resume, gateway/pendingTurn.ts) lives. Injectable for tests. */
  dataDir?: string;
}

export interface Principal {
  email: string;
  name: string | null;
  role: string; // "user" | "admin" | "agent"
  isOwner: boolean;
}
interface AuthedRequest extends Request {
  userEmail?: string;
  principal?: Principal;
}

export function buildApp(deps: GatewayDeps) {
  const app = express();
  // 10mb, not 2mb: a base64-encoded composer image attachment (up to
  // MAX_IMAGE_BYTES = 6mb decoded, ~8mb once base64-inflated) has to clear
  // this global parser before Express ever reaches a route — a route-local
  // express.json() override can't help, because this one already rejects an
  // oversized body first. Every other endpoint's payloads are tiny; raising
  // the ceiling costs nothing (it's a rejection threshold, not a pre-allocation).
  app.use(express.json({ limit: '10mb' }));
  app.use(cookieParser());

  const authFetch = deps.authFetch ?? fetch;
  const authUrl = deps.authServiceUrl ?? 'http://localhost:3002';

  // Public liveness only — everything else sits behind the owner wall.
  // buildMarker (short git sha, not a secret — repo is public) is included
  // so infra/scripts/cabinet-deploy-watch.sh can poll a plain unauthenticated
  // curl for deploy verification instead of standing up agent-bearer auth
  // for a detached shell script. /api/healthz below carries the full
  // authenticated detail.
  //
  // presence ('working'/'idle', mirroring /api/healthz's) plus the raw
  // queueDepth it's derived from are included for the same reason:
  // cabinet-deploy-watch.sh's drain step needs to know whether a turn is in
  // flight before it kills cabinet-api, and it's the same unauthenticated
  // shell-script caller — queue depth isn't sensitive (no content, just a
  // count), so exposing it here (and in its timeout log line) costs nothing.
  app.get('/healthz', (_req, res) => {
    const depth = deps.runtime.queue.depth;
    res.json({
      ok: true,
      buildMarker: deps.buildMarker ?? 'unknown',
      presence: depth > 0 ? 'working' : 'idle',
      queueDepth: depth,
    });
  });

  async function authenticate(req: AuthedRequest, res: Response, next: NextFunction) {
    try {
      // Humans present a session cookie; agents present a bearer access key.
      // Either way, Artanis resolves it to a principal.
      const token = req.cookies?.token;
      const authz = req.headers.authorization;
      if (!token && !authz) return res.status(401).json({ error: 'Authentication required' });
      const headers: Record<string, string> = authz ? { Authorization: authz } : { Cookie: `token=${token}` };
      const r = await authFetch(`${authUrl}/api/auth/me`, { headers });
      if (!r.ok) return res.status(401).json({ error: 'Authentication failed' });
      const { user } = (await r.json()) as { user?: { email?: string; name?: string | null; role?: string } };
      const isOwner = !!user?.email && user.email === deps.ownerEmail;
      const isAgent = user?.role === 'agent';
      if (!user?.email || (!isOwner && !isAgent)) {
        return res.status(403).json({ error: 'Not authorized for Cabinet' });
      }
      req.userEmail = user.email;
      req.principal = { email: user.email, name: user.name ?? null, role: user.role ?? 'user', isOwner };
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
    const by = (req as AuthedRequest).principal?.email ?? null;
    deps.db.prepare('INSERT INTO thread (id, title, kind, created_by) VALUES (?,?,?,?)').run(id, req.body?.title ?? null, 'user', by);
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
        `SELECT id, role, parts, usage, author, created_at FROM message
         WHERE thread_id = ? AND created_at < ? ORDER BY created_at DESC LIMIT ?`,
      )
      .all(req.params.id, before, limit) as { parts: string; usage: string | null }[];
    res.json({
      messages: rows.reverse().map((r) => ({ ...r, parts: JSON.parse(r.parts), usage: r.usage ? JSON.parse(r.usage) : null })),
      // Reattach-on-load (2026-07-15): is a turn executing on THIS thread
      // right now? A tab that (re)loads mid-turn uses this to show the
      // working strip and follow along via polling — the turn itself
      // survives any client disconnect; only the live view was lost before.
      live: deps.runtime.currentThread === req.params.id,
    });
  });

  // ---------- attachments (composer images — § vision spike, 2026-07-11) ----------
  // Bytes live on disk under an id (uuid + extension); message.parts only
  // ever stores that id + mediaType, never the bytes — same shape as
  // review-shots below, for the same reason (keep DB rows small, serve
  // through the existing /api auth wall instead of inlining base64).
  const ATTACHMENTS_DIR = resolvePath(deps.attachmentsDir ?? '/srv/benloe/data/cabinet/chat-images');

  app.post('/api/attachments', (req, res) => {
    const { mediaType, dataBase64 } = req.body ?? {};
    try {
      const saved = saveAttachment(ATTACHMENTS_DIR, mediaType, dataBase64);
      res.status(201).json(saved);
    } catch (err) {
      const message = err instanceof AttachmentError ? err.message : 'could not save attachment';
      res.status(400).json({ error: message });
    }
  });

  app.get('/api/attachments/:id', (req, res) => {
    const id = req.params.id ?? '';
    // Layer 1: charset allowlist rejects any path separator outright.
    if (!ATTACHMENT_NAME_RE.test(id)) return res.status(400).json({ error: 'invalid id' });
    const filePath = resolvePath(ATTACHMENTS_DIR, id);
    // Layer 2: resolve-and-verify the result actually lands inside the dir.
    if (!filePath.startsWith(ATTACHMENTS_DIR + sep)) return res.status(400).json({ error: 'invalid path' });
    let bytes: Buffer;
    try {
      bytes = readFileSync(filePath);
    } catch {
      return res.status(404).json({ error: 'not found' });
    }
    res.setHeader('Content-Type', mimeFromFilename(id) ?? 'application/octet-stream');
    // uuid filenames are never reused/overwritten — safe to cache hard once served.
    res.setHeader('Cache-Control', 'private, max-age=31536000, immutable');
    res.send(bytes);
  });

  // ---------- chat (the turn stream) ----------
  app.post('/api/chat', async (req, res) => {
    const { threadId, text, attachments } = req.body ?? {};
    const attachmentRefs = Array.isArray(attachments) ? attachments : [];
    if (typeof threadId !== 'string' || typeof text !== 'string' || (!text.trim() && attachmentRefs.length === 0)) {
      return res.status(400).json({ error: 'threadId and text (or an attachment) required' });
    }
    const thread = deps.db.prepare('SELECT id, title FROM thread WHERE id = ?').get(threadId) as
      | { id: string; title: string | null }
      | undefined;
    if (!thread) return res.status(404).json({ error: 'no such thread' });

    // Resolve each referenced attachment id to bytes + mediaType now, while a
    // plain 400 (not an SSE error mid-stream) is still possible — mirrors
    // the /api/attachments/:id read path above, minus re-validating mime
    // (mimeFromFilename derives it from the id itself, not client input).
    const images: { mediaType: ImageMime; base64: string }[] = [];
    const imageParts: MessagePart[] = [];
    for (const ref of attachmentRefs) {
      const id = typeof (ref as { id?: unknown })?.id === 'string' ? (ref as { id: string }).id : '';
      if (!ATTACHMENT_NAME_RE.test(id)) return res.status(400).json({ error: `invalid attachment id: ${id}` });
      const filePath = resolvePath(ATTACHMENTS_DIR, id);
      if (!filePath.startsWith(ATTACHMENTS_DIR + sep)) return res.status(400).json({ error: 'invalid attachment path' });
      const mediaType = mimeFromFilename(id);
      if (!mediaType) return res.status(400).json({ error: `unrecognized attachment type: ${id}` });
      let bytes: Buffer;
      try {
        bytes = readFileSync(filePath);
      } catch {
        return res.status(400).json({ error: `attachment not found: ${id}` });
      }
      images.push({ mediaType, base64: bytes.toString('base64') });
      imageParts.push({ type: 'image', id, mediaType });
    }

    const principal = (req as AuthedRequest).principal;
    const userParts: MessagePart[] = [...imageParts, ...(text.trim() ? [{ type: 'text' as const, text }] : [])];
    persistUserMessage(deps.db, threadId, userParts, principal?.email ?? null);
    deps.db
      .prepare("UPDATE thread SET updated_at = datetime('now'), created_by = COALESCE(created_by, ?) WHERE id = ?")
      .run(principal?.email ?? null, threadId);

    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    });

    // Live-persist rides inside the recorder now (transcript.ts) — upserts
    // the assistant row as events fold so a hard process kill mid-turn
    // can't erase the transcript. Shared with resume + cron turns.
    const recorder = createTranscriptRecorder({ db: deps.db, threadId });
    const send = (e: TurnEvent) => {
      recorder.onEvent(e);
      res.write(encodeSse({ event: e.type, data: e }));
      if (e.type === 'turn-start') {
        // Nudge OTHER tabs (this thread open elsewhere, or reloaded
        // mid-turn) to re-fetch and notice `live: true` — the sending tab
        // ignores this while its own stream is up. Paired with the same
        // broadcast in the finally below when the turn is over.
        broadcast('thread-activity', { threadId });
      }
    };

    // Auto-recall (§7.3 follow-up, 2026-07-09): a lesson sitting in the store
    // changed nothing about a future turn unless something proactively
    // recalled it — nothing did. Recall against the current user message
    // (symmetric with jobs.ts's snapshot pattern) and let recallLessons'
    // relevance cutoff decide what's worth injecting. Embedder down/crashed
    // must not break the turn — log and proceed lesson-less.
    let lessons: Awaited<ReturnType<typeof recallLessons>> = [];
    if (deps.episodic && deps.embedder) {
      try {
        lessons = await recallLessons(deps.episodic, deps.embedder, text, 4, deps.db);
      } catch (err) {
        console.warn(`chat: lesson recall failed for thread ${threadId}: ${(err as Error).message}`);
      }
    }

    // Profile-completeness check (mentorship Phase B) — cheap (a few indexed
    // COUNT queries + 3 file reads), self-quieting once genuinely complete.
    // When there's a gap, load ONBOARDING.md alongside it in the same turn
    // so the interview discipline (bright-line rules, the both-kinds-
    // sentinel requirement) is present the moment the gap is surfaced, not
    // just a bare "something's missing" note with no guidance attached.
    let profileGapText: string | null = null;
    if (deps.memory) {
      try {
        profileGapText = profileGap(deps.db, deps.memory);
      } catch (err) {
        console.warn(`chat: profile completeness check failed for thread ${threadId}: ${(err as Error).message}`);
      }
    }

    const hb = setInterval(() => res.write(SSE_HEARTBEAT), 25_000);
    // Durable breadcrumb for the interrupted-turn resume (pendingTurn.ts):
    // written now (even while this turn waits in the queue — a restart there
    // orphans the message just the same), removed on ANY graceful end in the
    // finally below. Only a hard process death leaves it for boot to find.
    const DATA_DIR = deps.dataDir ?? '/srv/benloe/data/cabinet';
    const turnMarker = markTurnInFlight(DATA_DIR, threadId, text);
    try {
      await deps.runtime.run({
        threadId, prompt: text, kind: 'user', onEvent: send,
        images: images.length ? images : undefined,
        promptInput: {
          // Tell Cabinet who it's talking to (Ben vs an agent like Benji).
          ...(principal ? { interlocutor: { name: principal.name ?? principal.email, role: principal.role, isOwner: principal.isOwner } } : {}),
          ...(lessons.length ? { lessons: lessons.map((l) => ({ text: l.text, domain: l.domain })) } : {}),
          ...(profileGapText ? { profileGap: profileGapText, domainFiles: ['ONBOARDING.md'] } : {}),
        },
      });
    } catch (err) {
      res.write(encodeSse({ event: 'error', data: { message: String((err as Error).message).slice(0, 300), retryable: true } }));
    } finally {
      clearInterval(hb);
      // Compare-before-clear: a turn that queued behind this one has already
      // overwritten the breadcrumb with its own — don't strip its protection.
      clearTurnInFlightIf(DATA_DIR, turnMarker);
      recorder.persist(deps.db, threadId);
      broadcast('thread-activity', { threadId });
      // Auto-name a still-"untitled" thread from its opening exchange. Best
      // effort — a titling failure must never surface to the chat turn — and
      // only on the first turn, so an established title is never overwritten.
      if (!thread.title?.trim() && recorder.parts.length > 0) {
        const assistantText = recorder.parts
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

  // ---------- admin: manual job trigger (mentorship session 2) ----------
  // Fires the exact JobSpec.run() the scheduler's own timer invokes (see
  // Scheduler.runNow) — proves the scheduler→job wiring, not a hand-run copy
  // of the job's logic. Async: weekly-review runs on the opus/xhigh route and
  // can take minutes, so this returns 202 immediately rather than blocking the
  // HTTP request; poll GET /api/threads/:id/messages on the job's system
  // thread (e.g. sys-weekly) to see the persisted transcript land.
  app.post('/api/admin/jobs/:name/run', (req, res) => {
    const principal = (req as AuthedRequest).principal;
    if (!principal || !(principal.isOwner || principal.role === 'agent')) {
      return res.status(403).json({ error: 'owner or agent role required' });
    }
    if (!deps.scheduler) return res.status(503).json({ error: 'scheduler not wired' });
    const { name } = req.params;
    if (!deps.scheduler.has(name)) return res.status(404).json({ error: `no such job: ${name}` });
    void deps.scheduler.runNow(name).catch((err) => {
      console.warn(`admin job trigger: ${name} failed: ${(err as Error).message}`);
    });
    res.status(202).json({ ok: true, started: name });
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
  // "Why did we spike" — by day and model, over a 30-day trailing window.
  app.get('/api/usage', (_req, res) => {
    const byDay = deps.db
      .prepare(
        `SELECT date(ts) day, model, SUM(input_tokens) input, SUM(output_tokens) output,
                SUM(cache_read) cache_read, SUM(cache_write) cache_write, SUM(COALESCE(cost_usd,0)) cost_usd, COUNT(*) turns
         FROM token_usage WHERE ts > datetime('now','-30 days') GROUP BY day, model ORDER BY day DESC`,
      )
      .all();
    res.json({ authMode: deps.runtime.authMode, byDay });
  });

  // "Are we near a wall" — fixed rolling windows that map to how Max plan
  // limits actually gate (rolling 5h window + a weekly cap; 24h/7d give
  // context around the 5h number). Kept as a separate endpoint from
  // /api/usage on purpose: distinct question, distinct shape, cleaner than
  // a mode param on one route.
  app.get('/api/usage/rolling', (_req, res) => {
    const windows: { id: '5h' | '24h' | '7d'; modifier: string }[] = [
      { id: '5h', modifier: '-5 hours' },
      { id: '24h', modifier: '-24 hours' },
      { id: '7d', modifier: '-7 days' },
    ];
    const rows = windows.map(({ id, modifier }) => {
      const r = deps.db
        .prepare(
          `SELECT COALESCE(SUM(input_tokens),0) input, COALESCE(SUM(output_tokens),0) output,
                  COALESCE(SUM(cache_read),0) cache_read, COALESCE(SUM(cache_write),0) cache_write,
                  COALESCE(SUM(cost_usd),0) cost_usd, COUNT(*) turns
           FROM token_usage WHERE ts > datetime('now', ?)`,
        )
        .get(modifier) as {
        input: number;
        output: number;
        cache_read: number;
        cache_write: number;
        cost_usd: number;
        turns: number;
      };
      // Cache-read:cache-write ratio — the health headline. High is good
      // (mostly reusing a stable prefix); collapsing toward 1 is the
      // regression signal (system prompt/context churning every turn).
      // null, not 0/Infinity, when there's no write to divide by yet.
      const cacheReadWriteRatio = r.cache_write > 0 ? Number((r.cache_read / r.cache_write).toFixed(2)) : null;
      return { window: id, ...r, cacheReadWriteRatio };
    });
    res.json({ authMode: deps.runtime.authMode, windows: rows });
  });

  // ---------- review screenshots ----------
  // Durable, authenticated way for a peer (e.g. benji) to retrieve
  // screenshots this agent takes during dev-server QA — they live on the
  // VPS filesystem and are otherwise unreachable. Read-only, scoped to one
  // directory and two extensions; nothing here writes or deletes.
  const REVIEW_SHOTS_DIR = resolvePath(deps.reviewShotsDir ?? '/srv/benloe/data/cabinet/review-screenshots');
  // No `/` or `\` in the charset at all, so no filename can smuggle a path
  // segment (encoded or not) — ".." only functions as a traversal token
  // when it's its own segment between separators.
  const SHOT_NAME_RE = /^[A-Za-z0-9._-]+\.(png|jpe?g)$/;
  const SHOT_CONTENT_TYPE: Record<string, string> = { png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg' };

  app.get('/api/review-shots', (_req, res) => {
    let names: string[];
    try {
      names = readdirSync(REVIEW_SHOTS_DIR);
    } catch {
      return res.json({ shots: [] }); // dir doesn't exist yet — not an error
    }
    const shots = names
      .filter((n) => SHOT_NAME_RE.test(n))
      .flatMap((name) => {
        try {
          const st = statSync(join(REVIEW_SHOTS_DIR, name));
          return st.isFile() ? [{ name, size: st.size, mtime: st.mtime.toISOString() }] : [];
        } catch {
          return []; // deleted between readdir and stat — skip, don't 500
        }
      })
      .sort((a, b) => b.mtime.localeCompare(a.mtime));
    res.json({ shots });
  });

  app.get('/api/review-shots/:name', (req, res) => {
    const name = req.params.name ?? '';
    // Layer 1: charset allowlist rejects any path separator outright.
    if (!SHOT_NAME_RE.test(name)) return res.status(400).json({ error: 'invalid name' });
    const filePath = resolvePath(REVIEW_SHOTS_DIR, name);
    // Layer 2: resolve-and-verify the result actually lands inside the dir.
    // Belt-and-suspenders over layer 1 — survives a future regex loosening.
    if (!filePath.startsWith(REVIEW_SHOTS_DIR + sep)) {
      return res.status(400).json({ error: 'invalid path' });
    }
    let st: ReturnType<typeof statSync>;
    try {
      st = statSync(filePath);
    } catch {
      return res.status(404).json({ error: 'not found' });
    }
    if (!st.isFile()) return res.status(404).json({ error: 'not found' });
    const ext = extname(name).slice(1).toLowerCase();
    res.setHeader('Content-Type', SHOT_CONTENT_TYPE[ext] ?? 'application/octet-stream');
    res.setHeader('Cache-Control', 'no-store'); // ephemeral QA artifacts, never cached
    res.send(readFileSync(filePath));
  });

  app.get('/api/healthz', (_req, res) => {
    let dbOk = false;
    try {
      deps.db.prepare('SELECT 1').get();
      dbOk = true;
    } catch { /* stays false */ }
    const depth = deps.runtime.queue.depth;
    // One health signal, not two: pendingBackfill lives inside embedder so a
    // single object answers "alive AND caught up?" — a ready embedder with a
    // growing pendingBackfill is exactly the silent-rot state this guards.
    const embedderStatus = deps.embedderStatus?.();
    const embedder = embedderStatus ? { ...embedderStatus, pendingBackfill: pendingBackfillCount(deps.db) } : null;
    res.json({
      ok: dbOk,
      db: dbOk,
      authMode: deps.runtime.authMode,
      embedder,
      // Per-job {lastRun, lastError, nextFireAt, lastResult} for every cron
      // job the scheduler holds (heartbeat, morning-briefing, evening-checkin,
      // weekly-review, maintenance) — closes the "silent cron death" class
      // observability audit flagged: the embedder was the only pipeline with
      // a real alive/dead signal, every scheduled job was ambiguous. Reuses
      // Scheduler's own tracking verbatim (see jobsHealth) — {} when no
      // scheduler is wired (e.g. CABINET_SCHEDULER=off).
      jobs: deps.scheduler?.jobsHealth?.() ?? {},
      // "Is the retrieval instrumentation harness actually accumulating
      // data?" (§ mentorship Phase 3, item 3) — a bare row count, not the
      // log's content; just enough to watch it grow off a near-empty corpus.
      retrievalLog: retrievalLogCount(deps.db),
      // The commit actually compiled into this running dist/ (see index.ts's
      // readBuildInfo + scripts/write-build-info.mjs) — deploy verification
      // is now a one-line healthz read instead of bundle-grep + process-
      // restart-timestamp archaeology.
      buildMarker: deps.buildMarker ?? 'unknown',
      queueDepth: depth,
      pendingApprovals: deps.approvals.pending().length,
      // presence for the v2 strip
      presence: depth > 0 ? 'working' : 'idle',
      presenceMeta: `${deps.approvals.pending().length} awaiting sign-off · queue ${depth}`,
    });
  });

  return app;
}
