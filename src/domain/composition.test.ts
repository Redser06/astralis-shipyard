import { describe, expect, it } from 'vitest';
import {
  LAMP_RADIUS,
  hullVolumes,
  runningLightAnchors,
  type Keepout,
} from './hullForm';
import { exteriorLightRig, rigKeepouts } from './exteriorLights';
import {
  apertureClearance,
  hullSkinArea,
  placeWindows,
  windowIssues,
} from './windows';
import { socketsFor } from '../render/sockets';
import type { ArchetypeId } from './types';

/**
 * The four subsystems, on one hull, at the same time.
 *
 * WHY THIS FILE EXISTS SEPARATELY from `windows.test.ts`, `exteriorLights.test.ts`
 * and `hullForm.test.ts`. Each of those proves its own subsystem sound in
 * isolation, and each passed while the ship was visibly wrong: the connectivity
 * work, the fittings, the glazing and the lighting rig were built one after
 * another by different hands, and every one of them measured itself against the
 * hull without asking what was already bolted to it. The result was a
 * floodlight housing hanging over a porthole and marker lamps stuck to the
 * middle of the glass, on all five archetypes, at almost every seed — invisible
 * to every unit test in the repo because no test looked at two subsystems at
 * once.
 *
 * So this is the seam test. It composes exactly what `render/Ship.tsx` composes,
 * in the same precedence order, and asserts the things that only mean anything
 * once the populations share a hull.
 */

const ARCHETYPES: ArchetypeId[] = [
  'angular_stealth',
  'industrial_expanse',
  'brutalist_dreadnought',
  'outrigger_science',
  'aerodynamic_sleek',
];

/**
 * Enough seeds to catch a rule that only bites on some rolls.
 *
 * The lamp-versus-beacon collision that started this only appeared on some
 * seeds, and a single-seed test would have shipped it. These are arbitrary and
 * fixed — never random, or a red build stops being reproducible.
 */
const SEEDS = [1, 7, 42, 1337, 4242, 90210, 31415, 2718];

/** Exactly the chain `Ship` builds, and in the order `Ship` builds it. */
function compose(archetype: ArchetypeId, seed: number) {
  const volumes = hullVolumes(archetype);
  const sockets = socketsFor(archetype, volumes);
  const rig = exteriorLightRig(archetype, volumes, seed);
  const rigZones = rigKeepouts(rig);
  const windows = placeWindows(archetype, volumes, sockets, seed, { keepClear: rigZones });
  const lampZones: Keepout[] = [
    ...rigZones,
    ...windows.map((window) => ({
      position: window.position,
      radius: Math.hypot(window.extent[0], window.extent[1]) + LAMP_RADIUS,
    })),
  ];
  const lamps = runningLightAnchors(volumes, seed, { keepClear: lampZones });
  return { volumes, sockets, rig, rigZones, windows, lampZones, lamps };
}

/**
 * The fixtures' own silhouettes, restated here rather than read from
 * `rigKeepouts`.
 *
 * This matters more than it looks. The first version of these assertions took
 * their exclusion list from `rigKeepouts`, the very function whose output feeds
 * the placement — so emptying it moved the assertion and the behaviour together
 * and the suite stayed green through a mutation that put a floodlight straight
 * back over a porthole. A seam test that sources its expectation from the code
 * under test measures nothing.
 *
 * So the radii here are deliberately independent and deliberately modest: the
 * housing barrel, not the flared hood that `rigKeepouts` reserves. Anything
 * inside this is unarguably intersecting the fixture, whatever the policy
 * margin happens to be this month.
 */
function fixtureFootprints(rig: ReturnType<typeof exteriorLightRig>): Keepout[] {
  return [
    ...rig.floods.map((flood) => ({ position: flood.position, radius: flood.size })),
    ...rig.beacons.map((beacon) => ({ position: beacon.position, radius: beacon.radius })),
  ];
}

