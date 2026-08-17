import type { SublightId } from '../../domain/types';

/**
 * Bell dimensions per drive tier.
 *
 * Its own module because `Ship` needs the length to start the exhaust plume at
 * the mouth of whichever bell is fitted, and a constant that suited one tier
 * left the other two either firing from inside the housing or from thin air.
 */
export const ENGINE_PROFILE: Record<
  SublightId,
  { radius: number; length: number; glow: string }
> = {
  ion_pulse: { radius: 0.42, length: 1.0, glow: '#67e8f9' },
  mpd_thruster: { radius: 0.58, length: 1.35, glow: '#a78bfa' },
  fusion_torch: { radius: 0.78, length: 1.75, glow: '#fbbf24' },
};

/** How far aft of its mount face a drive reaches — the plume starts there. */
export const engineBellLength = (sublight: SublightId): number =>
  ENGINE_PROFILE[sublight].length;
