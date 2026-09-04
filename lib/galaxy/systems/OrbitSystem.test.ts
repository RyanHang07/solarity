import { describe, expect, it } from "vitest";
import { Container } from "pixi.js";
import {
  createOrbitBody,
  effectiveOrbitRadius,
  lerpOrbitRadii,
} from "./OrbitSystem";
import type { PlanetConfig } from "../types";

const config = (orbitRadius: number): PlanetConfig => ({
  id: "a",
  color: 0xff8866,
  radius: 8,
  orbitRadius,
  orbitSpeed: 0.2,
  phase: 0,
  shine: false,
});

describe("lerpOrbitRadii", () => {
  it("interpolates display radii between endpoints", () => {
    const body = createOrbitBody(new Container(), config(200));
    const from = new Map([["a", 200]]);
    const to = new Map([["a", 100]]);
    lerpOrbitRadii([body], from, 0, to);
    expect(effectiveOrbitRadius(body)).toBe(200);
    lerpOrbitRadii([body], from, 1, to);
    expect(effectiveOrbitRadius(body)).toBe(100);
    lerpOrbitRadii([body], from, 0.5, to);
    expect(effectiveOrbitRadius(body)).toBe(150);
  });
});
