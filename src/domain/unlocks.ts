import type { TechId } from './types';

/**
 * Research gating.
 *
 * In the prototype `unlockedTechs` was written by three R&D buttons and read by
 * nobody — locked technology stayed freely selectable in the Designer, so the
 * research economy was decorative. This module is the missing predicate, kept
 * pure so the rule is testable without rendering anything.
 */

export type ResearchState = {
  points: number;
  unlocked: Readonly<Record<string, boolean>>;
};

/** Technologies that must be researched before they can be fitted. */
export const RESEARCH_COSTS: Readonly<Partial<Record<TechId, number>>> = {
  graviton_singularity: 5000,
  tachyon_disruptor: 4200,
  zero_point_core: 6500,
};

export const LOCKABLE_TECHS = Object.keys(RESEARCH_COSTS) as TechId[];

export const isLockable = (tech: string): boolean =>
  Object.prototype.hasOwnProperty.call(RESEARCH_COSTS, tech);

export const costOf = (tech: string): number | null =>
  RESEARCH_COSTS[tech as TechId] ?? null;

/** Freely-available technology counts as unlocked. */
export function isUnlocked(tech: string, state: ResearchState): boolean {
  if (!isLockable(tech)) return true;
  return state.unlocked[tech] === true;
}

/**
 * Why a technology cannot be fitted, or null if it can.
 * The Designer surfaces this as the disabled control's tooltip, so the player
 * is told *why* rather than finding a dead button.
 */
export function selectionBlockedReason(tech: string, state: ResearchState): string | null {
  if (isUnlocked(tech, state)) return null;
  const cost = costOf(tech);
  return cost === null
    ? 'Not yet researched'
    : `Requires research — ${cost.toLocaleString()} XP`;
}

/**
 * Whether a whole blueprint can be fitted.
 *
 * Without this, presets are a hole straight through the research gate: loading
 * a curated ship would install locked technology that the Designer refuses to
 * select one component at a time.
 */
export function blueprintBlockedReason(
  blueprint: Readonly<{
    sublight: string;
    ftl: string;
    weapons: string;
    sensors: string;
    fuel: string;
    material: string;
  }>,
  state: ResearchState,
): string | null {
  const fitted = [
    blueprint.sublight,
    blueprint.ftl,
    blueprint.weapons,
    blueprint.sensors,
    blueprint.fuel,
    blueprint.material,
  ];
  for (const tech of fitted) {
    const reason = selectionBlockedReason(tech, state);
    if (reason) return reason;
  }
  return null;
}

export type UnlockResult =
  | { ok: true; state: ResearchState }
  | { ok: false; reason: string };

/** Spend research points to unlock a technology. Never mutates its input. */
export function unlock(state: ResearchState, tech: string): UnlockResult {
  const cost = costOf(tech);
  if (cost === null) return { ok: false, reason: 'That technology needs no research' };
  if (state.unlocked[tech]) return { ok: false, reason: 'Already researched' };
  if (state.points < cost) {
    return {
      ok: false,
      reason: `Insufficient research — ${(cost - state.points).toLocaleString()} XP short`,
    };
  }
  return {
    ok: true,
    state: {
      points: state.points - cost,
      unlocked: { ...state.unlocked, [tech]: true },
    },
  };
}

export const INITIAL_RESEARCH: ResearchState = {
  points: 14500,
  unlocked: {},
};
