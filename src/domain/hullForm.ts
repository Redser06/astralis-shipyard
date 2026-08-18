import type { ArchetypeId, Socket, Vec3 } from './types';
import { DEFAULT_HULL_PROFILE, sampleProfile, type ProfilePoint } from './profile';
import { streamFor } from './rng';

/**
 * The hull as solid volumes — and the ray caster that snaps hardware onto them.
 *
 * WHY THIS EXISTS. Until now the hull lived only as JSX inside
 * `render/hulls/Hulls.tsx` and the socket table lived as hand-typed world
 * coordinates in `render/sockets.ts`, with nothing tying the two together. They
 * drifted, comprehensively: engine bells hung two units aft of the last plate,
 * radiator frames began in vacuum on all five archetypes, and the Outrigger's
 * headline sensor mast started 1.55 units above a fuselage 1.9 across. The
 * numbers could not be checked because there was nothing to check them against.
 *
 * So the shape of a hull is declared here, once, as data. `Hulls.tsx` renders
 * from this table and the socket resolver ray-casts against it, which means the
 * two cannot disagree by construction — move a plate and its hardware moves
 * with it.
 *
 * WHY ANALYTIC RAYS RATHER THAN three-mesh-bvh. drei ships a BVH and we could
 * have raycast the real meshes at mount time. Three reasons not to:
 *   1. `src/domain` must never import `three`, and this is exactly the logic
 *      that benefits most from being unit-testable without a GPU — a socket
 *      landing in vacuum is a numeric fact, not something to eyeball.
 *   2. Mount-time mesh raycasting needs the hull refs to exist before the
 *      hardware mounts, which in R3F means an effect, a second commit, and one
 *      frame with every part in the wrong place.
 *   3. These are a dozen convex primitives per hull. A closed-form intersection
 *      is both exact and cheaper than building an acceleration structure.
 *
 * Everything here is pure: no three, no DOM, no randomness that is not seeded.
 */

export type Axis = 'x' | 'y' | 'z';

interface SolidCommon {
  /**
   * Rendered, but invisible to the ray caster. Thin decorative work — truss
   * rings, cross-struts, the habitat hoop — that nothing should ever bolt to.
   * Snapping a radiator to a 0.09-radius tube would be worse than not snapping.
   */
  decorative?: boolean;
}

export interface BoxSolid extends SolidCommon {
  kind: 'box';
  size: Vec3;
  position: Vec3;
  /** Euler XYZ, three's default order. */
  rotation?: Vec3;
}

export interface SphereSolid extends SolidCommon {
  kind: 'sphere';
  radius: number;
  position: Vec3;
  segments?: readonly [number, number];
}

export interface CapsuleSolid extends SolidCommon {
  kind: 'capsule';
  /** Length of the cylindrical section, excluding the two hemispherical caps. */
  length: number;
  radius: number;
  position: Vec3;
  axis: Axis;
  segments?: readonly [number, number];
}

export interface FrustumSolid extends SolidCommon {
  kind: 'frustum';
  /** Radius at the -axis end. */
  radiusStart: number;
  /** Radius at the +axis end. */
  radiusEnd: number;
  height: number;
  /** Radial segments. Under 12 this is a faceted prism, not a cone. */
  sides: number;
  position: Vec3;
  axis: Axis;
  /** Extra roll about the solid's own axis. Only meaningful when faceted. */
  twist?: number;
}

export interface RingSolid extends SolidCommon {
  kind: 'ring';
  radius: number;
  tube: number;
  position: Vec3;
  rotation?: Vec3;
  radialSegments: number;
  tubularSegments: number;
  /** Rings are always decorative — see `SolidCommon.decorative`. */
  decorative: true;
}

export interface LatheSolid extends SolidCommon {
  kind: 'lathe';
  /** The revolved profile always runs along the ship's z axis, nose at +z. */
  axis: 'z';
  segments: number;
}

export type Solid =
  | BoxSolid
  | SphereSolid
  | CapsuleSolid
  | FrustumSolid
  | RingSolid
  | LatheSolid;

/* ------------------------------------------------------------------ */
/* The five hulls                                                      */
/* ------------------------------------------------------------------ */

