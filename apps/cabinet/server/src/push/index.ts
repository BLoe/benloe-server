import type Database from 'better-sqlite3';
import { encryptPayload, vapidAuthorization, type VapidKeys } from './webpush.js';

/**
 * Push delivery (2026-08-01).
 *
 * The gap this closes: RHYTHM.md's whole structure is pings — morning brief,
 * 3:30pm protein snack, evening block start, 10:30 wind-down — and every one
 * of them was being emitted to an in-process SSE bus that reaches Ben only if
 * a browser tab happens to be open. PLAYBOOK P1 says appointments beat
 * intentions; an appointment nobody is told about is an intention.
 *
 * Deliberately not email: the failure mode of an emailed 3:30 snack reminder
 * is that it lands in a pile with everything else and gets read at 7pm.
 */

export interface PushMessage {
  /** Notification title. Keep it short — Android truncates around 40 chars. */
  title: string;
  body: string;
  /**
   * Collapse key. A second ping with the same tag REPLACES the first rather
   * than stacking, which is what stops a missed morning brief and the evening
   * check-in from becoming a wall of stale notifications.
   */
  tag?: string;
  /** Where clicking it should land. Defaults to the chat surface. */
  url?: string;
  /** Recorded in push_delivery so a missing ping is diagnosable. */
  kind: string;
  /** True for wind-down/quiet pings: shows without a sound or vibration. */
  silent?: boolean;
}

export interface PushConfig {
  keys: VapidKeys;
  /** RFC 8292 requires a contact the push service can reach. */
  subject: string;
}

export interface PushSendResult {
  sent: number;
  failed: number;
  pruned: number;
}

interface SubRow {
  id: number;
  endpoint: string;
  p256dh: string;
  auth: string;
}

/** Read VAPID config from the environment; null when push isn't configured. */
export function pushConfigFromEnv(env: NodeJS.ProcessEnv = process.env): PushConfig | null {
  const publicKey = env.CABINET_VAPID_PUBLIC_KEY;
  const privateKey = env.CABINET_VAPID_PRIVATE_KEY;
  if (!publicKey || !privateKey) return null;
  return {
    keys: { publicKey, privateKey },
    subject: env.CABINET_VAPID_SUBJECT || `mailto:${env.CABINET_OWNER_EMAIL ?? 'root@benloe.com'}`,
  };
}

export class PushService {
  constructor(
    private db: Database.Database,
    private config: PushConfig | null,
    /** Injectable for tests; production uses global fetch. */
    private fetchImpl: typeof fetch = fetch,
  ) {}

  get configured(): boolean {
    return this.config !== null;
  }

  get publicKey(): string | null {
    return this.config?.keys.publicKey ?? null;
  }

  /** Upsert by endpoint: re-subscribing the same browser must not duplicate. */
  subscribe(sub: { endpoint: string; p256dh: string; auth: string; email?: string | null; label?: string | null }): void {
    this.db
      .prepare(
        `INSERT INTO push_subscription (endpoint, p256dh, auth, email, label)
         VALUES (?,?,?,?,?)
         ON CONFLICT(endpoint) DO UPDATE SET
           p256dh = excluded.p256dh,
           auth = excluded.auth,
           email = excluded.email,
           label = COALESCE(excluded.label, push_subscription.label),
           failures = 0,
           last_error = NULL`,
      )
      .run(sub.endpoint, sub.p256dh, sub.auth, sub.email ?? null, sub.label ?? null);
  }

  unsubscribe(endpoint: string): boolean {
    return this.db.prepare('DELETE FROM push_subscription WHERE endpoint = ?').run(endpoint).changes > 0;
  }

  list(): { id: number; endpoint: string; label: string | null; createdAt: string; lastOkAt: string | null; failures: number }[] {
    return this.db
      .prepare('SELECT id, endpoint, label, created_at AS createdAt, last_ok_at AS lastOkAt, failures FROM push_subscription ORDER BY id')
      .all() as never;
  }

  /**
   * Send to every registered device. Never throws: a push that fails is a
   * missed ping, and a missed ping must not take down the scheduled job that
   * was trying to send it.
   */
  async send(msg: PushMessage): Promise<PushSendResult> {
    const result: PushSendResult = { sent: 0, failed: 0, pruned: 0 };
    if (!this.config) {
      this.record(msg, result, 'push not configured (no VAPID keys)');
      return result;
    }
    const subs = this.db.prepare('SELECT id, endpoint, p256dh, auth FROM push_subscription').all() as SubRow[];
    if (subs.length === 0) {
      this.record(msg, result, 'no subscriptions registered');
      return result;
    }

    const payload = JSON.stringify({
      title: msg.title,
      body: msg.body,
      tag: msg.tag ?? msg.kind,
      url: msg.url ?? '/',
      silent: !!msg.silent,
    });

    let lastError: string | null = null;
    await Promise.all(
      subs.map(async (sub) => {
        try {
          const { body } = encryptPayload(payload, { p256dh: sub.p256dh, auth: sub.auth });
          const res = await this.fetchImpl(sub.endpoint, {
            method: 'POST',
            headers: {
              Authorization: vapidAuthorization({
                endpoint: sub.endpoint,
                subject: this.config!.subject,
                keys: this.config!.keys,
              }),
              'Content-Encoding': 'aes128gcm',
              'Content-Type': 'application/octet-stream',
              // How long the push service should hold it if the device is
              // offline. A 3:30 snack ping is worthless at 9pm, so this is
              // deliberately short rather than the 4-week maximum.
              TTL: '3600',
              Urgency: msg.silent ? 'low' : 'normal',
            },
            body: body as unknown as BodyInit,
          });

          if (res.status === 404 || res.status === 410) {
            // The endpoint is permanently gone (profile deleted, app removed).
            // Prune on sight; keeping it just generates failures forever.
            this.db.prepare('DELETE FROM push_subscription WHERE id = ?').run(sub.id);
            result.pruned++;
            return;
          }
          if (!res.ok) {
            lastError = `${res.status} ${(await res.text().catch(() => '')).slice(0, 200)}`;
            this.db
              .prepare('UPDATE push_subscription SET failures = failures + 1, last_error = ? WHERE id = ?')
              .run(lastError, sub.id);
            result.failed++;
            return;
          }
          this.db
            .prepare("UPDATE push_subscription SET last_ok_at = datetime('now'), failures = 0, last_error = NULL WHERE id = ?")
            .run(sub.id);
          result.sent++;
        } catch (err) {
          lastError = String((err as Error).message ?? err).slice(0, 200);
          this.db
            .prepare('UPDATE push_subscription SET failures = failures + 1, last_error = ? WHERE id = ?')
            .run(lastError, sub.id);
          result.failed++;
        }
      }),
    );

    this.record(msg, result, lastError);
    return result;
  }

  private record(msg: PushMessage, result: PushSendResult, error: string | null): void {
    try {
      this.db
        .prepare('INSERT INTO push_delivery (kind, title, body, sent, failed, error) VALUES (?,?,?,?,?,?)')
        .run(msg.kind, msg.title, msg.body.slice(0, 500), result.sent, result.failed, error);
    } catch {
      // Logging a delivery must never be the thing that breaks a delivery.
    }
  }
}
