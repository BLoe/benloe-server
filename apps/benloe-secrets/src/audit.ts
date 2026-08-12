/**
 * Append-only audit log for every change to the secret document.
 *
 * Written somewhere the services that consume secrets cannot reach:
 * /var/lib/benloe-secrets/audit.log, mode 0600, owned by this uid. The point is
 * that the record of who changed what survives the thing being wrong — a log
 * living inside the system it describes is a log you have to trust that system
 * to be correct about.
 *
 * Deliberately NOT in the SQLite database the document lives in, for the same
 * reason: a separate append-only file is checkable independently and survives
 * the database being restored from a backup.
 *
 * One line of JSON per event, so `tail -f` works and `jq` works. Never contains
 * the document, a value, or any fragment of one — only who did what, when, and
 * how big the result was.
 */
import { appendFileSync } from 'node:fs';

export interface AuditEvent {
  /** 'dashboard' (the owner in a browser), 'broker' (the unix socket, i.e.
   *  Cabinet), or 'boot' (the renderer at startup). */
  via: 'dashboard' | 'broker' | 'boot';
  /** 'document.save', 'document.read', 'materialize', 'plaid.request', … */
  action: string;
  /** Version the action produced or read. */
  version?: number;
  /** Shape of the result — counts only, never content. */
  key_count?: number;
  byte_length?: number;
  /** Credential name(s) involved, if any. Names are not secrets. */
  credentials?: string[];
  /** For proxied calls: which upstream path. Never the body. */
  path?: string;
  ok: boolean;
  /** Short reason on failure. Must never be derived from secret material. */
  error?: string;
  /** Authenticated principal for dashboard actions. */
  actor?: string;
}

export type AuditFn = (event: AuditEvent) => void;

/**
 * Never throws. A service that refuses to work because it could not write its
 * own log is a self-inflicted outage; one that works silently is a missing
 * record. We take the second and make the failure loud on stderr, which PM2
 * captures.
 */
export function createAuditLog(path: string): AuditFn {
  let warned = false;
  return (event: AuditEvent) => {
    const line = JSON.stringify({ at: new Date().toISOString(), ...event }) + '\n';
    try {
      appendFileSync(path, line, { mode: 0o600 });
    } catch (err) {
      if (!warned) {
        warned = true; // once per process — a broken log must not flood the logs
        console.error('audit: FAILED TO WRITE — changes are now unrecorded:', err instanceof Error ? err.message : err);
      }
      console.error('audit(unwritten):', line.trim());
    }
  };
}
