import { describe, expect, it } from "vitest";
import { surfaceMotionProfile } from "./planetSurfaceMotion";

describe("surfaceMotionProfile", () => {
  it("gives gas giants faster cloud spin and emissive bands", () => {
    const gas = surfaceMotionProfile("gas");
    expect(gas.emissive).toBe(true);
    expect(gas.cloudSpinMul).toBeGreaterThan(gas.spinMul);
  });

  it("keeps terra surfaces calm", () => {
    const terra = surfaceMotionProfile("terra");
    expect(terra.emissive).toBe(false);
    expect(terra.spinMul).toBe(1);
  });
});
