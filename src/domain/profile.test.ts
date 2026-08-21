import { describe, expect, it } from 'vitest';
import {
  DEFAULT_HULL_PROFILE,
  PROFILE_LIMITS,
  clampProfilePoint,
  profileVolume,
  sampleProfile,
  toSvgPath,
  withPointAt,
} from './profile';

const project = (point: { r: number; z: number }) => ({ x: point.z * 10, y: -point.r * 10 });

describe('toSvgPath', () => {
  it('emits cubic Bezier segments, not a polyline', () => {
    // The prototype called this a "Bezier" while emitting only `L` commands.
    // That is the exact defect this asserts against.
    const path = toSvgPath(DEFAULT_HULL_PROFILE, project);
    expect(path).toMatch(/^M /);
    expect(path).toContain(' C ');
    expect(path).not.toMatch(/ L /);
  });

  it('starts exactly on the first control point', () => {
    const path = toSvgPath(DEFAULT_HULL_PROFILE, project);
    const first = project(DEFAULT_HULL_PROFILE[0]!);
    expect(path.startsWith(`M ${first.x.toFixed(2)} ${first.y.toFixed(2)}`)).toBe(true);
  });

  it('handles degenerate inputs without throwing', () => {
    expect(toSvgPath([], project)).toBe('');
    expect(toSvgPath([{ r: 1, z: 0 }], project)).toMatch(/^M /);
  });
});

describe('sampleProfile', () => {
  it('passes through the first and last control points', () => {
    const sampled = sampleProfile(DEFAULT_HULL_PROFILE, 8);
    const first = DEFAULT_HULL_PROFILE[0]!;
    const last = DEFAULT_HULL_PROFILE[DEFAULT_HULL_PROFILE.length - 1]!;
    expect(sampled[0]!.z).toBeCloseTo(first.z, 5);
    expect(sampled[sampled.length - 1]!.z).toBeCloseTo(last.z, 5);
  });

  it('produces more points than it was given', () => {
    expect(sampleProfile(DEFAULT_HULL_PROFILE, 8).length).toBeGreaterThan(
      DEFAULT_HULL_PROFILE.length,
    );
  });

  it('never emits a radius that would make a degenerate lathe face', () => {
    const wild = [
      { r: 0.05, z: 8 },
      { r: 3.2, z: 2 },
      { r: 0.05, z: -2 },
      { r: 2.0, z: -8 },
    ];
    for (const point of sampleProfile(wild, 12)) {
      expect(point.r).toBeGreaterThanOrEqual(PROFILE_LIMITS.minRadius);
    }
  });

  it('is deterministic', () => {
    expect(sampleProfile(DEFAULT_HULL_PROFILE, 6)).toEqual(
      sampleProfile(DEFAULT_HULL_PROFILE, 6),
    );
  });
});

describe('editing', () => {
  it('clamps a dragged point into the legal envelope', () => {
    expect(clampProfilePoint({ r: 99, z: 99 })).toEqual({
      r: PROFILE_LIMITS.maxRadius,
      z: PROFILE_LIMITS.maxZ,
    });
    expect(clampProfilePoint({ r: -5, z: -99 })).toEqual({
      r: PROFILE_LIMITS.minRadius,
      z: PROFILE_LIMITS.minZ,
    });
  });

  it('replaces only the targeted station', () => {
    const next = withPointAt(DEFAULT_HULL_PROFILE, 2, { r: 2.5, z: 3.6 });
    expect(next[2]!.r).toBe(2.5);
    expect(next[0]).toEqual(DEFAULT_HULL_PROFILE[0]);
    expect(next[3]).toEqual(DEFAULT_HULL_PROFILE[3]);
  });

  it('does not mutate the profile it is given', () => {
    const snapshot = JSON.stringify(DEFAULT_HULL_PROFILE);
    withPointAt(DEFAULT_HULL_PROFILE, 1, { r: 3, z: 0 });
    expect(JSON.stringify(DEFAULT_HULL_PROFILE)).toBe(snapshot);
  });
});

describe('profileVolume', () => {
  it('grows when the hull is made fatter', () => {
    const fatter = DEFAULT_HULL_PROFILE.map((point) => ({ ...point, r: point.r * 1.5 }));
    expect(profileVolume(fatter)).toBeGreaterThan(profileVolume(DEFAULT_HULL_PROFILE));
  });

  it('is positive for the stock airframe', () => {
    expect(profileVolume(DEFAULT_HULL_PROFILE)).toBeGreaterThan(0);
  });
});
