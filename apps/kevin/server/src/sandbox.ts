// The server's side of the sandbox: hands one bash script to the sandbox runner
// (apps/kevin/sandbox/kevin-sandbox-run) and collects what it reports.
//
// In production the runner is reached through a unix socket that systemd listens
// on; systemd starts it per connection as the kevin-sh uid with no network, a
// private view of the filesystem, and a hard time limit that kills every process
// the script started (see setup.sh for the units). In tests and on a development
// machine the same runner is started directly as a child process and has only
// its own limits. Either way the request and the reply use the framing described
// at the top of the runner.
//
// This module never waits on the script's goodwill. It stops listening and
// returns when the reply's end frame arrives, when its own timer fires, when the
// caller aborts, or when too much output has arrived; in each of the last three
// it closes the connection, which is the runner's signal to kill the script.
import { spawn } from 'node:child_process';
import { connect } from 'node:net';
import type { Readable, Writable } from 'node:stream';

export interface SandboxRun {
  /** The script's exit code (128 + signal number if a signal ended it); null when it did not end by itself. */
  code: number | null;
  stdout: Buffer;
  stderr: string;
  timedOut: boolean;
  /** More output than `maxOut` arrived; the script was stopped. */
  overflow: boolean;
  /** Set when the sandbox could not be reached or ended without reporting: why. The script may not have run. */
  failure?: string;
}

export interface SandboxOpts {
  stdin?: Buffer;
  signal?: AbortSignal;
  /** Bytes of stdout plus stderr accepted before the script is stopped. */
  maxOut: number;
  /** Seconds the script may run. The runner caps this at 115. */
  seconds?: number;
  /** Working folder, used only when the runner is started directly; the systemd unit sets its own. */
  dir?: string;
}

/** How long past the script's own limit the server waits for the runner to report before giving up on it. */
const GRACE_MS = 10_000;

function request(script: string, stdin: Buffer, seconds: number): Buffer {
  const body = Buffer.from(script, 'utf8');
  const head = Buffer.alloc(4 + 4 + 4);
  head.write('KSB1', 0, 'latin1');
  head.writeUInt32BE(seconds, 4);
  head.writeUInt32BE(body.length, 8);
  const len = Buffer.alloc(8);
  len.writeBigUInt64BE(BigInt(stdin.length));
  return Buffer.concat([head, body, len, stdin]);
}

/**
 * Runs `script` with bash in the sandbox named by `target`: `['unix:/path/to.sock']` for the systemd
 * socket, or a command and its arguments that start the runner directly. Never rejects.
 */
export function runInSandbox(target: string[], script: string, o: SandboxOpts): Promise<SandboxRun> {
  const seconds = Math.min(Math.max(Math.round(o.seconds ?? 115), 1), 115);
  return new Promise((resolve) => {
    const out: Buffer[] = [];
    const err: Buffer[] = [];
    let size = 0;
    let pending: Buffer = Buffer.alloc(0);
    let settled = false;
    let close: () => void = () => undefined;

    const settle = (r: Partial<SandboxRun>) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      o.signal?.removeEventListener('abort', onAbort);
      close();
      resolve({ code: null, timedOut: false, overflow: false, ...r, stdout: Buffer.concat(out), stderr: Buffer.concat(err).toString('utf8') });
    };
    const onAbort = () => settle({ failure: 'stopped' });
    const timer = setTimeout(() => settle({ timedOut: true }), seconds * 1000 + GRACE_MS);
    if (o.signal?.aborted) return void settle({ failure: 'stopped' });
    o.signal?.addEventListener('abort', onAbort, { once: true });

    const onData = (chunk: Buffer) => {
      if (settled) return;
      pending = pending.length ? Buffer.concat([pending, chunk]) : chunk;
      while (pending.length >= 5) {
        const kind = pending[0]!;
        const len = pending.readUInt32BE(1);
        if (pending.length < 5 + len) break;
        const payload = pending.subarray(5, 5 + len);
        pending = pending.subarray(5 + len);
        if (kind === 3) {
          let end: { code?: number | null; timed_out?: boolean };
          try {
            end = JSON.parse(payload.toString('utf8')) as typeof end;
          } catch {
            return void settle({ failure: 'the sandbox sent a reply that could not be read' });
          }
          const code = typeof end.code === 'number' ? (end.code < 0 ? 128 - end.code : end.code) : null;
          return void settle({ code, timedOut: end.timed_out === true });
        }
        if (kind !== 1 && kind !== 2) return void settle({ failure: 'the sandbox sent a reply that could not be read' });
        size += payload.length;
        if (size > o.maxOut) return void settle({ overflow: true });
        (kind === 1 ? out : err).push(Buffer.from(payload));
      }
    };
    const wire = (input: Writable, output: Readable) => {
      output.on('data', onData);
      // Ended without an end frame: the runner was killed (the unit's hard limit) or never started.
      output.on('end', () => settle({ failure: 'the sandbox ended without reporting a result (it could not start, or was killed at its hard limits)' }));
      // The runner may stop reading before the whole request is written (a refused request, a script that exits early).
      input.on('error', (e) => {
        if ((e as NodeJS.ErrnoException).code !== 'EPIPE') settle({ failure: `could not send to the sandbox: ${e.message}` });
      });
      // Written, and deliberately not ended: the open connection is what keeps the script alive.
      input.write(request(script, o.stdin ?? Buffer.alloc(0), seconds));
    };

    const [head, ...rest] = target;
    if (head?.startsWith('unix:')) {
      const sock = connect(head.slice(5));
      close = () => sock.destroy();
      sock.on('error', (e) => settle({ failure: `the sandbox is not available (${e.message})` }));
      sock.on('connect', () => wire(sock, sock));
    } else if (head) {
      const child = spawn(head, rest, { stdio: ['pipe', 'pipe', 'inherit'], env: { PATH: '/usr/bin:/bin', LANG: 'C.UTF-8', ...(o.dir ? { KEVIN_SHELL_DIR: o.dir } : {}) } });
      close = () => {
        // Closing its input is the runner's cue to kill the script's whole session and exit. Killing the
        // runner outright would leave the script running, so that is only the fallback for a runner that is stuck.
        child.stdin.destroy();
        child.stdout.destroy();
        setTimeout(() => child.kill('SIGKILL'), 2000).unref();
      };
      child.on('error', (e) => settle({ failure: `the sandbox is not available (${e.message})` }));
      wire(child.stdin, child.stdout);
    } else {
      settle({ failure: 'no sandbox is configured' });
    }
  });
}
