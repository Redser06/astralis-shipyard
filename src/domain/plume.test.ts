import { describe, expect, it } from 'vitest';
import {
  IDLE_THROTTLE,
  PLUME_PROFILES,
  SHOCK_THRESHOLD,
  advancePhase,
  plumeExtent,
  plumeFlicker,
  plumeStream,
  plumeThrottle,
  shockAt,
  shockCount,
  shockDiamonds,
  spool,
  writePlumeColours,
  writePlumePoints,
  type PlumeExtent,
} from './plume';
import type { SublightId } from './types';

/**
 * What the exhaust has to do, checked without a GPU.
 *
 * Every one of these is a named defect from the R4 brief. The plume this
 * replaced reacted to the fitted drive in no way whatsoever — not in length,
 * not in width, not even in colour — marched all 240 of its particles up the
 * axis in lockstep, and drove its brightness from a constant. None of that is
 * visible in a type check, and all of it is visible here.
 */

const DRIVES: readonly SublightId[] = ['ion_pulse', 'mpd_thruster', 'fusion_torch'];
const NOZZLE = 0.58;

describe('throttle', () => {
  it('a derelict drive is exactly off, whatever the burn command says', () => {
    expect(plumeThrottle(false, true)).toBe(0);
    expect(plumeThrottle(true, true)).toBe(0);
  });

  it('a live drive idles rather than going cold, and burning is full throttle', () => {
    expect(plumeThrottle(false, false)).toBe(IDLE_THROTTLE);
    expect(plumeThrottle(false, false)).toBeGreaterThan(0);
    expect(plumeThrottle(true, false)).toBe(1);
  });

  it('spooling approaches the commanded setting and stops there', () => {
    let value = 0;
    for (let i = 0; i < 400; i++) value = spool(value, 1, 1 / 60);
    expect(value).toBeCloseTo(1, 4);

    for (let i = 0; i < 400; i++) value = spool(value, 0, 1 / 60);
    expect(value).toBeCloseTo(0, 4);
  });

  it('spooling is framerate independent, and survives a stalled tab', () => {
    let sixty = 0;
    for (let i = 0; i < 60; i++) sixty = spool(sixty, 1, 1 / 60);
    let thirty = 0;
    for (let i = 0; i < 30; i++) thirty = spool(thirty, 1, 1 / 30);
    expect(Math.abs(sixty - thirty)).toBeLessThan(0.03);

    // A tab that was backgrounded for a minute must not overshoot past 1.
    expect(spool(0, 1, 60)).toBeLessThanOrEqual(1);
    expect(spool(0.5, 1, Number.NaN)).toBe(0.5);
  });
});

describe('per-tier identity', () => {
  it('no two drives share a signature colour', () => {
    const mantles = DRIVES.map((d) => PLUME_PROFILES[d].mantleColour);
    expect(new Set(mantles).size).toBe(DRIVES.length);
    const cores = DRIVES.map((d) => PLUME_PROFILES[d].coreColour);
    expect(new Set(cores).size).toBe(DRIVES.length);
  });

  it('the three drives differ in shape, not just in hue', () => {
    const full = DRIVES.map((d) => plumeExtent(d, 1, NOZZLE));
    const [ion, mpd, fusion] = full as [PlumeExtent, PlumeExtent, PlumeExtent];

    // The ion pulse is the thin one.
    expect(ion.coreRadius).toBeLessThan(mpd.coreRadius);
    expect(ion.coreRadius).toBeLessThan(fusion.coreRadius);
    // The MPD thruster is a column: it stays broad most of the way down, where
    // the torch is a spike from the moment it leaves the bell.
    expect(mpd.tipRadius / mpd.coreRadius).toBeGreaterThan(0.4);
    expect(mpd.tipRadius / mpd.coreRadius).toBeGreaterThan(fusion.tipRadius / fusion.coreRadius);
    // The fusion torch is a spike, and the longest of the three.
    expect(fusion.tipRadius / fusion.coreRadius).toBeLessThan(0.35);
    expect(fusion.coreLength).toBeGreaterThan(mpd.coreLength);
    expect(fusion.coreLength).toBeGreaterThan(ion.coreLength);
  });

  it('every plume closes to a point rather than ending in a flat cut', () => {
    // The first build of this shipped a mantle that kept its full width to the
    // end. With no way to fade a hard silhouette edge, that read as a coloured
    // brick hanging behind the ship — obvious the moment it was looked at, and
    // invisible to every other check in this file.
    for (const drive of DRIVES) {
      const extent = plumeExtent(drive, 1, NOZZLE);
      expect(extent.envelopeTipRadius, drive).toBeLessThan(extent.envelopeRadius * 0.35);
      expect(extent.tipRadius, drive).toBeLessThan(extent.coreRadius);
    }
  });

  it('a bigger bell throws a bigger plume', () => {
    const small = plumeExtent('fusion_torch', 1, 0.42);
    const large = plumeExtent('fusion_torch', 1, 0.78);
    expect(large.coreLength).toBeGreaterThan(small.coreLength * 1.5);
    expect(large.coreRadius).toBeGreaterThan(small.coreRadius);
  });

  it('the torch lights the hull hardest and the ion pulse least', () => {
    const lit = DRIVES.map((d) => plumeExtent(d, 1, NOZZLE).lightIntensity);
    expect(lit[2]).toBeGreaterThan(lit[1] as number);
    expect(lit[1]).toBeGreaterThan(lit[0] as number);
  });

  it('flicker follows turbulence: the ion pulse is steady, the torch is not', () => {
    const samples = (drive: SublightId): number[] =>
      [0, 0.13, 0.31, 0.52, 0.77, 1.03].map((t) => plumeFlicker(drive, t, 1));

    const spread = (values: number[]): number => Math.max(...values) - Math.min(...values);
    expect(spread(samples('ion_pulse'))).toBeLessThan(spread(samples('fusion_torch')));
    expect(spread(samples('fusion_torch'))).toBeGreaterThan(0.05);
  });

  it('flicker is deterministic in time, so a frozen clock freezes the plume', () => {
    expect(plumeFlicker('fusion_torch', 3.5, 1)).toBe(plumeFlicker('fusion_torch', 3.5, 1));
    // And it dies away with the throttle rather than flickering a dead drive.
    expect(plumeFlicker('fusion_torch', 3.5, 0)).toBe(1);
  });
});

