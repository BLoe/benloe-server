import { fork, type ChildProcess } from 'node:child_process';
import { fileURLToPath } from 'node:url';

export const EMBEDDING_DIMS = 384;

interface Pending {
  resolve(vectors: Float32Array[]): void;
  reject(err: Error): void;
}

/**
 * Lifecycle of the embedding child process. Plain `child !== null` used to
 * stand in for "alive," which conflated "never spawned" with "spawned, then
 * crashed" (both leave `child === null`) — indistinguishable from the
 * outside. This makes the four real states explicit.
 */
export type EmbedderState = 'never_started' | 'starting' | 'ready' | 'crashed';

export interface EmbedderStatus {
  state: EmbedderState;
  /** Reason for the most recent crash; null once healthy again. */
  lastError: string | null;
  /** ISO timestamp of the last state transition. */
  since: string;
}

/**
 * In-process embedder (§7.3): one child process hosting bge-small-en-v1.5.
 * A child process rather than a worker thread because onnxruntime-node's
 * native addon refuses to load twice in one process — child respawn is the
 * only crash-recovery path that actually works (validated in tests).
 * Spawned lazily; in-flight requests fail fast on crash and callers degrade.
 */
export class Embedder {
  private child: ChildProcess | null = null;
  private ready: Promise<void> | null = null;
  private state: EmbedderState = 'never_started';
  private lastError: string | null = null;
  private since: string = new Date().toISOString();

  private pending = new Map<number, Pending>();
  private nextId = 1;

  private transition(state: EmbedderState, lastError: string | null = null): void {
    this.state = state;
    this.lastError = lastError;
    this.since = new Date().toISOString();
  }

  private spawn(): Promise<void> {
    this.transition('starting');
    const child = fork(fileURLToPath(new URL('./worker.mjs', import.meta.url)), [], {
      serialization: 'advanced',
      stdio: ['ignore', 'ignore', 'inherit', 'ipc'],
      env: process.env,
    });
    this.child = child;
    this.ready = new Promise<void>((resolveReady, rejectReady) => {
      const onFirst = (msg: { ready?: boolean }) => {
        if (msg.ready) {
          child.off('message', onFirst);
          this.transition('ready');
          resolveReady();
        }
      };
      child.on('message', onFirst);
      child.once('error', rejectReady);
      child.once('exit', () => rejectReady(new Error('embedding process exited during startup')));
    });

    child.on('message', (msg: { id?: number; dims?: number; vectors?: Float32Array[]; error?: string }) => {
      if (msg.id === undefined) return;
      const p = this.pending.get(msg.id);
      if (!p) return;
      this.pending.delete(msg.id);
      if (msg.error) p.reject(new Error(`embedding failed: ${msg.error}`));
      else if (msg.dims !== EMBEDDING_DIMS) p.reject(new Error(`unexpected dims ${msg.dims}`));
      else p.resolve(msg.vectors!.map((v) => new Float32Array(v)));
    });

    const failAll = (why: string) => {
      for (const [, p] of this.pending) p.reject(new Error(why));
      this.pending.clear();
      if (this.child === child) {
        this.child = null;
        this.ready = null;
        this.transition('crashed', why);
      }
    };
    child.on('error', (err) => failAll(`embedding process error: ${err.message}`));
    child.on('exit', (code) => failAll(`embedding process exited (code ${code})`));

    return this.ready;
  }

  async embed(texts: string[]): Promise<Float32Array[]> {
    if (texts.length === 0) return [];
    if (!this.child) await this.spawn();
    else await this.ready;
    const id = this.nextId++;
    return new Promise<Float32Array[]>((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.child!.send({ id, texts });
    });
  }

  /** Unambiguous lifecycle snapshot — see EmbedderState. */
  status(): EmbedderStatus {
    return { state: this.state, lastError: this.lastError, since: this.since };
  }

  get alive(): boolean {
    return this.state === 'ready';
  }

  /** Test hook: hard-kill the child to exercise crash recovery. */
  async terminateForTest(): Promise<void> {
    const child = this.child;
    this.child = null;
    this.ready = null;
    if (child) {
      const gone = new Promise((r) => child.once('exit', r));
      child.kill('SIGKILL');
      await gone;
      // The exit handler installed in spawn() no-ops here (it guards on
      // `this.child === child`, which we already cleared above, to avoid a
      // stale prior child's delayed exit clobbering a newer one's state) —
      // so this hook drives the crashed transition itself.
      this.transition('crashed', 'terminated for test');
    }
  }

  async close(): Promise<void> {
    await this.terminateForTest();
  }
}

/**
 * Split text into ~maxWords-word chunks with overlap (§7.3: ~512 tokens with
 * 64-token overlap ≈ 380 words / 48-word overlap at ~0.75 words per token).
 */
export function chunkText(text: string, maxWords = 380, overlapWords = 48): string[] {
  const words = text.split(/\s+/).filter(Boolean);
  if (words.length === 0) return [];
  if (words.length <= maxWords) return [words.join(' ')];
  const chunks: string[] = [];
  const step = maxWords - overlapWords;
  for (let start = 0; start < words.length; start += step) {
    chunks.push(words.slice(start, start + maxWords).join(' '));
    if (start + maxWords >= words.length) break;
  }
  return chunks;
}
