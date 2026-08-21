import { describe, expect, it } from 'vitest';
import { deriveWear } from './condition';
import {
  DAMAGE_KINDS,
  MIN_MARKABLE_GRAIN,
  samplePoint,
  stationExposure,
  surfaceArea,
  surfaceDamage,
  surfaceForRecipe,
  surfaceForSolid,
  surfaceGrain,
  type DamageSurface,
} from './damage';
import { HULL_SOLIDS } from './hullForm';
import { WEAPON_FITTINGS } from './fittings';
import { DEFAULT_HULL_PROFILE } from './profile';
import { streamFor } from './rng';
import type { WearChannels } from './types';

const FRESH: WearChannels = {
  abrasion: 0,
  grime: 0,
  thermal: 0,
  impact: 0,
  oxidation: 0,
  repair: 0,
  structural: 0,
};

const WRECKED: WearChannels = {
  abrasion: 1,
  grime: 1,
  thermal: 1,
  impact: 1,
  oxidation: 1,
  repair: 1,
  structural: 1,
};

const HULL: DamageSurface = { kind: 'box', size: [4.6, 2.4, 12] };

describe('damage placement', () => {
  it('marks nothing on a factory-fresh ship', () => {
    expect(surfaceDamage(HULL, FRESH, 1234, 'hull-0')).toEqual([]);
  });

  it('marks a worn ship, and a wrecked one harder', () => {
    const worn = surfaceDamage(HULL, deriveWear(0.45, 99), 99, 'hull-0', { max: 40 });
    const wrecked = surfaceDamage(HULL, deriveWear(0.98, 99), 99, 'hull-0', { max: 40 });
    expect(worn.length).toBeGreaterThan(0);
    expect(wrecked.length).toBeGreaterThan(worn.length);
  });

  it('is deterministic in the seed', () => {
    const a = surfaceDamage(HULL, WRECKED, 0xbeef, 'hull-3');
    const b = surfaceDamage(HULL, WRECKED, 0xbeef, 'hull-3');
    expect(a).toEqual(b);
  });

  it('gives different ships different damage', () => {
    const a = surfaceDamage(HULL, WRECKED, 1, 'hull-3');
    const b = surfaceDamage(HULL, WRECKED, 2, 'hull-3');
    expect(a).not.toEqual(b);
  });

  it('gives each surface its own stream, so adding one does not reshuffle the rest', () => {
    // The whole reason marks are keyed by tag rather than drawn from one
    // ship-wide sequence: fitting a new component must not repaint the hull.
    const before = surfaceDamage(HULL, WRECKED, 7, 'hull-2');
    const after = surfaceDamage(HULL, WRECKED, 7, 'hull-2');
    expect(after).toEqual(before);
    expect(surfaceDamage(HULL, WRECKED, 7, 'hull-9')).not.toEqual(before);
  });

  it('never places a mark wider than the plate it sits on', () => {
    const surfaces: DamageSurface[] = [
      { kind: 'box', size: [0.9, 0.62, 1] },
      { kind: 'sphere', radius: 0.62 },
      { kind: 'capsule', radius: 0.52, length: 7.4 },
      { kind: 'cylinder', radiusTop: 1.4, radiusBottom: 2.6, height: 2.2 },
      { kind: 'lathe', profile: DEFAULT_HULL_PROFILE },
      { kind: 'plane', width: 3, height: 1.55 },
    ];
    for (const surface of surfaces) {
      const grain = surfaceGrain(surface);
      for (const mark of surfaceDamage(surface, WRECKED, 5, `s-${surface.kind}`, { max: 40 })) {
        expect(mark.size, surface.kind).toBeLessThanOrEqual(grain * 0.7 + 1e-9);
      }
    }
  });

  it('does not mark anything too narrow to hold a decal', () => {
    // The Industrial longerons are 0.16 square. A decal there is a stripe.
    expect(surfaceDamage({ kind: 'box', size: [0.16, 0.16, 9] }, WRECKED, 5, 'longeron')).toEqual([]);
    expect(surfaceGrain({ kind: 'box', size: [0.16, 0.16, 9] })).toBeLessThan(MIN_MARKABLE_GRAIN);
  });

  it('respects the ceiling on marks per surface', () => {
    const marks = surfaceDamage(HULL, WRECKED, 3, 'hull-0', { max: 4 });
    expect(marks.length).toBeLessThanOrEqual(4);
  });

  it('keeps a variety of marks when the ceiling bites', () => {
    // Filling in channel order would starve whatever is last, and the last two
    // are the pits and the breaches — the marks a beaten ship is read by.
    const marks = surfaceDamage(HULL, WRECKED, 8, 'hull-0', { max: 7 });
    expect(marks).toHaveLength(7);
    expect(new Set(marks.map((mark) => mark.kind)).size).toBeGreaterThanOrEqual(5);
  });

  it('draws every mark from one of the seven wear channels', () => {
    const kinds = new Set(surfaceDamage(HULL, WRECKED, 11, 'hull-0', { max: 60 }).map((m) => m.kind));
    for (const kind of kinds) {
      expect(DAMAGE_KINDS.some((spec) => spec.kind === kind)).toBe(true);
    }
    expect(DAMAGE_KINDS).toHaveLength(7);
  });

  it('scorches harder where a component is exposed to more heat', () => {
    const plain = surfaceDamage(HULL, WRECKED, 4, 'x', { max: 60 });
    const hot = surfaceDamage(HULL, WRECKED, 4, 'x', { max: 60, exposure: { thermal: 3 } });
    const scorches = (marks: ReadonlyArray<{ kind: string }>): number =>
      marks.filter((mark) => mark.kind === 'scorch').length;
    expect(scorches(hot)).toBeGreaterThan(scorches(plain));
  });
});

