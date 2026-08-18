import { describe, expect, it } from 'vitest';
import type { ArchetypeId, Vec3 } from './types';
import {
  axisRotation,
  hullBounds,
  hullVolumes,
  normalise,
  raycastHull,
  runningLightAnchors,
  type HullVolume,
} from './hullForm';
import { exteriorLightRig } from './exteriorLights';
import { socketsFor } from '../render/sockets';

/**
 * The connectivity guarantee, as arithmetic.
 *
 * Every defect these cover was found by exporting the scene to glTF and reading
 * world-space bounds out of it by hand. That is a good way to find a problem
 * once and a terrible way to stop it coming back, so the same measurements are
 * made here — on the same data the renderer uses, without a GPU.
 *
 * `src/render/sockets.ts` is imported deliberately: it is the real socket table
 * and it is free of three, so the thing under test is what actually ships.
 */

const ARCHETYPES: ArchetypeId[] = [
  'angular_stealth',
  'industrial_expanse',
  'brutalist_dreadnought',
  'outrigger_science',
  'aerodynamic_sleek',
];

const sub = (a: Vec3, b: Vec3): Vec3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const len = (a: Vec3): number => Math.hypot(a[0], a[1], a[2]);

/** Distance from a point to the hull skin, looking back down its own normal. */
function gapToHull(volumes: HullVolume[], position: Vec3, normal: Vec3): number {
  const n = normalise(normal);
  const origin: Vec3 = [
    position[0] + n[0] * 60,
    position[1] + n[1] * 60,
    position[2] + n[2] * 60,
  ];
  const hit = raycastHull(volumes, origin, [-n[0], -n[1], -n[2]]);
  return hit ? len(sub(hit.point, position)) : Infinity;
}

describe('hull volumes', () => {
  it('drops decorative work the ray caster must never seat hardware on', () => {
    // Seven truss rings and a habitat hoop are rendered but not collidable.
    const industrial = hullVolumes('industrial_expanse');
    expect(industrial.every((v) => v.kind !== 'frustum' || v.decorative !== true)).toBe(true);
    const outrigger = hullVolumes('outrigger_science');
    expect(outrigger.some((v) => v.decorative)).toBe(false);
  });

  it('expands the sculpted lathe into collidable frusta', () => {
    const aero = hullVolumes('aerodynamic_sleek');
    expect(aero.filter((v) => v.kind === 'frustum').length).toBeGreaterThan(20);
  });
});

describe('aerodynamic hull orientation', () => {
  it('derives a rotation that puts the profile’s +z on world +Z', () => {
    // R1-01: a hand-typed Rx(-90°) put the needle nose at the stern, in the
    // engine bay, and made the blunt tail the bow.
    expect(axisRotation('z')).toEqual([Math.PI / 2, 0, 0]);
  });

  it('puts the needle nose forward and the blunt tail aft', () => {
    const volumes = hullVolumes('aerodynamic_sleek');
    const nose = raycastHull(volumes, [0, 0, 30], [0, 0, -1]);
    const tail = raycastHull(volumes, [0, 0, -30], [0, 0, 1]);
    expect(nose?.point[2]).toBeCloseTo(8.0, 1);
    expect(tail?.point[2]).toBeCloseTo(-7.4, 1);

    // And the nose is the sharp end: the hull is far narrower there.
    const noseWidth = raycastHull(volumes, [30, 0, 6.2], [-1, 0, 0])?.point[0] ?? 0;
    const tailWidth = raycastHull(volumes, [30, 0, -6.2], [-1, 0, 0])?.point[0] ?? 0;
    expect(noseWidth).toBeLessThan(tailWidth);
  });
});

