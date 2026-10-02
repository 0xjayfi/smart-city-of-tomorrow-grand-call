// Small, deterministic helpers shared by the city and the overlay.
// Everything in the film is a pure function of time t, so frames can be
// rendered in any order and always come out identical.

export const clamp = (x, a = 0, b = 1) => Math.min(b, Math.max(a, x));
export const lerp = (a, b, t) => a + (b - a) * t;
export const smooth = (t) => t * t * (3 - 2 * t);
export const easeOutCubic = (t) => 1 - Math.pow(1 - t, 3);
export const easeInCubic = (t) => t * t * t;
export const easeInOutCubic = (t) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);
export const easeOutExpo = (t) => (t >= 1 ? 1 : 1 - Math.pow(2, -10 * t));
export const easeOutBack = (t) => {
  const c1 = 1.4, c3 = c1 + 1;
  return 1 + c3 * Math.pow(t - 1, 3) + c1 * Math.pow(t - 1, 2);
};

/** Progress of t through [start, start + dur], clamped to 0..1. */
export const prog = (t, start, dur) => clamp((t - start) / dur);

/** Fade-in then fade-out envelope. */
export const envelope = (t, tin, din, tout, dout) =>
  clamp((t - tin) / din) * (1 - clamp((t - tout) / dout));

/** Seeded PRNG (mulberry32). */
export function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Stateless hash in 0..1 for an integer. */
export const hash1 = (n) => {
  let x = Math.sin(n * 127.1 + 311.7) * 43758.5453;
  return x - Math.floor(x);
};

export const fmtInt = (n) => Math.round(n).toLocaleString('en-US');
