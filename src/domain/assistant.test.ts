import { describe, expect, it } from 'vitest';
import { detectIntent, proposeBlueprint, validateProposal } from './assistant';
import { SHIP_PRESETS } from './presets';
import { deriveStats } from './stats';
import { INITIAL_RESEARCH, unlock, type ResearchState } from './unlocks';
import type { Blueprint } from './types';

const base = SHIP_PRESETS[0] as Blueprint;
const open: ResearchState = {
  points: 0,
  unlocked: { graviton_singularity: true, tachyon_disruptor: true, zero_point_core: true },
};

describe('detectIntent', () => {
  it('reads a role and maps it to an archetype', () => {
    expect(detectIntent('a fast stealth scout').archetypeHint).toBe('angular_stealth');
    expect(detectIntent('heavy siege dreadnought').archetypeHint).toBe('brutalist_dreadnought');
    expect(detectIntent('long survey expedition').archetypeHint).toBe('outrigger_science');
    expect(detectIntent('atmospheric dropship').archetypeHint).toBe('aerodynamic_sleek');
  });

  it('reads condition from the story, not just adjectives', () => {
    expect(detectIntent('a battered salvage hauler').conditionHint).toBeGreaterThan(0.6);
    expect(detectIntent('straight out of commission, mirror finish').conditionHint).toBeLessThan(
      0.2,
    );
  });

  it('distinguishes "ghost ship" from "ghost"', () => {
    // Multi-word phrases are matched first, so one means derelict and the
    // other means stealthy.
    expect(detectIntent('a ghost ship adrift').conditionHint).toBeGreaterThan(0.9);
    expect(detectIntent('a ghost that never shows on radar').archetypeHint).toBe(
      'angular_stealth',
    );
  });

  it('weights the stat it was actually asked for', () => {
    expect(detectIntent('maximum firepower').weights.firepower).toBeGreaterThan(0.5);
    expect(detectIntent('as fast as possible').weights.speed).toBeGreaterThan(0.5);
  });

  it('returns no matches for an unrelated prompt', () => {
    expect(detectIntent('bananas').matchedTerms).toHaveLength(0);
  });
});

describe('proposeBlueprint', () => {
  it('is deterministic for the same prompt', () => {
    const a = proposeBlueprint('fast stealth scout', base, open);
    const b = proposeBlueprint('fast stealth scout', base, open);
    expect(a.blueprint).toEqual(b.blueprint);
    expect(a.summary).toBe(b.summary);
  });

  it('honours the archetype the brief asks for', () => {
    expect(proposeBlueprint('siege dreadnought', base, open).blueprint.architecture).toBe(
      'brutalist_dreadnought',
    );
  });

  it('actually optimises — a firepower brief out-guns a stealth brief', () => {
    const gunship = proposeBlueprint('maximum firepower warship', base, open);
    const sneak = proposeBlueprint('quiet covert stealth scout', base, open);
    expect(deriveStats(gunship.blueprint).firepower).toBeGreaterThan(
      deriveStats(sneak.blueprint).firepower,
    );
    expect(deriveStats(sneak.blueprint).stealth).toBeGreaterThan(
      deriveStats(gunship.blueprint).stealth,
    );
  });

  it('gives a long-range brief more warp than a short-range one', () => {
    const far = proposeBlueprint('deep space interstellar explorer', base, open);
    const near = proposeBlueprint('armoured system patrol brick', base, open);
    expect(deriveStats(far.blueprint).warp).toBeGreaterThan(deriveStats(near.blueprint).warp);
  });

  it('never proposes technology the player has not researched', () => {
    // INITIAL_RESEARCH has all three lockables still locked.
    const proposal = proposeBlueprint('the most powerful weapon possible', base, INITIAL_RESEARCH);
    expect(proposal.blueprint.weapons).not.toBe('tachyon_disruptor');
    expect(proposal.blueprint.fuel).not.toBe('zero_point_core');
    expect(proposal.blueprint.ftl).not.toBe('graviton_singularity');
  });

  it('uses newly researched technology once it is unlocked', () => {
    const researched = unlock(INITIAL_RESEARCH, 'tachyon_disruptor');
    expect(researched.ok).toBe(true);
    if (!researched.ok) return;
    const proposal = proposeBlueprint('maximum firepower', base, researched.state);
    expect(proposal.blueprint.weapons).toBe('tachyon_disruptor');
  });

  it('does not strip out a whole subsystem to save mass', () => {
    // A "heavy hauler" brief mentions nothing about range, and the optimiser
    // used to answer by fitting no FTL core at all — technically optimal for
    // the requested stats, useless as a ship.
    const proposal = proposeBlueprint('a heavy industrial cargo hauler', base, open);
    expect(proposal.blueprint.ftl).not.toBe('none');
  });

  it('explains every choice it made', () => {
    const proposal = proposeBlueprint('fast stealth scout', base, open);
    expect(proposal.rationale.length).toBeGreaterThanOrEqual(6);
    for (const line of proposal.rationale) {
      expect(line.category).toBeTruthy();
      expect(line.choice).toBeTruthy();
      expect(line.because).toBeTruthy();
    }
    expect(proposal.source).toBe('rules');
  });

  it('still returns a usable ship for an unrecognised brief', () => {
    const proposal = proposeBlueprint('bananas', base, open);
    expect(proposal.blueprint.architecture).toBeTruthy();
    expect(proposal.summary).toMatch(/balanced/i);
  });
});

