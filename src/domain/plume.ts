import type { SublightId } from './types';
import { streamFor } from './rng';

/**
 * Exhaust plumes: what each drive tier throws out of its bell, as numbers.
 *
 * This is pure so the *identity* of a drive can be asserted without a GPU. The
 * plume it replaces was a 240-point cloud and a flat disc that knew nothing
 * about which engine was fitted: `Ship` handed it `blueprint.accentColor` and
 * never handed it `sublight` at all, so an ion pulse and a fusion torch threw
 * exactly the same exhaust, in whatever colour the ship's trim happened to be.
 * Per-tier character now lives in `PLUME_PROFILES` and is covered by tests, and
 * the renderer's only job is to draw it.
 *
 * TWO THINGS THIS MODULE IS CAREFUL ABOUT.
 *
 * 1. NOTHING IS SYNCHRONISED. Every particle carries its own speed and its own
 *    phase, drawn from the ship's seed, and phases are stratified so the column
 *    starts evenly filled. The old cloud gave all 240 particles one speed and
 *    one wrap threshold, so the whole thing marched up the axis and snapped
 *    back together — a visible pulse rather than a stream.
 *
 * 2. NOTHING ALLOCATES ON THE HOT PATH. `plumeExtent` and `shockAt` fill a
 *    caller-owned object, and `writePlumePoints` / `writePlumeColours` fill
 *    caller-owned buffers. A render loop calling these sixty times a second
 *    must not be feeding the garbage collector.
 *
 * All lengths are expressed in nozzle radii and multiplied by the fitted bell's
 * exit radius by the caller, so a plume is always in proportion to the engine
 * it leaves — and the bell profile stays the renderer's business.
 */

/* --------------------------- Throttle --------------------------- */

/**
 * Station-keeping thrust. Deliberately not zero: a live drive idles, and the
 * difference between idling and burning is the whole point of Test Burn.
 */
export const IDLE_THROTTLE = 0.2;

/** How quickly a drive spools between settings, in e-foldings per second. */
export const SPOOL_RATE = 3.4;

/** Below this there is not enough pressure for standing shock structure. */
export const SHOCK_THRESHOLD = 0.4;

/**
 * Commanded throttle in [0, 1].
 *
 * A derelict returns exactly 0 — no plume, no glow, no light. That hard zero is
 * what the derelict state is sold on, so it is a rule here rather than a
 * condition scattered through the renderer.
 */
export function plumeThrottle(burning: boolean, dead: boolean): number {
  if (dead) return 0;
  return burning ? 1 : IDLE_THROTTLE;
}

/**
 * One step of the spool-up, framerate-independent.
 *
 * Exponential approach rather than a linear ramp, so a burn command lights the
 * drive immediately and then settles, which is how a throttle feels.
 */
export function spool(current: number, target: number, delta: number): number {
  if (!Number.isFinite(delta) || delta <= 0) return current;
  const blend = 1 - Math.exp(-SPOOL_RATE * Math.min(delta, 0.25));
  return current + (target - current) * blend;
}

/* --------------------------- Profiles --------------------------- */

export interface PlumeProfile {
  drive: SublightId;
  /** The white-hot centre of the column. */
  coreColour: string;
  /** The cooler, wider sheath around it — this is the tier's signature colour. */
  mantleColour: string;
  /** Turbulent particles riding the column, downstream where it has cooled. */
  sparkColour: string;
  /** Full-throttle column length, in nozzle radii. */
  length: number;
  /** Column radius at the throat, as a fraction of the nozzle radius. */
  throatRadius: number;
  /** Tip radius as a fraction of the throat: 1 is a column, 0 a spike. */
  taper: number;
  /** How far the diffuse envelope stands outside the core, as a fraction. */
  mantleSpread: number;
  /**
   * What is left of the envelope's radius at its downstream end.
   *
   * Small, always. An envelope that keeps its width to the end is a cylinder
   * with a flat cut across it — which is exactly how the first build of this
   * looked: a purple brick behind the ship. Exhaust has to close to a point,
   * because there is no way to fade a hard silhouette edge without a shader.
   */
  mantleTip: number;
  /**
   * How far the SPARKS fan out past the column by the time they reach the tip.
   * Particles disperse as the flame they came out of narrows; that difference
   * is what keeps the plume from reading as one solid object.
   */
  mantleFan: number;
  /** Standing shock diamonds. Zero means a smooth column. */
  shockCount: number;
  /** Spacing between diamonds at full throttle, in nozzle radii. */
  shockSpacing: number;
  /** 0 = laminar and steady, 1 = violent. Drives flicker and swirl. */
  turbulence: number;
  /** Colour of the light the drive casts on the hull. */
  lightColour: string;
  /** Full-throttle intensity of that light. */
  lightIntensity: number;
  /** Its range, in nozzle radii. */
  lightRange: number;
}

