// Notifications: one inbox row, one live event, and a web push to every
// subscribed device. A device whose subscription has expired is forgotten.
// web-push 4 is an ES module with named exports only (its published types still describe a default export).
import * as webpush from 'web-push';
import { bus } from './bus.js';
import { config } from './config.js';
import { type DB, nowIso } from './db.js';
import { logEvent } from './memory.js';

let configured = false;
function setup(): boolean {
  if (configured) return true;
  if (!config.vapidPublic || !config.vapidPrivate) return false;
  // The contact a push service may use about these messages: the owner's address, or the app's own URL when none is set.
  webpush.setVapidDetails(config.ownerEmail ? `mailto:${config.ownerEmail}` : config.publicUrl, config.vapidPublic, config.vapidPrivate);
  configured = true;
  return true;
}

export interface NotifyInput { title: string; body?: string; link?: string | null; source?: string | null }

/**
 * How long one push service gets to answer, in milliseconds. Reminders are sent one after another by
 * the job runner; none may wait on a service that never replies. (An object so a test can shorten it.)
 */
export const pushLimits = { timeoutMs: 10_000 };

/** Rejects if `p` has not settled after `ms`. */
function withDeadline<T>(p: Promise<T>, ms: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`no answer after ${ms} ms`)), ms);
    p.then(resolve, reject).finally(() => clearTimeout(timer));
  });
}

/** Tests replace the sender. */
export const transport = {
  // The request has its own socket timeout; notify() adds a deadline around whatever sender is in place.
  send: (sub: { endpoint: string; keys: { p256dh: string; auth: string } }, payload: string): Promise<unknown> => webpush.sendNotification(sub, payload, { TTL: 24 * 3600, timeout: pushLimits.timeoutMs }),
};

/**
 * A notification link is a path inside this app, or nothing. Tapping it navigates, and the text
 * can come from the model, so anything a browser could read as another site is dropped:
 * "//host" and "/\host" (browsers treat a backslash as a slash), any backslash, and control
 * characters (browsers strip tabs and newlines from URLs before parsing them).
 */
export function appLink(link: unknown): string | null {
  if (typeof link !== 'string' || link.length > 500) return null;
  if (!/^\/(?![/\\])/.test(link) || /[\\\u0000-\u001f\u007f]/.test(link)) return null;
  return link;
}

export async function notify(db: DB, n: NotifyInput): Promise<{ id: number; pushed: number }> {
  const link = appLink(n.link);
  const at = nowIso();
  const source = n.source ?? 'kevin';
  const id = Number(db.prepare('INSERT INTO notifications (at, title, body, link, source) VALUES (?,?,?,?,?)').run(at, n.title, n.body ?? '', link, source).lastInsertRowid);
  bus.publish({ type: 'notification', id, at, title: n.title, body: n.body ?? '', link, source });
  bus.publish({ type: 'data_changed', domains: ['system'] });
  logEvent(db, `notification: ${n.title}${n.body ? ' — ' + n.body.slice(0, 200) : ''}`);
  let pushed = 0;
  if (setup()) {
    const subs = db.prepare('SELECT endpoint, keys FROM push_subscriptions').all() as { endpoint: string; keys: string }[];
    const payload = JSON.stringify({ id, title: n.title, body: n.body ?? '', link: link ?? '/' });
    await Promise.all(
      subs.map(async (s) => {
        try {
          await withDeadline(transport.send({ endpoint: s.endpoint, keys: JSON.parse(s.keys) as { p256dh: string; auth: string } }, payload), pushLimits.timeoutMs + 2000);
          pushed++;
        } catch (e) {
          const status = (e as { statusCode?: number }).statusCode;
          if (status === 404 || status === 410) db.prepare('DELETE FROM push_subscriptions WHERE endpoint = ?').run(s.endpoint);
          else console.error('push failed', status, (e as Error).message);
        }
      }),
    );
  }
  return { id, pushed };
}

export function subscribe(db: DB, sub: { endpoint: string; keys: { p256dh: string; auth: string } }, ua: string | null): void {
  if (!/^https:\/\//.test(sub.endpoint) || !sub.keys?.p256dh || !sub.keys?.auth) throw new Error('not a push subscription');
  db.prepare('INSERT INTO push_subscriptions (endpoint, keys, ua, created_at) VALUES (?,?,?,?) ON CONFLICT(endpoint) DO UPDATE SET keys = excluded.keys, ua = excluded.ua')
    .run(sub.endpoint, JSON.stringify(sub.keys), ua, nowIso());
}