const stealthChine = 0.42;
const INDUSTRIAL_TRUSS_SEGMENTS = 7;
const INDUSTRIAL_TRUSS_SPAN = 8.4;

export const HULL_SOLIDS: Record<ArchetypeId, readonly Solid[]> = {
  angular_stealth: [
    // Main faceted body
    { kind: 'box', size: [2.6, 1.0, 10.5], position: [0, 0, 0] },
    // Razor chines — angled plates down each flank
    ...[-1, 1].map(
      (side): BoxSolid => ({
        kind: 'box',
        size: [1.2, 0.36, 10.2],
        position: [side * 1.45, -0.1, 0],
        rotation: [0, 0, side * stealthChine],
      }),
    ),
    // Faceted prow — a four-sided pyramid, so the facets deflect radar
    {
      kind: 'frustum',
      radiusStart: 1.42,
      radiusEnd: 0,
      height: 5.2,
      sides: 4,
      twist: Math.PI / 4,
      position: [0, 0, 7.4],
      axis: 'z',
    },
    // Dorsal spine
    { kind: 'box', size: [1.1, 0.5, 6.4], position: [0, 0.72, -0.6] },
    // Canted tail fins
    ...[-1, 1].map(
      (side): BoxSolid => ({
        kind: 'box',
        size: [0.18, 1.9, 2.6],
        position: [side * 1.1, 0.9, -4.4],
        rotation: [0, 0, side * 0.55],
      }),
    ),
  ],

  industrial_expanse: [
    // Forward habitat / bridge module
    { kind: 'box', size: [3.4, 2.3, 4.2], position: [0, 0.35, 5.4] },
    // Spine
    { kind: 'box', size: [1.5, 1.5, 9.2], position: [0, 0, -0.6] },
    // Truss ribs — the visual signature of a ship built for vacuum only
    ...Array.from({ length: INDUSTRIAL_TRUSS_SEGMENTS }, (_, i): RingSolid => {
      const z = 3.4 - (i / (INDUSTRIAL_TRUSS_SEGMENTS - 1)) * INDUSTRIAL_TRUSS_SPAN;
      return {
        kind: 'ring',
        radius: 1.55,
        tube: 0.09,
        radialSegments: 6,
        tubularSegments: 4,
        position: [0, 0, z],
        rotation: [0, 0, Math.PI / 4],
        decorative: true,
      };
    }),
    // Longerons tying the ribs together. These carry the radiators, so unlike
    // the ribs they are solid to the ray caster.
    ...[
      [1.5, 1.5],
      [-1.5, 1.5],
      [1.5, -1.5],
      [-1.5, -1.5],
    ].map(
      ([x, y]): BoxSolid => ({
        kind: 'box',
        size: [0.16, 0.16, 9.0],
        position: [x as number, y as number, -0.6],
      }),
    ),
    // Segmented cargo pods slung under the spine
    ...[-2.4, 0, 2.4].map(
      (z): BoxSolid => ({
        kind: 'box',
        size: [2.5, 1.3, 2.0],
        position: [0, -1.55, z],
      }),
    ),
    // Outboard engine nacelles. Taller than they were: they now have to look
    // like they could contain the drive that is bolted to their aft face.
    ...[-1, 1].map(
      (side): BoxSolid => ({
        kind: 'box',
        size: [2.4, 1.8, 1.6],
        position: [side * 2.0, 0, -6.4],
      }),
    ),
  ],

  brutalist_dreadnought: [
    // Hammerhead armoured prow — the widest point on any archetype
    { kind: 'box', size: [6.6, 2.0, 4.0], position: [0, 0, 6.2] },
    {
      kind: 'frustum',
      radiusStart: 2.6,
      radiusEnd: 1.4,
      height: 2.2,
      sides: 6,
      position: [0, 0, 8.4],
      axis: 'z',
    },
    // Main citadel body
    { kind: 'box', size: [4.6, 2.4, 12.0], position: [0, 0, -0.5] },
    // Elevated command tower
    { kind: 'box', size: [2.2, 1.7, 3.4], position: [0, 2.0, -1.2] },
    { kind: 'box', size: [1.4, 0.6, 2.2], position: [0, 3.0, -1.2] },
    // Flanking armour skirts
    ...[-1, 1].map(
      (side): BoxSolid => ({
        kind: 'box',
        size: [1.1, 1.7, 10.0],
        position: [side * 2.75, -0.5, -1.0],
        rotation: [0, 0, side * 0.18],
      }),
    ),
    // Spinal mass-driver trench
    { kind: 'box', size: [0.9, 0.45, 8.0], position: [0, 1.3, 2.4] },
    // Aft engine block. Widened from 5.2 so a three-bell bank of tier-3 torches
    // actually fits inside its footprint instead of overhanging it.
    { kind: 'box', size: [6.8, 2.6, 2.6], position: [0, 0, -7.4] },
  ],

  outrigger_science: [
    // Slim central fuselage
    { kind: 'capsule', radius: 0.95, length: 8.0, position: [0, 0, 0], axis: 'z', segments: [4, 12] },
    // Forward instrument bulb
    { kind: 'sphere', radius: 1.15, position: [0, 0, 5.4], segments: [20, 14] },
    // Twin outrigger booms
    ...[-1, 1].map(
      (side): CapsuleSolid => ({
        kind: 'capsule',
        radius: 0.52,
        length: 7.4,
        position: [side * 4.3, 0, -1.4],
        axis: 'z',
        segments: [4, 10],
      }),
    ),
    // Cross struts tying the booms to the fuselage
    ...[2.6, -0.4, -3.4].flatMap((z) =>
      [-1, 1].map(
        (side): FrustumSolid => ({
          kind: 'frustum',
          radiusStart: 0.16,
          radiusEnd: 0.16,
          height: 4.3,
          sides: 8,
          position: [side * 2.15, 0, z],
          axis: 'x',
          decorative: true,
        }),
      ),
    ),
    // Habitat ring amidships
    {
      kind: 'ring',
      radius: 1.85,
      tube: 0.34,
      radialSegments: 10,
      tubularSegments: 28,
      position: [0, 0, -1.0],
      rotation: [Math.PI / 2, 0, 0],
      decorative: true,
    },
  ],

  aerodynamic_sleek: [
    // The revolved airframe. Its orientation is derived, not hand-typed — see
    // `axisRotation`, and R1-01 in the review, where a hand-typed -90° put the
    // needle nose in the engine bay.
    { kind: 'lathe', axis: 'z', segments: 40 },
    // Swept delta wings
    ...[-1, 1].map(
      (side): BoxSolid => ({
        kind: 'box',
        size: [3.4, 0.16, 3.8],
        position: [side * 2.1, -0.15, -2.2],
        rotation: [0, side * -0.32, side * 0.08],
      }),
    ),
    // Vertical stabiliser
    { kind: 'box', size: [0.14, 1.9, 2.4], position: [0, 1.15, -5.2] },
    // Canopy blister
    { kind: 'sphere', radius: 0.62, position: [0, 0.78, 3.4], segments: [18, 12] },
  ],
};

