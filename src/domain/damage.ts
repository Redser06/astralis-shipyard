import { streamFor, type Rng } from './rng';
import { sampleProfile, type ProfilePoint } from './profile';
import type { Vec3, WearChannels } from './types';
import type { Recipe, WearExposure } from './fittings';
import type { Solid } from './hullForm';

/**
 * Where a ship is marked, and with what.
 *
 * WHAT THIS IS. The seven wear channels in `condition.ts` already say *how
 * badly* a ship has been used. Until now they only moved PBR parameters, so
 * every archetype at condition 0.8 was uniformly grubbier than at 0.2 —
 * weathering without any history. This module turns the same seven numbers
 * into discrete, located marks: a scorch by the engine, a micrometeorite
 * puncture through a radiator, a mismatched plate welded over a hole.
 *
 * ONE MARK PER CHANNEL, and the mapping is deliberate rather than decorative:
 *
 *   abrasion   → scuff   bright bare metal where something has rubbed
 *   grime      → grime   dark soiling that settles and stays
 *   thermal    → scorch  soot rings, worst near drives and radiator roots
 *   impact     → pit     micrometeorite craters, punched clean through
 *   oxidation  → stain   rust bleeding downhill from a seam
 *   repair     → patch   a plate that never got repainted
 *   structural → breach  a hole with the plating torn back around it
 *
 * That is the whole point of routing through `deriveWear` rather than adding a
 * damage slider: `repair` peaks mid-life and falls away, so a Long Patrol ship
 * carries patches a Derelict Hulk does not, and the marks tell that story
 * without anybody encoding it twice.
 *
 * WHY IT IS PURE. Marks are placed by closed-form sampling of the surface the
 * decal will be projected onto, in that mesh's own geometry frame. `three`'s
 * DecalGeometry then does the projection in `render/damage`. Keeping placement
 * here means "no decal ever lands on a surface too small to hold it" and "the
 * same seed always marks the same plate" are unit tests, not screenshots.
 *
 * CRITICALLY: this module draws from its own `streamFor(seed, 'damage:…')`
 * streams and adds no wear channel. `deriveWear` calls `jitter()` once per
 * channel from a single stream in source order, so inserting a channel
 * anywhere but the end silently re-rolls every existing ship. Nothing here
 * touches it.
 */

export type DamageKind = 'scuff' | 'grime' | 'scorch' | 'pit' | 'stain' | 'patch' | 'breach';

/**
 * Which wear channel drives each mark. Iterated in this fixed order so a given
 * seed always produces the same marks — a `Record` would leave the order to
 * whatever the object literal happened to be written in.
 */
export const DAMAGE_KINDS: ReadonlyArray<{
  kind: DamageKind;
  channel: keyof WearChannels;
  /** Marks per unit of √area at full channel strength. */
  density: number;
  /** Nominal decal width, before jitter and before the surface clamps it. */
  size: number;
  /** How opaque the mark is at full channel strength. */
  opacity: number;
}> = [
  { kind: 'grime', channel: 'grime', density: 0.5, size: 1.35, opacity: 0.5 },
  { kind: 'scuff', channel: 'abrasion', density: 0.52, size: 1.0, opacity: 0.6 },
  { kind: 'scorch', channel: 'thermal', density: 0.46, size: 1.25, opacity: 0.75 },
  { kind: 'stain', channel: 'oxidation', density: 0.4, size: 1.05, opacity: 0.62 },
  { kind: 'patch', channel: 'repair', density: 0.3, size: 1.0, opacity: 0.95 },
  { kind: 'pit', channel: 'impact', density: 0.5, size: 0.55, opacity: 0.95 },
  { kind: 'breach', channel: 'structural', density: 0.3, size: 0.75, opacity: 1 },
] as const;

/**
 * A surface a decal can be projected onto, expressed in the *mesh's own
 * geometry frame* — which is what `three`'s DecalGeometry consumes.
 *
 * Every axial primitive is described about +Y, because `Hulls.tsx` and
 * `Fitting.tsx` both swing a solid onto its declared axis with a mesh
 * rotation; the geometry underneath is always authored about Y.
 */
export type DamageSurface =
  | { kind: 'box'; size: Vec3 }
  | { kind: 'sphere'; radius: number }
  | { kind: 'capsule'; radius: number; length: number }
  | { kind: 'cylinder'; radiusTop: number; radiusBottom: number; height: number }
  | { kind: 'lathe'; profile: readonly ProfilePoint[] }
  | { kind: 'plane'; width: number; height: number };

