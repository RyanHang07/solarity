/** Evenly space orbit radii so the outermost Ring fits the viewport. */
export const orbitRadiiForCount = (
  count: number,
  inner = 95,
  outer = 360,
): number[] => {
  if (count <= 0) {
    return [];
  }
  if (count === 1) {
    return [inner];
  }
  const step = (outer - inner) / (count - 1);
  return Array.from({ length: count }, (_, index) =>
    Math.round(inner + step * index),
  );
};
