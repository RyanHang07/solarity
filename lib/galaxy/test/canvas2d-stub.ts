/**
 * A 2D canvas context that draws nothing, so `Galaxy` can be built in a test.
 *
 * ## Why this exists
 *
 * The scene classes were untestable, and not for an interesting reason. Every
 * texture in `render/` is painted into a `<canvas>`, and jsdom implements the
 * element but not `getContext("2d")` — it returns `null`. The painters handle
 * that (`if (!context) return Texture.WHITE`), but Pixi does not: a
 * `FillGradient` reaches straight for `createRadialGradient` and throws on
 * null. So constructing a single planet was enough to fail.
 *
 * The real fix would be the `canvas` package, a native build that has to
 * compile on every machine and in CI to test code that **draws nothing we
 * assert on**. Nothing here checks a pixel. What the scene tests check is
 * structure — how many planets are in the container, whether a removed one
 * took its textures with it, whether ten systems produce ten suns — and none
 * of that needs a rasteriser.
 *
 * ## What it is, and the limit that comes with it
 *
 * A permissive stub: any method is a no-op, gradients are objects that accept
 * colour stops, and image data is the right size and all zeroes.
 *
 * **So a test here can never assert on appearance.** If a painter stopped
 * drawing entirely, every test in this directory would still pass. That is the
 * price of testing the scene graph without a GPU, and it is the reason the
 * device pass exists: this stub covers structure and lifetime, the playground
 * and a real phone cover everything you can see.
 */

const noop = (): void => {};

const gradient = (): CanvasGradient =>
  ({ addColorStop: noop }) as unknown as CanvasGradient;

const imageData = (width: number, height: number): ImageData =>
  ({
    width,
    height,
    colorSpace: "srgb",
    data: new Uint8ClampedArray(Math.max(1, width * height * 4)),
  }) as ImageData;

const makeContext = (canvas: HTMLCanvasElement): CanvasRenderingContext2D => {
  const state: Record<string | symbol, unknown> = { canvas };

  return new Proxy(state, {
    get(target, prop) {
      if (prop in target) {
        return target[prop];
      }
      if (prop === "createRadialGradient" || prop === "createLinearGradient") {
        return gradient;
      }
      if (prop === "createConicGradient") {
        return gradient;
      }
      if (prop === "createImageData") {
        return (w: number, h: number) => imageData(w, h);
      }
      if (prop === "getImageData") {
        return (_x: number, _y: number, w: number, h: number) =>
          imageData(w, h);
      }
      if (prop === "measureText") {
        return () => ({ width: 0 });
      }
      // Everything else is a drawing call we neither perform nor assert on.
      return noop;
    },
    set(target, prop, value) {
      target[prop] = value;
      return true;
    },
  }) as unknown as CanvasRenderingContext2D;
};

/**
 * Install on `HTMLCanvasElement`. Call once per test file that builds scene
 * objects, before the first construction.
 *
 * **Only `"2d"` is answered.** A request for a WebGL context still returns
 * `null`, which is correct: there is no GPU here, and a test that thinks it
 * has one is a test that will lie.
 */
export const installCanvas2dStub = (): void => {
  if (typeof HTMLCanvasElement === "undefined") {
    throw new Error(
      "installCanvas2dStub needs a DOM. Add `// @vitest-environment jsdom` to the test file.",
    );
  }
  HTMLCanvasElement.prototype.getContext = function getContext(
    this: HTMLCanvasElement,
    kind: string,
  ) {
    return kind === "2d" ? makeContext(this) : null;
  } as HTMLCanvasElement["getContext"];
};