export interface DamageMark {
  kind: DamageKind;
  /** In the target mesh's geometry frame. */
  position: Vec3;
  /** Outward surface normal there — the decal's projection axis. */
  normal: Vec3;
  /** Roll about the normal, radians. */
  roll: number;
  size: number;
  opacity: number;
}

export interface DamageOptions {
  /** Per-channel multipliers, e.g. an engine bell scorches harder. */
  exposure?: WearExposure;
  /** Scales every count. Below 1 for parts, which are small and numerous. */
  density?: number;
  /** Hard ceiling on marks for this surface. */
  max?: number;
}

const clamp = (v: number, lo: number, hi: number): number => Math.max(lo, Math.min(hi, v));

/* ------------------------------------------------------------------ */
/* Surface measurement                                                 */
/* ------------------------------------------------------------------ */

/** Rough outer area. Used only to decide how many marks a surface earns. */
export function surfaceArea(surface: DamageSurface): number {
  switch (surface.kind) {
    case 'box': {
      const [x, y, z] = surface.size;
      return 2 * (x * y + y * z + z * x);
    }
    case 'sphere':
      return 4 * Math.PI * surface.radius * surface.radius;
    case 'capsule':
      return 2 * Math.PI * surface.radius * (surface.length + 2 * surface.radius);
    case 'cylinder': {
      const mean = (surface.radiusTop + surface.radiusBottom) / 2;
      return 2 * Math.PI * mean * surface.height;
    }
    case 'lathe': {
      let area = 0;
      for (let i = 0; i < surface.profile.length - 1; i++) {
        const a = surface.profile[i] as ProfilePoint;
        const b = surface.profile[i + 1] as ProfilePoint;
        const slant = Math.hypot(b.r - a.r, b.z - a.z);
        area += Math.PI * (a.r + b.r) * slant;
      }
      return area;
    }
    case 'plane':
      return surface.width * surface.height;
  }
}

/**
 * The smallest dimension a mark has to fit inside. A decal wider than the
 * plate it sits on wraps around the edges and reads as a stripe, which is how
 * you get a "battle-damaged" ship that looks painted rather than hit.
 */
export function surfaceGrain(surface: DamageSurface): number {
  switch (surface.kind) {
    case 'box':
      return Math.min(surface.size[0], surface.size[1], surface.size[2]);
    case 'sphere':
      return surface.radius * 1.4;
    case 'capsule':
      return Math.min(surface.radius * 1.6, surface.length + surface.radius);
    case 'cylinder':
      return Math.min(
        Math.max(surface.radiusTop, surface.radiusBottom) * 1.6,
        surface.height,
      );
    case 'lathe': {
      let maxR = 0;
      let minZ = Infinity;
      let maxZ = -Infinity;
      for (const point of surface.profile) {
        maxR = Math.max(maxR, point.r);
        minZ = Math.min(minZ, point.z);
        maxZ = Math.max(maxZ, point.z);
      }
      return Math.min(maxR * 1.6, maxZ - minZ);
    }
    case 'plane':
      return Math.min(surface.width, surface.height);
  }
}

/* ------------------------------------------------------------------ */
/* Surface sampling                                                    */
/* ------------------------------------------------------------------ */

const normalise = (v: Vec3): Vec3 => {
  const l = Math.hypot(v[0], v[1], v[2]);
  return l < 1e-9 ? [0, 1, 0] : [v[0] / l, v[1] / l, v[2] / l];
};

interface SurfacePoint {
  position: Vec3;
  normal: Vec3;
}

/** A point on a body of revolution at angle φ, given the profile slope there. */
function revolvedPoint(r: number, y: number, phi: number, dr: number, dy: number): SurfacePoint {
  const sin = Math.sin(phi);
  const cos = Math.cos(phi);
  // Outward normal in the (radius, height) half-plane, rotated round the axis.
  // A cone's slope tips the normal off horizontal — which is exactly what makes
  // a decal on a tapering nose lie along the taper rather than through it.
  const [outR, outY] = normalise([dy, -dr, 0]);
  return {
    // three revolves x = r·sin φ, z = r·cos φ, for both lathes and cylinders.
    position: [r * sin, y, r * cos],
    normal: normalise([outR * sin, outY, outR * cos]),
  };
}

