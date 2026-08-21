import { describe, expect, it } from 'vitest';
import {
  CONDITION_PRESETS,
  DERELICT_THRESHOLD,
  conditionFor,
  deriveWear,
  isDerelict,
  presetFor,
} from './condition';

describe('deriveWear', () => {
  it('is deterministic for a given condition and seed', () => {
    // This is the property the whole system rests on: a saved ship must not
    // reshuffle its battle damage on reload.
    expect(deriveWear(0.6, 12345)).toEqual(deriveWear(0.6, 12345));
    expect(deriveWear(0.0, 1)).toEqual(deriveWear(0.0, 1));
    expect(deriveWear(1.0, 999)).toEqual(deriveWear(1.0, 999));
  });

  it('produces different wear for different seeds', () => {
    expect(deriveWear(0.6, 1)).not.toEqual(deriveWear(0.6, 2));
  });

  it('keeps every channel within 0..1', () => {
    for (let c = 0; c <= 1.0001; c += 0.05) {
      for (const seed of [1, 7, 4242, 0xffff]) {
        for (const [channel, value] of Object.entries(deriveWear(c, seed))) {
          expect(value, `${channel} at c=${c.toFixed(2)} seed=${seed}`).toBeGreaterThanOrEqual(0);
          expect(value, `${channel} at c=${c.toFixed(2)} seed=${seed}`).toBeLessThanOrEqual(1);
        }
      }
    }
  });

  it('leaves a factory-fresh hull essentially unworn', () => {
    const wear = deriveWear(0, 42);
    expect(wear.abrasion).toBeLessThan(0.05);
    expect(wear.structural).toBeLessThan(0.05);
    expect(wear.oxidation).toBeLessThan(0.05);
  });

  it('reserves structural failure for the far end', () => {
    expect(deriveWear(0.5, 42).structural).toBeLessThan(0.1);
    expect(deriveWear(1.0, 42).structural).toBeGreaterThan(0.5);
  });

  it('peaks replacement plating mid-life, not at the end', () => {
    // A working ship gets patched. An abandoned one stops being maintained.
    const seed = 42;
    const early = deriveWear(0.05, seed).repair;
    const middle = deriveWear(0.55, seed).repair;
    const dead = deriveWear(1.0, seed).repair;
    expect(middle).toBeGreaterThan(early);
    expect(middle).toBeGreaterThan(dead);
  });

  it('accumulates impact pitting monotonically with exposure', () => {
    const seed = 7;
    const samples = [0, 0.25, 0.5, 0.75, 1].map((c) => deriveWear(c, seed).impact);
    for (let i = 1; i < samples.length; i++) {
      expect(samples[i]!).toBeGreaterThanOrEqual(samples[i - 1]!);
    }
  });
});

describe('condition presets', () => {
  it('covers the range in ascending, non-overlapping bands', () => {
    for (let i = 1; i < CONDITION_PRESETS.length; i++) {
      expect(CONDITION_PRESETS[i]!.min).toBeGreaterThan(CONDITION_PRESETS[i - 1]!.max);
    }
  });

  it('resolves a value inside a band to that band', () => {
    for (const preset of CONDITION_PRESETS) {
      expect(presetFor(conditionFor(preset)).id).toBe(preset.id);
    }
  });

  it('resolves a value between bands to the nearest one', () => {
    // 0.15 sits in the gap between Fleet Commission (…0.10) and Active Service (0.20…)
    expect(['fleet_commission', 'active_service']).toContain(presetFor(0.15).id);
  });

  it('flags only the top band as derelict', () => {
    expect(isDerelict(DERELICT_THRESHOLD)).toBe(true);
    expect(isDerelict(1)).toBe(true);
    expect(isDerelict(0.85)).toBe(false);
    expect(isDerelict(0)).toBe(false);
  });
});
