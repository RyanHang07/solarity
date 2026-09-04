import { Container, Sprite, type Texture } from "pixi.js";
import { createCoreTexture, createDiscTexture } from "../render/coreTexture";
import type { GalaxyPalette } from "../galaxyPalette";

/**
 * What a Circle turns around.
 *
 * ## Why it is here at all
 *
 * A personal galaxy is one sun in a quiet sky, and that is right — the subject
 * is the person. Ten systems in one rectangle read as ten unrelated diagrams
 * unless something ties them together. **This is the thing they are all
 * orbiting**, and without it the cluster is an arrangement rather than a place.
 *
 * ## Two layers turning against each other
 *
 * The literal accretion look is differential rotation — inner material turning
 * faster than outer — which for a starfield costs two trig calls per star per
 * frame. Here it is free: **the core and the disc are two sprites**, rotated at
 * different rates, and the shear between them is the whole effect. Two
 * transforms a frame regardless of what is drawn on them.
 *
 * The disc is squashed on the vertical, matching the tilt the systems are drawn
 * at, so it sits in the same plane as the orbits rather than facing the viewer.
 */
export class GalacticCore {
  readonly container: Container;
  private readonly core: Sprite;
  private readonly disc: Sprite;
  private readonly owned: Texture[] = [];

  constructor(palette: GalaxyPalette, seed: number) {
    this.container = new Container({ label: "galactic-core" });
    this.container.eventMode = "none";
    // Behind everything in the cluster, including the bridges.
    this.container.zIndex = -3000;
    this.container.visible = false;

    const coreTexture = createCoreTexture(palette.inner, palette.outer);
    const discTexture = createDiscTexture(palette.inner, palette.outer, seed);
    this.owned.push(coreTexture, discTexture);

    this.disc = new Sprite({
      texture: discTexture,
      label: "core-disc",
      anchor: 0.5,
    });
    this.disc.blendMode = "add";
    this.disc.eventMode = "none";

    this.core = new Sprite({
      texture: coreTexture,
      label: "core-glow",
      anchor: 0.5,
    });
    this.core.blendMode = "add";
    this.core.eventMode = "none";

    this.container.addChild(this.disc, this.core);

    // Same reasoning as `Planet` and `Sun`: Pixi's `destroy({ children: true })`
    // frees display objects and deliberately not their textures, so without
    // this the two maps outlive every scene that ever built one.
    this.container.on("destroyed", () => {
      for (const texture of this.owned) {
        texture.destroy(true);
      }
      this.owned.length = 0;
    });
  }

  /**
   * Size it to the frame it sits behind, not just the cluster.
   *
   * ## It has to cover the viewport
   *
   * Sizing from the cluster's reach alone left it **compacted on a phone**:
   * a small cluster gave a small backdrop with the canvas visible around it,
   * so the galaxy read as an object sitting in the frame rather than as the
   * space the frame is looking into. `minSpan` is the viewport's own diagonal,
   * expressed in cluster coordinates, so the backdrop always runs past the
   * edges however small the panel or however tight the Circle.
   *
   * ## And it flattens less than the orbits do
   *
   * The systems tilt at 0.95 full-size and 0.5 compact, which through
   * `sin` is 0.81 against 0.48 — so tracking that directly made the backdrop
   * *half as tall* on a phone, which is the other half of "compacted".
   *
   * A backdrop is conceptually much further away than the orbits in front of
   * it, and distant things flatten less with the same change of angle. Mapping
   * the tilt into the top half of the range keeps it in the same plane as the
   * orbits without collapsing on the surface where there is least room.
   */
  layout(reach: number, flatten: number, minSpan = 0): void {
    const span = Math.max(Math.max(reach, 1) * 3.2, minSpan);
    const gentle = 0.5 + Math.max(0, Math.min(1, flatten)) * 0.5;

    this.core.width = span;
    this.core.height = span * gentle;
    this.disc.width = span * 1.15;
    this.disc.height = span * 1.15 * gentle * 0.94;
  }

  setVisible(visible: boolean): void {
    this.container.visible = visible;
  }

  /**
   * Turn the two layers.
   *
   * The disc leads and the core trails at a fraction of the rate, in the same
   * direction — **not opposed**. Counter-rotation here would read as two
   * separate things sharing a centre; a slower inner layer reads as one mass
   * with the outside being dragged around it, which is the look wanted.
   */
  tick(elapsedMs: number, spin: number): void {
    if (spin === 0) {
      return;
    }
    const seconds = elapsedMs / 1000;
    this.disc.rotation = seconds * spin;
    this.core.rotation = seconds * spin * 0.35;
  }
}
