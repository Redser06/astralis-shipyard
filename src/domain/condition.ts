import { streamFor } from './rng';
import type { ConditionPreset, WearChannels } from './types';

/**
 * The condition system.
 *
 * One scalar in [0, 1] drives seven independent wear channels. The same
 * blueprint renders as a mirror-finish parade ship at 0.0 and a tumbling,
 * unlit hulk at 1.0 — same bones, same silhouette, entirely different story.
 *
 * All jitter is drawn from a seeded stream, so a given (condition, seed) pair
 * always produces the same wear. Determinism is the whole point: a saved ship
 * that reshuffles its battle damage on reload is not a saved ship.
 */

const clamp01 = (v: number): number => Math.max(0, Math.min(1, v));

function smoothstep(edge0: number, edge1: number, x: number): number {
  const t = clamp01((x - edge0) / (edge1 - edge0));
  return t * t * (3 - 2 * t);
}

/** Gaussian bump — used for channels that peak mid-life rather than accumulate. */
function bump(x: number, center: number, width: number): number {
  const d = x - center;
  return Math.exp(-(d * d) / (2 * width * width));
}

export function deriveWear(condition: number, seed: number): WearChannels {
  const c = clamp01(condition);
  const rng = streamFor(seed, 'wear');
  const jitter = (amount: number): number => 1 + (rng() * 2 - 1) * amount;

  return {
    // Convex edges and leading surfaces scuff first, then saturate.
    abrasion: clamp01(smoothstep(0.02, 0.45, c) * jitter(0.12)),
    // Grime settles into cavities steadily over the whole service life.
    grime: clamp01(smoothstep(0.05, 0.8, c) * jitter(0.15)),
    // Thermal scoring around engine bells and radiator roots appears early.
    thermal: clamp01(smoothstep(0.1, 0.6, c) * jitter(0.1)),
    // Micrometeorite pitting simply accumulates with exposure.
    impact: clamp01(Math.pow(c, 1.3) * jitter(0.18)),
    // Oxidation staining is a late-life symptom.
    oxidation: clamp01(smoothstep(0.35, 0.95, c) * jitter(0.2)),
    // Mismatched replacement plating PEAKS MID-LIFE and then falls away:
    // a working ship gets patched, an abandoned one stops being maintained.
    repair: clamp01(bump(c, 0.55, 0.42) * jitter(0.25)),
    // Actual structural failure is reserved for the far end.
    structural: clamp01(smoothstep(0.72, 1.0, c) * jitter(0.1)),
  };
}

export const CONDITION_PRESETS: readonly ConditionPreset[] = [
  {
    id: 'fleet_commission',
    name: 'Fleet Commission',
    min: 0.0,
    max: 0.1,
    blurb: 'Straight out of the yard. Mirror finish, matched plating, every light lit.',
  },
  {
    id: 'active_service',
    name: 'Active Service',
    min: 0.2,
    max: 0.35,
    blurb: 'Working ship. Scuffed leading edges, soot around the bells, still proud.',
  },
  {
    id: 'long_patrol',
    name: 'Long Patrol',
    min: 0.45,
    max: 0.6,
    blurb: 'Months out. Grime in the recesses, a few replaced panels that never got repainted.',
  },
  {
    id: 'frontier_salvage',
    name: 'Frontier Salvage',
    min: 0.7,
    max: 0.85,
    blurb: 'Patched, mismatched and jury-rigged. Held together by whoever had the parts.',
  },
  {
    id: 'derelict_hulk',
    name: 'Derelict Hulk',
    min: 0.9,
    max: 1.0,
    blurb: 'Dead. Lights out, drives cold, tumbling slowly through its own debris.',
  },
] as const;

/** Representative value for a preset — its midpoint. */
export function conditionFor(preset: ConditionPreset): number {
  return (preset.min + preset.max) / 2;
}

/** Which preset best describes an arbitrary condition value. */
export function presetFor(condition: number): ConditionPreset {
  const c = clamp01(condition);
  let best = CONDITION_PRESETS[0] as ConditionPreset;
  let bestDistance = Infinity;
  for (const preset of CONDITION_PRESETS) {
    if (c >= preset.min && c <= preset.max) return preset;
    const distance = Math.min(Math.abs(c - preset.min), Math.abs(c - preset.max));
    if (distance < bestDistance) {
      bestDistance = distance;
      best = preset;
    }
  }
  return best;
}

/** Past this point the ship is dead: running lights out, drives cold, tumbling. */
export const DERELICT_THRESHOLD = 0.9;

export const isDerelict = (condition: number): boolean => condition >= DERELICT_THRESHOLD;
