export type RefitSchedule = "immediate" | "deferred" | "none";

/** Gates orbit-radius animation until achieve/remove bursts finish. */
export class OrbitRefitCoordinator {
  private waitingBursts = new Set<string>();
  private fromRadii = new Map<string, number>();
  private toRadii = new Map<string, number>();
  private fromReach = 0;
  private toReach = 0;
  private deferred = false;

  isWaitingForBurst(): boolean {
    return this.deferred && this.waitingBursts.size > 0;
  }

  schedule(
    targets: ReadonlyMap<string, number>,
    burstIds: readonly string[],
    fromReach: number,
    toReach: number,
    currentRadius: (id: string) => number | undefined,
  ): RefitSchedule {
    this.fromRadii.clear();
    this.toRadii.clear();

    let radiiChange = false;
    for (const [id, to] of targets) {
      const from = currentRadius(id);
      if (from === undefined) {
        continue;
      }
      this.fromRadii.set(id, from);
      this.toRadii.set(id, to);
      if (Math.abs(from - to) > 0.5) {
        radiiChange = true;
      }
    }

    this.fromReach = fromReach;
    this.toReach = toReach;
    this.waitingBursts = new Set(burstIds);
    this.deferred = burstIds.length > 0;

    if (!radiiChange && Math.abs(fromReach - toReach) < 0.5) {
      this.deferred = false;
      this.waitingBursts.clear();
      this.fromRadii.clear();
      this.toRadii.clear();
      return "none";
    }

    if (burstIds.length > 0) {
      return "deferred";
    }

    this.deferred = false;
    return "immediate";
  }

  burstFinished(planetId: string): boolean {
    this.waitingBursts.delete(planetId);
    return this.shouldStartRefit();
  }

  burstCancelled(planetId: string): void {
    this.waitingBursts.delete(planetId);
  }

  shouldStartRefit(): boolean {
    return (
      this.fromRadii.size > 0 &&
      this.waitingBursts.size === 0 &&
      (this.deferred ||
        [...this.fromRadii.entries()].some(([id, from]) => {
          const to = this.toRadii.get(id);
          return to !== undefined && Math.abs(from - to) > 0.5;
        }))
    );
  }

  fromById(): ReadonlyMap<string, number> {
    return this.fromRadii;
  }

  toById(): ReadonlyMap<string, number> {
    return this.toRadii;
  }

  reachFrom(): number {
    return this.fromReach;
  }

  reachTo(): number {
    return this.toReach;
  }

  complete(): void {
    this.waitingBursts.clear();
    this.fromRadii.clear();
    this.toRadii.clear();
    this.deferred = false;
  }

  clear(): void {
    this.complete();
  }
}