describe('Test Burn scales hard, and a derelict goes dark', () => {
  it('every drive grows several times longer between idle and full burn', () => {
    for (const drive of DRIVES) {
      const idle = plumeExtent(drive, IDLE_THROTTLE, NOZZLE);
      const burn = plumeExtent(drive, 1, NOZZLE);
      expect(burn.coreLength / idle.coreLength, drive).toBeGreaterThan(3);
      expect(burn.lightIntensity / idle.lightIntensity, drive).toBeGreaterThan(5);
      expect(burn.opacity, drive).toBeGreaterThan(idle.opacity);
    }
  });

  it('length and brightness rise monotonically with throttle', () => {
    for (const drive of DRIVES) {
      let previousLength = -1;
      let previousLight = -1;
      for (let t = 0; t <= 1.0001; t += 0.1) {
        const extent = plumeExtent(drive, t, NOZZLE);
        expect(extent.coreLength, `${drive} @ ${t}`).toBeGreaterThan(previousLength);
        expect(extent.lightIntensity, `${drive} @ ${t}`).toBeGreaterThan(previousLight);
        previousLength = extent.coreLength;
        previousLight = extent.lightIntensity;
      }
    }
  });

  it('at zero throttle there is nothing to draw and nothing to light', () => {
    for (const drive of DRIVES) {
      const extent = plumeExtent(drive, 0, NOZZLE);
      expect(extent.coreLength, drive).toBe(0);
      expect(extent.coreRadius, drive).toBe(0);
      expect(extent.envelopeLength, drive).toBe(0);
      expect(extent.opacity, drive).toBe(0);
      expect(extent.lightIntensity, drive).toBe(0);
      expect(shockDiamonds(drive, 0, NOZZLE), drive).toEqual([]);
    }
  });

  it('a throttle outside [0, 1] is clamped rather than inverted', () => {
    const over = plumeExtent('fusion_torch', 4, NOZZLE);
    const full = plumeExtent('fusion_torch', 1, NOZZLE);
    expect(over.coreLength).toBeCloseTo(full.coreLength, 10);
    expect(plumeExtent('fusion_torch', -3, NOZZLE).coreLength).toBe(0);
  });

  it('reuses a caller-supplied object rather than allocating per frame', () => {
    const scratch = plumeExtent('ion_pulse', 1, NOZZLE);
    const returned = plumeExtent('fusion_torch', 0.5, NOZZLE, scratch);
    expect(returned).toBe(scratch);
    expect(scratch.coreLength).toBeCloseTo(plumeExtent('fusion_torch', 0.5, NOZZLE).coreLength, 10);
  });
});

