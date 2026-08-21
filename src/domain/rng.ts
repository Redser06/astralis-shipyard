/**
 * Deterministic pseudo-random number generation.
 *
 * Every stochastic decision in the wear system draws from here, seeded off the
 * blueprint's `seed`. That is what makes a saved ship render identically every
 * time instead of reshuffling its damage on each reload.
 *
 * mulberry32 — small, fast, good enough distribution for visual variation.
 */
export type Rng = () => number;

export function mulberry32(seed: number): Rng {
  let a = seed >>> 0;
  return function next(): number {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Derive an independent stream from a base seed and a string tag. */
export function streamFor(seed: number, tag: string): Rng {
  let h = seed >>> 0;
  for (let i = 0; i < tag.length; i++) {
    h = (Math.imul(h ^ tag.charCodeAt(i), 0x01000193) >>> 0) || 1;
  }
  return mulberry32(h);
}

export const randRange = (rng: Rng, lo: number, hi: number): number => lo + rng() * (hi - lo);

export const randInt = (rng: Rng, lo: number, hi: number): number =>
  Math.floor(randRange(rng, lo, hi + 1));

export function pick<T>(rng: Rng, items: readonly T[]): T {
  if (items.length === 0) throw new Error('pick() called with an empty list');
  const item = items[Math.floor(rng() * items.length) % items.length];
  return item as T;
}

/** A fresh seed for a newly created ship. Not used on any render path. */
export function newSeed(): number {
  return Math.floor(Math.random() * 0xffffffff) >>> 0;
}
