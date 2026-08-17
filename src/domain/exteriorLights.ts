import { streamFor } from './rng';
import { hullBounds, normalise, raycastHull, type HullVolume } from './hullForm';
import type { ArchetypeId, Vec3 } from './types';

/**
 * Exterior lighting: floodlights that light the ship, and navigation lights
 * that declare it.
 *
 * WHY THIS IS A DOMAIN MODULE. The same argument as `windows.ts` and
 * `hullForm.ts`. A floodlight has to be bolted to plate and aimed at plate, and
 * "is this lamp on the hull" and "does its cone land on anything" are numeric
 * facts. Hand-typed world coordinates are what left the prototype's running
 * lights floating in vacuum on all five archetypes, byte-identical because the
 * hull was never consulted. So mounts are declared as *intent* and seated on
 * the measured skin, exactly as sockets are.
 *
 * TWO POPULATIONS, doing different jobs:
 *
 *   FLOODS are working lights. They mount on a face, point at a named part of
 *   the ship, and genuinely illuminate it — a real `spotLight` in the renderer,
 *   not an emissive decal pretending. They are what makes a drydock read as a
 *   place where work happens, and what gives the hull form at night.
 *
 *   BEACONS are navigation lights, and they are derived rather than declared:
 *   port red and starboard green at the widest point of the beam, a white
 *   masthead forward, and anti-collision strobes at bow and stern. Their
 *   positions come out of the hull's own extremities, so a wider ship carries
 *   its red and green further apart without anybody retyping a number.
 *
 * Pure: no `three`, no DOM, and every strobe phase drawn from one seeded
 * stream so a saved ship blinks the same way it did last time.
 */

/* ------------------------------------------------------------------ */
/* Types                                                               */
/* ------------------------------------------------------------------ */

export interface Floodlight {
  id: string;
  /** Seated on the hull skin. */
  position: Vec3;
  /** Outward normal of the plate it is bolted to. */
  normal: Vec3;
  /** What the beam is trained on, in ship-local space. */
  aim: Vec3;
  colour: string;
  /**
   * Luminous intensity in candela. three's lights are physical, so a spot's
   * illuminance falls as intensity / d²: 30 cd reads a little under the key
   * light at four units out, which is roughly how far these throw. They were
   * twice this and burned a hard white patch into the plate they lit — a
   * floodlight should model the hull, not erase it.
   */
  intensity: number;
  /** Cone half-angle, radians. */
  angle: number;
  /** Beam length before it dies. */
  range: number;
  /** Housing radius. The lens is a shade under this. */
  size: number;
}

export type BeaconRole = 'port' | 'starboard' | 'masthead' | 'bow' | 'stern';

export interface NavigationBeacon {
  id: string;
  role: BeaconRole;
  position: Vec3;
  normal: Vec3;
  colour: string;
  /** Seconds per flash. Zero is a steady light. */
  period: number;
  /** Where in its own cycle this lamp starts, so a fleet does not blink as one. */
  phase: number;
  radius: number;
  /** Whether this lamp pools colour on the plate around it. */
  casts: boolean;
}

export interface ExteriorLightRig {
  floods: Floodlight[];
  beacons: NavigationBeacon[];
}

/* ------------------------------------------------------------------ */
/* Flood mounts, per archetype                                         */
/* ------------------------------------------------------------------ */

interface FloodIntent {
  id: string;
  /** Roughly where on the hull. The standoff is measured, not typed. */
  at: Vec3;
  normal: Vec3;
  aim: Vec3;
  angle: number;
  range: number;
  intensity: number;
  size: number;
  /** Generates the matching port-side fixture, aim mirrored with it. */
  mirror?: boolean;
}

/**
 * Three positions on every ship, because they are the three things a crew
 * actually needs lit: the bow they are flying into, the outboard hardware they
 * have to inspect, and the drive bay.
 */