/**
 * Mesh rotation that swings a solid authored about +Y onto its declared axis.
 *
 * Derived rather than hand-written, because hand-writing it is precisely how
 * the aerodynamic hull ended up revolved back-to-front: `Rx(-90°)` maps +Y to
 * world -Z, so a profile documented "nose at +z" rendered its nose at the
 * stern. `Rx(+90°)` maps +Y to +Z, which is what every convention in this
 * codebase asks for.
 */
export function axisRotation(axis: Axis, twist = 0): Vec3 {
  switch (axis) {
    case 'y':
      return [0, twist, 0];
    case 'z':
      return [Math.PI / 2, twist, 0];
    case 'x':
      // Euler XYZ applies Rz first, so a twist here would not be about the
      // solid's own axis. Nothing on the x axis is faceted, so nothing needs one.
      return [0, 0, -Math.PI / 2];
  }
}

/* ------------------------------------------------------------------ */
/* Small vector helpers — kept local so domain stays free of three      */
/* ------------------------------------------------------------------ */

const add = (a: Vec3, b: Vec3): Vec3 => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const sub = (a: Vec3, b: Vec3): Vec3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const scale = (a: Vec3, k: number): Vec3 => [a[0] * k, a[1] * k, a[2] * k];
const dot = (a: Vec3, b: Vec3): number => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const length = (a: Vec3): number => Math.sqrt(dot(a, a));