describe('surface sampling', () => {
  const surfaces: DamageSurface[] = [
    { kind: 'box', size: [2, 1, 3] },
    { kind: 'sphere', radius: 1.15 },
    { kind: 'capsule', radius: 0.95, length: 8 },
    { kind: 'cylinder', radiusTop: 0, radiusBottom: 1.42, height: 5.2 },
    { kind: 'lathe', profile: DEFAULT_HULL_PROFILE },
    { kind: 'plane', width: 3, height: 1.55 },
  ];

  it('returns unit normals everywhere', () => {
    for (const surface of surfaces) {
      const rng = streamFor(1, surface.kind);
      for (let i = 0; i < 50; i++) {
        const { normal } = samplePoint(surface, rng);
        expect(Math.hypot(normal[0], normal[1], normal[2]), surface.kind).toBeCloseTo(1, 6);
      }
    }
  });

  it('lands on the surface of a sphere, not inside it', () => {
    const rng = streamFor(2, 'sphere');
    for (let i = 0; i < 50; i++) {
      const { position } = samplePoint({ kind: 'sphere', radius: 1.15 }, rng);
      expect(Math.hypot(position[0], position[1], position[2])).toBeCloseTo(1.15, 6);
    }
  });

  it('lands on the wall of a cone at the radius that station has', () => {
    const surface: DamageSurface = {
      kind: 'cylinder',
      radiusTop: 0,
      radiusBottom: 1.42,
      height: 5.2,
    };
    const rng = streamFor(3, 'cone');
    for (let i = 0; i < 50; i++) {
      const { position } = samplePoint(surface, rng);
      const t = position[1] / 5.2 + 0.5;
      expect(Math.hypot(position[0], position[2])).toBeCloseTo(1.42 * (1 - t), 5);
    }
  });

  it('tips the normal off horizontal on a tapering surface', () => {
    // A decal on a nose cone must lie along the taper. A purely radial normal
    // is what puts one half of a mark inside the plating.
    const rng = streamFor(4, 'cone');
    const { normal } = samplePoint(
      { kind: 'cylinder', radiusTop: 0, radiusBottom: 1.42, height: 5.2 },
      rng,
    );
    expect(Math.abs(normal[1])).toBeGreaterThan(0.05);
  });

  it('faces +z on a plane, matching three PlaneGeometry', () => {
    const rng = streamFor(5, 'plane');
    const { position, normal } = samplePoint({ kind: 'plane', width: 3, height: 1.5 }, rng);
    expect(normal).toEqual([0, 0, 1]);
    expect(position[2]).toBe(0);
  });
});

describe('adapters', () => {
  it('gives every solid hull volume a markable surface', () => {
    for (const [archetype, solids] of Object.entries(HULL_SOLIDS)) {
      const marked = solids
        .map((solid) => surfaceForSolid(solid, DEFAULT_HULL_PROFILE))
        .filter((surface) => surface !== null);
      expect(marked.length, archetype).toBeGreaterThan(0);
    }
  });

  it('never marks decorative structure — truss rings and cross-struts', () => {
    for (const solids of Object.values(HULL_SOLIDS)) {
      for (const solid of solids) {
        if (solid.decorative) expect(surfaceForSolid(solid)).toBeNull();
      }
    }
  });

  it('maps a frustum onto the cylinder the renderer actually builds', () => {
    // Hulls.tsx passes cylinderGeometry(radiusEnd, radiusStart, …) because
    // three's radiusTop is the +axis end. Getting this backwards would place
    // damage on a nose cone as though it were a tail cone.
    const surface = surfaceForSolid({
      kind: 'frustum',
      radiusStart: 2.6,
      radiusEnd: 1.4,
      height: 2.2,
      sides: 6,
      position: [0, 0, 8.4],
      axis: 'z',
    });
    expect(surface).toEqual({ kind: 'cylinder', radiusTop: 1.4, radiusBottom: 2.6, height: 2.2 });
  });

  it('gives component pieces surfaces, and skips pipes and rings', () => {
    const rail = WEAPON_FITTINGS.rail_lance;
    const marked = rail.pieces.filter((piece) => surfaceForRecipe(piece.recipe) !== null);
    expect(marked.length).toBeGreaterThan(0);
    for (const piece of rail.pieces) {
      if (piece.recipe.kind === 'pipe') expect(surfaceForRecipe(piece.recipe)).toBeNull();
    }
  });

  it('measures area sensibly', () => {
    expect(surfaceArea({ kind: 'box', size: [1, 1, 1] })).toBeCloseTo(6, 6);
    expect(surfaceArea({ kind: 'sphere', radius: 1 })).toBeCloseTo(4 * Math.PI, 6);
    expect(surfaceArea({ kind: 'plane', width: 2, height: 3 })).toBeCloseTo(6, 6);
  });
});

describe('station exposure', () => {
  it('scorches the stern and not the bow', () => {
    const stern = stationExposure(-8, -9, 9);
    const bow = stationExposure(8, -9, 9);
    expect(stern.thermal as number).toBeGreaterThan(1.4);
    expect(bow.thermal as number).toBeCloseTo(1, 6);
  });

  it('abrades the leading surfaces and not the stern', () => {
    expect(stationExposure(9, -9, 9).abrasion as number).toBeGreaterThan(1);
    expect(stationExposure(-9, -9, 9).abrasion as number).toBeCloseTo(1, 6);
  });

  it('survives a degenerate hull with no length', () => {
    expect(Number.isFinite(stationExposure(0, 0, 0).thermal as number)).toBe(true);
  });
});
