/* ============================================================================
   The client half of the cabinet-secrets broker seam.

   This file is one side of a two-process boundary, and it is deliberately dumb:
   it moves JSON across a unix socket and classifies failures. It holds no
   credential material, because there is none to hold — that is the entire point
   of the broker. Cabinet names a credential; the broker injects and calls.

   ## Why node:http and not fetch
   Node's global fetch cannot target a unix socket without an undici dispatcher.
   node:http takes `socketPath` natively, and this module needs roughly forty
   lines of it. That matches how the rest of Cabinet's integrations are built —
   integrations/plaid.ts hand-rolls its Plaid calls and githubApp.ts hand-rolls
   RS256 rather than taking a JWT library.

   ## Why failure classification is the real work here
   Four different things look like "the broker said no", and conflating them
   produces the worst kind of bug — a diagnosis that sends you to the wrong
   system:

     socket missing      → the broker isn't running
     socket EACCES       → this process isn't in the claude-worker group
     HTTP 503            → the broker is up; Plaid credentials aren't stored
     HTTP 403            → the broker is up and refused the path on purpose

   Only the third is a normal, expected state. The first two are operational
   faults and the fourth is a programming error in the caller. They get distinct
   error codes so a log line names the system to go look at.

   ## What this file must never grow
   A method that returns credential material. There is no broker endpoint that
   serves one, and if one is ever added, this client should not be the thing
   that makes it convenient to call.
   ========================================================================== */
import { request as httpRequest } from 'node:http';

/** Default socket path — 0660 cabinet-secrets:claude-worker, per docs/SECRETS.md. */
export const DEFAULT_BROKER_SOCKET = '/run/cabinet-secrets/broker.sock';

export type BrokerFailureKind =
  /** No socket at that path — the broker service is not running. */
  | 'unreachable'
  /** Socket exists, connect refused by the kernel — a uid/group problem. */
  | 'forbidden'
  /** Connected, but the broker did not answer within the timeout. */
  | 'timeout'
  /** Connected and answered, but the body was not the JSON we expect. */
  | 'malformed';

export class BrokerTransportError extends Error {
  constructor(
    readonly kind: BrokerFailureKind,
    message: string,
    readonly cause?: unknown,
  ) {
    super(message);
    this.name = 'BrokerTransportError';
  }
}

export interface BrokerReply<T> {
  /** The broker's own HTTP status. 200 does NOT imply the upstream call succeeded. */
  status: number;
  body: T;
}

export interface BrokerClientOptions {
  socketPath?: string;
  /**
   * Per-request ceiling. Generous because /v1/plaid/request proxies a live
   * Plaid call — a slow bank is not a broker fault — but finite, because a
   * hung socket read would otherwise wedge a scheduler job forever.
   */
  timeoutMs?: number;
}

export class SecretsBrokerClient {
  private readonly socketPath: string;
  private readonly timeoutMs: number;

  constructor(opts: BrokerClientOptions = {}) {
    this.socketPath = opts.socketPath ?? DEFAULT_BROKER_SOCKET;
    this.timeoutMs = opts.timeoutMs ?? 60_000;
  }

  /** Where this client is pointed. Exposed for diagnostics, never for auth. */
  get endpoint(): string {
    return this.socketPath;
  }

  get<T>(path: string): Promise<BrokerReply<T>> {
    return this.send<T>('GET', path);
  }

  post<T>(path: string, body: unknown): Promise<BrokerReply<T>> {
    return this.send<T>('POST', path, body);
  }

  private send<T>(method: 'GET' | 'POST', path: string, body?: unknown): Promise<BrokerReply<T>> {
    const payload = body === undefined ? null : Buffer.from(JSON.stringify(body), 'utf8');

    return new Promise<BrokerReply<T>>((resolve, reject) => {
      let settled = false;
      const done = (fn: () => void) => {
        if (settled) return;
        settled = true;
        fn();
      };

      const req = httpRequest(
        {
          socketPath: this.socketPath,
          path,
          method,
          headers: {
            // The broker mounts express.json(); without this header the body
            // arrives as {} and every field reads as missing — a failure that
            // looks like a validation bug in the broker rather than a header
            // omission here.
            ...(payload ? { 'Content-Type': 'application/json', 'Content-Length': payload.length } : {}),
            Accept: 'application/json',
          },
          timeout: this.timeoutMs,
        },
        (res) => {
          const chunks: Buffer[] = [];
          res.on('data', (c: Buffer) => chunks.push(c));
          res.on('end', () => {
            const text = Buffer.concat(chunks).toString('utf8');
            let parsed: unknown;
            try {
              parsed = text ? JSON.parse(text) : null;
            } catch {
              // Do not echo the body. It is unbounded, and on a misconfigured
              // socket it could be anything at all.
              return done(() =>
                reject(
                  new BrokerTransportError(
                    'malformed',
                    `Broker ${method} ${path} returned a non-JSON body (status ${res.statusCode ?? 0}).`,
                  ),
                ),
              );
            }
            done(() => resolve({ status: res.statusCode ?? 0, body: parsed as T }));
          });
          res.on('error', (err) =>
            done(() => reject(new BrokerTransportError('malformed', `Broker ${method} ${path} response failed.`, err))),
          );
        },
      );

      req.on('timeout', () => {
        // `timeout` does not abort the request on its own; without the destroy
        // the socket stays open and this promise never settles.
        req.destroy(new BrokerTransportError('timeout', `Broker ${method} ${path} timed out after ${this.timeoutMs}ms.`));
      });

      req.on('error', (err) => {
        done(() => reject(classify(err, method, path, this.socketPath)));
      });

      if (payload) req.write(payload);
      req.end();
    });
  }
}

/**
 * Turn a socket-level errno into a message that names the right system.
 *
 * ENOENT and EACCES are the two that actually happen, and they have completely
 * different fixes — one is "start the service", the other is "this process is
 * in the wrong group". A generic "broker unavailable" for both would send
 * someone restarting a service that was never down.
 */
function classify(err: unknown, method: string, path: string, socketPath: string): BrokerTransportError {
  if (err instanceof BrokerTransportError) return err;
  const code = (err as NodeJS.ErrnoException)?.code;
  const where = `Broker ${method} ${path}`;
  switch (code) {
    case 'ENOENT':
      return new BrokerTransportError(
        'unreachable',
        `${where}: no socket at ${socketPath} — the cabinet-secrets service is not running.`,
        err,
      );
    case 'ECONNREFUSED':
      return new BrokerTransportError(
        'unreachable',
        `${where}: connection refused at ${socketPath} — a stale socket file, or the service is restarting.`,
        err,
      );
    case 'EACCES':
    case 'EPERM':
      return new BrokerTransportError(
        'forbidden',
        `${where}: permission denied on ${socketPath} — this process is not in the claude-worker group.`,
        err,
      );
    case 'ETIMEDOUT':
      return new BrokerTransportError('timeout', `${where}: socket timed out.`, err);
    default:
      return new BrokerTransportError(
        'unreachable',
        `${where}: ${(err as Error)?.message ?? 'socket error'}`,
        err,
      );
  }
}
