/**
 * Hull profile — the lathe cross-section for the aerodynamic archetype.
 *
 * The prototype's "Spline Sculptor" drew its curve with SVG `L` commands, so
 * despite the label it was a polyline, and its control points could not be
 * dragged. This module is the real thing: a centripetal-ish Catmull-Rom spline
 * that both the SVG editor and the 3D lathe sample, so what you draw is exactly
 * what gets revolved.
 *
 * Pure — no three, no DOM.
 */

export interface ProfilePoint {
  /** Radius from the axis of revolution. Must stay positive. */
  r: number;
  /** Station along the hull. +z is forward. */
  z: number;
}

export const PROFILE_LIMITS = {
  minRadius: 0.05,
  maxRadius: 3.2,
  minZ: -9,
  maxZ: 9,
} as const;

/** The stock airframe. Nose at +z, tail at -z. */
export const DEFAULT_HULL_PROFILE: readonly ProfilePoint[] = [
  { r: 0.05, z: 8.0 },
  { r: 0.55, z: 6.2 },
  { r: 1.05, z: 3.6 },
  { r: 1.38, z: 0.8 },
  { r: 1.42, z: -2.0 },
  { r: 1.25, z: -4.6 },
  { r: 0.92, z: -6.4 },
  { r: 0.72, z: -7.4 },
] as const;

export const clampProfilePoint = (point: ProfilePoint): ProfilePoint => ({
  r: Math.min(PROFILE_LIMITS.maxRadius, Math.max(PROFILE_LIMITS.minRadius, point.r)),
  z: Math.min(PROFILE_LIMITS.maxZ, Math.max(PROFILE_LIMITS.minZ, point.z)),
});

/** Replace one control point, keeping the result inside the legal envelope. */
export function withPointAt(
  profile: readonly ProfilePoint[],
  index: number,
  next: ProfilePoint,
): ProfilePoint[] {
  return profile.map((point, i) => (i === index ? clampProfilePoint(next) : point));
}

/**
 * Catmull-Rom through every control point. Endpoints are duplicated so the
 * curve starts and ends exactly on the first and last handles rather than
 * drifting off them.
 */
function neighbours(
  points: readonly ProfilePoint[],
  i: number,
): [ProfilePoint, ProfilePoint, ProfilePoint, ProfilePoint] {
  const at = (index: number): ProfilePoint =>
    points[Math.min(points.length - 1, Math.max(0, index))] as ProfilePoint;
  return [at(i - 1), at(i), at(i + 1), at(i + 2)];
}

/** Sample the spline into a dense polyline suitable for LatheGeometry. */
export function sampleProfile(
  profile: readonly ProfilePoint[],
  segmentsPerSpan = 8,
): ProfilePoint[] {
  if (profile.length < 2) return [...profile];

  const out: ProfilePoint[] = [];
  for (let i = 0; i < profile.length - 1; i++) {
    const [p0, p1, p2, p3] = neighbours(profile, i);
    for (let s = 0; s < segmentsPerSpan; s++) {
      const t = s / segmentsPerSpan;
      out.push(catmullRom(p0, p1, p2, p3, t));
    }
  }
  out.push(profile[profile.length - 1] as ProfilePoint);

  // A lathe with a zero or negative radius produces degenerate faces.
  return out.map((point) => ({
    r: Math.max(PROFILE_LIMITS.minRadius, point.r),
    z: point.z,
  }));
}

function catmullRom(
  p0: ProfilePoint,
  p1: ProfilePoint,
  p2: ProfilePoint,
  p3: ProfilePoint,
  t: number,
): ProfilePoint {
  const t2 = t * t;
  const t3 = t2 * t;
  const mix = (a: number, b: number, c: number, d: number): number =>
    0.5 *
    (2 * b + (-a + c) * t + (2 * a - 5 * b + 4 * c - d) * t2 + (-a + 3 * b - 3 * c + d) * t3);
  return { r: mix(p0.r, p1.r, p2.r, p3.r), z: mix(p0.z, p1.z, p2.z, p3.z) };
}

/**
 * The same spline as a cubic-Bezier SVG path, so the editor preview and the
 * revolved geometry cannot disagree. Catmull-Rom converts exactly to Bezier:
 * the control handles sit a third of the way along the neighbour chord.
 */
export function toSvgPath(
  profile: readonly ProfilePoint[],
  project: (point: ProfilePoint) => { x: number; y: number },
): string {
  if (profile.length === 0) return '';
  const first = project(profile[0] as ProfilePoint);
  if (profile.length === 1) return `M ${first.x} ${first.y}`;

  let path = `M ${first.x.toFixed(2)} ${first.y.toFixed(2)}`;
  for (let i = 0; i < profile.length - 1; i++) {
    const [p0, p1, p2, p3] = neighbours(profile, i);
    const a = project(p1);
    const b = project(p2);
    const prev = project(p0);
    const next = project(p3);

    const c1 = { x: a.x + (b.x - prev.x) / 6, y: a.y + (b.y - prev.y) / 6 };
    const c2 = { x: b.x - (next.x - a.x) / 6, y: b.y - (next.y - a.y) / 6 };

    path +=
      ` C ${c1.x.toFixed(2)} ${c1.y.toFixed(2)}` +
      ` ${c2.x.toFixed(2)} ${c2.y.toFixed(2)}` +
      ` ${b.x.toFixed(2)} ${b.y.toFixed(2)}`;
  }
  return path;
}

/** Rough enclosed volume of the solid of revolution — feeds the hull stats. */
export function profileVolume(profile: readonly ProfilePoint[]): number {
  const sampled = sampleProfile(profile, 12);
  let volume = 0;
  for (let i = 0; i < sampled.length - 1; i++) {
    const a = sampled[i] as ProfilePoint;
    const b = sampled[i + 1] as ProfilePoint;
    const height = Math.abs(b.z - a.z);
    // Conical frustum.
    volume += (Math.PI * height * (a.r * a.r + a.r * b.r + b.r * b.r)) / 3;
  }
  return volume;
}
