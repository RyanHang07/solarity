/** Check-in: dark → peak bloom → rest glow. Check-out is the reverse. t is 0..1. */
const PEAK = 1.7;
const REST = 1;

export const shineLight = (t: number): number => {
  if (t <= 0) {
    return 0;
  }
  if (t < 0.36) {
    const u = t / 0.36;
    return PEAK * u * u;
  }
  if (t < 0.52) {
    return PEAK;
  }
  if (t >= 1) {
    return REST;
  }
  const u = (t - 0.52) / 0.48;
  const eased = 1 - (1 - u) ** 3;
  return PEAK + (REST - PEAK) * eased;
};

export const dimLight = (t: number): number => {
  if (t <= 0) {
    return REST;
  }
  if (t < 0.48) {
    const u = t / 0.48;
    const eased = u * u * u;
    return REST + (PEAK - REST) * eased;
  }
  if (t < 0.64) {
    return PEAK;
  }
  if (t >= 1) {
    return 0;
  }
  const u = (t - 0.64) / 0.36;
  const eased = 1 - (1 - u) * (1 - u);
  return PEAK * (1 - eased);
};
