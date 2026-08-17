import { describe, expect, it } from 'vitest';
import type { ArchetypeId, Socket } from './types';
import { hullVolumes, type HullVolume } from './hullForm';
import { deriveWear } from './condition';
import { socketsFor } from '../render/sockets';
import {
  BLAST_SHRINK,
  EXCLUSION_BASE,
  FLIGHT_DECKS,
  MAX_GLAZED_FRACTION,
  MIN_APERTURE_GAP,
  PORTHOLE_RADIUS,
  SOCKET_EXTENT,
  WEAPON_BLAST_RADIUS,
  apertureReach,
  distance,
  exclusionRadius,
  glazeWindows,
  hullSkinArea,
  placeWindows,
  windowIssues,
} from './windows';

/**
 * The glazing rules, as arithmetic.
 *
 * The fuel rule in particular is the reason this file exists. "No windows near
 * fuel pods" is the kind of constraint that is obviously satisfied when you
 * write the placement code and quietly violated eighteen months later when
 * somebody widens a hull or moves a socket — and it is invisible in a
 * screenshot, because a porthole beside a tank looks exactly like a porthole
 * anywhere else. So it is measured here, on the real socket table, for every
 * archetype and a spread of seeds.
 *
 * `src/render/sockets.ts` is imported deliberately, as `hullForm.test.ts` does:
 * it is the table that actually ships and it is free of three.
 */

const ARCHETYPES: ArchetypeId[] = [
  'angular_stealth',
  'industrial_expanse',
  'brutalist_dreadnought',
  'outrigger_science',
  'aerodynamic_sleek',
];

/** A spread wide enough that a rule surviving all of them is not luck. */
const SEEDS = [0, 1, 7, 42, 1337, 90210, 0xbeef, 0xffffffff];

interface Fixture {
  archetype: ArchetypeId;
  volumes: HullVolume[];
  sockets: Socket[];
  area: number;
}

function fixtureFor(archetype: ArchetypeId): Fixture {
  const volumes = hullVolumes(archetype);
  return {
    archetype,
    volumes,
    sockets: socketsFor(archetype, volumes),
    area: hullSkinArea(volumes),
  };
}

const FIXTURES = ARCHETYPES.map(fixtureFor);

describe('the fuel exclusion', () => {
  it('is the widest keep-out of any hardware, at every size class', () => {
    // If this ever stops being true, some other rule has quietly overtaken the
    // one that is supposed to be absolute.
    for (const [kind, radius] of Object.entries(EXCLUSION_BASE)) {
      if (kind === 'fuel') continue;
      expect(radius).toBeLessThan(EXCLUSION_BASE.fuel);
    }
  });

  it('clears the largest fuel pod geometry at every size class', () => {
    // `cryo_h2` is the bulkiest tank: a 0.62-radius capsule of length 2.6 lying
    // across the socket at local y 0.68, so its furthest point is 2.04 from the
    // mount before the socket's own size scale is applied.
    const worstPodReach = Math.hypot(2.6 / 2 + 0.62, 0.68);
    for (const [size, scaleFactor] of Object.entries(SOCKET_EXTENT)) {
      expect(
        EXCLUSION_BASE.fuel * scaleFactor,
        `fuel keep-out at size ${size}`,
      ).toBeGreaterThan(worstPodReach * scaleFactor);
    }
  });

  it('is never violated, on any archetype, at any seed', () => {
    for (const fixture of FIXTURES) {
      const fuel = fixture.sockets.filter((socket) => socket.kind === 'fuel');
      expect(fuel.length, `${fixture.archetype} has fuel sockets to test against`)
        .toBeGreaterThan(0);

      for (const seed of SEEDS) {
        const windows = placeWindows(
          fixture.archetype,
          fixture.volumes,
          fixture.sockets,
          seed,
        );
        for (const window of windows) {
          for (const socket of fuel) {
            const gap = distance(window.position, socket.position);
            expect(
              gap,
              `${fixture.archetype} seed ${seed}: ${window.id} is ${gap.toFixed(2)} from fuel socket ${socket.id}`,
            ).toBeGreaterThanOrEqual(exclusionRadius(socket) + apertureReach(window));
          }
        }
      }
    }
  });

  it('holds even when a hull is glazed with the budget lifted off', () => {
    // The area ceiling is not what keeps windows off the tanks. Take it away
    // and the fuel rule must still hold on its own.
    for (const fixture of FIXTURES) {
      const windows = placeWindows(fixture.archetype, fixture.volumes, fixture.sockets, 5, {
        maxGlazedFraction: 1,
      });
      const fuel = fixture.sockets.filter((socket) => socket.kind === 'fuel');
      for (const window of windows) {
        for (const socket of fuel) {
          expect(distance(window.position, socket.position)).toBeGreaterThanOrEqual(
            exclusionRadius(socket) + apertureReach(window),
          );
        }
      }
    }
  });
});