const FLOOD_MOUNTS: Readonly<Record<ArchetypeId, readonly FloodIntent[]>> = {
  angular_stealth: [
    { id: 'flood-bow', at: [0, 0.6, 1.0], normal: [0, 1, 0], aim: [0, -0.3, 6.2], angle: 0.4, range: 15, intensity: 32, size: 0.23 },
    // Raking aft along the chine and the after flank, rather than out into the
    // vacuum where the radiator happens to hang. Aimed at the body rather than
    // at the tail fin: the fin is 0.18 thick, and a beam aimed at something
    // that thin misses it the moment the fixture's standoff changes.
    { id: 'flood-waist', at: [1.3, 0.15, 0.6], normal: [1, 0.25, 0], aim: [1.15, 0.1, -4.8], angle: 0.5, range: 9, intensity: 20, size: 0.19, mirror: true },
    // On the aft end of the dorsal spine, so the beam clears the spine it is
    // standing on before it reaches the after deck.
    { id: 'flood-drive', at: [0, 0.9, -3.75], normal: [0, 1, 0], aim: [0, -0.3, -5.0], angle: 0.44, range: 12, intensity: 28, size: 0.22 },
  ],
  industrial_expanse: [
    // Off the habitat module's roof, down the length of the truss.
    { id: 'flood-bow', at: [0, 1.5, 4.6], normal: [0, 1, 0], aim: [0, 0.1, -3.4], angle: 0.5, range: 18, intensity: 40, size: 0.26 },
    // Off the upper longerons, onto the cargo pods slung underneath.
    { id: 'flood-bay', at: [1.5, 1.5, 0.8], normal: [0, 1, 0], aim: [0, -1.6, 0], angle: 0.55, range: 8, intensity: 22, size: 0.2, mirror: true },
    { id: 'flood-drive', at: [0, 0.75, -4.4], normal: [0, 1, 0], aim: [2.0, 0, -6.6], angle: 0.45, range: 10, intensity: 25, size: 0.22, mirror: true },
  ],
  brutalist_dreadnought: [
    { id: 'flood-bow', at: [0, 1.2, 2.8], normal: [0, 1, 0], aim: [0, 0.8, 7.6], angle: 0.44, range: 13, intensity: 38, size: 0.28 },
    // Searchlights off the command tower, sweeping the armour skirts.
    // On the tower's flank rather than its roof: a roof mount aimed outboard
    // hits the tower's own side 0.3 from the lens.
    { id: 'flood-tower', at: [1.05, 2.2, -1.2], normal: [1, 0.3, 0], aim: [3.6, -1.5, -1.0], angle: 0.5, range: 11, intensity: 30, size: 0.23, mirror: true },
    { id: 'flood-drive', at: [0, 1.3, -5.6], normal: [0, 1, 0], aim: [0, 0, -9.2], angle: 0.46, range: 11, intensity: 30, size: 0.25 },
  ],
  outrigger_science: [
    { id: 'flood-bow', at: [0, 0.95, 1.4], normal: [0, 1, 0], aim: [0, 0, 5.6], angle: 0.42, range: 10, intensity: 22, size: 0.19 },
    // Boom-mounted, cross-lighting the fuselage. On a science ship the booms
    // are the only structure far enough outboard to light the hull side-on.
    { id: 'flood-boom', at: [4.3, 0.5, 0.6], normal: [0, 1, 0], aim: [0, 0.4, 0.4], angle: 0.5, range: 8, intensity: 19, size: 0.17, mirror: true },
    // Aimed at the fuselage's own tail cap. Aimed past it at z -6.4 the beam
    // cleared the hull entirely and lit nothing.
    { id: 'flood-drive', at: [0, 0.95, -2.4], normal: [0, 1, 0], aim: [0, -0.2, -4.4], angle: 0.44, range: 9, intensity: 21, size: 0.19 },
  ],
  aerodynamic_sleek: [
    { id: 'flood-bow', at: [0, 1.3, 1.0], normal: [0, 1, 0], aim: [0, 0.2, 6.4], angle: 0.4, range: 13, intensity: 28, size: 0.2 },
    { id: 'flood-wing', at: [1.15, 0.55, -2.0], normal: [1, 0.45, 0], aim: [3.0, -0.4, -2.8], angle: 0.5, range: 8, intensity: 19, size: 0.17, mirror: true },
    // Forward of the vertical stabiliser, raking aft over it. Mounted level
    // with the fin it lands 0.36 from its own lens.
    { id: 'flood-drive', at: [0, 1.4, -2.6], normal: [0, 1, 0], aim: [0, 0.4, -7.4], angle: 0.44, range: 10, intensity: 24, size: 0.2 },
  ],
};

