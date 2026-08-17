import type { ArchetypeId, Socket, SocketKind, Vec3 } from '../domain/types';
import type { HullVolume } from '../domain/hullForm';
import { resolveSockets } from '../domain/hullForm';

/**
 * Declared attachment points, per archetype.
 *
 * The prototype bolted protrusions on at hardcoded world coordinates tuned for
 * one hull, which is why radiators intersected the Brutalist hull and floated
 * free of the Outrigger booms. Every mounted part now resolves its transform
 * from a socket that belongs to the hull it is mounted on, so widening a hull
 * moves its hardware with it.
 *
 * Convention: +Z is forward (prow), -Z aft, +Y up, +X starboard.
 * `mirror: true` generates the matching port-side socket automatically — which
 * also removes the class of bug where a loop over [-x, +x] overwrote a ref and
 * left only one of the pair animated.
 *
 * WHAT A POSITION MEANS HERE. It is *intent*, not a final coordinate: which
 * structure the fitting belongs to and where along it, plus the direction it
 * faces. `socketsFor()` then casts a ray back down that normal against the
 * hull's real volumes (`domain/hullForm.ts`) and seats the socket on the skin
 * it hit. Hand-typed standoffs are what put engine bells two units aft of the
 * last plate and started every radiator frame in vacuum; a measured standoff
 * cannot drift, because the hull it is measured against is the hull that
 * renders.
 *
 * So these numbers only need to be roughly right in the two ways a ray cares
 * about: on the correct structure, and pointing outward from it.
 */

