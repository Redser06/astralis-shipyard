import { streamFor } from './rng';
import { DERELICT_THRESHOLD } from './condition';
import { surfaceArea, surfaceForSolid } from './damage';
import {
  hullBounds,
  isCrowded,
  normalise,
  raycastHull,
  seatOnHull,
  type HullVolume,
  type Keepout,
} from './hullForm';
import type { ArchetypeId, Socket, SocketKind, SocketSize, Vec3, WearChannels } from './types';

/**
 * Where a ship is glazed, and where it must not be.
 *
 * WHY A RULE ENGINE RATHER THAN A LIST OF COORDINATES. Windows are the one
 * fitting whose placement is governed by constraints rather than by taste: a
 * pressure hull is weakened by every hole cut in it, so glazing is periodic and
 * rationed, and there are places a naval architect simply will not cut. Writing
 * that as a hand-typed table per archetype would repeat exactly the mistake
 * `sockets.ts` was rebuilt to undo — numbers tuned against one hull, drifting
 * silently the moment the hull moves. So the rules are stated once, here, and
 * the placements are derived from the hull that actually renders.
 *
 * THE RULES, in the order they bind:
 *
 *   1. NOTHING NEAR FUEL. Absolute. A porthole in a cryogenic hydrogen bay or
 *      beside an antimatter bottle is not a design choice, it is a hull loss.
 *      `windowIssues()` reports a violation and a unit test fails the build on
 *      one; there is no override and no per-archetype exception.
 *   2. Nothing near the drives. Engine wash and radiation, and it is the one
 *      part of a ship nobody needs to see out of.
 *   3. Small or nothing near weapon mounts. Muzzle blast and ejected casings.
 *      Inside the blast radius a port is allowed but shrunk; inside the
 *      exclusion radius it is refused outright.
 *   4. One FLIGHT DECK per ship, and it is glazed far more generously than
 *      anywhere else — a segmented band with mullions, because that is how you
 *      span an aperture that wide without losing the frame.
 *   5. Portholes everywhere else: small, round, individually framed, spaced far
 *      enough apart that the plate between them still carries load.
 *   6. A hard ceiling on glazed area as a fraction of hull skin area, standing
 *      in for structural integrity. This is the constraint that binds on the
 *      big hulls, and it is why a dreadnought is not simply a frigate with more
 *      windows.
 *
 * Everything is seeded off the blueprint, so a ship's ports never move. And
 * everything is pure — no `three` — which is what lets rule 1 be arithmetic in
 * a unit test rather than something somebody promises they looked at.
 *
 * ON WEAR. Glazing state (lit, dark, cracked, blown) is derived from the
 * EXISTING seven wear channels. No channel was added, deliberately:
 * `deriveWear` draws one jitter per channel from a single stream in source
 * order, so inserting a channel anywhere but the end silently re-rolls the wear
 * of every ship ever saved — and appending one purely to say "cracked glass"
 * when `structural` and `impact` already say it would be a second source of
 * truth for the same fact.
 */

/* ------------------------------------------------------------------ */
/* Types                                                               */
/* ------------------------------------------------------------------ */

export type WindowClass = 'flight_deck' | 'porthole';

export interface WindowPlacement {
  id: string;
  class: WindowClass;
  /** Seated on the hull skin, like every other fitting. */
  position: Vec3;
  /** Outward surface normal at that point — the glazing faces along it. */
  normal: Vec3;
  /** Roll reference, so a band of bridge glazing is level rather than canted. */
  up: Vec3;
  /**
   * Half-extents in the aperture's own tangent frame: [across, up]. A porthole
   * is round, so both are its radius.
   */
  extent: readonly [number, number];
  /** Panes across the aperture. Portholes are 1; the flight deck is mullioned. */
  panes: number;
  /** Glazed area. This is what the structural budget is spent from. */
  area: number;
}

export type GlazingState = 'lit' | 'dark' | 'cracked' | 'blown';

export interface GlazedWindow extends WindowPlacement {
  state: GlazingState;
  /** 0–1. Interior light reaching the pane; 0 whenever the state is not lit. */
  brightness: number;
}

