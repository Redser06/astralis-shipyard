import { AdditiveBlending, Color, DoubleSide } from 'three';
import { useMemo } from 'react';
import type { MaterialSpec, WearChannels } from '../../domain/types';
import { weatheredPbr, type RenderMode } from './renderModes';

interface HullMaterialProps {
  spec: MaterialSpec;
  accentColor: string;
  mode: RenderMode;
  wear: WearChannels;
}

/**
 * Rendered as JSX rather than built with `new THREE.Material()` so React Three
 * Fiber owns the lifecycle and disposes it on unmount. The prototype leaked
 * every material it ever created; this makes that failure mode unexpressible.
 */
export function HullMaterial({ spec, accentColor, mode, wear }: HullMaterialProps) {
  const pbr = useMemo(() => weatheredPbr(spec, wear), [spec, wear]);

  switch (mode) {
    case 'wireframe':
      return <meshBasicMaterial color={accentColor} wireframe />;

    case 'xray':
      return (
        <meshBasicMaterial
          color={accentColor}
          transparent
          opacity={0.18}
          depthWrite={false}
          blending={AdditiveBlending}
          side={DoubleSide}
        />
      );

    case 'thermal':
      return (
        <meshStandardMaterial
          color="#05070c"
          emissive={new Color().setHSL(0.62 - wear.thermal * 0.55, 0.95, 0.42)}
          emissiveIntensity={1.5}
          roughness={1}
          metalness={0}
        />
      );

    case 'pbr':
    default:
      return (
        <meshStandardMaterial
          color={pbr.color}
          roughness={pbr.roughness}
          metalness={pbr.metalness}
          // With image-based lighting present this is what makes metal read as
          // metal. Without an environment to reflect, a metalness-0.9 surface
          // is correctly black — which is exactly how the prototype rendered.
          envMapIntensity={1.15}
        />
      );
  }
}

/** Emissive trim: running lights, engine glow, holographic edges. */
export function EmissiveMaterial({
  color,
  intensity = 2,
  mode,
  toneMapped = false,
}: {
  color: string;
  intensity?: number;
  mode: RenderMode;
  /**
   * Trim bypasses ACES by default, which is what makes a running light read as
   * a light rather than as a pale dot. Large-area emitters — window glazing
   * above all — must opt back IN, or they clip to flat white and the bloom
   * pass smears them across the hull.
   */
  toneMapped?: boolean;
}) {
  if (mode === 'wireframe') return <meshBasicMaterial color={color} wireframe />;

  // X-Ray draws the hull as an additive transparent shell so you can see the
  // structure through it. An opaque standard material inside that shell renders
  // as a solid lump floating in the middle of the ship — which is exactly what
  // every emissive fitting did, because this branch did not exist.
  if (mode === 'xray') {
    return (
      <meshBasicMaterial
        color={color}
        transparent
        opacity={0.42}
        depthWrite={false}
        blending={AdditiveBlending}
        side={DoubleSide}
      />
    );
  }

  return (
    <meshStandardMaterial
      color="#000000"
      emissive={color}
      emissiveIntensity={mode === 'thermal' ? intensity * 1.6 : intensity}
      roughness={0.4}
      metalness={0}
      toneMapped={toneMapped}
    />
  );
}