const SOCKETS_BY_ARCHETYPE: Record<ArchetypeId, readonly Socket[]> = {
  angular_stealth: [
    { id: 'eng', kind: 'engine', position: [1.15, 0, -8.4], normal: [0, 0, -1], up: [0, 1, 0], size: 'M', mirror: true },
    { id: 'rad', kind: 'radiator', position: [1.95, 0.4, -3.0], normal: [1, 0, 0], up: [0, 0, 1], size: 'M', mirror: true },
    // Onto the dorsal spine, not off its forward lip: the spine ends at z 2.6.
    { id: 'sen', kind: 'sensor', position: [0, 1.35, 1.6], normal: [0, 1, 0], up: [0, 0, 1], size: 'S' },
    { id: 'wpn', kind: 'weapon', position: [1.35, -0.45, 1.9], normal: [0, -1, 0], up: [0, 0, 1], size: 'S', mirror: true },
    { id: 'rcs-f', kind: 'rcs', position: [1.55, 0.5, 5.6], normal: [1, 0.3, 0], up: [0, 1, 0], size: 'S', mirror: true },
    // Was z -5.6, which is aft of the last plate; the body ends at -5.25.
    { id: 'rcs-a', kind: 'rcs', position: [1.55, 0.5, -4.6], normal: [1, 0.3, 0], up: [0, 1, 0], size: 'S', mirror: true },
    { id: 'ftl', kind: 'ftl', position: [0, 0, -1.2], normal: [0, 0, -1], up: [0, 1, 0], size: 'M' },
    { id: 'fuel', kind: 'fuel', position: [1.45, -0.7, -1.4], normal: [1, -0.4, 0], up: [0, 0, 1], size: 'M', mirror: true },
  ],

  industrial_expanse: [
    // On the nacelle's centreline, so the bell's footprint stays on the nacelle.
    { id: 'eng', kind: 'engine', position: [2.0, 0, -7.9], normal: [0, 0, -1], up: [0, 1, 0], size: 'L', mirror: true },
    // Radiators hang off the upper longerons — the only structure this far
    // outboard on a truss ship. Previously they started 1.95 units outboard of
    // it, bridging nothing.
    { id: 'rad', kind: 'radiator', position: [1.5, 1.5, -2.0], normal: [1, 0, 0], up: [0, 0, 1], size: 'L', mirror: true },
    { id: 'rad-2', kind: 'radiator', position: [1.5, 1.5, 1.4], normal: [1, 0, 0], up: [0, 0, 1], size: 'M', mirror: true },
    { id: 'sen', kind: 'sensor', position: [0, 2.15, 1.8], normal: [0, 1, 0], up: [0, 0, 1], size: 'M' },
    // On the forward module's roof; z 3.0 was off its leading face entirely.
    { id: 'wpn', kind: 'weapon', position: [1.0, 1.6, 5.0], normal: [0, 1, 0], up: [0, 0, 1], size: 'M', mirror: true },
    { id: 'rcs-f', kind: 'rcs', position: [2.4, 0.7, 5.2], normal: [1, 0.3, 0], up: [0, 1, 0], size: 'S', mirror: true },
    { id: 'rcs-a', kind: 'rcs', position: [2.4, 0.3, -4.8], normal: [1, 0.3, 0], up: [0, 1, 0], size: 'S', mirror: true },
    { id: 'ftl', kind: 'ftl', position: [0, 0, -2.2], normal: [0, 0, -1], up: [0, 1, 0], size: 'L' },
    // Slung alongside the cargo pods rather than floating outboard of them.
    { id: 'fuel', kind: 'fuel', position: [1.25, -1.55, 0], normal: [1, 0, 0], up: [0, 0, 1], size: 'L', mirror: true },
  ],

  // The wide one. Its radiators sit further outboard than any other archetype
  // precisely because the hull is wider — the bug the socket table exists to fix.
  brutalist_dreadnought: [
    // All three bells on one station, so the bank is flush. They were staggered
    // 0.4 apart, which buried them to three different depths.
    { id: 'eng-c', kind: 'engine', position: [0, 0, -9.1], normal: [0, 0, -1], up: [0, 1, 0], size: 'L' },
    { id: 'eng', kind: 'engine', position: [2.2, 0, -9.1], normal: [0, 0, -1], up: [0, 1, 0], size: 'L', mirror: true },
    { id: 'rad', kind: 'radiator', position: [4.15, 0.95, -3.4], normal: [1, 0, 0], up: [0, 0, 1], size: 'L', mirror: true },
    // On the command tower's roof, where a mast belongs, rather than hanging off
    // its forward edge above the spinal trench.
    { id: 'sen', kind: 'sensor', position: [0, 3.6, -1.2], normal: [0, 1, 0], up: [0, 0, 1], size: 'M' },
    // Inboard from x 2.35, so all of the 0.7-radius base lands on the citadel
    // deck (which ends at x 2.3) instead of 54% of it hanging over the gunwale.
    { id: 'wpn-f', kind: 'weapon', position: [1.5, 1.3, 3.1], normal: [0, 1, 0], up: [0, 0, 1], size: 'L', mirror: true },
    { id: 'wpn-a', kind: 'weapon', position: [1.5, 1.3, -3.6], normal: [0, 1, 0], up: [0, 0, 1], size: 'L', mirror: true },
    // y 0.9 met the prow's top edge, so the quad sat on a corner. 0.4 is plate.
    { id: 'rcs-f', kind: 'rcs', position: [2.9, 0.4, 5.4], normal: [1, 0.3, 0], up: [0, 1, 0], size: 'M', mirror: true },
    { id: 'rcs-a', kind: 'rcs', position: [2.9, 0.4, -5.4], normal: [1, 0.3, 0], up: [0, 1, 0], size: 'M', mirror: true },
    { id: 'ftl', kind: 'ftl', position: [0, 0, -3.0], normal: [0, 0, -1], up: [0, 1, 0], size: 'L' },
    { id: 'fuel', kind: 'fuel', position: [2.95, -1.15, -0.8], normal: [1, -0.3, 0], up: [0, 0, 1], size: 'L', mirror: true },
  ],

  // Hardware rides the booms, not the centre hull.
  outrigger_science: [
    { id: 'eng', kind: 'engine', position: [4.3, 0, -6.4], normal: [0, 0, -1], up: [0, 1, 0], size: 'M', mirror: true },
    // On the boom's flank. It used to sit 0.39 above the boom's crown and
    // project sideways out of mid-air.
    { id: 'rad', kind: 'radiator', position: [4.3, 0, -1.9], normal: [1, 0, 0], up: [0, 0, 1], size: 'M', mirror: true },
    { id: 'sen', kind: 'sensor', position: [0, 2.5, 3.6], normal: [0, 1, 0], up: [0, 0, 1], size: 'L' },
    { id: 'sen-2', kind: 'sensor', position: [0, 1.9, -3.2], normal: [0, 1, 0], up: [0, 0, 1], size: 'S' },
    { id: 'wpn', kind: 'weapon', position: [0, -0.95, 3.4], normal: [0, -1, 0], up: [0, 0, 1], size: 'S' },
    // Normal points off the boom's flank rather than down its axis, so the
    // thruster cones clear the spar instead of firing through it.
    { id: 'rcs-f', kind: 'rcs', position: [4.3, 0, 1.2], normal: [1, 0, 0], up: [0, 1, 0], size: 'S', mirror: true },
    // z -5.0 was past the fuselage's tail cap altogether.
    { id: 'rcs-a', kind: 'rcs', position: [1.0, 0.4, -4.2], normal: [1, 0.3, 0], up: [0, 1, 0], size: 'S', mirror: true },
    { id: 'ftl', kind: 'ftl', position: [0, 0, -1.0], normal: [0, 0, -1], up: [0, 1, 0], size: 'M' },
    { id: 'fuel', kind: 'fuel', position: [1.5, -0.75, -2.2], normal: [1, -0.4, 0], up: [0, 0, 1], size: 'M', mirror: true },
  ],

  aerodynamic_sleek: [
    // One centreline drive. The lathe's tail cap is 1.44 across, which will not
    // carry a mirrored pair without the bells overlapping each other.
    { id: 'eng', kind: 'engine', position: [0, 0, -7.4], normal: [0, 0, -1], up: [0, 1, 0], size: 'M' },
    // Aft of the wing root, where there is bare fuselage to bolt to.
    { id: 'rad', kind: 'radiator', position: [1.5, 0.2, -5.6], normal: [1, 0, 0], up: [0, 0, 1], size: 'S', mirror: true },
    { id: 'sen', kind: 'sensor', position: [0, 1.05, 2.4], normal: [0, 1, 0], up: [0, 0, 1], size: 'S' },
    // x 1.55 was wider than the hull at this station, so the ray missed entirely.
    { id: 'wpn', kind: 'weapon', position: [1.05, -0.35, 1.0], normal: [0, -1, 0], up: [0, 0, 1], size: 'S', mirror: true },
    { id: 'rcs-f', kind: 'rcs', position: [1.5, 0.35, 4.6], normal: [1, 0.3, 0], up: [0, 1, 0], size: 'S', mirror: true },
    { id: 'rcs-a', kind: 'rcs', position: [1.5, 0.35, -4.6], normal: [1, 0.3, 0], up: [0, 1, 0], size: 'S', mirror: true },
    { id: 'ftl', kind: 'ftl', position: [0, 0, -1.5], normal: [0, 0, -1], up: [0, 1, 0], size: 'M' },
    { id: 'fuel', kind: 'fuel', position: [1.15, -0.55, -1.0], normal: [1, -0.4, 0], up: [0, 0, 1], size: 'S', mirror: true },
  ],
};

