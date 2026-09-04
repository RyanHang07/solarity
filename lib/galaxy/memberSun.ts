import { SUN_COLOR_PRESETS, type SunPresetId } from "./palettes";
import { hashString, pickIndex } from "./rng";
import type { ColorHex } from "./types";

/**
 * A member's sun colour, derived from their id.
 *
 * ## The gap this closes
 *
 * Sun colour comes from `sunPresetId`, which lives in a cosmetics table that
 * Solarity's first version does not have. Without one, `resolveSunColor` falls
 * through to `DEFAULT_SUN_COLOR` for everybody — so a Circle of ten would be
 * **ten identical amber suns**, with nothing but position telling members
 * apart. In a picture whose whole subject is *who is doing what*, that is the
 * thing it most needs to say.
 *
 * ## Derived, not stored
 *
 * The id is stable and already unique, so hashing it onto the existing presets
 * gives every member a fixed colour with no schema, no settings screen and no
 * migration. **Everyone sees the same person as the same colour**, on every
 * device, which a locally-random choice would not give.
 *
 * **This is a default, not a decision.** The day a cosmetics editor exists, a
 * stored `sunPresetId` takes precedence and this becomes the value somebody
 * starts from — which is a better first experience than everyone starting
 * identical anyway.
 *
 * ## Why `pickIndex` and not `% SUN_COLOR_PRESETS.length`
 *
 * There are six presets, and `hashString % 6` reaches only three of them —
 * FNV-1a leaves its low bits barely mixed, so an even modulus throws away half
 * the range. Writing it the obvious way would have produced *three* identical
 * colours instead of one, which is a subtler version of the same bug this
 * function exists to fix. See `pickIndex` for the measurements.
 */
export const sunPresetIdForMember = (memberId: string): SunPresetId => {
  const preset =
    SUN_COLOR_PRESETS[
      pickIndex(hashString(memberId), SUN_COLOR_PRESETS.length)
    ];
  // `SUN_COLOR_PRESETS` is a non-empty literal, so this cannot be reached; the
  // fallback exists because the type system cannot know that from an index.
  return (preset?.id ?? SUN_COLOR_PRESETS[0]?.id ?? "amber") as SunPresetId;
};

export const sunColorForMember = (memberId: string): ColorHex => {
  const id = sunPresetIdForMember(memberId);
  return (
    SUN_COLOR_PRESETS.find((preset) => preset.id === id)?.color ?? 0xf4a261
  );
};
