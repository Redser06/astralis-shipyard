import type { SublightId } from '../../domain/types';
import { PLUME_PROFILES } from '../../domain/plume';

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
  // `glow` is the drive's own plume colour rather than a second copy of it. The
  // throat and the exhaust leaving it are the same fire; two tables would have
  // drifted apart the first time either was retuned.
  ion_pulse: { radius: 0.42, length: 1.0, glow: PLUME_PROFILES.ion_pulse.lightColour },
  mpd_thruster: { radius: 0.58, length: 1.35, glow: PLUME_PROFILES.mpd_thruster.lightColour },
  fusion_torch: { radius: 0.78, length: 1.75, glow: PLUME_PROFILES.fusion_torch.lightColour },
};

/** How far aft of its mount face a drive reaches — the plume starts there. */
export const engineBellLength = (sublight: SublightId): number =>
  ENGINE_PROFILE[sublight].length;