/* ------------------------------------------------------------------ */
/* The rules, as numbers                                               */
/* ------------------------------------------------------------------ */

/**
 * Keep-out radius around each kind of hardware, before the socket's own size
 * class scales it.
 *
 * Sized against the geometry that actually hangs off the socket rather than
 * picked to look tidy: the largest fuel pod (`cryo_h2`) reaches 2.04 units from
 * its socket, so a fuel keep-out of 2.8 clears the biggest tank by a metre at
 * every size class. Engines are sized off the longest bell plus its plume root.
 */
export const EXCLUSION_BASE: Readonly<Record<SocketKind, number>> = {
  /** HARD RULE. See the header. Never lower this to fit a window in. */
  fuel: 2.8,
  engine: 2.4,
  weapon: 1.2,
  radiator: 0.9,
  rcs: 0.5,
  sensor: 0.45,
  // The FTL ring encircles the hull rather than protruding from it, so it
  // occupies no plate and blocks no glazing.
  ftl: 0,
};

/** Matches `SIZE_SCALE` in `render/parts/Parts.tsx`: a big socket, big hardware. */
export const SOCKET_EXTENT: Readonly<Record<SocketSize, number>> = { S: 0.7, M: 1.0, L: 1.4 };

/**
 * Beyond the weapon exclusion radius but inside this, a port is allowed at
 * reduced size — a scuttle rather than a viewport. Muzzle blast does not stop
 * dead at the exclusion boundary, it falls off.
 */
export const WEAPON_BLAST_RADIUS = 3.4;

/** How much a port inside the blast radius shrinks. */
export const BLAST_SHRINK = 0.6;

/** Clear plate required between two apertures, on top of their own radii. */
export const MIN_APERTURE_GAP = 0.62;

/**
 * Glazed area as a fraction of hull skin area. The structural budget.
 *
 * A pressure hull is a monocoque; every aperture is a stress raiser and a
 * radiation leak. One percent is the number that makes the big hulls run out of
 * budget before they run out of candidate stations, which is the point — the
 * ceiling has to bind, or it is decoration.
 */
export const MAX_GLAZED_FRACTION = 0.01;

/** Nominal porthole radius before the blast-radius shrink. */
export const PORTHOLE_RADIUS = 0.17;

/**
 * Stations walked bow to stern looking for somewhere to cut a port, and the
 * bearings tried at each. Flanks first, because that is where accommodation is;
 * the dorsal bearings pick up spines and citadel roofs.
 */
const STATIONS = 22;
const BEARINGS = [Math.PI / 2, -Math.PI / 2, Math.PI / 3, -Math.PI / 3, 0];

/** Far enough to start outside any hull. Mirrors `hullForm`'s own reach. */
const REACH = 60;

/** A grazing hit is not a plate you can cut a round hole in. */
const FACING = 0.55;

/* ------------------------------------------------------------------ */
/* The flight deck                                                     */
/* ------------------------------------------------------------------ */

interface FlightDeckIntent {
  /** Where on the hull the bridge is. Seated onto the skin by ray cast. */
  position: Vec3;
  normal: Vec3;
  up: Vec3;
  /** Half-extents [across, up] before seating. */
  extent: readonly [number, number];
  panes: number;
}

/**
 * One per archetype, because the bridge is the one aperture whose location is a
 * statement about the ship rather than an output of a rule. Everything else on
 * the hull is derived.
 *
 * These are *intent*, in the same sense as `sockets.ts`: which structure the
 * flight deck belongs to and roughly where along it. The exact standoff is
 * measured off the hull, so a reshaped hull carries its bridge with it.
 */