export function normalise(a: Vec3): Vec3 {
  const l = length(a);
  return l < 1e-9 ? [0, 1, 0] : [a[0] / l, a[1] / l, a[2] / l];
}

/** Euler XYZ to a 3x3 matrix, matching three's default `Rx · Ry · Rz`. */
function rotationMatrix(e: Vec3): number[] {
  const [x, y, z] = e;
  const cx = Math.cos(x);
  const sx = Math.sin(x);
  const cy = Math.cos(y);
  const sy = Math.sin(y);
  const cz = Math.cos(z);
  const sz = Math.sin(z);
  // Row-major.
  return [
    cy * cz,
    -cy * sz,
    sy,
    sx * sy * cz + cx * sz,
    -sx * sy * sz + cx * cz,
    -sx * cy,
    -cx * sy * cz + sx * sz,
    cx * sy * sz + sx * cz,
    cx * cy,
  ];
}

const applyMatrix = (m: number[], v: Vec3): Vec3 => [
  m[0] * v[0] + m[1] * v[1] + m[2] * v[2],
  m[3] * v[0] + m[4] * v[1] + m[5] * v[2],
  m[6] * v[0] + m[7] * v[1] + m[8] * v[2],
];

/** Transpose == inverse, for a rotation. */
const applyMatrixT = (m: number[], v: Vec3): Vec3 => [
  m[0] * v[0] + m[3] * v[1] + m[6] * v[2],
  m[1] * v[0] + m[4] * v[1] + m[7] * v[2],
  m[2] * v[0] + m[5] * v[1] + m[8] * v[2],
];

/**
 * Swizzle so the solid's axis becomes local +Y, and back again.
 *
 * The x case is a reflection rather than a rotation, which is harmless here:
 * every solid we swizzle is rotationally symmetric about its own axis, and the
 * map is its own inverse, so normals come back in the right frame.
 */
const toAxisFrame = (v: Vec3, axis: Axis): Vec3 =>
  axis === 'y' ? v : axis === 'z' ? [v[0], v[2], -v[1]] : [v[1], v[0], v[2]];

const fromAxisFrame = (v: Vec3, axis: Axis): Vec3 =>
  axis === 'y' ? v : axis === 'z' ? [v[0], -v[2], v[1]] : [v[1], v[0], v[2]];

/* ------------------------------------------------------------------ */
/* Ray casting                                                         */
/* ------------------------------------------------------------------ */

export interface SurfaceHit {
  /** Distance along the ray direction, which is assumed to be a unit vector. */
  distance: number;
  point: Vec3;
  /** Outward surface normal at the hit. */
  normal: Vec3;
}

const EPS = 1e-6;

/**
 * Collision form of a hull: decoration dropped, the lathe expanded into the
 * stack of conical frusta its dense profile polyline actually describes.
 */
export type HullVolume = Exclude<Solid, LatheSolid | RingSolid>;

export function hullVolumes(
  archetype: ArchetypeId,
  profile: readonly ProfilePoint[] = DEFAULT_HULL_PROFILE,
): HullVolume[] {
  const out: HullVolume[] = [];
  for (const solid of HULL_SOLIDS[archetype]) {
    if (solid.decorative) continue;
    if (solid.kind === 'lathe') {
      const sampled = sampleProfile(profile, 10);
      for (let i = 0; i < sampled.length - 1; i++) {
        const a = sampled[i] as ProfilePoint;
        const b = sampled[i + 1] as ProfilePoint;
        const height = Math.abs(b.z - a.z);
        if (height < EPS) continue;
        const lower = a.z < b.z ? a : b;
        const upper = a.z < b.z ? b : a;
        out.push({
          kind: 'frustum',
          radiusStart: lower.r,
          radiusEnd: upper.r,
          height,
          sides: 40,
          position: [0, 0, (a.z + b.z) / 2],
          axis: 'z',
        });
      }
      continue;
    }
    // Rings declare `decorative: true` in their type, so they are already gone.
    out.push(solid);
  }
  return out;
}