describe('placement', () => {
  it('reports no issues on any archetype at any seed', () => {
    for (const fixture of FIXTURES) {
      for (const seed of SEEDS) {
        const windows = placeWindows(
          fixture.archetype,
          fixture.volumes,
          fixture.sockets,
          seed,
        );
        expect(
          windowIssues(windows, fixture.sockets, fixture.area),
          `${fixture.archetype} seed ${seed}`,
        ).toEqual([]);
      }
    }
  });

  it('gives every archetype exactly one flight deck', () => {
    for (const fixture of FIXTURES) {
      for (const seed of SEEDS) {
        const decks = placeWindows(
          fixture.archetype,
          fixture.volumes,
          fixture.sockets,
          seed,
        ).filter((window) => window.class === 'flight_deck');
        expect(decks.length, `${fixture.archetype} seed ${seed}`).toBe(1);
      }
    }
  });

  it('glazes the flight deck far more generously than any porthole', () => {
    for (const fixture of FIXTURES) {
      const windows = placeWindows(fixture.archetype, fixture.volumes, fixture.sockets, 11);
      const deck = windows.find((window) => window.class === 'flight_deck');
      const ports = windows.filter((window) => window.class === 'porthole');
      expect(deck).toBeDefined();
      expect(ports.length, `${fixture.archetype} has portholes`).toBeGreaterThan(2);
      const widest = Math.max(...ports.map((port) => port.area));
      // "Noticeably larger" is not a matter of taste when it is a ratio.
      expect(deck!.area / widest, fixture.archetype).toBeGreaterThan(4);
      expect(deck!.panes, fixture.archetype).toBeGreaterThan(1);
    }
  });

  it('keeps every porthole round and every porthole small', () => {
    for (const fixture of FIXTURES) {
      const ports = placeWindows(
        fixture.archetype,
        fixture.volumes,
        fixture.sockets,
        3,
      ).filter((window) => window.class === 'porthole');
      for (const port of ports) {
        expect(port.extent[0]).toBe(port.extent[1]);
        expect(port.panes).toBe(1);
        expect(port.extent[0]).toBeLessThanOrEqual(PORTHOLE_RADIUS);
      }
    }
  });

  it('shrinks a port that sits inside a weapon blast radius', () => {
    // Not every archetype has plate in that band, so this asserts the rule
    // where it applies and asserts that it applies somewhere.
    let seen = 0;
    for (const fixture of FIXTURES) {
      const weapons = fixture.sockets.filter((socket) => socket.kind === 'weapon');
      for (const seed of SEEDS) {
        const ports = placeWindows(
          fixture.archetype,
          fixture.volumes,
          fixture.sockets,
          seed,
        ).filter((window) => window.class === 'porthole');
        for (const port of ports) {
          const nearWeapon = weapons.some(
            (socket) =>
              distance(port.position, socket.position) <
              WEAPON_BLAST_RADIUS + port.extent[0],
          );
          if (!nearWeapon) continue;
          seen += 1;
          expect(port.extent[0]).toBeCloseTo(PORTHOLE_RADIUS * BLAST_SHRINK, 6);
        }
      }
    }
    expect(seen, 'some port on some hull lands inside a blast radius').toBeGreaterThan(0);
  });

  it('never cuts two apertures closer than the plate between them allows', () => {
    for (const fixture of FIXTURES) {
      const windows = placeWindows(fixture.archetype, fixture.volumes, fixture.sockets, 77);
      for (let i = 0; i < windows.length; i++) {
        for (let j = i + 1; j < windows.length; j++) {
          const a = windows[i]!;
          const b = windows[j]!;
          expect(distance(a.position, b.position)).toBeGreaterThanOrEqual(
            apertureReach(a) + apertureReach(b) + MIN_APERTURE_GAP,
          );
        }
      }
    }
  });

  it('stays inside the structural budget, and spends most of it', () => {
    for (const fixture of FIXTURES) {
      const windows = placeWindows(fixture.archetype, fixture.volumes, fixture.sockets, 21);
      const glazed = windows.reduce((sum, window) => sum + window.area, 0);
      const budget = fixture.area * MAX_GLAZED_FRACTION;
      expect(glazed, fixture.archetype).toBeLessThanOrEqual(budget);
      // A ceiling nothing ever approaches is decoration rather than a rule.
      expect(glazed / budget, fixture.archetype).toBeGreaterThan(0.3);
    }
  });

  it('is deterministic in (archetype, seed)', () => {
    for (const fixture of FIXTURES) {
      const once = placeWindows(fixture.archetype, fixture.volumes, fixture.sockets, 4242);
      const twice = placeWindows(fixture.archetype, fixture.volumes, fixture.sockets, 4242);
      expect(twice).toEqual(once);
      const other = placeWindows(fixture.archetype, fixture.volumes, fixture.sockets, 4243);
      expect(other).not.toEqual(once);
    }
  });

  it('seats every window on the hull skin, facing outward', () => {
    for (const fixture of FIXTURES) {
      for (const window of placeWindows(
        fixture.archetype,
        fixture.volumes,
        fixture.sockets,
        8,
      )) {
        const length = Math.hypot(window.normal[0], window.normal[1], window.normal[2]);
        expect(length).toBeCloseTo(1, 5);
        // Outward, in the sense that matters: away from the ship's own axis.
        const outward =
          window.normal[0] * window.position[0] + window.normal[1] * window.position[1];
        expect(outward, `${fixture.archetype} ${window.id}`).toBeGreaterThan(-0.35);
      }
    }
  });

  it('moves its glazing when the hull moves under it', () => {
    // The whole argument for a rule engine over a coordinate table. Squash the
    // aerodynamic airframe and its ports have to follow the new skin.
    const slim = hullVolumes('aerodynamic_sleek', [
      { r: 0.05, z: 8.0 },
      { r: 0.4, z: 3.6 },
      { r: 0.6, z: -2.0 },
      { r: 0.4, z: -7.4 },
    ]);
    const stock = hullVolumes('aerodynamic_sleek');
    const sockets = socketsFor('aerodynamic_sleek', stock);
    const before = placeWindows('aerodynamic_sleek', stock, sockets, 5);
    const after = placeWindows('aerodynamic_sleek', slim, sockets, 5);
    expect(after).not.toEqual(before);
    // A thinner hull has less skin, so it earns less glass.
    expect(hullSkinArea(slim)).toBeLessThan(hullSkinArea(stock));
  });

  it('declares a flight deck for every archetype', () => {
    for (const archetype of ARCHETYPES) {
      const deck = FLIGHT_DECKS[archetype];
      expect(deck.panes).toBeGreaterThan(1);
      expect(deck.extent[0]).toBeGreaterThan(deck.extent[1]);
    }
  });
});

