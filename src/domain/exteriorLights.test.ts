import { describe, expect, it } from 'vitest';
import type { ArchetypeId } from './types';
import { hullVolumes, raycastHull } from './hullForm';
import {
  BEACON_SPEC,
  beamDirection,
  exteriorLightIssues,
  exteriorLightRig,
  lensPosition,
} from './exteriorLights';

/**
 * The exterior lighting rig, measured rather than eyeballed.
 *
 * The specific failure this guards against is the one the prototype shipped:
 * fourteen lamps drawn from a hardcoded box, byte-identical on all five
 * archetypes, half of them in vacuum and most of the rest sealed inside plate.
 * Every assertion here is a version of "this lamp is on the ship, and the light
 * it throws lands on the ship".
 */

const ARCHETYPES: ArchetypeId[] = [
  'angular_stealth',
  'industrial_expanse',
  'brutalist_dreadnought',
  'outrigger_science',
  'aerodynamic_sleek',
];

const SEEDS = [0, 3, 4242, 0xbeef];

describe('floodlights', () => {
  it('report no issues on any archetype', () => {
    for (const archetype of ARCHETYPES) {
      const volumes = hullVolumes(archetype);
      const rig = exteriorLightRig(archetype, volumes, 4242);
      expect(exteriorLightIssues(rig, volumes, archetype), archetype).toEqual([]);
    }
  });

  it('give every archetype working lights fore, outboard and aft', () => {
    for (const archetype of ARCHETYPES) {
      const rig = exteriorLightRig(archetype, hullVolumes(archetype), 1);
      expect(rig.floods.length, archetype).toBeGreaterThanOrEqual(3);
      for (const stem of ['flood-bow', 'flood-drive']) {
        expect(
          rig.floods.some((flood) => flood.id.startsWith(stem)),
          `${archetype} has a ${stem}`,
        ).toBe(true);
      }
    }
  });

  it('put every lens outside the plate it is bolted to', () => {
    // A lamp buried in the hull throws light from inside it. The lens has to be
    // further from the ship's skin than the mount point is.
    for (const archetype of ARCHETYPES) {
      const volumes = hullVolumes(archetype);
      for (const flood of exteriorLightRig(archetype, volumes, 1).floods) {
        const lens = lensPosition(flood);
        const inward = [-flood.normal[0], -flood.normal[1], -flood.normal[2]] as const;
        const back = raycastHull(volumes, lens, inward);
        expect(back, `${archetype} ${flood.id} lens sees the hull below it`).not.toBeNull();
        expect(back!.distance, `${archetype} ${flood.id}`).toBeGreaterThan(0.05);
      }
    }
  });

  it('aim every beam at plate, within the beam s own range', () => {
    for (const archetype of ARCHETYPES) {
      const volumes = hullVolumes(archetype);
      for (const flood of exteriorLightRig(archetype, volumes, 1).floods) {
        const hit = raycastHull(volumes, lensPosition(flood), beamDirection(flood));
        expect(hit, `${archetype} ${flood.id} lands on nothing`).not.toBeNull();
        expect(hit!.distance, `${archetype} ${flood.id}`).toBeLessThanOrEqual(flood.range);
      }
    }
  });

  it('mirror outboard fixtures into matched pairs', () => {
    for (const archetype of ARCHETYPES) {
      const rig = exteriorLightRig(archetype, hullVolumes(archetype), 1);
      for (const flood of rig.floods.filter((f) => f.id.endsWith('-s'))) {
        const twin = rig.floods.find((f) => f.id === `${flood.id.slice(0, -2)}-p`);
        expect(twin, `${archetype} ${flood.id} has a port-side twin`).toBeDefined();
        expect(twin!.position[0]).toBeCloseTo(-flood.position[0], 6);
        expect(twin!.position[2]).toBeCloseTo(flood.position[2], 6);
      }
    }
  });
});

describe('navigation lights', () => {
  it('follow the convention: red to port, green to starboard', () => {
    expect(BEACON_SPEC.port.colour).not.toBe(BEACON_SPEC.starboard.colour);
    for (const archetype of ARCHETYPES) {
      const rig = exteriorLightRig(archetype, hullVolumes(archetype), 1);
      const port = rig.beacons.find((beacon) => beacon.role === 'port')!;
      const starboard = rig.beacons.find((beacon) => beacon.role === 'starboard')!;
      expect(port.position[0], archetype).toBeLessThan(0);
      expect(starboard.position[0], archetype).toBeGreaterThan(0);
      expect(port.colour).toBe(BEACON_SPEC.port.colour);
      expect(starboard.colour).toBe(BEACON_SPEC.starboard.colour);
    }
  });

  it('sit at the hull s own extremities, so a wider ship spreads them wider', () => {
    // The bug this replaces put identical lamps on every archetype.
    const stealth = exteriorLightRig('angular_stealth', hullVolumes('angular_stealth'), 1);
    const brute = exteriorLightRig(
      'brutalist_dreadnought',
      hullVolumes('brutalist_dreadnought'),
      1,
    );
    const beam = (rig: typeof stealth): number => {
      const port = rig.beacons.find((b) => b.role === 'port')!;
      const starboard = rig.beacons.find((b) => b.role === 'starboard')!;
      return starboard.position[0] - port.position[0];
    };
    expect(beam(brute)).toBeGreaterThan(beam(stealth));
  });

  it('are on the hull, not floating beside it', () => {
    for (const archetype of ARCHETYPES) {
      const volumes = hullVolumes(archetype);
      for (const beacon of exteriorLightRig(archetype, volumes, 1).beacons) {
        const inward = [-beacon.normal[0], -beacon.normal[1], -beacon.normal[2]] as const;
        const back = raycastHull(volumes, beacon.position, inward);
        expect(back, `${archetype} ${beacon.id}`).not.toBeNull();
        // Standing exactly 0.03 proud of the plate it is bolted to.
        expect(back!.distance, `${archetype} ${beacon.id}`).toBeLessThan(0.2);
      }
    }
  });

  it('strobe out of phase, deterministically', () => {
    const volumes = hullVolumes('outrigger_science');
    const a = exteriorLightRig('outrigger_science', volumes, 7);
    const b = exteriorLightRig('outrigger_science', volumes, 7);
    expect(b).toEqual(a);
    const other = exteriorLightRig('outrigger_science', volumes, 8);
    expect(other.beacons.map((x) => x.phase)).not.toEqual(a.beacons.map((x) => x.phase));
    for (const beacon of a.beacons) {
      expect(beacon.phase).toBeGreaterThanOrEqual(0);
      expect(beacon.phase).toBeLessThan(1);
    }
  });

  it('does not move a fixture when the seed changes — only its phase', () => {
    const volumes = hullVolumes('industrial_expanse');
    const positions = SEEDS.map((seed) =>
      exteriorLightRig('industrial_expanse', volumes, seed).floods.map((f) => f.position),
    );
    for (const set of positions) expect(set).toEqual(positions[0]);
  });
});