/**
 * Faceted solids are treated as their inscribed cylinder. A part then seats a
 * hair into the facet rather than floating a hair off it, which is the failure
 * you cannot see. For the four-sided stealth prow this is not an approximation
 * at all: a square rotated 45° has its faces exactly `r·cos(π/4)` from the axis.
 */
const inscribed = (radius: number, sides: number): number =>
  sides >= 12 ? radius : radius * Math.cos(Math.PI / sides);

function intersectBox(solid: BoxSolid, origin: Vec3, direction: Vec3): SurfaceHit | null {
  const matrix = solid.rotation ? rotationMatrix(solid.rotation) : null;
  const local = sub(origin, solid.position);
  const o = matrix ? applyMatrixT(matrix, local) : local;
  const d = matrix ? applyMatrixT(matrix, direction) : direction;
  const half: Vec3 = [solid.size[0] / 2, solid.size[1] / 2, solid.size[2] / 2];

  let tMin = -Infinity;
  let tMax = Infinity;
  let axis = 0;
  let sign = 1;

  for (let i = 0; i < 3; i++) {
    const oi = o[i] as number;
    const di = d[i] as number;
    const h = half[i] as number;
    if (Math.abs(di) < EPS) {
      if (Math.abs(oi) > h) return null;
      continue;
    }
    let t1 = (-h - oi) / di;
    let t2 = (h - oi) / di;
    // The face a ray ENTERS through always opposes the ray, so its outward
    // normal is simply -sign(di) — which is what this already is before the
    // swap. Negating it again with the swap (as this did) returned a negative
    // normal for every box face on every archetype: `resolveSocket` hid it,
    // because a disagreeing normal falls back to the authored one, but anything
    // that trusts the measured normal got the inward face. Windows on the
    // starboard side of a box hull were rejected outright as back-facing, and
    // floodlights seated on a dorsal plate came back aimed into it.
    const faceSign = di > 0 ? -1 : 1;
    if (t1 > t2) {
      const swap = t1;
      t1 = t2;
      t2 = swap;
    }
    if (t1 > tMin) {
      tMin = t1;
      axis = i;
      sign = faceSign;
    }
    if (t2 < tMax) tMax = t2;
    if (tMin > tMax) return null;
  }

  const t = tMin > EPS ? tMin : tMax;
  if (t < EPS) return null;

  const nLocal: Vec3 =
    axis === 0 ? [sign, 0, 0] : axis === 1 ? [0, sign, 0] : [0, 0, sign];
  const normal = matrix ? applyMatrix(matrix, nLocal) : nLocal;
  return { distance: t, point: add(origin, scale(direction, t)), normal: normalise(normal) };
}

function intersectSphere(
  centre: Vec3,
  radius: number,
  origin: Vec3,
  direction: Vec3,
): SurfaceHit | null {
  const oc = sub(origin, centre);
  const b = dot(oc, direction);
  const c = dot(oc, oc) - radius * radius;
  const disc = b * b - c;
  if (disc < 0) return null;
  const root = Math.sqrt(disc);
  const t = -b - root > EPS ? -b - root : -b + root;
  if (t < EPS) return null;
  const point = add(origin, scale(direction, t));
  return { distance: t, point, normal: normalise(sub(point, centre)) };
}

interface LocalHit {
  t: number;
  normal: Vec3;
}

/** Nearest candidate ahead of the ray origin. */
function nearest(candidates: readonly LocalHit[]): LocalHit | null {
  let best: LocalHit | null = null;
  for (const candidate of candidates) {
    if (candidate.t > EPS && (best === null || candidate.t < best.t)) best = candidate;
  }
  return best;
}

