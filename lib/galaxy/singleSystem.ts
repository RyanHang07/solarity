import type {
  GalaxySnapshot,
  SingleSystemSnapshot,
  SystemConfig,
} from "./types";

/**
 * The id a personal galaxy's only system carries.
 *
 * **A constant rather than an inline string**, because it is also the key
 * every FX and diff entry will be scoped by once systems can be added and
 * removed, and two spellings of it would be a bug nobody could see.
 */
export const SELF_SYSTEM_ID = "self";

/**
 * One person's snapshot in the shape the renderer takes.
 *
 * ## Why this is an adapter and not a compatibility shim
 *
 * `GalaxySnapshot` used to be one sun and its planets. It is now a list of
 * systems, because Solarity's Circle galaxy puts up to ten people in one sky.
 * The alternative was keeping both shapes on the type and letting every
 * consumer handle either — and the consumer that matters is `diffSnapshot`,
 * where two shapes would mean two sets of bugs.
 *
 * So the personal galaxy is **genuinely the one-element case**. That is the
 * property worth protecting: if `systems.length === 1` took a different path
 * from `systems.length === 3`, the path shipped first would be the one the
 * tests exercised least.
 *
 * ## What it does not do
 *
 * It does not derive an `ambienceTier`. A personal galaxy's tier comes from
 * `achievementCount`, which the renderer still reads; a Circle sets the tier
 * explicitly because a summed count stops meaning anything across ten people.
 */
export const singleSystemSnapshot = (
  snapshot: SingleSystemSnapshot,
): GalaxySnapshot => ({
  systems: [
    {
      id: SELF_SYSTEM_ID,
      sun: snapshot.sun,
      planets: snapshot.planets,
      dayClosed: snapshot.dayClosed,
    },
  ],
  stars: snapshot.stars,
  nebula: snapshot.nebula,
  nebulaPreview: snapshot.nebulaPreview,
  achievementCount: snapshot.achievementCount,
  skyClosed: snapshot.dayClosed,
});

/**
 * The system a single-system sky contains.
 *
 * **Throws rather than returning `undefined`.** Every caller of this is code
 * that only makes sense for a personal galaxy, and a silent `undefined` there
 * becomes a blank canvas several frames later with nothing to explain it.
 */
export const onlySystem = (snapshot: GalaxySnapshot): SystemConfig => {
  const system = snapshot.systems[0];
  if (!system) {
    throw new Error("snapshot has no systems");
  }
  return system;
};