describe('windowIssues', () => {
  it('catches a window planted on a fuel tank', () => {
    const fixture = FIXTURES[2]!;
    const fuel = fixture.sockets.find((socket) => socket.kind === 'fuel')!;
    const issues = windowIssues(
      [
        {
          id: 'illegal',
          class: 'porthole',
          position: fuel.position,
          normal: [1, 0, 0],
          up: [0, 1, 0],
          extent: [0.17, 0.17],
          panes: 1,
          area: 0.09,
        },
      ],
      fixture.sockets,
      fixture.area,
    );
    expect(issues.some((issue) => issue.includes('fuel'))).toBe(true);
  });

  it('catches two flight decks and an over-glazed hull', () => {
    const fixture = FIXTURES[0]!;
    const deck = {
      class: 'flight_deck' as const,
      position: [0, 40, 0] as const,
      normal: [0, 1, 0] as const,
      up: [0, 0, 1] as const,
      extent: [4, 4] as const,
      panes: 5,
      area: 64,
    };
    const issues = windowIssues(
      [
        { ...deck, id: 'a' },
        { ...deck, id: 'b', position: [0, 60, 0] },
      ],
      [],
      fixture.area,
    );
    expect(issues.some((issue) => issue.includes('flight decks'))).toBe(true);
    expect(issues.some((issue) => issue.includes('structural budget'))).toBe(true);
  });
});

