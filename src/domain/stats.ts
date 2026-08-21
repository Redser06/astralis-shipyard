import { getArchetype } from './architectures';
import {
  getFtl,
  getFuel,
  getMaterial,
  getSublight,
  getWeapon,
} from './components';
import type { Blueprint, ShipStats } from './types';

/**
 * Derived ship statistics.
 *
 * The prototype stored a hand-written `stats` block on each preset that was
 * never displayed and never recalculated. Those hand-written numbers were also
 * mutually inconsistent — the Rocinante scored 84 firepower on the *weakest*
 * weapon in the catalogue while the Horizon scored 62 on the strongest — so
 * they are not reproduced here. Stats are computed from the component choices
 * instead, which is what makes those choices mean something.
 *
 * Every function in this module is pure and synchronous.
 */

const clamp = (v: number, lo = 0, hi = 100): number => Math.max(lo, Math.min(hi, v));

/** Structural mass of a bare hull before any component is fitted. */
const BASE_HULL_MASS = 60;
/** Reference consumable mass at massFactor 1.0. */
const BASE_CONSUMABLE_MASS = 30;

/** Total dry mass, in arbitrary but internally consistent units. */
export function deriveMass(bp: Blueprint): number {
  const arch = getArchetype(bp.architecture);
  const sublight = getSublight(bp.sublight);
  const ftl = getFtl(bp.ftl);
  const fuel = getFuel(bp.fuel);
  const material = getMaterial(bp.material);

  const structural = BASE_HULL_MASS * arch.modifiers.massFactor * material.weight;
  const propulsion = sublight.mass + ftl.mass;
  const consumables = BASE_CONSUMABLE_MASS * fuel.massFactor;

  return structural + propulsion + consumables;
}

/** Thrust-to-weight ratio. The single number that drives sublight speed. */
export function deriveThrustToWeight(bp: Blueprint): number {
  return getSublight(bp.sublight).thrust / deriveMass(bp);
}

/**
 * Wear degrades performance. A Frontier Salvage hauler genuinely is slower and
 * hits softer than the same blueprint fresh out of commission — which is what
 * stops the condition slider being purely cosmetic.
 */
function wearPenalty(condition: number, severity: number): number {
  return 1 - severity * clamp(condition, 0, 1);
}

export function deriveStats(bp: Blueprint): ShipStats {
  const arch = getArchetype(bp.architecture).modifiers;
  const weapon = getWeapon(bp.weapons);
  const material = getMaterial(bp.material);
  const fuel = getFuel(bp.fuel);
  const ftl = getFtl(bp.ftl);

  // Speed — thrust-to-weight, compressed by a square root so the top end does
  // not run away, then shifted by the archetype's aerodynamic/structural bias.
  const twr = deriveThrustToWeight(bp);
  const speed = clamp(
    Math.round((34 * Math.sqrt(twr) + arch.speed) * wearPenalty(bp.condition, 0.35)),
  );

  // Armour — dominated by the hull composite, then the archetype's structure.
  const armor = clamp(
    Math.round(
      ((material.armor / 1150) * 78 + 8 + arch.armor) * wearPenalty(bp.condition, 0.25),
    ),
  );

  // Firepower — weighted toward alpha strike (70%) over sustained rate (30%),
  // so torpedoes read as heavy hitters despite a low cyclic rate.
  const alpha = weapon.damage / 890;
  const sustained = (weapon.damage * weapon.rate) / 62300;
  const firepower = clamp(
    Math.round(
      ((0.7 * alpha + 0.3 * sustained) * 88 + 6 + arch.firepower) *
        wearPenalty(bp.condition, 0.35),
    ),
  );

  // Stealth — architecture is the dominant term, then hull composite tier.
  // Hot weapons and bulky external tanks both cost you.
  const materialTierBonus = ((material.tier - 1) / 3) * 22;
  const heatPenalty = (weapon.heat / 90) * 14;
  const bulkPenalty = ((fuel.massFactor - 0.25) / 1.15) * 12;
  const stealth = clamp(
    Math.round(
      (30 + arch.stealth + materialTierBonus - heatPenalty - bulkPenalty) *
        wearPenalty(bp.condition, 0.2),
    ),
  );

  // Warp — a direct read of jump range, nudged by the archetype.
  const warp = clamp(
    Math.round(
      ((ftl.jumpRange / 95) * 92 + arch.warp) * wearPenalty(bp.condition, 0.35),
    ),
  );

  return { speed, armor, firepower, stealth, warp };
}

/** Convenience for the HUD — an at-a-glance overall rating. */
export function deriveOverall(stats: ShipStats): number {
  const { speed, armor, firepower, stealth, warp } = stats;
  return Math.round((speed + armor + firepower + stealth + warp) / 5);
}

export const STAT_LABELS: ReadonlyArray<{ key: keyof ShipStats; label: string }> = [
  { key: 'speed', label: 'Sublight' },
  { key: 'armor', label: 'Armour' },
  { key: 'firepower', label: 'Firepower' },
  { key: 'stealth', label: 'Stealth' },
  { key: 'warp', label: 'Warp' },
] as const;