describe('socket resolution', () => {
  for (const archetype of ARCHETYPES) {
    describe(archetype, () => {
      const volumes = hullVolumes(archetype);
      const sockets = socketsFor(archetype, volumes);

      it('seats every socket on the hull skin', () => {
        // Nothing disconnected: no engine bell two units aft of the last plate,
        // no radiator frame starting in vacuum, no mast 1.55 above its fuselage.
        for (const socket of sockets) {
          if (socket.kind === 'ftl') continue;
          expect(
            gapToHull(volumes, socket.position, socket.normal),
            `${socket.id} is not on the hull`,
          ).toBeLessThan(0.01);
        }
      });

      it('leaves the FTL socket on the centreline, since the ring encircles', () => {
        for (const socket of sockets.filter((s) => s.kind === 'ftl')) {
          expect(socket.position[0]).toBe(0);
          expect(socket.position[1]).toBe(0);
        }
      });

      it('keeps mirrored pairs symmetric about the centreline', () => {
        for (const socket of sockets.filter((s) => s.id.endsWith('-s'))) {
          const port = sockets.find((s) => s.id === `${socket.id.slice(0, -2)}-p`);
          expect(port, `${socket.id} has no port twin`).toBeDefined();
          expect(port?.position[0]).toBeCloseTo(-socket.position[0], 6);
          expect(port?.position[1]).toBeCloseTo(socket.position[1], 6);
          expect(port?.position[2]).toBeCloseTo(socket.position[2], 6);
        }
      });
    });
  }

  it('pulls the stealth drives forward onto the aft plate', () => {
    // Measured before: the housing spanned z [-9.08, -7.72] against a hull whose
    // last surface was z -5.25, so 13% of the ship's length was empty space.
    const volumes = hullVolumes('angular_stealth');
    const engine = socketsFor('angular_stealth', volumes).find((s) => s.id === 'eng-s');
    expect(engine?.position[2]).toBeCloseTo(-5.25, 2);
  });

  it('brings the outrigger radiators onto the boom flank', () => {
    // Measured before: the frame sat at y 0.95–1.44 while the boom's crown was
    // y 0.56, so it projected sideways out of mid-air.
    const volumes = hullVolumes('outrigger_science');
    const radiator = socketsFor('outrigger_science', volumes).find((s) => s.id === 'rad-s');
    expect(radiator?.position[0]).toBeCloseTo(4.82, 2);
    expect(Math.abs(radiator?.position[1] ?? 9)).toBeLessThan(0.01);
  });

  it('follows the surface normal onto a canted plate', () => {
    // The stealth chines are canted 0.42 rad; a flat mount plane met them as a
    // wedge. The resolved socket takes the plate's own normal.
    const volumes = hullVolumes('angular_stealth');
    const weapon = socketsFor('angular_stealth', volumes).find((s) => s.id === 'wpn-s');
    expect(weapon?.normal[0]).not.toBe(0);
  });
});

describe('running lights', () => {
  it('puts every lamp on the skin, just proud of it', () => {
    for (const archetype of ARCHETYPES) {
      const volumes = hullVolumes(archetype);
      const anchors = runningLightAnchors(volumes, 1234);
      expect(anchors.length).toBe(14);
      for (const anchor of anchors) {
        // Look straight down from the lamp: plate should be 0.05 below it. Any
        // lamp adrift beside the hull would find nothing, and one sealed inside
        // solid plate would report the far side of whatever contains it.
        const n = anchor.normal;
        const down = raycastHull(volumes, anchor.position, [-n[0], -n[1], -n[2]]);
        expect(down, `${archetype} lamp is not above any hull surface`).not.toBeNull();
        expect(down?.distance, `${archetype} lamp stands off by ${down?.distance}`).toBeCloseTo(
          0.05,
          2,
        );
      }
    }
  });

  it('differs per archetype, because it is measured off the hull', () => {
    // The old box was keyed only on the seed, so all five ships lit up in
    // byte-identical places — half of them in vacuum, half inside solid plate.
    const stealth = runningLightAnchors(hullVolumes('angular_stealth'), 99);
    const brutalist = runningLightAnchors(hullVolumes('brutalist_dreadnought'), 99);
    expect(stealth[0]?.position).not.toEqual(brutalist[0]?.position);
    expect(Math.abs(brutalist[0]?.position[0] ?? 0)).toBeGreaterThan(
      Math.abs(stealth[0]?.position[0] ?? 0),
    );
  });

  it('is deterministic for a seed', () => {
    const volumes = hullVolumes('industrial_expanse');
    expect(runningLightAnchors(volumes, 7)).toEqual(runningLightAnchors(volumes, 7));
    expect(runningLightAnchors(volumes, 7)).not.toEqual(runningLightAnchors(volumes, 8));
  });

  it('gives way to fixtures it is told to keep clear of', () => {
    // These lamps are scattered by seed; the navigation beacons are derived
    // from the hull's extremities and cannot move. Placed independently the two
    // collided — on `industrial_expanse` the nearest pair came out 0.060 apart,
    // inside the beacon's own base. The scattered population yields.
    for (const archetype of ARCHETYPES) {
      const volumes = hullVolumes(archetype);
      const rig = exteriorLightRig(archetype, volumes, 4242);
      const keepClear = rig.beacons.map((beacon) => beacon.position);
      const clearance = 0.28;

      const anchors = runningLightAnchors(volumes, 4242, { keepClear, clearance });

      for (const anchor of anchors) {
        for (const point of keepClear) {
          const gap = Math.hypot(
            anchor.position[0] - point[0],
            anchor.position[1] - point[1],
            anchor.position[2] - point[2],
          );
          expect(gap, `${archetype} marker lamp is inside a beacon`).toBeGreaterThanOrEqual(
            clearance,
          );
        }
      }

      // Rejection re-rolls rather than costing the ship a lamp: the budget is
      // three candidates per station, and a handful of exclusion spheres on a
      // hull this size never exhausts it.
      expect(anchors.length, `${archetype} lost lamps to the exclusion`).toBe(14);
    }
  });
});

