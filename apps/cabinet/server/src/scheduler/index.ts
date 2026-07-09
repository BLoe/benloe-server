export interface JobSpec {
  name: string;
  /** Next run strictly after `from`; null disables the job. */
  next(from: Date): Date | null;
  /**
   * Resolved value (if any) is opaque to the scheduler — stashed verbatim in
   * `lastResult` for a job that wants to surface something beyond pass/fail
   * (e.g. maintenance's {backups, backfilled, expired}). Most jobs resolve
   * void; `lastResult` simply stays unset for those.
   */
  run(): Promise<unknown>;
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
  /** Opaque per-job payload from the most recent successful run() (see jobsHealth). Unset for jobs that resolve void. */
  readonly lastResult = new Map<string, unknown>();

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
      const result = await job.run();
      this.lastRun.set(name, new Date());
      this.lastError.delete(name); // a success must clear a prior failure — lastError reflects the MOST RECENT run, not any run ever
      if (result !== undefined) this.lastResult.set(name, result);
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
        .then((result) => {
          this.lastRun.set(job.name, new Date());
          this.lastError.delete(job.name); // same clear-on-success as runNow, below
          if (result !== undefined) this.lastResult.set(job.name, result);
        })
        .catch((err) => this.lastError.set(job.name, String((err as Error).message ?? err)))
        .finally(() => this.arm(job)); // re-arm from now → missed windows collapse to one run
    }, delay);
    timer.unref();
    this.timers.set(job.name, timer);
  }

  /**
   * Per-job observability snapshot for /api/healthz (mentorship: broader
   * observability audit, phase 2 #1). Reuses lastRun/lastError/lastResult
   * verbatim — no parallel tracking — plus a fresh nextFireTimes() call so
   * "scheduled but hasn't fired since boot" (lastRun: null, nextFireAt set)
   * reads distinctly from "has fired before, next one's at X" (lastRun set).
   * All timestamps are ISO strings, matching embedder.status().since.
   */
  jobsHealth(): Record<
    string,
    { lastRun: string | null; lastError: string | null; nextFireAt: string | null; lastResult: unknown }
  > {
    const next = this.nextFireTimes();
    return Object.fromEntries(
      this.jobs.map((j) => [
        j.name,
        {
          lastRun: this.lastRun.get(j.name)?.toISOString() ?? null,
          lastError: this.lastError.get(j.name) ?? null,
          nextFireAt: next[j.name] ?? null,
          lastResult: this.lastResult.has(j.name) ? this.lastResult.get(j.name) : null,
        },
      ]),
    );
  }
}