/** Uniform-ish point on the outside of a surface, with its outward normal. */
export function samplePoint(surface: DamageSurface, rng: Rng): SurfacePoint {
  switch (surface.kind) {
    case 'box': {
      const [x, y, z] = surface.size;
      // Pick a face in proportion to its area, so a long flank is not marked
      // as sparsely as an end cap.
      const faces: Array<{ area: number; axis: 0 | 1 | 2 }> = [
        { area: y * z, axis: 0 },
        { area: x * z, axis: 1 },
        { area: x * y, axis: 2 },
      ];
      const total = faces.reduce((sum, face) => sum + face.area, 0);
      let roll = rng() * total;
      let axis: 0 | 1 | 2 = 0;
      for (const face of faces) {
        if (roll < face.area) {
          axis = face.axis;
          break;
        }
        roll -= face.area;
      }
      const sign = rng() < 0.5 ? -1 : 1;
      const half = [x / 2, y / 2, z / 2];
      const position = [
        (rng() - 0.5) * x * 0.82,
        (rng() - 0.5) * y * 0.82,
        (rng() - 0.5) * z * 0.82,
      ];
      const out = [0, 0, 0];
      position[axis] = sign * (half[axis] as number);
      out[axis] = sign;
      return {
        position: [position[0] as number, position[1] as number, position[2] as number],
        normal: [out[0] as number, out[1] as number, out[2] as number],
      };
    }

    case 'sphere': {
      const phi = rng() * Math.PI * 2;
      const cosTheta = rng() * 2 - 1;
      const sinTheta = Math.sqrt(1 - cosTheta * cosTheta);
      const normal: Vec3 = [sinTheta * Math.sin(phi), cosTheta, sinTheta * Math.cos(phi)];
      return {
        position: [
          normal[0] * surface.radius,
          normal[1] * surface.radius,
          normal[2] * surface.radius,
        ],
        normal,
      };
    }

    case 'capsule': {
      const phi = rng() * Math.PI * 2;
      const y = (rng() - 0.5) * surface.length * 0.9;
      return revolvedPoint(surface.radius, y, phi, 0, 1);
    }

    case 'cylinder': {
      const phi = rng() * Math.PI * 2;
      const t = rng() * 0.86 + 0.07;
      const y = (t - 0.5) * surface.height;
      const r = surface.radiusBottom + (surface.radiusTop - surface.radiusBottom) * t;
      return revolvedPoint(r, y, phi, surface.radiusTop - surface.radiusBottom, surface.height);
    }

    case 'lathe': {
      const profile = surface.profile;
      // Weight by the slant area of each span, so the fat middle of a hull
      // collects more damage than the needle nose.
      const weights: number[] = [];
      let total = 0;
      for (let i = 0; i < profile.length - 1; i++) {
        const a = profile[i] as ProfilePoint;
        const b = profile[i + 1] as ProfilePoint;
        const w = (a.r + b.r) * Math.hypot(b.r - a.r, b.z - a.z);
        weights.push(w);
        total += w;
      }
      let roll = rng() * total;
      let index = 0;
      for (let i = 0; i < weights.length; i++) {
        if (roll < (weights[i] as number)) {
          index = i;
          break;
        }
        roll -= weights[i] as number;
      }
      const a = profile[index] as ProfilePoint;
      const b = profile[index + 1] as ProfilePoint;
      const t = rng();
      const r = a.r + (b.r - a.r) * t;
      // The lathe's profile z becomes the geometry's y — see `LatheHull`.
      const y = a.z + (b.z - a.z) * t;
      return revolvedPoint(r, y, rng() * Math.PI * 2, b.r - a.r, b.z - a.z);
    }

    case 'plane':
      // three's PlaneGeometry lies in XY and faces +Z.
      return {
        position: [(rng() - 0.5) * surface.width * 0.86, (rng() - 0.5) * surface.height * 0.86, 0],
        normal: [0, 0, 1],
      };
  }
}

/* ------------------------------------------------------------------ */
/* Placement                                                           */
/* ------------------------------------------------------------------ */

/** Anything narrower than this cannot hold a decal that reads as damage. */
export const MIN_MARKABLE_GRAIN = 0.3;

/**
 * The marks on one surface.
 *
 * Deterministic in (seed, tag): each surface draws its own stream, so adding a
 * component to a ship does not reshuffle the damage on the rest of it.
 */