/** The frustum's side wall and end caps, in a frame where its axis is +Y. */
function intersectFrustumLocal(
  o: Vec3,
  d: Vec3,
  radiusStart: number,
  radiusEnd: number,
  height: number,
): LocalHit | null {
  const half = height / 2;
  const k = (radiusEnd - radiusStart) / height;
  const candidates: LocalHit[] = [];

  // Side wall: x² + z² = r(y)², r(y) = radiusStart + (y + half)·k
  const A = radiusStart + (o[1] + half) * k;
  const B = d[1] * k;
  const a = d[0] * d[0] + d[2] * d[2] - B * B;
  const b = 2 * (o[0] * d[0] + o[2] * d[2] - A * B);
  const c = o[0] * o[0] + o[2] * o[2] - A * A;

  const sideRoots: number[] = [];
  if (Math.abs(a) < EPS) {
    if (Math.abs(b) > EPS) sideRoots.push(-c / b);
  } else {
    const disc = b * b - 4 * a * c;
    if (disc >= 0) {
      const root = Math.sqrt(disc);
      sideRoots.push((-b - root) / (2 * a), (-b + root) / (2 * a));
    }
  }
  for (const t of sideRoots) {
    const y = o[1] + d[1] * t;
    if (y < -half - EPS || y > half + EPS) continue;
    const r = radiusStart + (y + half) * k;
    // ∇(x² + z² − r(y)²) — the cone's slope tips the normal off horizontal.
    candidates.push({ t, normal: normalise([o[0] + d[0] * t, -r * k, o[2] + d[2] * t]) });
  }

  if (Math.abs(d[1]) > EPS) {
    for (const [y, radius, ny] of [
      [-half, radiusStart, -1],
      [half, radiusEnd, 1],
    ] as const) {
      const t = (y - o[1]) / d[1];
      const px = o[0] + d[0] * t;
      const pz = o[2] + d[2] * t;
      if (px * px + pz * pz <= radius * radius) candidates.push({ t, normal: [0, ny, 0] });
    }
  }

  return nearest(candidates);
}

function intersectFrustum(
  solid: FrustumSolid,
  origin: Vec3,
  direction: Vec3,
): SurfaceHit | null {
  const o = toAxisFrame(sub(origin, solid.position), solid.axis);
  const d = toAxisFrame(direction, solid.axis);
  const hit = intersectFrustumLocal(
    o,
    d,
    inscribed(solid.radiusStart, solid.sides),
    inscribed(solid.radiusEnd, solid.sides),
    solid.height,
  );
  if (!hit) return null;
  return {
    distance: hit.t,
    point: add(origin, scale(direction, hit.t)),
    normal: normalise(fromAxisFrame(hit.normal, solid.axis)),
  };
}

function intersectCapsule(
  solid: CapsuleSolid,
  origin: Vec3,
  direction: Vec3,
): SurfaceHit | null {
  const half = solid.length / 2;
  const o = toAxisFrame(sub(origin, solid.position), solid.axis);
  const d = toAxisFrame(direction, solid.axis);
  const candidates: LocalHit[] = [];

  // Cylindrical body
  const a = d[0] * d[0] + d[2] * d[2];
  if (a > EPS) {
    const b = 2 * (o[0] * d[0] + o[2] * d[2]);
    const c = o[0] * o[0] + o[2] * o[2] - solid.radius * solid.radius;
    const disc = b * b - 4 * a * c;
    if (disc >= 0) {
      const root = Math.sqrt(disc);
      for (const t of [(-b - root) / (2 * a), (-b + root) / (2 * a)]) {
        const y = o[1] + d[1] * t;
        if (y >= -half && y <= half) {
          candidates.push({ t, normal: normalise([o[0] + d[0] * t, 0, o[2] + d[2] * t]) });
        }
      }
    }
  }

  // Hemispherical caps
  for (const capY of [-half, half]) {
    const centre: Vec3 = [0, capY, 0];
    const oc = sub(o, centre);
    const b = dot(oc, d);
    const c = dot(oc, oc) - solid.radius * solid.radius;
    const disc = b * b - c;
    if (disc < 0) continue;
    const root = Math.sqrt(disc);
    for (const t of [-b - root, -b + root]) {
      const p = add(o, scale(d, t));
      const beyond = capY < 0 ? p[1] <= capY : p[1] >= capY;
      if (beyond) candidates.push({ t, normal: normalise(sub(p, centre)) });
    }
  }

  const hit = nearest(candidates);
  if (!hit) return null;
  return {
    distance: hit.t,
    point: add(origin, scale(direction, hit.t)),
    normal: normalise(fromAxisFrame(hit.normal, solid.axis)),
  };
}

