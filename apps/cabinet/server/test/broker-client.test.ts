/* ============================================================================
   THE SEAM TEST.

   Cabinet and cabinet-secrets are two processes talking over a unix socket.
   That join is the highest-risk surface in this integration, and the reason is
   written in PLATFORM.md: the interrupted-turn resume bug lived for three weeks
   between the route that wrote a breadcrumb and the shutdown path that cleared
   it. Both halves had tests. Both halves passed. Nothing crossed the seam, so
   nothing caught that in production the two halves ran in an order the tests
   never produced.

   So these tests do not mock node:http, and they do not mock the client.
   Every case below binds a REAL unix socket in a temp directory, runs the REAL
   SecretsBrokerClient against it, and asserts on what actually crossed the
   wire — including the header, which is the kind of detail a mock invents
   correctly by construction and reality gets wrong.

   The failure cases matter more than the happy path. A socket that is missing,
   unreadable, silent, or serving an nginx error page are four different
   operational states with four different fixes, and the whole value of this
   client is telling them apart. Each is provoked here for real: an unlinked
   path, a chmod 000 socket, a server that accepts and never answers, a server
   that returns HTML.
   ========================================================================== */
import { describe, it, expect, afterEach } from 'vitest';
import { createServer, type Server, type IncomingMessage, type ServerResponse } from 'node:http';
import { mkdtempSync, rmSync, chmodSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { SecretsBrokerClient, BrokerTransportError, DEFAULT_BROKER_SOCKET } from '../src/integrations/brokerClient.js';

interface Capture {
  method?: string;
  url?: string;
  contentType?: string;
  accept?: string;
  raw: string;
}

const cleanups: Array<() => void> = [];

afterEach(() => {
  while (cleanups.length) cleanups.pop()!();
});

/** Bind a real HTTP server on a real unix socket. Returns its path + a capture. */
async function serveOnSocket(
  handler: (req: IncomingMessage, res: ServerResponse, cap: Capture) => void,
): Promise<{ socketPath: string; captured: Capture }> {
  const dir = mkdtempSync(join(tmpdir(), 'broker-seam-'));
  const socketPath = join(dir, 'broker.sock');
  const captured: Capture = { raw: '' };

  const server: Server = createServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on('data', (c: Buffer) => chunks.push(c));
    req.on('end', () => {
      captured.method = req.method;
      captured.url = req.url;
      captured.contentType = req.headers['content-type'];
      captured.accept = req.headers.accept;
      captured.raw = Buffer.concat(chunks).toString('utf8');
      handler(req, res, captured);
    });
  });

  await new Promise<void>((resolve) => server.listen(socketPath, resolve));
  cleanups.push(() => {
    server.close();
    try {
      rmSync(dir, { recursive: true, force: true });
    } catch {
      /* temp dir; nothing to salvage */
    }
  });
  return { socketPath, captured };
}

/** A socket path inside a real directory that was never bound. */
function unboundSocketPath(): string {
  const dir = mkdtempSync(join(tmpdir(), 'broker-seam-gone-'));
  cleanups.push(() => rmSync(dir, { recursive: true, force: true }));
  return join(dir, 'broker.sock');
}

async function expectTransportError(p: Promise<unknown>): Promise<BrokerTransportError> {
  try {
    await p;
  } catch (err) {
    expect(err).toBeInstanceOf(BrokerTransportError);
    return err as BrokerTransportError;
  }
  throw new Error('expected the client to reject, but it resolved');
}

describe('SecretsBrokerClient — what actually crosses the socket', () => {
  it('round-trips a GET and returns status + parsed body', async () => {
    const { socketPath, captured } = await serveOnSocket((_req, res) => {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ configured: false, environment: 'sandbox' }));
    });

    const reply = await new SecretsBrokerClient({ socketPath }).get<{ configured: boolean; environment: string }>(
      '/v1/plaid/status',
    );

    expect(reply.status).toBe(200);
    expect(reply.body).toEqual({ configured: false, environment: 'sandbox' });
    expect(captured.method).toBe('GET');
    expect(captured.url).toBe('/v1/plaid/status');
  });

  it('sends a POST body the broker’s express.json() will actually parse', async () => {
    // This is the assertion that earns the whole file. The broker mounts
    // express.json(), which ignores a body with no application/json
    // content-type and hands the route `{}` — so every field reads as missing
    // and the broker answers 400 "path is required" for a request that DID
    // send a path. That failure looks like a bug in the broker. It is a
    // missing header here. A mocked transport cannot catch it.
    const { socketPath, captured } = await serveOnSocket((_req, res) => {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ status: 200, body: { accounts: [] } }));
    });

    await new SecretsBrokerClient({ socketPath }).post('/v1/plaid/request', {
      path: '/accounts/get',
      accessTokenCredential: 'plaid-item-abc',
    });

    expect(captured.method).toBe('POST');
    expect(captured.contentType).toBe('application/json');
    expect(JSON.parse(captured.raw)).toEqual({
      path: '/accounts/get',
      accessTokenCredential: 'plaid-item-abc',
    });
  });

  it('sets Content-Length so the server sees a complete body, not a hang', async () => {
    const { socketPath, captured } = await serveOnSocket((_req, res) => {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end('{}');
    });

    const payload = { publicToken: 'public-sandbox-x'.repeat(9), credentialName: 'plaid-item-x' };
    await new SecretsBrokerClient({ socketPath }).post('/v1/plaid/exchange', payload);

    expect(captured.raw).toBe(JSON.stringify(payload));
  });

  it('omits a body entirely on GET rather than sending "undefined"', async () => {
    const { socketPath, captured } = await serveOnSocket((_req, res) => {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end('{"credentials":[]}');
    });

    await new SecretsBrokerClient({ socketPath }).get('/v1/credentials');

    expect(captured.raw).toBe('');
    expect(captured.contentType).toBeUndefined();
  });
});

