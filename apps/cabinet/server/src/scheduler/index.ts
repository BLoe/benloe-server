export interface JobSpec {
  name: string;
  /** Next run strictly after `from`; null disables the job. */
  next(from: Date): Date | null;
  run(): Promise<void>;
}

const MAX_TIMEOUT = 2 ** 31 - 1; // setTimeout ceiling (~24.8 days)

/**
 * Hand-rolled scheduler (§11): one timer per job, re-armed after each run
 * from *now* — a late fire runs once and skips to the next future window,
 * so missed windows never stack. Busy-deferral comes free from the turn
 * queue that every LLM job submits into.
 */
export class Scheduler {
  private timers = new Map<string, NodeJS.Timeout>();
  private stopped = false;
  private inFlight = new Set<string>();
  readonly lastRun = new Map<string, Date>();
  readonly lastError = new Map<string, string>();

  constructor(private jobs: JobSpec[]) {}

  has(name: string): boolean {
    return this.jobs.some((j) => j.name === name);
  }

  /**
   * Owner/agent-authenticated manual trigger (gateway/app.ts's
   * POST /api/admin/jobs/:name/run). Runs the exact same JobSpec.run() the
   * cron timer below invokes — not a reimplementation — so firing this
   * proves the scheduler→job wiring itself, not just the job's own logic
   * run by hand from a scratch script. Rejects a second concurrent trigger
   * for the same name rather than overlapping two turns against the same
   * system thread; the timer path (arm(), below) is untouched by this guard.
   */
  async runNow(name: string): Promise<void> {
    const job = this.jobs.find((j) => j.name === name);
    if (!job) throw new Error(`no such job: ${name}`);
    if (this.inFlight.has(name)) throw new Error(`${name} is already running`);
    this.inFlight.add(name);
    try {
      await job.run();
      this.lastRun.set(name, new Date());
    } catch (err) {
      this.lastError.set(name, String((err as Error).message ?? err));
      throw err;
    } finally {
      this.inFlight.delete(name);
    }
  }

  start(): void {
    this.stopped = false;
    for (const job of this.jobs) this.arm(job);
  }

  stop(): void {
    this.stopped = true;
    for (const t of this.timers.values()) clearTimeout(t);
    this.timers.clear();
  }

  nextFireTimes(): Record<string, string | null> {
    const now = new Date();
    return Object.fromEntries(this.jobs.map((j) => [j.name, j.next(now)?.toISOString() ?? null]));
  }

  private arm(job: JobSpec): void {
    if (this.stopped) return;
    const now = new Date();
    const at = job.next(now);
    if (!at) return;
    const delay = Math.min(Math.max(0, at.getTime() - now.getTime()), MAX_TIMEOUT);
    const timer = setTimeout(() => {
      if (delay === MAX_TIMEOUT && at.getTime() > Date.now()) {
        this.arm(job); // long-wait chunking: not due yet, re-arm
        return;
      }
      void job
        .run()
        .then(() => this.lastRun.set(job.name, new Date()))
        .catch((err) => this.lastError.set(job.name, String((err as Error).message ?? err)))
        .finally(() => this.arm(job)); // re-arm from now → missed windows collapse to one run
    }, delay);
    timer.unref();
    this.timers.set(job.name, timer);
  }
}