describe('glazing state', () => {
  const fixture = FIXTURES[1]!;
  const windows = placeWindows(fixture.archetype, fixture.volumes, fixture.sockets, 99);

  it('lights a factory-fresh ship and darkens a derelict', () => {
    const fresh = glazeWindows(windows, deriveWear(0.05, 99), 0.05, 99);
    // Nothing is broken on a ship straight out of the yard, and the bridge is
    // manned. A handful of compartments are unlit even so — a ship with every
    // single port blazing reads as a lamp, not as a vessel with a crew in it.
    expect(fresh.every((window) => window.state === 'lit' || window.state === 'dark')).toBe(true);
    expect(fresh.find((window) => window.class === 'flight_deck')!.state).toBe('lit');
    expect(fresh.filter((window) => window.state === 'lit').length).toBeGreaterThan(
      fresh.length * 0.6,
    );

    const hulk = glazeWindows(windows, deriveWear(0.97, 99), 0.97, 99);
    expect(hulk.every((window) => window.brightness === 0)).toBe(true);
    expect(hulk.every((window) => window.state !== 'lit')).toBe(true);
  });

  it('breaks glass only at the far end of the slider', () => {
    const working = glazeWindows(windows, deriveWear(0.3, 4), 0.3, 4);
    expect(working.some((window) => window.state === 'blown')).toBe(false);

    // Structural failure is reserved for past 0.72 by `deriveWear`, so a hulk
    // is where blown ports come from.
    let blown = 0;
    for (const seed of SEEDS) {
      const hulk = glazeWindows(windows, deriveWear(1, seed), 1, seed);
      blown += hulk.filter((window) => window.state === 'blown').length;
    }
    expect(blown).toBeGreaterThan(0);
  });

  it('keeps the flight deck crewed while the ship still has power', () => {
    for (const condition of [0.1, 0.35, 0.6, 0.8]) {
      for (const seed of SEEDS) {
        const glazed = glazeWindows(windows, deriveWear(condition, seed), condition, seed);
        const deck = glazed.find((window) => window.class === 'flight_deck')!;
        // It can be cracked or blown by damage, but it is never simply unoccupied.
        expect(deck.state, `condition ${condition} seed ${seed}`).not.toBe('dark');
      }
    }
  });

  it('dims what is left as a ship gets filthy', () => {
    const clean = glazeWindows(windows, deriveWear(0.12, 6), 0.12, 6);
    const grubby = glazeWindows(windows, deriveWear(0.8, 6), 0.8, 6);
    const mean = (set: typeof clean): number =>
      set.reduce((sum, window) => sum + window.brightness, 0) / set.length;
    expect(mean(grubby)).toBeLessThan(mean(clean));
  });

  it('is deterministic, and independent of how many windows precede one', () => {
    const wear = deriveWear(0.75, 31);
    const once = glazeWindows(windows, wear, 0.75, 31);
    expect(glazeWindows(windows, wear, 0.75, 31)).toEqual(once);
    // Three draws per window, in order, so a prefix glazes identically.
    const prefix = glazeWindows(windows.slice(0, 4), wear, 0.75, 31);
    expect(prefix.map((window) => window.state)).toEqual(
      once.slice(0, 4).map((window) => window.state),
    );
  });
});