export const FLIGHT_DECKS: Readonly<Record<ArchetypeId, FlightDeckIntent>> = {
  // Forward of the dorsal spine, looking out over the faceted prow.
  angular_stealth: {
    position: [0, 0.5, 3.4],
    normal: [0, 0.72, 0.69],
    up: [0, 0, 1],
    extent: [0.78, 0.21],
    panes: 5,
  },
  // The forward habitat module's front face — the only flat bow on the fleet.
  industrial_expanse: {
    position: [0, 0.85, 7.5],
    normal: [0, 0.12, 1],
    up: [0, 1, 0],
    extent: [1.12, 0.28],
    panes: 7,
  },
  // Elevated citadel bridge, front face of the command tower.
  brutalist_dreadnought: {
    position: [0, 2.2, 0.5],
    normal: [0, 0.15, 1],
    up: [0, 1, 0],
    extent: [0.82, 0.25],
    panes: 5,
  },
  // Crown of the slim fuselage, under the forward instrument bulb.
  outrigger_science: {
    position: [0, 0.9, 1.9],
    normal: [0, 0.78, 0.63],
    up: [0, 0, 1],
    extent: [0.62, 0.2],
    panes: 4,
  },
  // Straight into the canopy blister — the one archetype with a cockpit rather
  // than a bridge, so the glazing wraps the pilot instead of spanning a deck.
  aerodynamic_sleek: {
    position: [0, 1.2, 3.4],
    normal: [0, 0.66, 0.75],
    up: [0, 0, 1],
    extent: [0.5, 0.19],
    panes: 3,
  },
};

/* ------------------------------------------------------------------ */
/* Small vector helpers — kept local so domain stays free of three      */
/* ------------------------------------------------------------------ */

const add = (a: Vec3, b: Vec3): Vec3 => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const sub = (a: Vec3, b: Vec3): Vec3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const scale = (a: Vec3, k: number): Vec3 => [a[0] * k, a[1] * k, a[2] * k];
const dot = (a: Vec3, b: Vec3): number => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a: Vec3, b: Vec3): Vec3 => [
  a[1] * b[2] - a[2] * b[1],
  a[2] * b[0] - a[0] * b[2],
  a[0] * b[1] - a[1] * b[0],
];

export const distance = (a: Vec3, b: Vec3): number =>
  Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);

const clamp = (v: number, lo: number, hi: number): number => Math.max(lo, Math.min(hi, v));

/* ------------------------------------------------------------------ */
/* Measurement                                                         */
/* ------------------------------------------------------------------ */

/** Keep-out radius for one socket, scaled by the hardware it carries. */
export function exclusionRadius(socket: Socket): number {
  return EXCLUSION_BASE[socket.kind] * SOCKET_EXTENT[socket.size];
}

/**
 * Outer skin area of a hull, reusing the same measurement the damage system
 * uses to decide how many marks a plate earns. Approximate by construction —
 * it double-counts where two solids interpenetrate — which is the conservative
 * direction only if you remember that it inflates the budget, so the fraction
 * is set low to compensate.
 */
export function hullSkinArea(volumes: readonly HullVolume[]): number {
  let total = 0;
  for (const volume of volumes) {
    const surface = surfaceForSolid(volume);
    if (surface) total += surfaceArea(surface);
  }
  return total;
}

/** Area of one aperture: round for a porthole, rectangular for a band. */
export function apertureArea(extent: readonly [number, number], panes: number): number {
  return panes > 1 ? 4 * extent[0] * extent[1] : Math.PI * extent[0] * extent[1];
}

/**
 * How far an aperture reaches from its own centre.
 *
 * A porthole is round, so that is simply its radius; a mullioned band is
 * rectangular, so it is the half-diagonal. Getting this wrong in one of the two
 * places it is used is how a placement routine and its own validator end up
 * disagreeing about whether the ship is legal.
 */
export const apertureReach = (window: WindowPlacement): number =>
  window.class === 'porthole' ? window.extent[0] : Math.hypot(window.extent[0], window.extent[1]);

/**
 * How far a point lies from the aperture itself, rather than from a circle
 * drawn round it.
 *
 * `apertureReach` circumscribes a band, which is right against sockets — they
 * are large and metres away, so the conservative answer costs nothing — and
 * badly wrong against a fixture bolted half a metre off. The industrial hull's
 * flight deck is 2.24 across and 0.56 tall: its half-diagonal is 1.15, so a
 * circular test reserves an area four times the glass and reports a beacon
 * 0.85 away as fouling a band whose top edge it clears by a third of a metre.
 * Applied as an exclusion, that measure deleted the bridge outright from three
 * of the five archetypes.
 *
 * So a band is measured as the rectangle it is: project onto the aperture's own
 * axes, clamp to the extents, and take what is left. A porthole is round, and
 * this reduces to its centre distance less its radius, which is exactly what
 * the circular measure already said.
 */
