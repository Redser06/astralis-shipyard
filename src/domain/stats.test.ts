import { describe, expect, it } from 'vitest';
import { deriveMass, deriveStats, deriveThrustToWeight } from './stats';
import { SHIP_PRESETS } from './presets';
import type { Blueprint } from './types';

/**
 * These assert *invariants*, not magic numbers. Pinning exact values would
 * make the suite a change-detector; pinning the relationships is what actually
 * says "component choice is meaningful".
 */

const base: Blueprint = {
  id: 'test',
  name: 'Test Article',
  class: 'Test',
  architecture: 'angular_stealth',
  sublight: 'mpd_thruster',
  ftl: 'alcubierre_ring',
  weapons: 'plasma_lance',
  sensors: 'ladar_array',
  fuel: 'antimatter_pods',
  material: 'carbon_nanotube',
  accentColor: '#38BDF8',
  condition: 0,
  seed: 1,
};

const with_ = (patch: Partial<Blueprint>): Blueprint => ({ ...base, ...patch });

describe('deriveStats', () => {
  it('keeps every stat within 0..100 across the whole catalogue', () => {
    const architectures = [
      'angular_stealth',
      'industrial_expanse',
      'brutalist_dreadnought',
      'outrigger_science',
      'aerodynamic_sleek',
    ] as const;
    const materials = [
      'duranium',
      'carbon_nanotube',
      'titanium_aerogel',
      'chronium_cloak',
    ] as const;
    const weapons = [
      'gauss_cannons',
      'plasma_lance',
      'quantum_torpedoes',
      'tachyon_disruptor',
    ] as const;

    for (const architecture of architectures) {
      for (const material of materials) {
        for (const weapon of weapons) {
          const stats = deriveStats(with_({ architecture, material, weapons: weapon }));
          for (const [key, value] of Object.entries(stats)) {
            expect(value, `${architecture}/${material}/${weapon} ${key}`).toBeGreaterThanOrEqual(0);
            expect(value, `${architecture}/${material}/${weapon} ${key}`).toBeLessThanOrEqual(100);
            expect(Number.isFinite(value)).toBe(true);
          }
        }
      }
    }
  });

  it('is deterministic', () => {
    expect(deriveStats(base)).toEqual(deriveStats(base));
  });

  it('trades speed for a heavier hull composite', () => {
    const light = deriveStats(with_({ material: 'chronium_cloak' })).speed;
    const heavy = deriveStats(with_({ material: 'duranium' })).speed;
    expect(light).toBeGreaterThan(heavy);
  });

  it('rewards a heavier hull composite with more armour', () => {
    const light = deriveStats(with_({ material: 'chronium_cloak' })).armor;
    const weak = deriveStats(with_({ material: 'duranium' })).armor;
    expect(light).toBeGreaterThan(weak);
  });

  it('ranks firepower by weapon strength', () => {
    const ranked = (
      ['gauss_cannons', 'plasma_lance', 'quantum_torpedoes', 'tachyon_disruptor'] as const
    ).map((weapons) => deriveStats(with_({ weapons })).firepower);

    for (let i = 1; i < ranked.length; i++) {
      expect(ranked[i]!, `weapon ${i} should out-gun weapon ${i - 1}`).toBeGreaterThan(
        ranked[i - 1]!,
      );
    }
  });

  it('ranks warp by FTL jump range', () => {
    const none = deriveStats(with_({ ftl: 'none' })).warp;
    const shunt = deriveStats(with_({ ftl: 'hyper_shunt' })).warp;
    const ring = deriveStats(with_({ ftl: 'alcubierre_ring' })).warp;
    const fold = deriveStats(with_({ ftl: 'graviton_singularity' })).warp;
    expect(none).toBe(0);
    expect(shunt).toBeGreaterThan(none);
    expect(ring).toBeGreaterThan(shunt);
    expect(fold).toBeGreaterThan(ring);
  });

  it('makes the stealth archetype stealthier than the dreadnought', () => {
    const sneaky = deriveStats(with_({ architecture: 'angular_stealth' })).stealth;
    const brick = deriveStats(with_({ architecture: 'brutalist_dreadnought' })).stealth;
    expect(sneaky).toBeGreaterThan(brick);
  });

  it('armours the dreadnought better than the science cruiser', () => {
    const brick = deriveStats(with_({ architecture: 'brutalist_dreadnought' })).armor;
    const science = deriveStats(with_({ architecture: 'outrigger_science' })).armor;
    expect(brick).toBeGreaterThan(science);
  });

  it('penalises a bulky external fuel tank on stealth', () => {
    const compact = deriveStats(with_({ fuel: 'zero_point_core' })).stealth;
    const bulky = deriveStats(with_({ fuel: 'cryo_h2' })).stealth;
    expect(compact).toBeGreaterThan(bulky);
  });

  it('degrades performance as condition worsens', () => {
    const fresh = deriveStats(with_({ condition: 0 }));
    const wrecked = deriveStats(with_({ condition: 1 }));
    expect(wrecked.speed).toBeLessThan(fresh.speed);
    expect(wrecked.firepower).toBeLessThan(fresh.firepower);
    expect(wrecked.warp).toBeLessThan(fresh.warp);
    expect(wrecked.armor).toBeLessThan(fresh.armor);
  });
});

describe('deriveMass', () => {
  it('is always positive', () => {
    for (const preset of SHIP_PRESETS) {
      expect(deriveMass(preset)).toBeGreaterThan(0);
    }
  });

  it('increases with a heavier fuel system', () => {
    expect(deriveMass(with_({ fuel: 'cryo_h2' }))).toBeGreaterThan(
      deriveMass(with_({ fuel: 'zero_point_core' })),
    );
  });

  it('gives the fusion torch a better thrust-to-weight than the ion drive', () => {
    expect(deriveThrustToWeight(with_({ sublight: 'fusion_torch' }))).toBeGreaterThan(
      deriveThrustToWeight(with_({ sublight: 'ion_pulse' })),
    );
  });
});

describe('presets', () => {
  it('every preset produces sane stats', () => {
    for (const preset of SHIP_PRESETS) {
      const stats = deriveStats(preset);
      for (const value of Object.values(stats)) {
        expect(value).toBeGreaterThanOrEqual(0);
        expect(value).toBeLessThanOrEqual(100);
      }
    }
  });

  it('has unique ids', () => {
    const ids = SHIP_PRESETS.map((p) => p.id);
    expect(new Set(ids).size).toBe(ids.length);
  });
});
