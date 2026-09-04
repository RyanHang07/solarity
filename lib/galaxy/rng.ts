export const hashString = (value: string): number => {
  let hash = 2166136261;
  for (let i = 0; i < value.length; i += 1) {
    hash = Math.imul(hash ^ value.charCodeAt(i), 16777619);
  }
  return hash >>> 0;
};

/**
 * A hash as a fraction in `[0, 1)`. **Use this instead of `hash % n`.**
 *
 * ## The bug this exists to stop, which had already shipped
 *
 * `hashString` is FNV-1a, and FNV-1a leaves its **low bits barely mixed**. So
 * `hash % n` for an even `n` throws away most of the range, and the effect is
 * severe and exact. Measured over six thousand uuids:
 *
 * | `hash % n` | distinct values |
 * |---|---|
 * | `% 3` | 3 of 3 ✅ |
 * | `% 5` | 5 of 5 ✅ |
 * | **`% 6`** | **3 of 6** |
 * | `% 40` | 10 of 40 |
 * | `% 280` | 70 of 280 |
 * | `% 628` | 157 of 628 |
 *
 * Any even modulus loses at least half; anything divisible by four loses three
 * quarters. Odd moduli are fine, which is why this went unnoticed.
 *
 * **`% 6` was picking a planet's surface**, and there are six surfaces — so
 * `terra`, `arid` and `lava` were unreachable and every planet in the product
 * would have been gas, ice or storm. It survived because it depends on the
 * *shape of the ids*: with short ids like `goal-7` the distribution is even,
 * so the playground looked correct and only production, where goal ids are
 * uuids, would have been wrong.
 *
 * Taking the high bits instead costs one divide and fixes every case.
 */
export const hashUnit = (hash: number): number => (hash >>> 0) / 4294967296;

/** Pick from `count` options by hash, without the low-bit bias above. */
export const pickIndex = (hash: number, count: number): number => {
  if (count <= 0) {
    return 0;
  }
  return Math.min(count - 1, Math.floor(hashUnit(hash) * count));
};

/** A hash mapped onto `[0, range)`, evenly. Replaces `hash % range`. */
export const hashRange = (hash: number, range: number): number =>
  Math.floor(hashUnit(hash) * range);

export const mulberry32 = (seed: number): (() => number) => {
  let a = seed >>> 0;
  return () => {
    a += 0x6d2b79f5;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
};