const mirrorX = (v: Vec3): Vec3 => [-v[0], v[1], v[2]];

/** Expand `mirror: true` declarations into explicit port/starboard pairs. */
export function expandSockets(sockets: readonly Socket[]): Socket[] {
  const out: Socket[] = [];
  for (const socket of sockets) {
    out.push({ ...socket, id: socket.mirror ? `${socket.id}-s` : socket.id });
    if (socket.mirror) {
      out.push({
        ...socket,
        id: `${socket.id}-p`,
        position: mirrorX(socket.position),
        normal: mirrorX(socket.normal),
      });
    }
  }
  return out;
}

/**
 * Every socket on an archetype, mirrors expanded and — when the hull's volumes
 * are supplied — seated on the measured skin.
 *
 * The volumes are a parameter rather than something this module derives so the
 * aerodynamic archetype's sculpted profile flows through: change a control
 * point in the Hull Sculptor and the hardware follows the new surface.
 */
export function socketsFor(archetype: ArchetypeId, volumes?: readonly HullVolume[]): Socket[] {
  const expanded = expandSockets(SOCKETS_BY_ARCHETYPE[archetype]);
  return volumes ? resolveSockets(expanded, volumes) : expanded;
}

export function socketsOfKind(archetype: ArchetypeId, kind: SocketKind): Socket[] {
  return socketsFor(archetype).filter((s) => s.kind === kind);
}

export { SOCKETS_BY_ARCHETYPE };
