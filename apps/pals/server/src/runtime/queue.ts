export type TurnKind = 'user' | 'heartbeat' | 'cron';

interface Job<T> {
  kind: TurnKind;
  fn(): Promise<T>;
  resolve(v: T): void;
  reject(e: unknown): void;
  enqueuedAt: number;
}

/**
 * Serialized turn queue (§4.2): one agent turn at a time, everywhere.
 * User turns jump ahead of pending scheduled turns; a running turn is never
 * preempted. Scheduled work therefore "defers while busy" for free.
 */
export class TurnQueue {
  private pending: Job<unknown>[] = [];
  private running = false;
  private currentKind: TurnKind | null = null;

  get busy(): boolean {
    return this.running;
  }

  get depth(): number {
    return this.pending.length + (this.running ? 1 : 0);
  }

  get runningKind(): TurnKind | null {
    return this.currentKind;
  }

  submit<T>(kind: TurnKind, fn: () => Promise<T>): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      const job: Job<T> = { kind, fn, resolve, reject, enqueuedAt: Date.now() };
      if (kind === 'user') {
        // ahead of scheduled work, behind other user turns (FIFO among users)
        const i = this.pending.findIndex((j) => j.kind !== 'user');
        if (i === -1) this.pending.push(job as Job<unknown>);
        else this.pending.splice(i, 0, job as Job<unknown>);
      } else {
        this.pending.push(job as Job<unknown>);
      }
      void this.drain();
    });
  }

  /** Drop pending (not running) scheduled turns — e.g. skip a stale heartbeat. */
  dropPendingScheduled(): number {
    const before = this.pending.length;
    this.pending = this.pending.filter((j) => j.kind === 'user');
    return before - this.pending.length;
  }

  private async drain(): Promise<void> {
    if (this.running) return;
    const job = this.pending.shift();
    if (!job) return;
    this.running = true;
    this.currentKind = job.kind;
    try {
      job.resolve(await job.fn());
    } catch (err) {
      job.reject(err);
    } finally {
      this.running = false;
      this.currentKind = null;
      void this.drain();
    }
  }
}
