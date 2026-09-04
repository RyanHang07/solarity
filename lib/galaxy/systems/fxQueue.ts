export type FxJob = {
  kind: string;
  elapsed: number;
  duration: number;
  update: (t: number) => void;
  finish: () => void;
  cancelled?: boolean;
};

export class FxQueue {
  private jobs: FxJob[] = [];

  get size(): number {
    return this.jobs.length;
  }

  kinds(): string[] {
    return this.jobs.map((job) => job.kind);
  }

  has(kind: string): boolean {
    return this.jobs.some((job) => job.kind === kind);
  }

  play(job: Omit<FxJob, "elapsed" | "cancelled">): void {
    this.jobs.push({ ...job, elapsed: 0, cancelled: false });
  }

  cancel(kind: string): void {
    for (const job of this.jobs) {
      if (job.kind === kind) {
        job.cancelled = true;
      }
    }
    this.jobs = this.jobs.filter((job) => !job.cancelled);
  }

  cancelMany(kinds: string[]): void {
    const drop = new Set(kinds);
    for (const job of this.jobs) {
      if (drop.has(job.kind)) {
        job.cancelled = true;
      }
    }
    this.jobs = this.jobs.filter((job) => !job.cancelled);
  }

  clear(): void {
    for (const job of this.jobs) {
      job.cancelled = true;
    }
    this.jobs = [];
  }

  tick(deltaMS: number, ease: (t: number) => number = (t) => t): void {
    if (this.jobs.length === 0) {
      return;
    }
    const pendingCount = this.jobs.length;
    const pending = [...this.jobs];
    const next: FxJob[] = [];
    for (const job of pending) {
      if (job.cancelled) {
        continue;
      }
      job.elapsed += deltaMS;
      const t = ease(Math.min(1, job.elapsed / job.duration));
      job.update(t);
      if (job.cancelled) {
        continue;
      }
      if (job.elapsed >= job.duration) {
        job.finish();
        continue;
      }
      next.push(job);
    }
    const spawned = this.jobs.slice(pendingCount);
    this.jobs = [
      ...next.filter((job) => !job.cancelled),
      ...spawned.filter((job) => !job.cancelled),
    ];
  }
};
