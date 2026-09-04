/**
 * The backdrop a Circle sits in.
 *
 * ## What it is for
 *
 * A personal galaxy is one sun in a quiet sky, and that is right — the subject
 * is the person. A Circle is ten systems that would otherwise read as ten
 * unrelated diagrams sharing a rectangle. **The backdrop is what makes them one
 * place**: a slow gravitational turn, as though the whole group were bound to
 * something at the middle.
 *
 * ## Two rigid rotations instead of one differential one
 *
 * The literal accretion look is differential rotation — inner stars turning
 * faster than outer ones — and it costs **two trig calls per star per frame**.
 * At two thousand stars and 60fps that is a quarter of a million `sin`/`cos` a
 * second, on a phone, for a background.
 *
 * So the starfield turns rigidly, the nebula turns rigidly at a **different
 * rate**, and the shear between the two layers is what reads as gravitational.
 * Two transforms a frame, whatever the star count, and the effect survives a
 * cheap device — which the honest version would not.
 *
 * ## It scales with the Circle, and vanishes for one person
 *
 * A solo galaxy gets **no spin at all**. Nothing is orbiting anything at the
 * sky level when there is one system, and a turning background would be motion
 * without a cause. It comes in as members do.
 */

/**
 * Radians per second for the starfield at a full Circle.
 *
 * **Was 0.012, which is 0.69 degrees a second — a full turn in eight and a half
 * minutes.** Technically moving, practically invisible: it shipped as "done"
 * and could not be seen at all. Ambient does not mean imperceptible; it means
 * you notice it without being interrupted by it.
 *
 * At 0.05 a full turn takes about two minutes, which is slow enough to sit
 * behind a screen somebody is reading and fast enough to be there.
 */
export const MAX_STARFIELD_SPIN = 0.05;

/**
 * The core disc turns faster than the starfield behind it.
 *
 * Parallax: the near thing moves more. It is also where the gravitational read
 * comes from — the disc sweeping past a slower field of stars looks like
 * something being pulled around, which two layers at the same rate would not.
 */
export const CORE_SPIN_RATIO = 2.4;

/**
 * The nebula turns the other way, and slower.
 *
 * **Opposed rather than merely different**, because two layers turning the
 * same way at similar rates read as one layer with a wobble. Counter-rotation
 * is unambiguous, and it is what gives the middle of the frame its sense of
 * something being wound in.
 */
export const NEBULA_SPIN_RATIO = -0.42;

/**
 * How fast the sky turns for a Circle of `memberCount`.
 *
 * Ramps to full by the time a Circle is half its cap: a group of five should
 * already feel like a place, and the last five members add planets rather than
 * atmosphere.
 */
export const starfieldSpinFor = (memberCount: number): number => {
  if (memberCount <= 1) {
    return 0;
  }
  const ramp = Math.min(1, (memberCount - 1) / 4);
  return MAX_STARFIELD_SPIN * ramp;
};

/**
 * How fast the galactic core turns for a Circle of `memberCount`.
 *
 * **The core is the backdrop a Circle actually gets.** The nebula is gated on
 * five achievement colour families — it is one person's history — so a Circle
 * has none, which an earlier pass discovered only after shipping a
 * counter-rotation for it.
 */
export const coreSpinFor = (memberCount: number): number =>
  starfieldSpinFor(memberCount) * CORE_SPIN_RATIO;

export const nebulaSpinFor = (memberCount: number): number => {
  const spin = starfieldSpinFor(memberCount);
  // `0 * -0.42` is `-0`, which is harmless as a rotation and wrong as a value:
  // it is not equal to `0` under `Object.is`, so "there is no spin" would read
  // as false to any caller that checks. Normalised rather than papered over.
  return spin === 0 ? 0 : spin * NEBULA_SPIN_RATIO;
};
