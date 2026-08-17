import { describe, expect, it } from 'vitest';
import { WEAPONS } from './components';
import {
  ALL_FITTINGS,
  HYPER_SHUNT_HOUSING,
  WEAPON_FITTINGS,
  fittingBounds,
  fittingIssues,
  getWeaponFitting,
  pipeRoute,
  recipeFamily,
  resolveAnchor,
  type FittingDef,
} from './fittings';
import type { WeaponId } from './types';

/**
 * The registry's invariants, checked without a GPU.
 *
 * These are the failures that used to be found by squinting at a screenshot,
 * or not at all: a part half-buried in the hull because it was centred on its
 * socket, a pipe routed to an anchor nobody declared, a "smooth" component
 * built entirely from boxes.
 */

describe('registry integrity', () => {
  it('every fitting is well formed', () => {
    for (const def of ALL_FITTINGS) {
      expect(fittingIssues(def), def.id).toEqual([]);
    }
  });

  it('every weapon in the catalogue has a shape, and every shape a weapon', () => {
    const catalogue = WEAPONS.map((weapon) => weapon.id).sort();
    const registered = Object.keys(WEAPON_FITTINGS).sort();
    expect(registered).toEqual(catalogue);
  });

  it('every fitting sits on its mounting face, not through it', () => {
    // R1-06: the engine bell, turret base, RCS block, radar collar and all
    // four fuel tanks used to be *centred* on the socket, so half of each sat
    // behind the mount plane. One socket buried a tier-1 tank in a dreadnought
    // skirt and left a tier-4 core hanging in space.
    for (const def of ALL_FITTINGS) {
      const bounds = fittingBounds(def);
      expect(bounds.min[1], `${def.id} dips below its mounting face`).toBeGreaterThanOrEqual(-0.05);
      expect(bounds.max[1], `${def.id} has no height`).toBeGreaterThan(0.1);
    }
  });

  it('declares a shape family that matches the recipes used', () => {
    for (const def of ALL_FITTINGS) {
      for (const piece of def.pieces) {
        const family = recipeFamily(piece.recipe);
        if (family) expect(family, `${def.id}/${piece.recipe.kind}`).toBe(def.family);
      }
    }
  });

  it('ships components in both shape families', () => {
    const families = new Set(ALL_FITTINGS.map((def) => def.family));
    expect(families).toEqual(new Set(['smooth', 'blocky']));
  });

  it('routes every pipe between two declared anchors', () => {
    for (const def of ALL_FITTINGS) {
      for (const piece of def.pieces) {
        if (piece.recipe.kind !== 'pipe') continue;
        expect(resolveAnchor(piece.recipe.from, def.anchors), `${def.id} from`).not.toBeNull();
        expect(resolveAnchor(piece.recipe.to, def.anchors), `${def.id} to`).not.toBeNull();
      }
    }
  });

  it('gives the new kinetic weapons real plumbing, not decoration', () => {
    for (const id of ['autocannon_pod', 'coil_battery', 'rail_lance'] as const) {
      const pipes = WEAPON_FITTINGS[id].pieces.filter((piece) => piece.recipe.kind === 'pipe');
      expect(pipes.length, id).toBeGreaterThanOrEqual(2);
    }
  });

  it('rejects a fitting that would sink into the hull', () => {
    const broken: FittingDef = {
      id: 'broken',
      name: 'Centred On Its Socket',
      socket: 'weapon',
      size: 'M',
      family: 'blocky',
      flange: 0.4,
      pieces: [{ recipe: { kind: 'slab', size: [1, 1, 1], chamfer: 0.05 }, material: 'armour' }],
    };
    expect(fittingIssues(broken).join(' ')).toMatch(/below its mounting face/);
  });

  it('rejects a pipe routed to an anchor nobody declared', () => {
    const broken: FittingDef = {
      id: 'dangling',
      name: 'Dangling Pipe',
      socket: 'weapon',
      size: 'M',
      family: 'smooth',
      flange: 0.4,
      anchors: { a: [0, 0.2, 0] },
      pieces: [
        { recipe: { kind: 'capsule', radius: 0.2, length: 0.4 }, at: [0, 0.4, 0], material: 'structure' },
        { recipe: { kind: 'pipe', from: 'a', to: 'nowhere', radius: 0.03 }, material: 'plumbing' },
      ],
    };
    expect(fittingIssues(broken).join(' ')).toMatch(/unknown anchor "nowhere"/);
  });
});

describe('pipe routing', () => {
  it('starts and ends exactly on its anchors', () => {
    const route = pipeRoute([0, 0, 0], [1, 2, 0], 0.2);
    expect(route[0]).toEqual([0, 0, 0]);
    expect(route[route.length - 1]).toEqual([1, 2, 0]);
  });

  it('bows away from the straight line rather than cutting it', () => {
    const route = pipeRoute([0, 0, 0], [0, 2, 0], 0.25);
    const mid = route[1] as [number, number, number];
    // Distance from the run's own axis (the y axis here).
    expect(Math.hypot(mid[0], mid[2])).toBeCloseTo(0.25, 5);
  });

  it('handles a run parallel to +z, where the usual perpendicular degenerates', () => {
    const route = pipeRoute([0, 0, 0], [0, 0, 1], 0.2);
    const mid = route[1] as [number, number, number];
    expect(Number.isFinite(mid[0])).toBe(true);
    expect(Math.hypot(mid[0], mid[1])).toBeCloseTo(0.2, 5);
  });
});

describe('lookup', () => {
  it('resolves every weapon id', () => {
    for (const weapon of WEAPONS) {
      expect(getWeaponFitting(weapon.id as WeaponId).id).toBe(weapon.id);
    }
  });

  it('gives the hyperspace shunt an external signature', () => {
    // R1-11: the tier-1 FTL used to draw a box on the centreline of every
    // archetype, entirely inside the hull, so choosing it produced no visible
    // geometry at all — and on the Industrial spine its faces were coplanar.
    const bounds = fittingBounds(HYPER_SHUNT_HOUSING);
    expect(HYPER_SHUNT_HOUSING.socket).toBe('ftl');
    expect(bounds.max[1]).toBeGreaterThan(0.5);
    expect(HYPER_SHUNT_HOUSING.pieces.some((piece) => piece.glow)).toBe(true);
  });
});
