import { Texture } from "pixi.js";
import { mulberry32 } from "../rng";

const SIZE = 256;

const fadeEdge = (nx: number, ny: number): number => {
  const dist = Math.sqrt(nx * nx + ny * ny);
  if (dist >= 1) {
    return 0;
  }
  const t = 1 - dist;
  return t * t * (3 - 2 * t);
};

const hash2 = (ix: number, iy: number, seed: number): number => {
  let n = Math.imul(ix + seed, 374761393) ^ Math.imul(iy + seed * 3, 668265263);
  n = Math.imul(n ^ (n >>> 13), 1274126177);
  return (n >>> 0) / 4294967296;
};

const valueNoise = (x: number, y: number, seed: number): number => {
  const x0 = Math.floor(x);
  const y0 = Math.floor(y);
  const fx = x - x0;
  const fy = y - y0;
  const ux = fx * fx * (3 - 2 * fx);
  const uy = fy * fy * (3 - 2 * fy);
  const a = hash2(x0, y0, seed);
  const b = hash2(x0 + 1, y0, seed);
  const c = hash2(x0, y0 + 1, seed);
  const d = hash2(x0 + 1, y0 + 1, seed);
  return a + (b - a) * ux + (c - a) * uy + (a - b - c + d) * ux * uy;
};

const fbm = (x: number, y: number, seed: number): number => {
  let amp = 0.52;
  let freq = 1;
  let sum = 0;
  let norm = 0;
  for (let i = 0; i < 5; i += 1) {
    sum += amp * valueNoise(x * freq, y * freq, seed + i * 17);
    norm += amp;
    amp *= 0.5;
    freq *= 2.05;
  }
  return sum / norm;
};

const paintCloud = (seed: number, stretch: number): HTMLCanvasElement => {
  const canvas = document.createElement("canvas");
  canvas.width = SIZE;
  canvas.height = SIZE;
  const ctx = canvas.getContext("2d");
  if (!ctx) {
    return canvas;
  }
  const image = ctx.createImageData(SIZE, SIZE);
  const data = image.data;
  const random = mulberry32(seed);
  const ox = random() * 40;
  const oy = random() * 40;
  for (let y = 0; y < SIZE; y += 1) {
    for (let x = 0; x < SIZE; x += 1) {
      const nx = (x / (SIZE - 1)) * 2 - 1;
      const ny = (y / (SIZE - 1)) * 2 - 1;
      const falloff = fadeEdge(nx, ny);
      const n = fbm(nx * 2.4 * stretch + ox, ny * 2.4 + oy, seed);
      const ridge = 1 - Math.abs(n * 2 - 1);
      const v = Math.max(0, n * 0.65 + ridge * 0.35);
      const alpha = Math.min(255, Math.round(v * falloff * 255));
      const i = (y * SIZE + x) * 4;
      data[i] = 255;
      data[i + 1] = 255;
      data[i + 2] = 255;
      data[i + 3] = alpha;
    }
  }
  ctx.putImageData(image, 0, 0);
  return canvas;
};

export const createNebulaCloudTextures = (seed: number): Texture[] => {
  const soft = Texture.from(paintCloud(seed, 1));
  const filament = Texture.from(paintCloud(seed ^ 0x9e3779b9, 0.55));
  soft.source.scaleMode = "linear";
  filament.source.scaleMode = "linear";
  return [soft, filament];
};
