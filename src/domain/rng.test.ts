import { describe, expect, it } from 'vitest';
import { mulberry32, pick, randInt, randRange, streamFor } from './rng';

describe('mulberry32', () => {
  it('produces the same sequence for the same seed', () => {
    const a = mulberry32(1234);
    const b = mulberry32(1234);
    const seqA = Array.from({ length: 20 }, () => a());
    const seqB = Array.from({ length: 20 }, () => b());
    expect(seqA).toEqual(seqB);
  });

  it('produces different sequences for different seeds', () => {
    const a = Array.from({ length: 10 }, mulberry32(1));
    const b = Array.from({ length: 10 }, mulberry32(2));
    expect(a).not.toEqual(b);
  });

  it('stays within [0, 1)', () => {
    const rng = mulberry32(99);
    for (let i = 0; i < 5000; i++) {
      const v = rng();
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(1);
    }
  });

  it('is roughly uniform', () => {
    const rng = mulberry32(7);
    const buckets = new Array(10).fill(0) as number[];
    const n = 20000;
    for (let i = 0; i < n; i++) buckets[Math.floor(rng() * 10)]! += 1;
    for (const count of buckets) {
      expect(count).toBeGreaterThan(n / 10 - n / 40);
      expect(count).toBeLessThan(n / 10 + n / 40);
    }
  });
});

describe('streamFor', () => {
  it('derives independent, repeatable streams from one seed', () => {
    const wear = Array.from({ length: 5 }, streamFor(42, 'wear'));
    const panels = Array.from({ length: 5 }, streamFor(42, 'panels'));
    const wearAgain = Array.from({ length: 5 }, streamFor(42, 'wear'));
    expect(wear).toEqual(wearAgain);
    expect(wear).not.toEqual(panels);
  });
});

describe('helpers', () => {
  it('randRange stays inside its bounds', () => {
    const rng = mulberry32(3);
    for (let i = 0; i < 1000; i++) {
      const v = randRange(rng, -5, 5);
      expect(v).toBeGreaterThanOrEqual(-5);
      expect(v).toBeLessThan(5);
    }
  });

  it('randInt is inclusive at both ends', () => {
    const rng = mulberry32(5);
    const seen = new Set<number>();
    for (let i = 0; i < 2000; i++) seen.add(randInt(rng, 1, 4));
    expect([...seen].sort()).toEqual([1, 2, 3, 4]);
  });

  it('pick always returns a member of the list', () => {
    const rng = mulberry32(11);
    const items = ['a', 'b', 'c'] as const;
    for (let i = 0; i < 200; i++) expect(items).toContain(pick(rng, items));
  });

  it('pick rejects an empty list rather than returning undefined', () => {
    expect(() => pick(mulberry32(1), [])).toThrow();
  });
});