function intersectVolume(
  volume: HullVolume,
  origin: Vec3,
  direction: Vec3,
): SurfaceHit | null {
  switch (volume.kind) {
    case 'box':
      return intersectBox(volume, origin, direction);
    case 'sphere':
      return intersectSphere(volume.position, volume.radius, origin, direction);
    case 'capsule':
      return intersectCapsule(volume, origin, direction);
    case 'frustum':
      return intersectFrustum(volume, origin, direction);
  }
}

/** Nearest surface along a ray. `direction` must be normalised. */
export function raycastHull(
  volumes: readonly HullVolume[],
  origin: Vec3,
  direction: Vec3,
): SurfaceHit | null {
  let best: SurfaceHit | null = null;
  for (const volume of volumes) {
    const hit = intersectVolume(volume, origin, direction);
    if (hit && (!best || hit.distance < best.distance)) best = hit;
  }
  return best;
}

/* ------------------------------------------------------------------ */
/* Socket resolution                                                   */
/* ------------------------------------------------------------------ */

/** Far enough to start outside any hull; the longest is 20 units nose to tail. */
const REACH = 60;

/**
 * A measured normal is trusted only when it broadly agrees with the authored
 * one. A grazing hit on a tail fin should not tip a radiator on its side.
 */
const NORMAL_AGREEMENT = 0.5;

/**
 * Snap a socket onto the outermost hull surface along its own normal.
 *
 * The authored position is intent — *where along the hull* the fitting belongs.
 * The exact standoff is measured, so it cannot rot when a hull changes.
 */
export function resolveSocket(socket: Socket, volumes: readonly HullVolume[]): Socket {
  // The FTL socket is a centre, not a face: the ring encircles the hull rather
  // than protruding from it. Snapping it to the skin would thread the ring
  // through the ship.
  if (socket.kind === 'ftl') return socket;

  const normal = normalise(socket.normal);
  // Cast inward from well outside, so the first hit is the outer skin rather
  // than whatever internal face happens to be nearest the authored point.
  const origin = add(socket.position, scale(normal, REACH));
  const hit = raycastHull(volumes, origin, scale(normal, -1));
  if (!hit) return socket;

  const agrees = dot(hit.normal, normal) > NORMAL_AGREEMENT;
  return {
    ...socket,
    position: hit.point,
    // Following the real surface is what makes a turret sit flush on a canted
    // chine instead of meeting it as a wedge.
    normal: agrees ? hit.normal : socket.normal,
  };
}

export function resolveSockets(
  sockets: readonly Socket[],
  volumes: readonly HullVolume[],
): Socket[] {
  return sockets.map((socket) => resolveSocket(socket, volumes));
}

/** How far the hull reaches from a point, in a direction. Null if it misses. */
export function hullReach(
  volumes: readonly HullVolume[],
  from: Vec3,
  direction: Vec3,
): number | null {
  const unit = normalise(direction);
  const hit = raycastHull(volumes, add(from, scale(unit, REACH)), scale(unit, -1));
  return hit ? length(sub(hit.point, from)) : null;
}

/**
 * Where an encircling FTL ring's support pylons must start.
 *
 * The ring is deliberately not socket-mounted — it surrounds the hull rather
 * than protruding from a face — but a hoop with two units of clear air all
 * round it reads as scenery, not as machinery. Four diagonal spokes, so they
 * miss the dorsal and ventral fittings.
 */
export const FTL_PYLON_ANGLES: readonly number[] = [
  Math.PI / 4,
  (3 * Math.PI) / 4,
  (5 * Math.PI) / 4,
  (7 * Math.PI) / 4,
];

export function ftlPylonReach(
  volumes: readonly HullVolume[],
  z: number,
  fallback: number,
): number[] {
  return FTL_PYLON_ANGLES.map((angle) => {
    const direction: Vec3 = [Math.cos(angle), Math.sin(angle), 0];
    const reach = hullReach(volumes, [0, 0, z], direction);
    return reach ?? fallback;
  });
}

/* ------------------------------------------------------------------ */
/* Running lights                                                      */
/* ------------------------------------------------------------------ */