/**
 * Three drives, three unmistakable exhausts.
 *
 * The brief for each is the same one the component catalogue gives the player:
 * the ion pulse is efficient and unimpressive, the MPD thruster is a real
 * plasma column, and the fusion torch is a controlled bomb. If you cannot tell
 * which is fitted from a still frame with the hull cropped out, this table is
 * wrong.
 */
export const PLUME_PROFILES: Record<SublightId, PlumeProfile> = {
  // Thin, steady, cyan. Barely flickers — an ion drive is a gentle shove that
  // happens to last for months, and it should look like restraint.
  ion_pulse: {
    drive: 'ion_pulse',
    coreColour: '#cffafe',
    mantleColour: '#22d3ee',
    sparkColour: '#67e8f9',
    length: 8.5,
    throatRadius: 0.5,
    taper: 0.34,
    mantleSpread: 0.55,
    mantleTip: 0.12,
    mantleFan: 1.15,
    shockCount: 0,
    shockSpacing: 0,
    turbulence: 0.12,
    lightColour: '#67e8f9',
    lightIntensity: 9,
    lightRange: 7,
  },

  // A violet plasma column: near-parallel sided, dense, faintly unstable. The
  // taper is high on purpose — this reads as a *column*, not as a flame.
  mpd_thruster: {
    drive: 'mpd_thruster',
    coreColour: '#ede9fe',
    mantleColour: '#7c3aed',
    sparkColour: '#a78bfa',
    length: 8,
    throatRadius: 0.82,
    taper: 0.46,
    mantleSpread: 0.62,
    mantleTip: 0.2,
    mantleFan: 1.12,
    shockCount: 0,
    shockSpacing: 0,
    turbulence: 0.45,
    lightColour: '#a78bfa',
    lightIntensity: 15,
    lightRange: 9,
  },

  // Violent yellow-white, with the standing shock diamonds of an underexpanded
  // nozzle. The only tier with shock structure, and the only one that lights
  // the hull from across the ship.
  fusion_torch: {
    drive: 'fusion_torch',
    coreColour: '#fffbeb',
    mantleColour: '#f59e0b',
    sparkColour: '#fde68a',
    length: 10.5,
    throatRadius: 0.92,
    taper: 0.26,
    mantleSpread: 0.8,
    mantleTip: 0.1,
    mantleFan: 1.35,
    shockCount: 5,
    shockSpacing: 1.5,
    turbulence: 1,
    lightColour: '#fbbf24',
    lightIntensity: 26,
    lightRange: 14,
  },
};

export const plumeProfile = (drive: SublightId): PlumeProfile => PLUME_PROFILES[drive];

/* --------------------------- Extent --------------------------- */

export interface PlumeExtent {
  /** Length of the bright core. Zero when the drive is dead. */
  coreLength: number;
  /** Core radius where it leaves the throat. */
  coreRadius: number;
  /** Core radius at its downstream tip. */
  tipRadius: number;
  /** The diffuse envelope: longer and wider than the core, and much fainter. */
  envelopeLength: number;
  envelopeRadius: number;
  /** Where the envelope closes. Always well inside `envelopeRadius`. */
  envelopeTipRadius: number;
  /** The cloud the particles ride, which fans OUT rather than closing. */
  sparkRadius: number;
  sparkTipRadius: number;
  /** Multiplier on every layer's authored opacity. */
  opacity: number;
  /** Intensity of the light at the nozzle, in three's units. */
  lightIntensity: number;
  /** Its range. */
  lightRange: number;
}

const emptyExtent = (): PlumeExtent => ({
  coreLength: 0,
  coreRadius: 0,
  tipRadius: 0,
  envelopeLength: 0,
  envelopeRadius: 0,
  envelopeTipRadius: 0,
  sparkRadius: 0,
  sparkTipRadius: 0,
  opacity: 0,
  lightIntensity: 0,
  lightRange: 0,
});

const clamp01 = (v: number): number => Math.max(0, Math.min(1, v));

/**
 * The plume's dimensions at a given throttle.
 *
 * Length scales linearly with throttle and brightness scales with its square,
 * which is what makes Test Burn read as a step change rather than as a nudge:
 * from idle to full the column grows five times longer and the nozzle light
 * comes up by more than an order of magnitude.
 *
 * Pass `out` to reuse an object on a render path.
 */
