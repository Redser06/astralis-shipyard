import { useMemo, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import {
  AdditiveBlending,
  Color,
  DoubleSide,
  FrontSide,
  type Group,
  type Mesh,
  type MeshBasicMaterial,
  type PointLight,
  type Points,
} from 'three';
import type { SublightId } from '../../domain/types';
import {
  advancePhase,
  plumeExtent,
  plumeFlicker,
  plumeProfile,
  plumeStream,
  plumeThrottle,
  shockAt,
  shockCount,
  spool,
  writePlumeColours,
  writePlumePoints,
  type PlumeExtent,
  type ShockDiamond,
} from '../../domain/plume';
import { ENGINE_PROFILE } from './engineProfile';
import type { RenderMode } from '../materials/renderModes';

/**
 * The exhaust plume.
 *
 * WHAT WAS HERE BEFORE, and why none of it survived. The old plume lived in
 * `Ship.tsx` and was two objects: a 240-point cloud and a flat disc. It never
 * saw `blueprint.sublight` at all — it was handed the ship's trim colour — so
 * the three drive tiers threw identical exhaust. Every particle shared one
 * speed and one wrap threshold, so the cloud marched up the axis and snapped
 * back as a block rather than flowing. And its core ran `toneMapped={false}` at
 * an emissive intensity of 6, which clips to flat white before the composer
 * ever sees it, so whatever hue the tier did have was destroyed on the way out.
 *
 * HOW THIS ONE IS BUILT. Four nested, additively blended, open-ended shells —
 * a wide diffuse envelope and three tightening core layers — with `DoubleSide`
 * so a ray through the column crosses eight surfaces near the axis and two at
 * a grazing angle near the silhouette. That accumulation is what reads as
 * volume, and it is why no single layer has to be bright enough to clip:
 * brightness comes from depth of material, so the tier's hue survives all the
 * way through ACES. On top of that sit a desynchronised particle stream (its
 * colour per vertex, cooling and fading downstream), standing shock diamonds
 * for the fusion torch, and a real `pointLight` at the throat.
 *
 * THE LIGHT IS THE POINT. Before this the scene had no point lights whatsoever,
 * so the brightest object on the ship illuminated nothing: a fusion torch sat
 * in front of an unlit engine deck. The nozzle light now throws the drive's own
 * colour up the hull, and it scales with the throttle, so Test Burn changes the
 * lighting of the whole stern rather than just adding a decal.
 *
 * NOTHING HERE ALLOCATES PER FRAME. Geometry is authored once at full throttle
 * and animated by scaling one group; the shells' opacities, the diamonds'
 * transforms and the light's intensity are written onto objects that already
 * exist; and the particle buffers are filled in place by `domain/plume.ts`.
 * Materials are declared as JSX, so the reconciler still owns their disposal.
 */

/** Particles in the stream. Enough to read as turbulence, few enough to be free. */
const STREAM_PARTICLES = 150;

/**
 * One additively blended shell of the column.
 *
 * `bottom` and `top` are multipliers on the base radius — the core's or the
 * envelope's — and `length` a fraction of that base's length. Omit `top` and
 * the shell simply follows its base's own taper.
 */
interface PlumeShell {
  id: string;
  base: 'core' | 'envelope';
  bottom: number;
  top?: number;
  length: number;
  opacity: number;
  tint: 'core' | 'mantle';
  /**
   * Draw the far wall as well as the near one.
   *
   * Only the small inner shells do. For a hollow cone every exterior ray
   * crosses both walls, so `DoubleSide` on the two big outer shells was buying
   * a uniform doubling of brightness at the price of doubling the fill on the
   * largest screen area the effect covers — a bad trade in a software
   * rasteriser, and this scene is rendered under SwiftShader in CI. Their
   * opacities carry the brightness instead.
   */
  bothSides: boolean;
}

/**
 * The nested shells, outermost first.
 *
 * Opacities are deliberately low — see the note above about brightness coming
 * from depth rather than from any one layer being bright.
 *
 * `bloom` exists for one reason: a single cone from throat to point has a dead
 * straight silhouette, and straight-edged exhaust reads as a paper cone stuck
 * on the back of the ship. A short, wider shell that closes faster than the
 * envelope does crosses it about a third of the way down, so the compound
 * outline is concave — a flame ballooning at the nozzle and drawing out to a
 * point, rather than a triangle.
 */
const SHELLS: readonly PlumeShell[] = [
  // A wake that reaches past the column and closes to nothing.
  //
  // The shells below are open-ended cones at uniform opacity, and uniform
  // opacity does not fade — it stops. However finely a cone tapers, its far rim
  // is still a hard edge, which read as a solid tube cut off square rather than
  // as exhaust dissipating. Tightening the taper is not the fix either: the
  // per-tier `taper` values are load-bearing identity (the MPD is deliberately
  // a broad column, the torch a spike) and plume.test.ts asserts exactly that.
  //
  // So this shell adds the dissipation instead of taking away the shape: it
  // starts narrower than the envelope, runs half again as long, and converges,
  // so the compound silhouette trails off instead of ending.
  { id: 'wake', base: 'envelope', bottom: 0.62, top: 0.02, length: 1.5, opacity: 0.03, tint: 'mantle', bothSides: false },
  { id: 'bloom', base: 'envelope', bottom: 1.18, top: 0.5, length: 0.34, opacity: 0.085, tint: 'mantle', bothSides: false },
  { id: 'envelope', base: 'envelope', bottom: 1, length: 1, opacity: 0.085, tint: 'mantle', bothSides: false },
  { id: 'outer', base: 'core', bottom: 1, length: 1, opacity: 0.2, tint: 'mantle', bothSides: false },
  // Mid stays on the tier's own colour. Taking it to the near-white core colour
  // put white over two thirds of the column's width and drowned the hue that
  // the whole per-tier table exists to establish.
  { id: 'mid', base: 'core', bottom: 0.64, length: 0.88, opacity: 0.2, tint: 'mantle', bothSides: true },
  { id: 'inner', base: 'core', bottom: 0.34, length: 0.72, opacity: 0.36, tint: 'core', bothSides: true },
];

interface ExhaustPlumeProps {
  sublight: SublightId;
  burning: boolean;
  dead: boolean;
  /** Seeds the particle stream, so the same ship throws the same exhaust. */
  seed: number;
  mode: RenderMode;
  /**
   * Freezes the flow and the flicker. `useReducedMotion` says functional motion
   * stays — and the plume's *scale* still answers Test Burn, which is the thing
   * the control exists to show — but a 17 Hz flicker on the brightest object in
   * the scene is exactly what the preference is asking to be spared. Freezing
   * it also pins the exhaust for the seed-determinism test.
   */
  reducedMotion: boolean;
}

export function ExhaustPlume({
  sublight,
  burning,
  dead,
  seed,
  mode,
  reducedMotion,
}: ExhaustPlumeProps) {
  const profile = useMemo(() => plumeProfile(sublight), [sublight]);
  const nozzleRadius = ENGINE_PROFILE[sublight].radius;

  // Full-throttle dimensions. The geometry is built to these once and animated
  // by scaling; rebuilding a lathe every frame is how the prototype leaked.
  const full = useMemo(
    () => plumeExtent(sublight, 1, nozzleRadius),
    [sublight, nozzleRadius],
  );

  const stream = useMemo(() => plumeStream(STREAM_PARTICLES, seed), [seed]);
  const phases = useMemo(() => Float32Array.from(stream, (p) => p.phase), [stream]);

  // Seeded and pre-filled, so the first rendered frame already shows a
  // populated column rather than 220 points stacked on the origin.
  const buffers = useMemo(() => {
    const positions = new Float32Array(stream.length * 3);
    const colours = new Float32Array(stream.length * 3);
    const hot = new Color(profile.coreColour);
    const cool = new Color(profile.sparkColour);
    writePlumePoints(stream, phases, full, 0, positions);
    writePlumeColours(stream, phases, [hot.r, hot.g, hot.b], [cool.r, cool.g, cool.b], 1, colours);
    return {
      positions,
      colours,
      hot: [hot.r, hot.g, hot.b] as [number, number, number],
      cool: [cool.r, cool.g, cool.b] as [number, number, number],
    };
  }, [stream, phases, full, profile]);

  const diamonds = shockCount(sublight);

  const columnRef = useRef<Group>(null);
  const shellRefs = useRef<(MeshBasicMaterial | null)[]>([]);
  const diamondRefs = useRef<(Mesh | null)[]>([]);
  const pointsRef = useRef<Points>(null);
  const lightRef = useRef<PointLight>(null);

  // Scratch, reused every frame.
  const throttleRef = useRef(plumeThrottle(burning, dead));
  const extentRef = useRef<PlumeExtent>(plumeExtent(sublight, 1, nozzleRadius));
  const shockRef = useRef<ShockDiamond>({ offset: 0, radius: 0, intensity: 0 });

  useFrame((state, delta) => {
    // Every input below is read live off props. Nothing here closes over a
    // value captured at mount — that stale closure in a render loop is the
    // single worst bug in this repo's history, and it is what made the old
    // Test Burn silently do nothing.
    const target = plumeThrottle(burning, dead);
    const throttle = reducedMotion ? target : spool(throttleRef.current, target, delta);
    throttleRef.current = throttle;

    const extent = plumeExtent(sublight, throttle, nozzleRadius, extentRef.current);
    const time = state.clock.elapsedTime;
    const flicker = reducedMotion ? 1 : plumeFlicker(sublight, time, throttle);

    // One scale drives the whole column: the envelope and the core shells share
    // a radius ratio by construction, so they cannot drift apart.
    const column = columnRef.current;
    if (column) {
      const radiusScale = full.coreRadius > 0 ? extent.coreRadius / full.coreRadius : 0;
      const lengthScale = full.coreLength > 0 ? extent.coreLength / full.coreLength : 0;
      column.scale.set(radiusScale, lengthScale, radiusScale);
    }

    for (let i = 0; i < SHELLS.length; i++) {
      const material = shellRefs.current[i];
      const shell = SHELLS[i];
      if (!material || !shell) continue;
      material.opacity = shell.opacity * extent.opacity * flicker;
    }

    for (let i = 0; i < diamonds; i++) {
      const mesh = diamondRefs.current[i];
      if (!mesh) continue;
      const shock = shockAt(sublight, i, throttle, nozzleRadius, shockRef.current);
      // A diamond that would stand past the end of the flame reports zero
      // intensity, and simply is not drawn — rather than hanging in the dark.
      mesh.visible = shock.intensity > 0;
      if (!mesh.visible) continue;
      mesh.position.y = shock.offset;
      mesh.scale.set(shock.radius, shock.radius * 1.9, shock.radius);
      (mesh.material as MeshBasicMaterial).opacity = 0.5 * shock.intensity * flicker;
    }

    const points = pointsRef.current;
    if (points) {
      if (!reducedMotion) {
        // Time to traverse the column: shorter at full throttle, because the
        // exhaust is genuinely moving faster, not just further.
        const lifetime = 0.95 - 0.45 * throttle;
        for (let i = 0; i < phases.length; i++) {
          const particle = stream[i];
          if (!particle) continue;
          // The domain's wrap, not a reimplementation of it here: the guards
          // against a zero lifetime and a non-finite delta are what stop a
          // stalled tab putting NaN into the buffer and blanking the draw call,
          // and they are covered by tests.
          phases[i] = advancePhase(phases[i] ?? 0, delta, particle.speed, lifetime);
        }
      }
      const swirl = reducedMotion ? 0 : time * profile.turbulence * 0.9;
      writePlumePoints(stream, phases, extent, swirl, buffers.positions);
      writePlumeColours(
        stream,
        phases,
        buffers.hot,
        buffers.cool,
        extent.opacity * flicker,
        buffers.colours,
      );
      points.geometry.getAttribute('position').needsUpdate = true;
      points.geometry.getAttribute('color').needsUpdate = true;
    }

    const light = lightRef.current;
    if (light) {
      light.intensity = extent.lightIntensity * flicker;
      light.distance = extent.lightRange;
    }
  });

  // A derelict is powerless: no column, no sparks, no light, nothing to dispose
  // of on the next frame either.
  if (dead) return null;

  return (
    <group>
      {/* The column. Authored at full throttle, scaled to the current one. */}
      <group ref={columnRef}>
        {SHELLS.map((shell, index) => {
          const base =
            shell.base === 'envelope'
              ? { radius: full.envelopeRadius, tip: full.envelopeTipRadius, span: full.envelopeLength }
              : { radius: full.coreRadius, tip: full.tipRadius, span: full.coreLength };
          const radiusBottom = base.radius * shell.bottom;
          const radiusTop =
            shell.top !== undefined ? base.radius * shell.top : base.tip * shell.bottom;
          const length = base.span * shell.length;

          return (
            <mesh key={shell.id} position={[0, length / 2, 0]}>
              {/* Open-ended: a capped cylinder puts a flat disc across the
                  throat, which is what made the old nozzle glow degenerate to
                  a sliver from every angle but dead astern. */}
              <cylinderGeometry args={[radiusTop, radiusBottom, length, 16, 1, true]} />
              <meshBasicMaterial
                ref={(material) => {
                  shellRefs.current[index] = material;
                }}
                color={shell.tint === 'core' ? profile.coreColour : profile.mantleColour}
                transparent
                opacity={shell.opacity}
                blending={AdditiveBlending}
                depthWrite={false}
                side={shell.bothSides ? DoubleSide : FrontSide}
              />
            </mesh>
          );
        })}
      </group>

      {/* Standing shock diamonds — the fusion torch only. Outside the scaled
          column because their spacing widens with chamber pressure more slowly
          than the flame lengthens, so they cannot just ride its scale. */}
      {Array.from({ length: diamonds }, (_, index) => (
        <mesh
          key={index}
          ref={(mesh) => {
            diamondRefs.current[index] = mesh;
          }}
        >
          <octahedronGeometry args={[1, 0]} />
          <meshBasicMaterial
            color={profile.coreColour}
            transparent
            opacity={0}
            blending={AdditiveBlending}
            depthWrite={false}
          />
        </mesh>
      ))}

      {/* Turbulence riding the column. Per-vertex colour, so a particle leaves
          the throat white-hot, cools to the drive's own colour and fades — the
          one place a flat colour would have cost the tier its identity. */}
      <points ref={pointsRef} frustumCulled={false}>
        <bufferGeometry>
          <bufferAttribute attach="attributes-position" args={[buffers.positions, 3]} />
          <bufferAttribute attach="attributes-color" args={[buffers.colours, 3]} />
        </bufferGeometry>
        <pointsMaterial
          vertexColors
          // Small. At a third of the nozzle radius these read as square
          // confetti tumbling behind the ship rather than as turbulence.
          size={nozzleRadius * 0.12}
          sizeAttenuation
          transparent
          opacity={0.85}
          blending={AdditiveBlending}
          depthWrite={false}
        />
      </points>

      {/* The light. Photoreal only: in Thermal IR a white-hot pool on the stern
          would be false temperature data, and in wireframe and X-Ray the hull
          is drawn with basic materials that no light can reach. */}
      {mode === 'pbr' && (
        <pointLight
          ref={lightRef}
          position={[0, nozzleRadius * 0.5, 0]}
          color={profile.lightColour}
          intensity={0}
          distance={full.lightRange}
          decay={2}
        />
      )}
    </group>
  );
}
