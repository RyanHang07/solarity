import { describe, expect, it } from "vitest";
import { SURFACE_KINDS } from "./constants";
import { hashRange, hashString, pickIndex } from "./rng";
import { resolvePlanetSurfaceKind } from "./scene/Planet";

/** What a Solarity goal or member id actually looks like. */
const uuid = (n: number): string =>
  `3f2a${n.toString(16).padStart(4, "0")}-9c1d-4e7b-b8a2-${n
    .toString(16)
    .padStart(12, "0")}`;

const distinct = (pick: (id: string) => unknown, count = 3000): number =>
  new Set(Array.from({ length: count }, (_, i) => pick(uuid(i)))).size;

describe("hashString: the low bits are not usable", () => {
  /**
   * **This is a characterisation test for a defect in `hashString`, kept so the
   * fix cannot be quietly undone.**
   *
   * FNV-1a leaves its low bits barely mixed, so `hash % n` for an even `n`
   * throws away most of the range. Anyone writing `hashString(id) % 6` in
   * future is writing a bug, and this is the file that says so.
   */
  it("loses half its range on an even modulus", () => {
    expect(distinct((id) => hashString(id) % 6)).toBe(3);
  });

  it("loses three quarters when the modulus divides by four", () => {
    expect(distinct((id) => hashString(id) % 40)).toBe(10);
    expect(distinct((id) => hashString(id) % 628)).toBe(157);
  });

  it("is fine on odd moduli, which is why this went unnoticed", () => {
    expect(distinct((id) => hashString(id) % 3)).toBe(3);
    expect(distinct((id) => hashString(id) % 5)).toBe(5);
  });

  /**
   * **And why the playground never showed it.** Short ids happen to distribute
   * evenly through the same modulus, so the dev harness looked correct while
   * production — where ids are uuids — would not have been.
   */
  it("looks fine with short ids, which is the trap", () => {
    const short = new Set(
      Array.from({ length: 3000 }, (_, i) => hashString(`goal-${i}`) % 6),
    );
    expect(short.size).toBe(6);
  });
});

describe("pickIndex and hashRange", () => {
  it("reach every value, on the moduli that broke", () => {
    expect(distinct((id) => pickIndex(hashString(id), 6))).toBe(6);
    expect(distinct((id) => hashRange(hashString(id), 40))).toBe(40);
  });

  it("spread evenly rather than merely reaching everything", () => {
    const counts = new Array(6).fill(0);
    for (let i = 0; i < 6000; i += 1) {
      const index = pickIndex(hashString(uuid(i)), 6);
      counts[index] = (counts[index] ?? 0) + 1;
    }
    // A perfectly even split is 1000 each; allow generous slack and still
    // catch a bucket that is starved or doubled.
    for (const count of counts) {
      expect(count).toBeGreaterThan(700);
      expect(count).toBeLessThan(1300);
    }
  });

  it("stays in range at the edges", () => {
    expect(pickIndex(0, 6)).toBe(0);
    expect(pickIndex(0xffffffff, 6)).toBe(5);
    expect(pickIndex(0xffffffff, 0)).toBe(0);
  });
});

describe("planet surfaces, the bug this actually caused", () => {
  /**
   * **Three of the six surfaces were unreachable in the product.** Every goal
   * would have been gas, ice or storm; `terra`, `arid` and `lava` existed,
   * were painted, were tested — and could never appear for a goal identified
   * by a uuid.
   */
  it("uses all six surfaces for uuid goal ids", () => {
    const kinds = new Set(
      Array.from({ length: 3000 }, (_, i) =>
        resolvePlanetSurfaceKind({
          id: uuid(i),
          color: 0x1ec8ff,
          radius: 12,
          orbitRadius: 120,
          orbitSpeed: 0.2,
          phase: 0,
          shine: false,
        }),
      ),
    );
    expect(kinds.size).toBe(SURFACE_KINDS.length);
  });
});