export function apertureClearance(window: WindowPlacement, point: Vec3): number {
  if (window.class === 'porthole') {
    return Math.max(0, distance(window.position, point) - window.extent[0]);
  }

  const forward = normalise(window.normal);
  // The same basis the renderer builds in `apertureQuaternion`, so the maths
  // here describes the rectangle that is actually drawn.
  let vertical = sub(window.up, scale(forward, dot(window.up, forward)));
  if (dot(vertical, vertical) < 1e-8) vertical = [0, 1, 0];
  vertical = normalise(vertical);
  const right = cross(vertical, forward);

  const offset = sub(point, window.position);
  const dx = Math.max(0, Math.abs(dot(offset, right)) - window.extent[0]);
  const dy = Math.max(0, Math.abs(dot(offset, vertical)) - window.extent[1]);
  const dz = dot(offset, forward);
  return Math.hypot(dx, dy, dz);
}

/**
 * Roll reference for an aperture on a given surface.
 *
 * Level with the ship's waterline wherever that is meaningful, and aligned fore
 * and aft on a dorsal or ventral surface, where "up" would be degenerate.
 */
function upFor(normal: Vec3): Vec3 {
  return Math.abs(normal[1]) > 0.85 ? [0, 0, 1] : [0, 1, 0];
}

/* ------------------------------------------------------------------ */
/* Placement                                                           */
/* ------------------------------------------------------------------ */

/**
 * Which socket, if any, forbids an aperture of this radius at this point — and
 * separately whether the point is merely inside a weapon's blast radius, where
 * a port is allowed but shrunk.
 */
function testExclusions(
  point: Vec3,
  radius: number,
  sockets: readonly Socket[],
): { blocked: boolean; blast: boolean } {
  let blast = false;
  for (const socket of sockets) {
    const gap = distance(point, socket.position);
    if (gap < exclusionRadius(socket) + radius) return { blocked: true, blast: false };
    if (socket.kind === 'weapon' && gap < WEAPON_BLAST_RADIUS + radius) blast = true;
  }
  return { blocked: false, blast };
}


export interface PlacementOptions {
  /** Override the structural ceiling. Tests use it; nothing else should. */
  maxGlazedFraction?: number;
  /**
   * Hull already claimed by fixtures that cannot move.
   *
   * Rules 1–3 keep glazing away from the *sockets* — the fuel bays, the drives,
   * the weapon mounts. They say nothing about the exterior lighting rig, which
   * is bolted to the same plate by a different module, so a porthole would
   * happily open directly under a floodlight's hood. It did, on every
   * archetype. Glazing has candidates to spare and the rig has nowhere else to
   * go, so glazing is what gives way. See `exteriorLights.rigKeepouts`.
   */
  keepClear?: readonly Keepout[];
}

/**
 * Every window on a ship, seated on the skin and satisfying every rule above.
 *
 * Deterministic in (archetype, seed): the station walk is a fixed sequence and
 * every jitter comes from one seeded stream, so a saved ship's ports are where
 * they were last time.
 */