describe('shock diamonds', () => {
  it('only the fusion torch has standing shock structure', () => {
    expect(shockCount('ion_pulse')).toBe(0);
    expect(shockCount('mpd_thruster')).toBe(0);
    expect(shockCount('fusion_torch')).toBeGreaterThan(2);
    expect(shockDiamonds('ion_pulse', 1, NOZZLE)).toEqual([]);
    expect(shockDiamonds('mpd_thruster', 1, NOZZLE)).toEqual([]);
    expect(shockDiamonds('fusion_torch', 1, NOZZLE).length).toBeGreaterThan(2);
  });

  it('every diamond stands inside the flame, never past the end of it', () => {
    for (let t = 0; t <= 1.0001; t += 0.05) {
      const core = plumeExtent('fusion_torch', t, NOZZLE).coreLength;
      for (const diamond of shockDiamonds('fusion_torch', t, NOZZLE)) {
        expect(diamond.offset, `throttle ${t}`).toBeGreaterThan(0);
        expect(diamond.offset, `throttle ${t}`).toBeLessThan(core);
        expect(diamond.radius).toBeGreaterThan(0);
      }
    }
  });

  it('diamonds decay downstream, in both size and brightness', () => {
    const diamonds = shockDiamonds('fusion_torch', 1, NOZZLE);
    for (let i = 1; i < diamonds.length; i++) {
      const previous = diamonds[i - 1]!;
      const current = diamonds[i]!;
      expect(current.offset).toBeGreaterThan(previous.offset);
      expect(current.radius).toBeLessThan(previous.radius);
      expect(current.intensity).toBeLessThan(previous.intensity);
    }
  });

  it('a throttled-back torch shows fewer diamonds, spaced closer', () => {
    const low = shockDiamonds('fusion_torch', SHOCK_THRESHOLD + 0.05, NOZZLE);
    const high = shockDiamonds('fusion_torch', 1, NOZZLE);
    expect(high.length).toBeGreaterThan(low.length);
    expect(high[0]!.offset).toBeGreaterThan(low[0]!.offset);
    // And below the pressure threshold there is no shock structure at all.
    expect(shockDiamonds('fusion_torch', SHOCK_THRESHOLD - 0.01, NOZZLE)).toEqual([]);
  });

  it('an out-of-range index reports a dark diamond rather than throwing', () => {
    const out = shockAt('fusion_torch', 99, 1, NOZZLE);
    expect(out.intensity).toBe(0);
    expect(shockAt('ion_pulse', 0, 1, NOZZLE).intensity).toBe(0);
  });
});

describe('the particle stream is a stream, not a marching block', () => {
  const stream = plumeStream(200, 4242);

  it('particles carry their own speeds, spread wide', () => {
    const speeds = stream.map((p) => p.speed);
    const min = Math.min(...speeds);
    const max = Math.max(...speeds);
    expect(max / min).toBeGreaterThan(1.5);
    expect(new Set(speeds).size).toBeGreaterThan(stream.length * 0.9);
  });

  it('phases fill the column evenly from the very first frame', () => {
    const buckets = new Array(10).fill(0) as number[];
    for (const p of stream) {
      expect(p.phase).toBeGreaterThanOrEqual(0);
      expect(p.phase).toBeLessThan(1);
      buckets[Math.min(9, Math.floor(p.phase * 10))]!++;
    }
    // A synchronised block would pile every particle into one or two buckets.
    for (const count of buckets) expect(count).toBeGreaterThan(stream.length / 20);
  });

  it('stays spread out instead of re-synchronising as it runs', () => {
    const phases = Float32Array.from(stream, (p) => p.phase);
    for (let step = 0; step < 600; step++) {
      for (let i = 0; i < phases.length; i++) {
        phases[i] = advancePhase(phases[i]!, 1 / 60, stream[i]!.speed, 0.9);
      }
    }
    const buckets = new Array(10).fill(0) as number[];
    for (const phase of phases) buckets[Math.min(9, Math.floor(phase * 10))]!++;
    for (const count of buckets) expect(count).toBeGreaterThan(phases.length / 25);
  });

  it('is seeded: the same ship throws the same exhaust, a different one does not', () => {
    expect(plumeStream(64, 7)).toEqual(plumeStream(64, 7));
    expect(plumeStream(64, 8)).not.toEqual(plumeStream(64, 7));
  });

  it('advancing a phase always lands back inside [0, 1), and never on NaN', () => {
    expect(advancePhase(0.9, 1 / 60, 1.6, 0.4)).toBeGreaterThanOrEqual(0);
    expect(advancePhase(0.9, 1 / 60, 1.6, 0.4)).toBeLessThan(1);
    // A dead plume has zero length, so lifetime can legitimately be zero.
    expect(advancePhase(0.4, 1 / 60, 1, 0)).toBe(0.4);
    expect(advancePhase(0.4, Number.NaN, 1, 1)).toBe(0.4);
    expect(Number.isFinite(advancePhase(0.4, 5000, 1.6, 0.4))).toBe(true);
  });

  it('asks for no particles and gets none, without dividing by zero', () => {
    expect(plumeStream(0, 1)).toEqual([]);
    expect(plumeStream(-5, 1)).toEqual([]);
  });
});