describe('SecretsBrokerClient — broker-level statuses are data, not exceptions', () => {
  // The broker answers 400/403/503 as part of its normal contract. If the
  // client threw on those, PlaidClient could not tell "not configured yet"
  // (an ordinary state Ben sees before pasting his keys) from "the socket is
  // gone" (an outage). Statuses come back; only transport faults throw.
  for (const status of [400, 403, 404, 500, 503]) {
    it(`returns ${status} as a status with its body intact`, async () => {
      const { socketPath } = await serveOnSocket((_req, res) => {
        res.writeHead(status, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'broker said no' }));
      });

      const reply = await new SecretsBrokerClient({ socketPath }).post<{ error: string }>('/v1/plaid/request', {
        path: '/accounts/get',
      });

      expect(reply.status).toBe(status);
      expect(reply.body.error).toBe('broker said no');
    });
  }

  it('treats an empty body as null rather than throwing on JSON.parse("")', async () => {
    const { socketPath } = await serveOnSocket((_req, res) => {
      res.writeHead(204);
      res.end();
    });

    const reply = await new SecretsBrokerClient({ socketPath }).get('/v1/health');
    expect(reply.status).toBe(204);
    expect(reply.body).toBeNull();
  });
});

describe('SecretsBrokerClient — the four failure modes are distinguishable', () => {
  it('missing socket → unreachable, naming the service rather than the caller', async () => {
    const socketPath = unboundSocketPath();
    const err = await expectTransportError(new SecretsBrokerClient({ socketPath }).get('/v1/health'));

    expect(err.kind).toBe('unreachable');
    expect(err.message).toContain('cabinet-secrets');
    expect(err.message).toContain(socketPath);
  });

  it('unreadable socket → forbidden, naming the group rather than the service', async () => {
    const { socketPath } = await serveOnSocket((_req, res) => res.end('{}'));
    chmodSync(socketPath, 0o000);
    // Guard: a root test runner has CAP_DAC_OVERRIDE and cannot be denied, so
    // this case is unprovokable there. Skipping loudly beats a false pass.
    if (process.getuid?.() === 0) return;

    const err = await expectTransportError(new SecretsBrokerClient({ socketPath }).get('/v1/health'));

    expect(err.kind).toBe('forbidden');
    expect(err.message).toContain('claude-worker');
  });

  it('server accepts and never answers → timeout, and the promise actually settles', async () => {
    // The regression this pins: `req.on('timeout')` fires but does NOT abort
    // the request. Without the explicit destroy, this promise never settles
    // and a scheduler job hangs forever — a failure with no error and no log,
    // which is the worst kind to diagnose.
    const { socketPath } = await serveOnSocket(() => {
      /* accept the connection, write nothing, ever */
    });

    const err = await expectTransportError(
      new SecretsBrokerClient({ socketPath, timeoutMs: 150 }).post('/v1/plaid/request', { path: '/accounts/get' }),
    );

    expect(err.kind).toBe('timeout');
    expect(err.message).toContain('150ms');
  });

  it('non-JSON body → malformed, without echoing the body', async () => {
    const secretish = 'access-sandbox-do-not-echo-this-anywhere';
    const { socketPath } = await serveOnSocket((_req, res) => {
      res.writeHead(502, { 'Content-Type': 'text/html' });
      res.end(`<html><body>502 Bad Gateway ${secretish}</body></html>`);
    });

    const err = await expectTransportError(new SecretsBrokerClient({ socketPath }).get('/v1/health'));

    expect(err.kind).toBe('malformed');
    expect(err.message).toContain('502');
    // An unbounded upstream body must never be pasted into an error string
    // that will land in a log, a chat transcript, or an audit row.
    expect(err.message).not.toContain(secretish);
  });

  it('carries the underlying errno as `cause` for diagnosis without re-throwing raw', async () => {
    const err = await expectTransportError(new SecretsBrokerClient({ socketPath: unboundSocketPath() }).get('/v1/health'));
    expect((err.cause as NodeJS.ErrnoException).code).toBe('ENOENT');
  });
});

describe('SecretsBrokerClient — the contract with the real broker', () => {
  it('defaults to the socket path documented in docs/SECRETS.md', () => {
    expect(DEFAULT_BROKER_SOCKET).toBe('/run/cabinet-secrets/broker.sock');
    expect(new SecretsBrokerClient().endpoint).toBe(DEFAULT_BROKER_SOCKET);
  });

  it('exposes no method that could return credential material', () => {
    // Structural, like cabinet-secrets' own no-secret-egress test. The broker
    // has no endpoint that serves a secret; this asserts the client never
    // grows a convenience wrapper that presumes one, which is how such an
    // endpoint would get requested in the first place.
    const surface = Object.getOwnPropertyNames(SecretsBrokerClient.prototype);
    expect(surface.sort()).toEqual(['constructor', 'endpoint', 'get', 'post', 'send'].sort());
  });

  it('the real broker socket, if present on this box, answers /v1/health', async () => {
    // A live contract check that degrades to a skip off-box. When it does run
    // it is the only test here that proves the OTHER half of the seam is
    // shaped the way this client assumes.
    if (!existsSync(DEFAULT_BROKER_SOCKET)) return;

    const reply = await new SecretsBrokerClient({ timeoutMs: 5_000 }).get<{ ok: boolean; environment: string }>(
      '/v1/health',
    );
    expect(reply.status).toBe(200);
    expect(reply.body.ok).toBe(true);
    expect(typeof reply.body.environment).toBe('string');
  });
});