export function placeWindows(
  archetype: ArchetypeId,
  volumes: readonly HullVolume[],
  sockets: readonly Socket[],
  seed: number,
  options: PlacementOptions = {},
): WindowPlacement[] {
  const rng = streamFor(seed, 'windows');
  const budget = hullSkinArea(volumes) * (options.maxGlazedFraction ?? MAX_GLAZED_FRACTION);
  const keepClear = options.keepClear ?? [];
  const placed: WindowPlacement[] = [];
  let spent = 0;

  const fits = (candidate: WindowPlacement): boolean => {
    if (spent + candidate.area > budget) return false;
    const reach = apertureReach(candidate);
    if (isCrowded(candidate.position, keepClear, reach)) return false;
    for (const other of placed) {
      if (distance(candidate.position, other.position) < reach + apertureReach(other) + MIN_APERTURE_GAP) {
        return false;
      }
    }
    return true;
  };

  const accept = (candidate: WindowPlacement): void => {
    placed.push(candidate);
    spent += candidate.area;
  };

  /* --- The flight deck, first, so it always gets its area --- */

  const deck = FLIGHT_DECKS[archetype];
  const seated = seatOnHull(volumes, deck.position, deck.normal, FACING);
  if (seated) {
    // The bridge is the widest aperture on the ship, so it is measured against
    // the socket exclusions at its own half-diagonal rather than at a
    // porthole's. Sockets are large and metres off, so circumscribing the band
    // costs nothing there.
    const reach = Math.hypot(deck.extent[0], deck.extent[1]);
    const { blocked } = testExclusions(seated.position, reach, sockets);
    const candidate: WindowPlacement = {
      id: 'flight-deck',
      class: 'flight_deck',
      position: seated.position,
      normal: seated.normal,
      up: deck.up,
      extent: deck.extent,
      panes: deck.panes,
      area: apertureArea(deck.extent, deck.panes),
    };
    // Against the exterior fixtures it is measured as the rectangle it is. Those
    // sit half a metre away, where circumscribing the band is not conservative
    // but simply wrong — it reserves four times the glass, and using it here
    // deleted the bridge outright from three of the five archetypes.
    const fouled = keepClear.some(
      (zone) => apertureClearance(candidate, zone.position) < zone.radius,
    );
    if (!blocked && !fouled) accept(candidate);
  }

  /* --- Portholes: walk the hull bow to stern, trying each bearing --- */

  const { minZ, maxZ } = hullBounds(volumes);
  const span = maxZ - minZ;

  for (let i = 0; i < STATIONS; i++) {
    // Bow to stern. Accommodation is forward on a real ship and the stern is
    // machinery, so working forwards means the budget is spent where people are.
    const t = 1 - (i + 0.5) / STATIONS;
    const jitter = (rng() - 0.5) * (span / STATIONS) * 0.7;
    const z = minZ + span * t + jitter;

    for (const bearing of BEARINGS) {
      const angle = bearing + (rng() - 0.5) * 0.22;
      const outward: Vec3 = [Math.sin(angle), Math.cos(angle), 0];
      const hit = raycastHull(volumes, add([0, 0, z], scale(outward, REACH)), scale(outward, -1));
      if (!hit) continue;
      if (dot(hit.normal, outward) < FACING) continue;

      // Never cut a round hole in something barely wider than the hole. The
      // stealth prow's needle and the airframe's nose cone both fail here.
      const girth = Math.hypot(hit.point[0], hit.point[1]);
      if (girth < PORTHOLE_RADIUS * 2.2) continue;

      const first = testExclusions(hit.point, PORTHOLE_RADIUS, sockets);
      if (first.blocked) continue;
      const radius = first.blast ? PORTHOLE_RADIUS * BLAST_SHRINK : PORTHOLE_RADIUS;
      // Re-test at the shrunk radius: a smaller port may clear an exclusion the
      // full-size one did not, and it must still clear it.
      if (testExclusions(hit.point, radius, sockets).blocked) continue;

      const extent: readonly [number, number] = [radius, radius];
      const candidate: WindowPlacement = {
        id: `port-${i}-${BEARINGS.indexOf(bearing)}`,
        class: 'porthole',
        position: hit.point,
        normal: hit.normal,
        up: upFor(hit.normal),
        extent,
        panes: 1,
        area: apertureArea(extent, 1),
      };
      if (fits(candidate)) accept(candidate);
    }
  }

  return placed;
}

/* ------------------------------------------------------------------ */
/* Validation                                                          */
/* ------------------------------------------------------------------ */

/**
 * Everything wrong with a set of placements, as prose. Empty means it is sound.
 *
 * The same shape as `fittingIssues` in `fittings.ts`, and for the same reason:
 * a rule that is only enforced inside the function that produces the data is a
 * rule nobody can check from the outside. A unit test runs this over every
 * archetype and every seed it can afford.
 */