describe('buffer writes', () => {
  const stream = plumeStream(48, 99);
  const phases = Float32Array.from(stream, (p) => p.phase);

  it('every point lands inside the envelope it belongs to', () => {
    const extent = plumeExtent('fusion_torch', 1, NOZZLE);
    const points = new Float32Array(stream.length * 3);
    writePlumePoints(stream, phases, extent, 0.7, points);

    const widest = Math.max(extent.sparkRadius, extent.sparkTipRadius);
    for (let i = 0; i < stream.length; i++) {
      const x = points[i * 3]!;
      const y = points[i * 3 + 1]!;
      const z = points[i * 3 + 2]!;
      expect(Number.isFinite(x) && Number.isFinite(y) && Number.isFinite(z)).toBe(true);
      // The drive fires along +Y and nothing travels upstream into the bell.
      expect(y).toBeGreaterThanOrEqual(0);
      expect(y).toBeLessThanOrEqual(extent.envelopeLength + 1e-6);
      expect(Math.hypot(x, z)).toBeLessThanOrEqual(widest + 1e-6);
    }
  });

  it('the sparks fan out downstream even though the flame closes', () => {
    const extent = plumeExtent('fusion_torch', 1, NOZZLE);
    const points = new Float32Array(stream.length * 3);
    // One particle on the envelope's edge, sampled near the throat and near the tip.
    const edge = [{ angle: 0, radial: 1, speed: 1, phase: 0.05, size: 1 }];
    writePlumePoints(edge, Float32Array.from([0.05]), extent, 0, points);
    const near = Math.hypot(points[0]!, points[2]!);
    writePlumePoints(edge, Float32Array.from([0.95]), extent, 0, points);
    const far = Math.hypot(points[0]!, points[2]!);

    expect(far).toBeGreaterThan(near);
    expect(extent.tipRadius).toBeLessThan(extent.coreRadius);
  });

  it('a dead drive writes a collapsed, harmless buffer', () => {
    const extent = plumeExtent('fusion_torch', 0, NOZZLE);
    const points = new Float32Array(stream.length * 3).fill(9);
    writePlumePoints(stream, phases, extent, 0, points);
    // `Math.abs` because a cosine of zero radius legitimately produces -0.
    for (const value of points) expect(Math.abs(value)).toBe(0);
  });

  it('colours run white-hot at the throat, tier-coloured downstream, then fade', () => {
    const hot: [number, number, number] = [1, 1, 1];
    const cool: [number, number, number] = [1, 0.4, 0];
    const single = [{ angle: 0, radial: 0, speed: 1, phase: 0, size: 1 }];
    const out = new Float32Array(3);

    writePlumeColours(single, Float32Array.from([0]), hot, cool, 1, out);
    expect(out[1]).toBeCloseTo(1, 5);
    expect(out[2]).toBeCloseTo(1, 5);

    writePlumeColours(single, Float32Array.from([0.5]), hot, cool, 1, out);
    // Cooled toward the tier colour: green and blue have dropped away.
    expect(out[2]!).toBeLessThan(out[0]!);

    writePlumeColours(single, Float32Array.from([0.99]), hot, cool, 1, out);
    expect(out[0]!).toBeLessThan(0.1);
  });

  it('never writes past the shortest of the buffers handed to it', () => {
    const points = new Float32Array(6).fill(-1);
    writePlumePoints(stream, phases, plumeExtent('ion_pulse', 1, NOZZLE), 0, points);
    // Two particles' worth written, and nothing beyond — no overrun, no throw.
    expect(points.length).toBe(6);
    for (const value of points) expect(Number.isFinite(value)).toBe(true);

    const short = new Float32Array(3);
    writePlumeColours(stream, Float32Array.from([0.5]), [1, 1, 1], [1, 0, 0], 1, short);
    expect(Number.isFinite(short[0]!)).toBe(true);
  });
});