export function surfaceDamage(
  surface: DamageSurface,
  wear: WearChannels,
  seed: number,
  tag: string,
  options: DamageOptions = {},
): DamageMark[] {
  const grain = surfaceGrain(surface);
  if (grain < MIN_MARKABLE_GRAIN) return [];

  const rng = streamFor(seed, `damage:${tag}`);
  const area = surfaceArea(surface);
  const spread = Math.sqrt(Math.max(area, 0));
  const density = options.density ?? 1;
  const max = options.max ?? 9;

  const byKind: DamageMark[][] = [];

  for (const spec of DAMAGE_KINDS) {
    const exposure = options.exposure?.[spec.channel] ?? 1;
    const strength = clamp(wear[spec.channel] * exposure, 0, 1.5);
    // A count below one still fires sometimes: a lightly-used ship should
    // carry the odd scuff, not a clean step from none to several.
    const expected = strength * spec.density * spread * density;
    let count = Math.floor(expected);
    if (rng() < expected - count) count += 1;

    const batch: DamageMark[] = [];
    for (let i = 0; i < count; i++) {
      const point = samplePoint(surface, rng);
      // Never wider than the plate it sits on.
      const size = clamp(
        spec.size * (0.65 + rng() * 0.7) * Math.min(1, spread / 3.5 + 0.45),
        0.08,
        grain * 0.7,
      );
      batch.push({
        kind: spec.kind,
        position: point.position,
        normal: point.normal,
        roll: rng() * Math.PI * 2,
        size,
        opacity: clamp(spec.opacity * (0.55 + 0.45 * strength) * (0.8 + rng() * 0.4), 0.12, 1),
      });
    }
    byKind.push(batch);
  }

  // Take one of each kind in turn until the ceiling is reached, rather than
  // filling up in channel order. Filling in order starves whatever is last —
  // and the last two are the pits and the breaches, which are the marks a
  // beaten ship is actually read by. The largest plates hit the ceiling every
  // time, so this is the common case, not the edge case.
  const marks: DamageMark[] = [];
  for (let round = 0; marks.length < max; round++) {
    let placed = false;
    for (const batch of byKind) {
      const mark = batch[round];
      if (!mark) continue;
      placed = true;
      marks.push(mark);
      if (marks.length >= max) break;
    }
    if (!placed) break;
  }

  return marks;
}

/* ------------------------------------------------------------------ */
/* Adapters: hull solids and component recipes                         */
/* ------------------------------------------------------------------ */

/**
 * The damage surface of a hull solid, in the frame the mesh renders in.
 *
 * `null` where nothing should be marked: decorative tubing and truss rings,
 * which are both too thin to hold a decal and are not plate in the first place.
 */
export function surfaceForSolid(
  solid: Solid,
  profile?: readonly ProfilePoint[],
): DamageSurface | null {
  if (solid.decorative) return null;
  switch (solid.kind) {
    case 'box':
      return { kind: 'box', size: solid.size };
    case 'sphere':
      return { kind: 'sphere', radius: solid.radius };
    case 'capsule':
      return { kind: 'capsule', radius: solid.radius, length: solid.length };
    case 'frustum':
      // `Hulls.tsx` builds these as cylinderGeometry(radiusEnd, radiusStart, …).
      return {
        kind: 'cylinder',
        radiusTop: solid.radiusEnd,
        radiusBottom: solid.radiusStart,
        height: solid.height,
      };
    case 'lathe':
      return profile ? { kind: 'lathe', profile: sampleProfile(profile, 10) } : null;
  }
}

/** The damage surface of a component piece, in that piece's own frame. */
export function surfaceForRecipe(recipe: Recipe): DamageSurface | null {
  switch (recipe.kind) {
    case 'slab':
    case 'greeble':
      return { kind: 'box', size: recipe.size };
    case 'capsule':
      return { kind: 'capsule', radius: recipe.radius, length: recipe.length };
    case 'sphere':
      return { kind: 'sphere', radius: recipe.radius };
    case 'cylinder':
      return {
        kind: 'cylinder',
        radiusTop: recipe.radiusTop,
        radiusBottom: recipe.radiusBottom,
        height: recipe.height,
      };
    case 'lathe':
      return {
        kind: 'lathe',
        profile: recipe.profile.map((point) => ({ r: point.r, z: point.y })),
      };
    // Pipes, rings and crystals are either too thin or too faceted to carry a
    // projected decal convincingly.
    default:
      return null;
  }
}

/**
 * Extra weathering for a hull solid because of where it sits.
 *
 * A ship scorches around its drives and abrades along its leading edges. The
 * hull table has no notion of "aft", so it is derived here from the solid's own
 * station: pure, and it moves automatically when a hull is reshaped.
 */
export function stationExposure(z: number, minZ: number, maxZ: number): WearExposure {
  const span = Math.max(maxZ - minZ, 1e-3);
  const t = clamp((z - minZ) / span, 0, 1);
  return {
    // Engine wash: strongest right at the stern, gone by amidships.
    thermal: 1 + 1.6 * Math.max(0, 1 - t * 2.4),
    // Leading surfaces take the dust the ship flies into.
    abrasion: 1 + 0.8 * Math.max(0, t * 2.2 - 1.2),
    impact: 1 + 0.6 * Math.max(0, t * 2.2 - 1.2),
  };
}