export function windowIssues(
  windows: readonly WindowPlacement[],
  sockets: readonly Socket[],
  hullArea: number,
  maxGlazedFraction = MAX_GLAZED_FRACTION,
  keepClear: readonly Keepout[] = [],
): string[] {
  const problems: string[] = [];

  for (const window of windows) {
    const reach = apertureReach(window);
    for (const socket of sockets) {
      const gap = distance(window.position, socket.position);
      const keepOut = exclusionRadius(socket) + reach;
      if (gap < keepOut) {
        problems.push(
          `${window.id}: ${gap.toFixed(2)} from ${socket.kind} socket ${socket.id}, needs ${keepOut.toFixed(2)}`,
        );
      }
    }
    // The same check for the fixtures that are not sockets — the floodlights
    // and beacons of `exteriorLights.ts`. Checkable from outside for the same
    // reason the socket rule is: a constraint enforced only inside the function
    // that produces the data is a constraint nobody else can verify. Measured
    // off the aperture rather than off a circle round it, so that the validator
    // and `placeWindows` agree about what fouling means.
    for (const zone of keepClear) {
      const gap = apertureClearance(window, zone.position);
      if (gap < zone.radius) {
        problems.push(
          `${window.id}: ${gap.toFixed(2)} from an exterior fixture, needs ${zone.radius.toFixed(2)}`,
        );
      }
    }
  }

  for (let i = 0; i < windows.length; i++) {
    for (let j = i + 1; j < windows.length; j++) {
      const a = windows[i] as WindowPlacement;
      const b = windows[j] as WindowPlacement;
      const gap = distance(a.position, b.position);
      const needed = apertureReach(a) + apertureReach(b) + MIN_APERTURE_GAP;
      if (gap < needed) {
        problems.push(
          `${a.id} and ${b.id}: ${gap.toFixed(2)} apart, needs ${needed.toFixed(2)}`,
        );
      }
    }
  }

  const glazed = windows.reduce((sum, window) => sum + window.area, 0);
  if (glazed > hullArea * maxGlazedFraction) {
    problems.push(
      `glazed area ${glazed.toFixed(2)} exceeds the structural budget ${(hullArea * maxGlazedFraction).toFixed(2)}`,
    );
  }

  const decks = windows.filter((window) => window.class === 'flight_deck');
  if (decks.length > 1) problems.push(`${decks.length} flight decks — a ship has one bridge`);

  return problems;
}

/* ------------------------------------------------------------------ */
/* Glazing state                                                       */
/* ------------------------------------------------------------------ */

/**
 * What each pane looks like at a given condition.
 *
 * Derived from the existing wear channels — see the header for why no channel
 * was added. `structural` blows glazing out entirely and is reserved for the
 * far end of the slider; `impact` cracks it, because a micrometeorite that
 * pits plate goes through a window; `grime` and `oxidation` dim what is left.
 *
 * A derelict is dark, and that is most of what sells it: at
 * `DERELICT_THRESHOLD` every pane loses its interior light in the same frame
 * the running lights and the drive glow go out.
 *
 * Exactly three draws per window, in a fixed order, so adding a window at the
 * stern cannot change the state of one at the bow.
 */
export function glazeWindows(
  windows: readonly WindowPlacement[],
  wear: WearChannels,
  condition: number,
  seed: number,
): GlazedWindow[] {
  const rng = streamFor(seed, 'windows:glazing');
  const dead = condition >= DERELICT_THRESHOLD;

  return windows.map((window) => {
    const breakage = rng();
    const occupancy = rng();
    const flicker = rng();

    let state: GlazingState;
    if (breakage < wear.structural * 0.45) {
      state = 'blown';
    } else if (breakage < wear.structural * 0.45 + wear.impact * 0.3) {
      state = 'cracked';
    } else if (dead) {
      state = 'dark';
    } else if (
      // Not every compartment is occupied, and a grubby ship has more of its
      // volume shut up and unlit. The flight deck is crewed whatever else is.
      window.class !== 'flight_deck' &&
      occupancy < 0.14 + wear.grime * 0.34
    ) {
      state = 'dark';
    } else {
      state = 'lit';
    }

    const dimming = clamp(1 - wear.grime * 0.4 - wear.oxidation * 0.25, 0.3, 1);
    const brightness =
      state === 'lit' ? clamp(dimming * (0.72 + flicker * 0.45), 0, 1) : 0;

    return { ...window, state, brightness };
  });
}
