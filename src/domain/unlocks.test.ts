import { describe, expect, it } from 'vitest';
import {
  INITIAL_RESEARCH,
  costOf,
  isLockable,
  isUnlocked,
  selectionBlockedReason,
  unlock,
  type ResearchState,
} from './unlocks';

describe('research gating', () => {
  it('treats freely-available technology as unlocked', () => {
    expect(isUnlocked('ion_pulse', INITIAL_RESEARCH)).toBe(true);
    expect(isUnlocked('duranium', INITIAL_RESEARCH)).toBe(true);
    expect(selectionBlockedReason('ion_pulse', INITIAL_RESEARCH)).toBeNull();
  });

  it('locks the three researchable technologies until bought', () => {
    // This is the bug the prototype had: these were set in the R&D tab and
    // never consulted by the Designer, so locked tech stayed selectable.
    for (const tech of ['graviton_singularity', 'tachyon_disruptor', 'zero_point_core']) {
      expect(isLockable(tech)).toBe(true);
      expect(isUnlocked(tech, INITIAL_RESEARCH)).toBe(false);
      expect(selectionBlockedReason(tech, INITIAL_RESEARCH)).toMatch(/Requires research/);
    }
  });

  it('spends points and unlocks on success', () => {
    const result = unlock(INITIAL_RESEARCH, 'tachyon_disruptor');
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.state.points).toBe(INITIAL_RESEARCH.points - costOf('tachyon_disruptor')!);
    expect(isUnlocked('tachyon_disruptor', result.state)).toBe(true);
    expect(selectionBlockedReason('tachyon_disruptor', result.state)).toBeNull();
  });

  it('never mutates the state it is given', () => {
    const before: ResearchState = { points: 9000, unlocked: {} };
    const snapshot = JSON.stringify(before);
    unlock(before, 'tachyon_disruptor');
    expect(JSON.stringify(before)).toBe(snapshot);
  });

  it('refuses when the player cannot afford it, and says how short they are', () => {
    const broke: ResearchState = { points: 100, unlocked: {} };
    const result = unlock(broke, 'zero_point_core');
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toMatch(/short/);
  });

  it('refuses to research the same technology twice', () => {
    const owned: ResearchState = { points: 99999, unlocked: { tachyon_disruptor: true } };
    const result = unlock(owned, 'tachyon_disruptor');
    expect(result.ok).toBe(false);
  });

  it('refuses to research technology that needs no research', () => {
    const result = unlock(INITIAL_RESEARCH, 'ion_pulse');
    expect(result.ok).toBe(false);
  });

  it('leaves other unlocks intact when buying a new one', () => {
    const first = unlock(INITIAL_RESEARCH, 'tachyon_disruptor');
    expect(first.ok).toBe(true);
    if (!first.ok) return;
    const second = unlock(first.state, 'graviton_singularity');
    expect(second.ok).toBe(true);
    if (!second.ok) return;
    expect(isUnlocked('tachyon_disruptor', second.state)).toBe(true);
    expect(isUnlocked('graviton_singularity', second.state)).toBe(true);
  });
});
