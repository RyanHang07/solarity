/**
 * Where each member's system sits in a shared sky.
 *
 * ## The one property this has to have
 *
 * **A member joining must not move anybody else.** A Circle that rearranges
 * itself every time somebody accepts an invite looks broken even though
 * nothing is wrong, and it throws away the spatial memory of who is where.
 *
 * That rules out anything computed from the current member count: a ring of
 * `n` moves all `n` when it becomes `n + 1`. What it wants is a **sequence**,
 * where position `k` depends only on `k`, so the newest member takes a seat
 * nobody was sitting in.
 *
 * Phyllotaxis — the arrangement of seeds in a sunflower — is exactly that. Each
 * position is `k` turns of the golden angle out along a square-root spiral, so
 * it packs evenly at any count, never collides, and every existing position is
 * untouched by the next one.
 *
 * **One rule at every count, deliberately.** A Circle of two looks like a
 * natural pair and a Circle of ten packs evenly, without a threshold anywhere —
 * and a threshold would rearrange everybody the moment it was crossed, which is
 * the exact failure this is built to avoid.
 *
 * ## `k` is join order, and that is not the roster's order
 *
 * `circle_roster` returns `order by (m.user_id = v_uid) desc, joined_at asc` —
 * the viewer first, deliberately, so the list reads well. **Using that index
 * here would give every member a differently arranged Circle**, and two people
 * looking at one phone would disagree about where somebody is.
 *
 * The host orders `snapshot.systems` by join time. The viewer is found by the
 * camera, not by the layout.
 */

/**
 * 137.50776°, in radians. The golden angle: the irrational turn that stops
 * successive positions ever lining up into spokes.
 */
export const GOLDEN_ANGLE = Math.PI * (3 - Math.sqrt(5));

export type ClusterSlot = {
  /** Offset from the centre of the cluster, in the sky's own units. */
  x: number;
  y: number;
  /** How far from the centre. Useful for depth ordering and fit. */
  distance: number;
};

/**
 * The slot for the `index`-th member to have joined.
 *
 * `spacing` is the distance between neighbouring systems; the spiral's radius
 * grows as `spacing · √k`, which is what keeps the density even rather than
 * thinning out as the Circle grows.
 */
export const clusterSlot = (index: number, spacing: number): ClusterSlot => {
  const distance = spacing * Math.sqrt(index);
  const angle = index * GOLDEN_ANGLE;
  return {
    x: Math.cos(angle) * distance,
    y: Math.sin(angle) * distance,
    distance,
  };
};

/** Every slot up to `count`, in join order. */
export const clusterSlots = (count: number, spacing: number): ClusterSlot[] =>
  Array.from({ length: Math.max(0, count) }, (_, index) =>
    clusterSlot(index, spacing),
  );

/**
 * How much to shrink each system so a cluster of `count` still fits.
 *
 * **One system is never shrunk**, so a personal galaxy is pixel-for-pixel what
 * it always was — the one-element case has to be the same picture, not a
 * cluster of one.
 *
 * Beyond that it falls off as `1/√count`, which is the rate that keeps the
 * *total drawn area* roughly constant: doubling the members halves each
 * system's area rather than its width. Linear falloff shrinks small Circles too
 * hard and large ones not enough.
 *
 * Floored, because past a certain point a system stops reading as a solar
 * system at all and becomes a smudge. Ten members sit comfortably above it.
 */
export const CLUSTER_MIN_SYSTEM_SCALE = 0.3;

export const clusterSystemScale = (count: number): number => {
  if (count <= 1) {
    return 1;
  }
  return Math.max(CLUSTER_MIN_SYSTEM_SCALE, 1 / Math.sqrt(count));
};

/**
 * How far the whole cluster extends, so the sky can fit it.
 *
 * The furthest edge of any system: its distance from the centre plus its own
 * reach once scaled. **Not the sum, and not the largest system's reach** —
 * either would frame the wrong thing, and the second would let a member with
 * ten goals push everybody else off screen.
 */
export const clusterReach = (
  systems: readonly { slotDistance: number; reach: number }[],
  systemScale: number,
): number => {
  let furthest = 0;
  for (const system of systems) {
    const edge = system.slotDistance + system.reach * systemScale;
    if (edge > furthest) {
      furthest = edge;
    }
  }
  return furthest;
};

/**
 * How legible orbit rings need to be at this cluster size.
 *
 * A hundred ellipses at cluster scale is a lot of line for not much
 * information, so the rings dim and thin as members are added. The strokes are
 * only repainted when something changes rather than every frame, so this costs
 * nothing per frame — it is about the picture, not the frame budget.
 *
 * **The frame budget question is the ring count, not the ring weight**, and it
 * is measured on hardware in step 6 rather than guessed at here. If a hundred
 * `Graphics` objects turn out to be the problem, the fix is one `Graphics` per
 * system holding every ellipse — same picture, a tenth of the objects.
 *
 * **The floor was 0.35 and the rings disappeared.** At ten members that put the
 * stroke at 0.44 physical pixels — below one, so the rasteriser blended it into
 * nothing and a Circle looked like suns with loose planets. 0.62 keeps them
 * present; `orbitStrokeAt` does the other half by holding the *width* near
 * full and spending the dimming on alpha, which is what a thinner-looking line
 * actually is.
 */
export const CLUSTER_RING_FLOOR = 0.62;

export const clusterRingLegibility = (count: number): number => {
  if (count <= 1) {
    return 1;
  }
  return Math.max(CLUSTER_RING_FLOOR, 1 / Math.sqrt(count));
};