export function plumeExtent(
  drive: SublightId,
  throttle: number,
  nozzleRadius: number,
  out: PlumeExtent = emptyExtent(),
): PlumeExtent {
  const profile = PLUME_PROFILES[drive];
  const t = clamp01(throttle);
  const r = Math.max(0, nozzleRadius);

  const coreRadius = r * profile.throatRadius * (0.78 + 0.22 * t);
  const envelopeRadius = coreRadius * (1 + profile.mantleSpread);

  out.coreLength = profile.length * r * t;
  out.coreRadius = t > 0 ? coreRadius : 0;
  out.tipRadius = out.coreRadius * profile.taper;
  out.envelopeLength = out.coreLength * 1.3;
  out.envelopeRadius = t > 0 ? envelopeRadius : 0;
  out.envelopeTipRadius = out.envelopeRadius * profile.mantleTip;
  out.sparkRadius = out.envelopeRadius * 0.72;
  out.sparkTipRadius = out.envelopeRadius * profile.mantleFan;
  // Never fully transparent while lit: a drive at idle is dim, not invisible.
  out.opacity = t > 0 ? 0.5 + 0.5 * t : 0;
  out.lightIntensity = profile.lightIntensity * (0.08 + 0.92 * t * t);
  out.lightRange = profile.lightRange * r * (0.5 + 0.5 * t);

  if (t <= 0) {
    out.opacity = 0;
    out.lightIntensity = 0;
  }
  return out;
}

/* --------------------------- Shock diamonds --------------------------- */

export interface ShockDiamond {
  /** Distance downstream of the throat. */
  offset: number;
  /** Half-width of the diamond. */
  radius: number;
  /** 0 when this diamond is not standing at the current throttle. */
  intensity: number;
}

/** How many diamonds a drive can show at all. Only the fusion torch has any. */
export const shockCount = (drive: SublightId): number => PLUME_PROFILES[drive].shockCount;

/** Brightness falloff from one diamond to the next, downstream. */
const SHOCK_DECAY = 0.78;

/**
 * Where the i-th shock diamond stands, and how bright.
 *
 * Diamond spacing widens with chamber pressure in a real underexpanded nozzle,
 * so it widens with throttle here — but more slowly than the column grows, so
 * a throttled-back torch shows fewer of them. Any diamond that would stand past
 * the end of the core returns `intensity: 0` rather than hanging in the dark
 * beyond the flame.
 *
 * Fills `out` so a render loop can call it per diamond per frame for free.
 */
export function shockAt(
  drive: SublightId,
  index: number,
  throttle: number,
  nozzleRadius: number,
  out: ShockDiamond = { offset: 0, radius: 0, intensity: 0 },
): ShockDiamond {
  const profile = PLUME_PROFILES[drive];
  const t = clamp01(throttle);

  out.offset = 0;
  out.radius = 0;
  out.intensity = 0;
  if (index < 0 || index >= profile.shockCount || t < SHOCK_THRESHOLD) return out;

  const r = Math.max(0, nozzleRadius);
  const spacing = profile.shockSpacing * r * (0.6 + 0.4 * t);
  const offset = spacing * (index + 0.8);
  const coreLength = profile.length * r * t;
  if (offset > coreLength * 0.88) return out;

  const decay = Math.pow(SHOCK_DECAY, index);
  out.offset = offset;
  out.radius = r * profile.throatRadius * (0.78 + 0.22 * t) * 0.92 * decay;
  out.intensity = t * decay;
  return out;
}

/** Every diamond currently standing. Allocates; for tests and for setup. */
export function shockDiamonds(
  drive: SublightId,
  throttle: number,
  nozzleRadius: number,
): ShockDiamond[] {
  const out: ShockDiamond[] = [];
  for (let i = 0; i < shockCount(drive); i++) {
    const diamond = shockAt(drive, i, throttle, nozzleRadius);
    if (diamond.intensity > 0) out.push(diamond);
  }
  return out;
}

/* --------------------------- The particle stream --------------------------- */

export interface PlumeParticle {
  /** Where round the column it rides, in radians. */
  angle: number;
  /** 0 on the axis, 1 at the envelope's edge. */
  radial: number;
  /** Multiplier on the exhaust velocity — this is what desynchronises them. */
  speed: number;
  /** Where in its own travel it starts, in [0, 1). */
  phase: number;
  /**
   * Per-particle weight. `pointsMaterial` has a single size for the whole draw
   * call, so this varies BRIGHTNESS rather than size — it is what stops the
   * stream reading as a uniform stipple.
   */
  size: number;
}

/** Slowest and fastest particle, as a fraction of the mean exhaust velocity. */
const SPEED_MIN = 0.55;
const SPEED_MAX = 1.65;

/**
 * A seeded stream of particles.
 *
 * Phases are STRATIFIED — particle i starts somewhere inside the i-th slice of
 * its life — so the column is evenly populated from the first frame and stays
 * that way, and speeds are spread wide enough that the distribution never
 * re-synchronises. Both are drawn from the ship's seed, so two sessions of the
 * same blueprint render the same exhaust; the old cloud used `Math.random()`
 * and could not.
 */
