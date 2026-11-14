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
  webpush.setVapidDetails(`mailto:${config.ownerEmail || 'owner@benloe.com'}`, config.vapidPublic, config.vapidPrivate);
  configured = true;
  return true;
}

export interface NotifyInput { title: string; body?: string; link?: string | null; source?: string | null }

/** Tests replace the sender. */
export const transport = {
  send: (sub: { endpoint: string; keys: { p256dh: string; auth: string } }, payload: string) => webpush.sendNotification(sub, payload, { TTL: 24 * 3600 }),
};

export async function notify(db: DB, n: NotifyInput): Promise<{ id: number; pushed: number }> {
  const link = n.link && n.link.startsWith('/') ? n.link : null;
  const id = Number(db.prepare('INSERT INTO notifications (at, title, body, link, source) VALUES (?,?,?,?,?)').run(nowIso(), n.title, n.body ?? '', link, n.source ?? 'kevin').lastInsertRowid);
  bus.publish({ type: 'notification', id, title: n.title, body: n.body ?? '', link });
  logEvent(db, `notification: ${n.title}${n.body ? ' — ' + n.body.slice(0, 200) : ''}`);
  let pushed = 0;
  if (setup()) {
    const subs = db.prepare('SELECT endpoint, keys FROM push_subscriptions').all() as { endpoint: string; keys: string }[];
    const payload = JSON.stringify({ id, title: n.title, body: n.body ?? '', link: link ?? '/' });
    await Promise.all(
      subs.map(async (s) => {
        try {
          await transport.send({ endpoint: s.endpoint, keys: JSON.parse(s.keys) as { p256dh: string; auth: string } }, payload);
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
