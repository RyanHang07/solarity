import { Texture } from "pixi.js";

const STAR_TEXTURE_SIZE = 32;

export const createStarTexture = (): Texture => {
  const canvas = document.createElement("canvas");
  canvas.width = STAR_TEXTURE_SIZE;
  canvas.height = STAR_TEXTURE_SIZE;
  const context = canvas.getContext("2d");
  if (!context) {
    return Texture.WHITE;
  }

  const center = STAR_TEXTURE_SIZE / 2;
  const gradient = context.createRadialGradient(
    center,
    center,
    0,
    center,
    center,
    center,
  );
  gradient.addColorStop(0, "rgba(255,255,255,1)");
  gradient.addColorStop(0.18, "rgba(255,255,255,0.95)");
  gradient.addColorStop(0.42, "rgba(255,255,255,0.28)");
  gradient.addColorStop(1, "rgba(255,255,255,0)");
  context.fillStyle = gradient;
  context.fillRect(0, 0, STAR_TEXTURE_SIZE, STAR_TEXTURE_SIZE);

  return Texture.from(canvas);
};