describe('the subsystems share one hull', () => {
  it('never cuts glazing under an exterior light fixture', () => {
    for (const archetype of ARCHETYPES) {
      for (const seed of SEEDS) {
        const { windows, sockets, volumes, rig } = compose(archetype, seed);
        expect(
          windowIssues(windows, sockets, hullSkinArea(volumes), undefined, fixtureFootprints(rig)),
          `${archetype} seed ${seed}`,
        ).toEqual([]);
      }
    }
  });

  it('never leaves a marker lamp inside a fixture or on the glass', () => {
    for (const archetype of ARCHETYPES) {
      for (const seed of SEEDS) {
        const { lamps, windows, rig } = compose(archetype, seed);
        // Independently of the keep-out lists: a lamp is a sphere, glazing is
        // an aperture, and neither may occupy the other's space.
        for (const lamp of lamps) {
          for (const zone of fixtureFootprints(rig)) {
            const gap = Math.hypot(
              lamp.position[0] - zone.position[0],
              lamp.position[1] - zone.position[1],
              lamp.position[2] - zone.position[2],
            );
            expect(
              gap,
              `${archetype} seed ${seed}: lamp buried in an exterior fixture`,
            ).toBeGreaterThanOrEqual(zone.radius + LAMP_RADIUS);
          }
          for (const window of windows) {
            expect(
              apertureClearance(window, lamp.position),
              `${archetype} seed ${seed}: lamp stuck to ${window.id}`,
            ).toBeGreaterThanOrEqual(LAMP_RADIUS);
          }
        }
      }
    }
  });

  it('still gives every archetype its full complement of lamps', () => {
    // The exclusions must cost the ship nothing. A rejected candidate re-rolls
    // at the same station, and if that budget ever stopped covering the
    // exclusion list the symptom would be a quietly darker ship rather than a
    // failure — so it is asserted rather than assumed.
    for (const archetype of ARCHETYPES) {
      for (const seed of SEEDS) {
        expect(compose(archetype, seed).lamps.length, `${archetype} seed ${seed}`).toBe(14);
      }
    }
  });

  it('still gives every archetype a bridge and some portholes', () => {
    // The counterweight to the test above. Yielding is only correct while it
    // costs the ship detail rather than features: an exclusion measured too
    // coarsely deleted the flight deck outright from three of the five hulls,
    // and every other test in the repo stayed green while it did.
    for (const archetype of ARCHETYPES) {
      for (const seed of SEEDS) {
        const { windows } = compose(archetype, seed);
        const decks = windows.filter((window) => window.class === 'flight_deck');
        expect(decks.length, `${archetype} seed ${seed} lost its bridge`).toBe(1);
        expect(
          windows.filter((window) => window.class === 'porthole').length,
          `${archetype} seed ${seed} lost its portholes`,
        ).toBeGreaterThan(4);
      }
    }
  });

  it('measures a mullioned band as a rectangle, not as a circle round it', () => {
    // `apertureClearance` is what lets the bridge survive contact with the
    // lighting rig, so its distinction from `apertureReach` is worth pinning
    // down: for the industrial flight deck the half-diagonal is over twice the
    // honest clearance to its own bow beacon.
    const { windows, rigZones } = compose('industrial_expanse', 42);
    const deck = windows.find((window) => window.class === 'flight_deck');
    expect(deck).toBeDefined();
    if (!deck) return;

    const halfDiagonal = Math.hypot(deck.extent[0], deck.extent[1]);
    for (const zone of rigZones) {
      const honest = apertureClearance(deck, zone.position);
      const circular = Math.max(
        0,
        Math.hypot(
          deck.position[0] - zone.position[0],
          deck.position[1] - zone.position[1],
          deck.position[2] - zone.position[2],
        ) - halfDiagonal,
      );
      // Never optimistic: the rectangle is inside its own circumscribed circle,
      // so the honest measure can only ever report more room, never less.
      expect(honest).toBeGreaterThanOrEqual(circular - 1e-9);
    }
  });

  it('is deterministic in (archetype, seed)', () => {
    // Composing the chain twice must not move a single fixture. The keep-out
    // lists are built by mapping over other populations, so an unstable
    // ordering anywhere upstream would show up here as a moving ship.
    for (const archetype of ARCHETYPES) {
      const first = compose(archetype, 4242);
      const second = compose(archetype, 4242);
      expect(second.windows).toEqual(first.windows);
      expect(second.lamps).toEqual(first.lamps);
      expect(second.rig).toEqual(first.rig);
    }
  });

  it('produces no NaN anywhere in the assembled fixtures', () => {
    // A NaN in a position propagates into a geometry attribute and takes the
    // whole draw call with it, silently. Cheap to check, so it is checked.
    const bad: string[] = [];
    const walk = (label: string, value: unknown): void => {
      if (typeof value === 'number') {
        if (!Number.isFinite(value)) bad.push(`${label} = ${value}`);
      } else if (Array.isArray(value)) {
        value.forEach((item, i) => walk(`${label}[${i}]`, item));
      } else if (value && typeof value === 'object') {
        for (const [key, item] of Object.entries(value)) walk(`${label}.${key}`, item);
      }
    };

    for (const archetype of ARCHETYPES) {
      for (const seed of SEEDS) {
        const { rig, windows, lamps, sockets } = compose(archetype, seed);
        walk(`${archetype}/${seed}.rig`, rig);
        walk(`${archetype}/${seed}.windows`, windows);
        walk(`${archetype}/${seed}.lamps`, lamps);
        walk(`${archetype}/${seed}.sockets`, sockets);
      }
    }
    expect(bad).toEqual([]);
  });
});
