import type { ArchetypeId, Socket, SocketKind, Vec3 } from '../domain/types';

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
 */

const SOCKETS_BY_ARCHETYPE: Record<ArchetypeId, readonly Socket[]> = {
  angular_stealth: [
    { id: 'eng', kind: 'engine', position: [1.15, 0, -8.4], normal: [0, 0, -1], up: [0, 1, 0], size: 'M', mirror: true },
    { id: 'rad', kind: 'radiator', position: [1.95, 0.35, -3.0], normal: [1, 0, 0], up: [0, 1, 0], size: 'M', mirror: true },
    { id: 'sen', kind: 'sensor', position: [0, 1.35, 2.6], normal: [0, 1, 0], up: [0, 0, 1], size: 'S' },
    { id: 'wpn', kind: 'weapon', position: [1.35, -0.45, 1.9], normal: [0, -1, 0], up: [0, 0, 1], size: 'S', mirror: true },
    { id: 'rcs-f', kind: 'rcs', position: [1.55, 0.5, 5.6], normal: [1, 0.3, 0], up: [0, 1, 0], size: 'S', mirror: true },
    { id: 'rcs-a', kind: 'rcs', position: [1.55, 0.5, -5.6], normal: [1, 0.3, 0], up: [0, 1, 0], size: 'S', mirror: true },
    { id: 'ftl', kind: 'ftl', position: [0, 0, -1.2], normal: [0, 0, -1], up: [0, 1, 0], size: 'M' },
    { id: 'fuel', kind: 'fuel', position: [1.45, -0.7, -1.4], normal: [1, -0.4, 0], up: [0, 1, 0], size: 'M', mirror: true },
  ],

  industrial_expanse: [
    { id: 'eng', kind: 'engine', position: [3.15, 0, -7.9], normal: [0, 0, -1], up: [0, 1, 0], size: 'L', mirror: true },
    { id: 'rad', kind: 'radiator', position: [3.55, 1.15, -2.0], normal: [1, 0.2, 0], up: [0, 1, 0], size: 'L', mirror: true },
    { id: 'rad-2', kind: 'radiator', position: [3.55, 1.15, 1.4], normal: [1, 0.2, 0], up: [0, 1, 0], size: 'M', mirror: true },
    { id: 'sen', kind: 'sensor', position: [0, 2.15, 1.8], normal: [0, 1, 0], up: [0, 0, 1], size: 'M' },
    { id: 'wpn', kind: 'weapon', position: [2.1, 0.95, 3.0], normal: [0, 1, 0], up: [0, 0, 1], size: 'M', mirror: true },
    { id: 'rcs-f', kind: 'rcs', position: [2.4, 0.7, 5.2], normal: [1, 0.3, 0], up: [0, 1, 0], size: 'S', mirror: true },
    { id: 'rcs-a', kind: 'rcs', position: [2.4, 0.7, -4.8], normal: [1, 0.3, 0], up: [0, 1, 0], size: 'S', mirror: true },
    { id: 'ftl', kind: 'ftl', position: [0, 0, -2.2], normal: [0, 0, -1], up: [0, 1, 0], size: 'L' },
    { id: 'fuel', kind: 'fuel', position: [2.55, -0.95, 0], normal: [1, -0.3, 0], up: [0, 1, 0], size: 'L', mirror: true },
  ],

  // The wide one. Its radiators sit further outboard than any other archetype
  // precisely because the hull is wider — the bug the socket table exists to fix.
  brutalist_dreadnought: [
    { id: 'eng-c', kind: 'engine', position: [0, 0, -9.1], normal: [0, 0, -1], up: [0, 1, 0], size: 'L' },
    { id: 'eng', kind: 'engine', position: [2.55, 0, -8.7], normal: [0, 0, -1], up: [0, 1, 0], size: 'L', mirror: true },
    { id: 'rad', kind: 'radiator', position: [4.15, 0.75, -3.4], normal: [1, 0.15, 0], up: [0, 1, 0], size: 'L', mirror: true },
    { id: 'sen', kind: 'sensor', position: [0, 2.85, 0.8], normal: [0, 1, 0], up: [0, 0, 1], size: 'M' },
    { id: 'wpn-f', kind: 'weapon', position: [2.35, 1.3, 3.1], normal: [0, 1, 0], up: [0, 0, 1], size: 'L', mirror: true },
    { id: 'wpn-a', kind: 'weapon', position: [2.35, 1.3, -2.6], normal: [0, 1, 0], up: [0, 0, 1], size: 'L', mirror: true },
    { id: 'rcs-f', kind: 'rcs', position: [2.9, 0.9, 5.4], normal: [1, 0.3, 0], up: [0, 1, 0], size: 'M', mirror: true },
    { id: 'rcs-a', kind: 'rcs', position: [2.9, 0.9, -5.4], normal: [1, 0.3, 0], up: [0, 1, 0], size: 'M', mirror: true },
    { id: 'ftl', kind: 'ftl', position: [0, 0, -3.0], normal: [0, 0, -1], up: [0, 1, 0], size: 'L' },
    { id: 'fuel', kind: 'fuel', position: [2.95, -1.15, -0.8], normal: [1, -0.3, 0], up: [0, 1, 0], size: 'L', mirror: true },
  ],

  // Hardware rides the booms, not the centre hull.
  outrigger_science: [
    { id: 'eng', kind: 'engine', position: [4.3, 0, -6.4], normal: [0, 0, -1], up: [0, 1, 0], size: 'M', mirror: true },
    { id: 'rad', kind: 'radiator', position: [4.3, 0.95, -1.9], normal: [1, 0.2, 0], up: [0, 1, 0], size: 'M', mirror: true },
    { id: 'sen', kind: 'sensor', position: [0, 2.5, 3.6], normal: [0, 1, 0], up: [0, 0, 1], size: 'L' },
    { id: 'sen-2', kind: 'sensor', position: [0, 1.9, -3.2], normal: [0, 1, 0], up: [0, 0, 1], size: 'S' },
    { id: 'wpn', kind: 'weapon', position: [0, -0.95, 3.4], normal: [0, -1, 0], up: [0, 0, 1], size: 'S' },
    { id: 'rcs-f', kind: 'rcs', position: [4.3, 0.5, 1.2], normal: [1, 0.3, 0], up: [0, 1, 0], size: 'S', mirror: true },
    { id: 'rcs-a', kind: 'rcs', position: [1.3, 0.6, -5.0], normal: [1, 0.3, 0], up: [0, 1, 0], size: 'S', mirror: true },
    { id: 'ftl', kind: 'ftl', position: [0, 0, -1.0], normal: [0, 0, -1], up: [0, 1, 0], size: 'M' },
    { id: 'fuel', kind: 'fuel', position: [1.5, -0.75, -2.2], normal: [1, -0.4, 0], up: [0, 1, 0], size: 'M', mirror: true },
  ],

  aerodynamic_sleek: [
    { id: 'eng', kind: 'engine', position: [0.95, 0, -7.4], normal: [0, 0, -1], up: [0, 1, 0], size: 'M', mirror: true },
    { id: 'rad', kind: 'radiator', position: [1.85, 0.2, -2.5], normal: [1, 0.1, 0], up: [0, 1, 0], size: 'S', mirror: true },
    { id: 'sen', kind: 'sensor', position: [0, 1.05, 2.4], normal: [0, 1, 0], up: [0, 0, 1], size: 'S' },
    { id: 'wpn', kind: 'weapon', position: [1.55, -0.35, 1.0], normal: [0, -1, 0], up: [0, 0, 1], size: 'S', mirror: true },
    { id: 'rcs-f', kind: 'rcs', position: [1.5, 0.35, 4.6], normal: [1, 0.3, 0], up: [0, 1, 0], size: 'S', mirror: true },
    { id: 'rcs-a', kind: 'rcs', position: [1.5, 0.35, -4.6], normal: [1, 0.3, 0], up: [0, 1, 0], size: 'S', mirror: true },
    { id: 'ftl', kind: 'ftl', position: [0, 0, -1.5], normal: [0, 0, -1], up: [0, 1, 0], size: 'M' },
    { id: 'fuel', kind: 'fuel', position: [1.15, -0.55, -1.0], normal: [1, -0.4, 0], up: [0, 1, 0], size: 'S', mirror: true },
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

/** Every socket on an archetype, mirrors already expanded. */
export function socketsFor(archetype: ArchetypeId): Socket[] {
  return expandSockets(SOCKETS_BY_ARCHETYPE[archetype]);
}

export function socketsOfKind(archetype: ArchetypeId, kind: SocketKind): Socket[] {
  return socketsFor(archetype).filter((s) => s.kind === kind);
}

export { SOCKETS_BY_ARCHETYPE };
