import { describe, expect, it } from "vitest";
import {
  MAX_STARFIELD_SPIN,
  coreSpinFor,
  nebulaSpinFor,
  starfieldSpinFor,
} from "./skyBackdrop";

describe("the sky's gravitational turn", () => {
  /**
   * **A solo galaxy gets none.** Nothing is orbiting anything at the sky level
   * when there is one system, so a turning background would be motion without
   * a cause — and it would change what the personal galaxy looks like, which
   * this whole rework has been careful not to do.
   */
  it("does not turn for one person", () => {
    expect(starfieldSpinFor(1)).toBe(0);
    expect(starfieldSpinFor(0)).toBe(0);
    expect(nebulaSpinFor(1)).toBe(0);
  });

  it("comes in as members do", () => {
    expect(starfieldSpinFor(2)).toBeGreaterThan(0);
    expect(starfieldSpinFor(3)).toBeGreaterThan(starfieldSpinFor(2));
  });

  it("is at full speed well before the Circle is full", () => {
    // A group of five should already feel like a place; the last five members
    // add planets rather than atmosphere.
    expect(starfieldSpinFor(5)).toBe(MAX_STARFIELD_SPIN);
    expect(starfieldSpinFor(10)).toBe(MAX_STARFIELD_SPIN);
  });

  /**
   * **Counter-rotation is the whole effect.**
   *
   * The literal accretion look is differential rotation — inner stars turning
   * faster than outer ones — at two trig calls per star per frame, which is a
   * quarter of a million `sin`/`cos` a second at two thousand stars. Two rigid
   * layers turning *against* each other produce the shear for two transforms.
   *
   * Same-direction layers at similar rates read as one layer with a wobble, so
   * the sign matters as much as the rate.
   */
  it("turns the nebula against the stars", () => {
    expect(nebulaSpinFor(6)).toBeLessThan(0);
    expect(starfieldSpinFor(6)).toBeGreaterThan(0);
  });

  it("turns the nebula more slowly than the stars", () => {
    expect(Math.abs(nebulaSpinFor(6))).toBeLessThan(starfieldSpinFor(6));
  });

  it("stays slow enough to be a background rather than a subject", () => {
    const secondsPerTurn = (Math.PI * 2) / MAX_STARFIELD_SPIN;
    expect(secondsPerTurn).toBeGreaterThan(60);
  });
});

describe("the galactic core", () => {
  /**
   * **The backdrop a Circle actually gets.**
   *
   * The nebula is gated on five achievement colour families — it is one
   * person's history — so a Circle snapshot with no stars produces none.
   * An earlier pass shipped a nebula counter-rotation as the Circle backdrop
   * and it was rotating nothing at all. The core exists so there is something
   * behind a Circle from its first day.
   */
  it("turns faster than the stars behind it", () => {
    expect(coreSpinFor(6)).toBeGreaterThan(starfieldSpinFor(6));
  });

  it("is still for one person", () => {
    expect(coreSpinFor(1)).toBe(0);
  });

  it("is slow enough to sit behind something being read", () => {
    // Under a degree and a half a second: present without interrupting.
    const degreesPerSecond = (coreSpinFor(10) * 180) / Math.PI;
    expect(degreesPerSecond).toBeLessThan(10);
  });
});

describe("the spin is actually perceptible", () => {
  /**
   * **The number that shipped first was 0.012 rad/s — 0.69° a second, a full
   * turn in eight and a half minutes.** It was marked done and could not be
   * seen. Ambient does not mean imperceptible.
   *
   * This is the assertion that would have caught it: a full turn has to happen
   * on a human timescale, not a geological one.
   */
  it("completes a turn in minutes rather than tens of minutes", () => {
    const secondsPerTurn = (Math.PI * 2) / MAX_STARFIELD_SPIN;
    expect(secondsPerTurn).toBeLessThan(240);
    expect(secondsPerTurn).toBeGreaterThan(60);
  });
});