export interface LampAnchor {
  position: Vec3;
  normal: Vec3;
}

export function hullBounds(volumes: readonly HullVolume[]): { minZ: number; maxZ: number } {
  let minZ = Infinity;
  let maxZ = -Infinity;
  for (const volume of volumes) {
    const z = volume.position[2];
    const half =
      volume.kind === 'box'
        ? volume.size[2] / 2
        : volume.kind === 'sphere'
          ? volume.radius
          : volume.kind === 'capsule'
            ? (volume.axis === 'z' ? volume.length / 2 : 0) + volume.radius
            : volume.axis === 'z'
              ? volume.height / 2
              : Math.max(volume.radiusStart, volume.radiusEnd);
    minZ = Math.min(minZ, z - half);
    maxZ = Math.max(maxZ, z + half);
  }
  return { minZ, maxZ };
}

/** Tuning for `runningLightAnchors`. All optional; the defaults are the ship. */
export interface LampAnchorOptions {
  count?: number;
  standoff?: number;
  /**
   * Points this population must not sit on top of.
   *
   * These lamps are scattered by seed, and other subsystems bolt their own
   * fixtures to the same skin — most importantly the navigation beacons in
   * `exteriorLights.ts`, which are derived from the hull's own extremities and
   * so cannot move out of the way. Placed independently, the two eventually
   * collide: on `industrial_expanse` the nearest pair came out 0.060 apart,
   * well inside the beacon's 0.135 base radius, so a marker lamp rendered
   * buried in another fixture. The scattered population is the one that can
   * afford to give way, so it is the one that does.
   */
  keepClear?: readonly Vec3[];
  /** How much room to leave around each `keepClear` point. */
  clearance?: number;
}

/**
 * Marker lamps that sit ON the ship.
 *
 * The prototype scattered fourteen spheres through a hardcoded ±2.6 × ±0.8 ×
 * ±6.5 box keyed only on the seed. The positions came out byte-identical on all
 * five archetypes: about half floated in open vacuum beside the hull and most
 * of the rest were sealed inside solid plate, rendering nothing. Here each lamp
 * is a measured point on the skin, so a wider hull carries its lights further
 * out by construction.
 *
 * These are anonymous deck lighting, NOT navigation lights — red and green mean
 * port and starboard, and belong to the beacons alone. See `render/Ship.tsx`.
 */
export function runningLightAnchors(
  volumes: readonly HullVolume[],
  seed: number,
  options: LampAnchorOptions = {},
): LampAnchor[] {
  const { count = 14, standoff = 0.05, keepClear = [], clearance = 0.28 } = options;
  const rng = streamFor(seed, 'lamps');
  const { minZ, maxZ } = hullBounds(volumes);
  const span = maxZ - minZ;
  const anchors: LampAnchor[] = [];
  const clearanceSq = clearance * clearance;

  // Walk the hull nose to tail, alternating flanks, with a few dorsal lamps.
  // The budget is three candidates per lamp, so a rejected position re-rolls at
  // the same station rather than costing the ship a light.
  for (let i = 0; i < count * 3 && anchors.length < count; i++) {
    const step = anchors.length;
    const z = minZ + span * ((step + 0.5) / count) + (rng() - 0.5) * (span / count) * 0.6;
    const side = step % 2 === 0 ? 1 : -1;
    const dorsal = step % 5 === 4;
    const tilt = (rng() - 0.5) * 1.1;
    const direction: Vec3 = dorsal
      ? normalise([Math.sin(tilt) * 0.6, 1, 0])
      : normalise([side * Math.cos(tilt), Math.sin(tilt), 0]);

    const hit = raycastHull(volumes, add([0, 0, z], scale(direction, REACH)), scale(direction, -1));
    if (!hit) continue;

    const position = add(hit.point, scale(hit.normal, standoff));
    const crowded = keepClear.some((point) => {
      const dx = position[0] - point[0];
      const dy = position[1] - point[1];
      const dz = position[2] - point[2];
      return dx * dx + dy * dy + dz * dz < clearanceSq;
    });
    if (crowded) continue;

    anchors.push({ position, normal: hit.normal });
  }

  return anchors;
}