/* ------------------------------------------------------------------ */
/* Navigation light convention                                         */
/* ------------------------------------------------------------------ */

/**
 * Colours lifted straight off the maritime and aviation convention the fiction
 * inherits: red to port, green to starboard, so another ship can read your
 * heading from your lights alone, plus white steady forward and white
 * anti-collision strobes at the extremities.
 */
export const BEACON_SPEC: Readonly<
  Record<BeaconRole, { colour: string; period: number; radius: number; casts: boolean }>
> = {
  port: { colour: '#ff3b30', period: 0, radius: 0.075, casts: true },
  starboard: { colour: '#22e06a', period: 0, radius: 0.075, casts: true },
  masthead: { colour: '#e2ecff', period: 0, radius: 0.06, casts: false },
  bow: { colour: '#f8fafc', period: 1.7, radius: 0.055, casts: false },
  stern: { colour: '#ff5a4d', period: 1.7, radius: 0.055, casts: false },
};

/* ------------------------------------------------------------------ */

const add = (a: Vec3, b: Vec3): Vec3 => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const scale = (a: Vec3, k: number): Vec3 => [a[0] * k, a[1] * k, a[2] * k];
const mirrorX = (v: Vec3): Vec3 => [-v[0], v[1], v[2]];

/** Far enough to start outside any hull, matching `hullForm`'s own reach. */
const REACH = 60;

/** Seat a point on the outermost skin along its own normal, as sockets are. */
function seat(
  volumes: readonly HullVolume[],
  position: Vec3,
  normal: Vec3,
): { position: Vec3; normal: Vec3 } | null {
  const unit = normalise(normal);
  const hit = raycastHull(volumes, add(position, scale(unit, REACH)), scale(unit, -1));
  return hit ? { position: hit.point, normal: hit.normal } : null;
}

/** The beam direction of a fixture, normalised. */
export function beamDirection(flood: Floodlight): Vec3 {
  return normalise([
    flood.aim[0] - flood.position[0],
    flood.aim[1] - flood.position[1],
    flood.aim[2] - flood.position[2],
  ]);
}

/**
 * How far the lamp itself stands off the plate, on its yoke.
 *
 * Load-bearing for the validator as well as the renderer: trace a beam from the
 * mount point and it starts *inside* the solid the fixture is bolted to, so the
 * ray exits through the far side and every aim looks valid. Trace it from the
 * lens and a fixture aimed at empty space is caught.
 */
export const FLOOD_STANDOFF = 0.3;

/** Where the lamp sits — clear of the plate, at the end of its yoke. */
export function lensPosition(flood: Floodlight): Vec3 {
  const beam = beamDirection(flood);
  return add(
    add(flood.position, scale(normalise(flood.normal), FLOOD_STANDOFF)),
    scale(beam, 0.08),
  );
}

/**
 * Every exterior light on a ship, seated on the hull that renders.
 *
 * A fixture whose mount ray misses the hull entirely is dropped rather than
 * left hanging in space — the failure the prototype shipped for five
 * archetypes. `exteriorLightIssues` turns that into a test failure so a mount
 * that has drifted off its plate is caught by `npm test`, not by squinting.
 */
