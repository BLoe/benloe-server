/**
 * Append-only audit log for every credential use.
 *
 * This is the half of the design that survives the agent being wrong rather
 * than merely careless. Isolation stops Cabinet LEARNING a secret; it cannot
 * stop Cabinet ASKING the broker to use one, because using it on Cabinet's
 * behalf is the whole job. What bounds that is an honest record of every
 * request, written somewhere Cabinet cannot read, rewrite, or truncate:
 * /var/lib/cabinet-secrets/audit.log, mode 0600, owned by this uid.
 *
 * Deliberately NOT in the SQLite database the credentials live in. A log whose
 * rows can be deleted by the same code path that serves requests is a log you
 * have to trust the code to be correct about. A separate append-only file is
 * checkable independently, and survives the database being restored from a
 * backup.
 *
 * One line of JSON per event, so `tail -f` works and `jq` works. Never contains
 * a secret, a decrypted value, or a request body — only WHO asked for WHAT
 * capability against WHICH credential name, and how it turned out.
 */
import { appendFileSync } from 'node:fs';

export interface AuditEvent {
  /** 'broker' (the unix socket, i.e. Cabinet) or 'dashboard' (Ben in a browser). */
  via: 'broker' | 'dashboard';
  /** Capability exercised: 'plaid.request', 'credential.put', 'credential.delete', 'credential.list'. */
  action: string;
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
 * Never throws. A broker that refuses to serve because it could not write its
 * own log is a self-inflicted outage; a broker that serves silently is a
 * missing record. We take the second and make the failure loud on stderr,
 * which PM2 captures.
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
        console.error('audit: FAILED TO WRITE — credential use is now unrecorded:', err instanceof Error ? err.message : err);
      }
      console.error('audit(unwritten):', line.trim());
    }
  };
}