describe('validateProposal', () => {
  it('accepts a well-formed model response', () => {
    const { blueprint, problems } = validateProposal(
      {
        architecture: 'outrigger_science',
        sublight: 'ion_pulse',
        ftl: 'alcubierre_ring',
        weapons: 'plasma_lance',
        sensors: 'tachyon_scanner',
        fuel: 'antimatter_pods',
        material: 'titanium_aerogel',
        condition: 0.4,
        name: 'SCI-2 Test',
      },
      base,
      open,
    );
    expect(problems).toHaveLength(0);
    expect(blueprint.architecture).toBe('outrigger_science');
    expect(blueprint.condition).toBe(0.4);
    expect(blueprint.name).toBe('SCI-2 Test');
  });

  it('rejects components the model invented', () => {
    const { blueprint, problems } = validateProposal(
      { weapons: 'death_ray', architecture: 'imperial_star_destroyer' },
      base,
      open,
    );
    expect(blueprint.weapons).toBe(base.weapons);
    expect(blueprint.architecture).toBe(base.architecture);
    expect(problems).toHaveLength(2);
  });

  it('refuses locked technology even when the model asks for it', () => {
    // The research gate is enforced against the model, not just the UI.
    const { blueprint, problems } = validateProposal(
      { weapons: 'tachyon_disruptor' },
      base,
      INITIAL_RESEARCH,
    );
    expect(blueprint.weapons).toBe(base.weapons);
    expect(problems[0]).toMatch(/not researched/i);
  });

  it('clamps an out-of-range condition', () => {
    expect(validateProposal({ condition: 7 }, base, open).blueprint.condition).toBe(1);
    expect(validateProposal({ condition: -3 }, base, open).blueprint.condition).toBe(0);
  });

  it('never throws on hostile or malformed input', () => {
    for (const garbage of [null, undefined, 42, 'nonsense', [], { name: { nested: true } }]) {
      expect(() => validateProposal(garbage, base, open)).not.toThrow();
    }
  });

  it('ignores an accent colour that is not a hex triplet', () => {
    expect(validateProposal({ accentColor: 'javascript:alert(1)' }, base, open).blueprint
      .accentColor).toBe(base.accentColor);
    expect(validateProposal({ accentColor: '#ABCDEF' }, base, open).blueprint.accentColor).toBe(
      '#ABCDEF',
    );
  });

  it('caps absurdly long names rather than rendering them', () => {
    const long = 'x'.repeat(5000);
    expect(validateProposal({ name: long }, base, open).blueprint.name.length).toBeLessThanOrEqual(
      60,
    );
  });
});
