import { describe, expect, it } from "vitest";
import { OrbitRefitCoordinator } from "./orbitRefitCoordinator";

describe("OrbitRefitCoordinator", () => {
  it("defers refit until burst planets finish", () => {
    const coordinator = new OrbitRefitCoordinator();
    const targets = new Map([
      ["a", 95],
      ["b", 183],
    ]);
    const schedule = coordinator.schedule(
      targets,
      ["gone"],
      400,
      360,
      (id) => (id === "a" ? 183 : id === "b" ? 272 : undefined),
    );
    expect(schedule).toBe("deferred");
    expect(coordinator.shouldStartRefit()).toBe(false);
    expect(coordinator.burstFinished("gone")).toBe(true);
    expect(coordinator.shouldStartRefit()).toBe(true);
    expect(coordinator.fromById().get("a")).toBe(183);
    expect(coordinator.toById().get("a")).toBe(95);
  });

  it("starts immediately when no burst is pending", () => {
    const coordinator = new OrbitRefitCoordinator();
    const schedule = coordinator.schedule(
      new Map([["a", 95]]),
      [],
      400,
      360,
      () => 183,
    );
    expect(schedule).toBe("immediate");
    expect(coordinator.shouldStartRefit()).toBe(true);
  });

  it("skips when radii and reach are unchanged", () => {
    const coordinator = new OrbitRefitCoordinator();
    const schedule = coordinator.schedule(
      new Map([["a", 183]]),
      ["gone"],
      360,
      360,
      () => 183,
    );
    expect(schedule).toBe("none");
    expect(coordinator.shouldStartRefit()).toBe(false);
  });

  it("does not snap targets while waiting for burst", () => {
    const coordinator = new OrbitRefitCoordinator();
    coordinator.schedule(
      new Map([["a", 95]]),
      ["gone"],
      400,
      360,
      () => 183,
    );
    expect(coordinator.isWaitingForBurst()).toBe(true);
  });
});
