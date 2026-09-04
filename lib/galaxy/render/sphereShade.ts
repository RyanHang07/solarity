import { Texture } from "pixi.js";

const SHADE_SIZE = 128;

export const createSphereShadeTexture = (): Texture => {
  const canvas = document.createElement("canvas");
  canvas.width = SHADE_SIZE;
  canvas.height = SHADE_SIZE;
  const context = canvas.getContext("2d");
  if (!context) {
    return Texture.WHITE;
  }

  const image = context.createImageData(SHADE_SIZE, SHADE_SIZE);
  const center = (SHADE_SIZE - 1) / 2;
  const radius = SHADE_SIZE / 2 - 1;
  const data = image.data;

  for (let y = 0; y < SHADE_SIZE; y += 1) {
    for (let x = 0; x < SHADE_SIZE; x += 1) {
      const nx = (x - center) / radius;
      const ny = (y - center) / radius;
      const i = (y * SHADE_SIZE + x) * 4;
      const zz = 1 - nx * nx - ny * ny;
      if (zz <= 0) {
        data[i + 3] = 0;
        continue;
      }
      const nz = Math.sqrt(zz);
      const light = nx * -0.32 + ny * -0.48 + nz * 0.86;
      const value = Math.max(0.08, Math.min(1, light * 0.72 + 0.18));
      const byte = Math.round(value * 255);
      data[i] = byte;
      data[i + 1] = byte;
      data[i + 2] = byte;
      data[i + 3] = 255;
    }
  }

  context.putImageData(image, 0, 0);
  return Texture.from(canvas);
};