export function exteriorLightRig(
  archetype: ArchetypeId,
  volumes: readonly HullVolume[],
  seed: number,
): ExteriorLightRig {
  const rng = streamFor(seed, 'exterior-lights');

  const intents: FloodIntent[] = [];
  for (const intent of FLOOD_MOUNTS[archetype]) {
    intents.push(intent.mirror ? { ...intent, id: `${intent.id}-s` } : intent);
    if (intent.mirror) {
      intents.push({
        ...intent,
        id: `${intent.id}-p`,
        at: mirrorX(intent.at),
        normal: mirrorX(intent.normal),
        aim: mirrorX(intent.aim),
      });
    }
  }

  const floods: Floodlight[] = [];
  for (const intent of intents) {
    const seated = seat(volumes, intent.at, intent.normal);
    if (!seated) continue;
    floods.push({
      id: intent.id,
      position: seated.position,
      normal: seated.normal,
      aim: intent.aim,
      // Work lights are cold white. Warm light is what comes out of a window;
      // keeping the two apart is most of what makes either read.
      colour: '#dceaff',
      intensity: intent.intensity,
      angle: intent.angle,
      range: intent.range,
      size: intent.size,
    });
  }

  /* --- Beacons, derived from the hull's own extremities --- */

  const { minZ, maxZ } = hullBounds(volumes);
  const span = maxZ - minZ;

  const casts: Array<{ role: BeaconRole; from: Vec3; direction: Vec3 }> = [
    // Slightly forward of amidships, where a hull is widest and the red and
    // green are furthest apart — which is the whole point of them.
    { role: 'port', from: [0, 0, minZ + span * 0.58], direction: [-1, 0.12, 0] },
    { role: 'starboard', from: [0, 0, minZ + span * 0.58], direction: [1, 0.12, 0] },
    { role: 'masthead', from: [0, 0, minZ + span * 0.68], direction: [0, 1, 0] },
    { role: 'bow', from: [0, 0, 0], direction: [0, 0, 1] },
    { role: 'stern', from: [0, 0, 0], direction: [0, 0, -1] },
  ];

  const beacons: NavigationBeacon[] = [];
  for (const cast of casts) {
    const seated = seat(volumes, cast.from, cast.direction);
    const phase = rng();
    if (!seated) continue;
    const spec = BEACON_SPEC[cast.role];
    beacons.push({
      id: `beacon-${cast.role}`,
      role: cast.role,
      // Stood a little proud so the lamp is not co-planar with the plate it is
      // bolted to, which z-fights.
      position: add(seated.position, scale(seated.normal, 0.03)),
      normal: seated.normal,
      colour: spec.colour,
      period: spec.period,
      phase,
      radius: spec.radius,
      casts: spec.casts,
    });
  }

  return { floods, beacons };
}

/* ------------------------------------------------------------------ */
/* Validation                                                          */
/* ------------------------------------------------------------------ */

/** Everything wrong with a rig, as prose. Empty means it is sound. */
export function exteriorLightIssues(
  rig: ExteriorLightRig,
  volumes: readonly HullVolume[],
  archetype: ArchetypeId,
): string[] {
  const problems: string[] = [];

  const expected = FLOOD_MOUNTS[archetype].reduce(
    (count, intent) => count + (intent.mirror ? 2 : 1),
    0,
  );
  if (rig.floods.length !== expected) {
    problems.push(
      `${archetype}: ${rig.floods.length} of ${expected} floodlights found plate to bolt to`,
    );
  }

  for (const flood of rig.floods) {
    // A fixture aimed at nothing is a fixture nobody will believe. The beam has
    // to leave the lens, clear the plate the fixture is bolted to, and land on
    // the ship inside its own range.
    const direction = beamDirection(flood);
    const hit = raycastHull(volumes, lensPosition(flood), direction);
    if (!hit) {
      problems.push(`${flood.id}: beam lands on nothing`);
    } else if (hit.distance > flood.range) {
      problems.push(
        `${flood.id}: beam reaches plate at ${hit.distance.toFixed(1)} but dies at ${flood.range}`,
      );
    } else if (hit.distance < 0.4) {
      problems.push(
        `${flood.id}: beam lands ${hit.distance.toFixed(2)} from the lens — it is jammed against what it lights`,
      );
    }
  }

  const roles = new Set(rig.beacons.map((beacon) => beacon.role));
  for (const role of Object.keys(BEACON_SPEC) as BeaconRole[]) {
    if (!roles.has(role)) problems.push(`${archetype}: no ${role} navigation light`);
  }

  const port = rig.beacons.find((beacon) => beacon.role === 'port');
  const starboard = rig.beacons.find((beacon) => beacon.role === 'starboard');
  if (port && starboard && port.position[0] >= starboard.position[0]) {
    problems.push('port and starboard navigation lights are on the wrong sides');
  }

  return problems;
}