describe('hull bounds', () => {
  it('spans the whole ship nose to tail', () => {
    const bounds = hullBounds(hullVolumes('brutalist_dreadnought'));
    expect(bounds.maxZ).toBeCloseTo(9.5, 1);
    expect(bounds.minZ).toBeCloseTo(-8.7, 1);
  });
});

describe('box face normals', () => {
  /**
   * Added in R3, with the fix for the bug it caught.
   *
   * `intersectBox` negated its face sign a second time when it swapped the slab
   * intervals, so every box face reported an INWARD normal no matter which side
   * the ray came from. `resolveSocket` hid it — a normal that disagrees with the
   * authored one is discarded — but everything downstream that trusts the
   * measured normal got the wrong hemisphere: window candidates on the starboard
   * side of a box hull were rejected as back-facing, so four of the five
   * archetypes were glazed only to port.
   */
  const cube: HullVolume[] = [{ kind: 'box', size: [2, 2, 2], position: [0, 0, 0] }];

  it('points out of the face the ray enters through, from any direction', () => {
    const cases: Array<{ from: Vec3; direction: Vec3; face: Vec3 }> = [
      { from: [10, 0, 0], direction: [-1, 0, 0], face: [1, 0, 0] },
      { from: [-10, 0, 0], direction: [1, 0, 0], face: [-1, 0, 0] },
      { from: [0, 10, 0], direction: [0, -1, 0], face: [0, 1, 0] },
      { from: [0, -10, 0], direction: [0, 1, 0], face: [0, -1, 0] },
      { from: [0, 0, 10], direction: [0, 0, -1], face: [0, 0, 1] },
      { from: [0, 0, -10], direction: [0, 0, 1], face: [0, 0, -1] },
    ];
    for (const { from, direction, face } of cases) {
      const hit = raycastHull(cube, from, direction);
      expect(hit, `ray from ${from.join(',')}`).not.toBeNull();
      expect(hit!.normal[0]).toBeCloseTo(face[0], 6);
      expect(hit!.normal[1]).toBeCloseTo(face[1], 6);
      expect(hit!.normal[2]).toBeCloseTo(face[2], 6);
      // And it opposes the ray, which is the property that actually matters.
      expect(
        hit!.normal[0] * direction[0] +
          hit!.normal[1] * direction[1] +
          hit!.normal[2] * direction[2],
      ).toBeLessThan(0);
    }
  });

  it('holds on the real hulls, port and starboard alike', () => {
    for (const archetype of ARCHETYPES) {
      const volumes = hullVolumes(archetype);
      for (const side of [-1, 1]) {
        const direction: Vec3 = [-side, 0, 0];
        const hit = raycastHull(volumes, [side * 60, 0, 0], direction);
        if (!hit) continue;
        expect(hit.normal[0] * side, `${archetype} ${side > 0 ? 'starboard' : 'port'}`)
          .toBeGreaterThan(0);
      }
    }
  });
});
