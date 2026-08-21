import { Color } from 'three';
import type { MaterialSpec, WearChannels } from '../../domain/types';
export type { RenderMode } from '../viewportOptions';


const RUST = new Color('#6b3b1f');
const SOOT = new Color('#0a0c10');

/**
 * Weathered PBR parameters.
 *
 * Wear pushes roughness up and metalness down — an oxidised, grimy plate stops
 * behaving like a polished conductor. Colour drifts toward soot with grime and
 * toward rust with oxidation.
 */
export function weatheredPbr(spec: MaterialSpec, wear: WearChannels) {
  const base = new Color(spec.color);

  const soiling = Math.min(1, wear.grime * 0.75 + wear.thermal * 0.35);
  const oxidation = wear.oxidation;

  const color = base.clone().lerp(SOOT, soiling * 0.45).lerp(RUST, oxidation * 0.32);

  const roughness = Math.min(
    1,
    spec.roughness + wear.abrasion * 0.28 + wear.grime * 0.3 + oxidation * 0.34,
  );
  const metalness = Math.max(0.05, spec.metalness - oxidation * 0.45 - wear.grime * 0.15);

  return { color, roughness, metalness };
}