export function plumeStream(count: number, seed: number): PlumeParticle[] {
  const rng = streamFor(seed, 'plume');
  const out: PlumeParticle[] = [];
  const n = Math.max(0, Math.floor(count));

  for (let i = 0; i < n; i++) {
    out.push({
      angle: rng() * Math.PI * 2,
      // sqrt keeps the draw uniform over the disc rather than crowding the axis.
      radial: Math.sqrt(rng()),
      speed: SPEED_MIN + rng() * (SPEED_MAX - SPEED_MIN),
      phase: (i + rng()) / n,
      size: 0.55 + rng() * 0.95,
    });
  }
  return out;
}

/**
 * Advance one particle's phase, wrapping into [0, 1).
 *
 * `lifetime` is how long a particle takes to traverse the column at unit speed.
 * Guards a zero lifetime and a non-finite delta, either of which would put NaN
 * into a position buffer and blank the whole draw call.
 */
export function advancePhase(
  phase: number,
  delta: number,
  speed: number,
  lifetime: number,
): number {
  if (!Number.isFinite(phase)) return 0;
  if (!Number.isFinite(delta) || delta <= 0 || lifetime <= 0) return phase;
  const next = phase + (delta * speed) / lifetime;
  return next - Math.floor(next);
}

/**
 * Write the stream's positions into a caller-owned buffer, in the plume's
 * local frame: the drive fires along +Y, from the throat at the origin.
 *
 * Particles ride the *envelope* rather than the core — the visible core tapers
 * as it cools, but the sparks in it disperse — so the trail fans out behind the
 * column instead of converging to a point with it.
 */
export function writePlumePoints(
  stream: readonly PlumeParticle[],
  phases: Float32Array,
  extent: PlumeExtent,
  swirl: number,
  out: Float32Array,
): void {
  const count = Math.min(stream.length, phases.length, Math.floor(out.length / 3));

  for (let i = 0; i < count; i++) {
    const particle = stream[i] as PlumeParticle;
    const f = phases[i] ?? 0;
    const radius =
      (extent.sparkRadius + (extent.sparkTipRadius - extent.sparkRadius) * f) *
      particle.radial;
    // Differential swirl: the outside of the column lags the axis, which is
    // what makes the stream read as flow rather than as drifting confetti.
    const angle = particle.angle + swirl * particle.radial;

    out[i * 3] = Math.cos(angle) * radius;
    out[i * 3 + 1] = f * extent.envelopeLength;
    out[i * 3 + 2] = Math.sin(angle) * radius;
  }
}

/**
 * Write per-particle colour into a caller-owned buffer.
 *
 * A particle leaves the throat at the core's white-hot colour, cools to the
 * tier's signature colour, and fades out before the end of the envelope. Doing
 * it per vertex is what keeps the tier hue legible: a single flat colour at an
 * intensity high enough to bloom clips to white, which is exactly how the old
 * plume lost every drive's identity.
 *
 * `hot` and `cool` are linear RGB triples, not hex — colour-space conversion is
 * the renderer's job.
 */
export function writePlumeColours(
  stream: readonly PlumeParticle[],
  phases: Float32Array,
  hot: readonly [number, number, number],
  cool: readonly [number, number, number],
  brightness: number,
  out: Float32Array,
): void {
  const count = Math.min(stream.length, phases.length, Math.floor(out.length / 3));

  for (let i = 0; i < count; i++) {
    const f = phases[i] ?? 0;
    // Cool quickly, then fade. Additive blending has no alpha to fade with, so
    // the fade has to happen in the colour itself.
    const mix = Math.min(1, f * 2.2);
    // Reaches exactly zero at the end of the run, so no particle ever winks out
    // mid-air when it wraps back to the throat.
    const fade = Math.pow(Math.max(0, 1 - f), 1.6) * brightness * (stream[i] as PlumeParticle).size;

    out[i * 3] = (hot[0] + (cool[0] - hot[0]) * mix) * fade;
    out[i * 3 + 1] = (hot[1] + (cool[1] - hot[1]) * mix) * fade;
    out[i * 3 + 2] = (hot[2] + (cool[2] - hot[2]) * mix) * fade;
  }
}

/**
 * Flicker multiplier for the core's brightness.
 *
 * Two incommensurable sine terms scaled by the drive's turbulence, so an ion
 * pulse is all but steady and a fusion torch never repeats. Deterministic in
 * `time`, so a frozen clock gives a frozen plume — which is what lets reduced
 * motion hold the whole effect still and lets the seed-determinism test compare
 * two sessions honestly.
 */
export function plumeFlicker(drive: SublightId, time: number, throttle: number): number {
  const turbulence = PLUME_PROFILES[drive].turbulence;
  if (turbulence <= 0) return 1;
  const amount = 0.16 * turbulence * clamp01(throttle);
  return 1 + amount * (Math.sin(time * 17.3) * 0.6 + Math.sin(time * 6.1) * 0.4);
}
