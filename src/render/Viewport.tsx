import { Suspense, useEffect, useMemo, useRef, useState } from 'react';
import { Canvas, useFrame, useThree } from '@react-three/fiber';
import { OrbitControls } from '@react-three/drei';
import { Bloom, EffectComposer, SMAA } from '@react-three/postprocessing';
import { ACESFilmicToneMapping, PCFShadowMap, Vector3, type Group } from 'three';
import type { Blueprint } from '../domain/types';
import { Ship } from './Ship';
import { SceneEnvironment } from './environments/Environments';
import {
  PRESET_POSITIONS,
  type CameraPreset,
  type EnvironmentId,
  type Protrusions,
} from './viewportOptions';
import type { RenderMode } from './materials/renderModes';
import { DroneSwarm } from './drones/DroneSwarm';
import { ShuttleCraft } from './drones/ShuttleCraft';
import { CinematicDirector, type CinematicCut } from './camera/CinematicDirector';


/**
 * Moves the camera to a preset, then gets out of the way so orbit control is
 * never fought over. Interpolation stops as soon as it is close enough.
 */
function CameraRig({ preset }: { preset: CameraPreset }) {
  const { camera } = useThree();
  const target = useMemo(() => new Vector3(...PRESET_POSITIONS[preset]), [preset]);
  const animating = useRef(true);

  useEffect(() => {
    animating.current = true;
  }, [preset]);

  useFrame((_, delta) => {
    if (!animating.current) return;
    camera.position.lerp(target, 1 - Math.pow(0.0015, delta));
    camera.lookAt(0, 0, 0);
    if (camera.position.distanceTo(target) < 0.05) animating.current = false;
  });

  return null;
}

/**
 * Key / fill / rim, with the key casting shadows.
 *
 * The prototype ran seven lights and no shadow map at all, which is why its
 * ships had no sense of form — nothing ever occluded anything else.
 */
function LightingRig({ intensity }: { intensity: number }) {
  return (
    <>
      <directionalLight
        position={[12, 16, 10]}
        intensity={intensity}
        castShadow
        shadow-mapSize={[2048, 2048]}
        shadow-camera-near={1}
        shadow-camera-far={70}
        shadow-camera-left={-24}
        shadow-camera-right={24}
        shadow-camera-top={24}
        shadow-camera-bottom={-24}
        shadow-bias={-0.0005}
        shadow-normalBias={0.02}
      />
      <directionalLight position={[-14, -4, -8]} intensity={intensity * 0.28} color="#38bdf8" />
      <directionalLight position={[0, 4, -18]} intensity={intensity * 0.42} color="#818cf8" />
      <ambientLight intensity={0.15} />
    </>
  );
}

export interface ViewportProps {
  blueprint: Blueprint;
  mode: RenderMode;
  environment: EnvironmentId;
  protrusions: Protrusions;
  burning: boolean;
  autoRotate: boolean;
  rotationSpeed: number;
  lightIntensity: number;
  cameraPreset: CameraPreset;
  onShipReady?: (group: Group) => void;
  cinematicActive?: boolean;
  cinematicCut?: CinematicCut;
  assemblyProgress?: number | null;
  isRepairing?: boolean;
  showDrones?: boolean;
  showShuttles?: boolean;
}

function detectWebGL2(): boolean {
  try {
    const canvas = document.createElement('canvas');
    return Boolean(canvas.getContext('webgl2'));
  } catch {
    return false;
  }
}

function UnsupportedNotice() {
  return (
    <div className="flex h-full w-full items-center justify-center bg-space-950 p-8">
      <div className="glass-panel max-w-md rounded-xl p-6 text-center">
        <h2 className="font-orbitron mb-2 text-lg font-bold text-neon-rose">
          WebGL2 unavailable
        </h2>
        <p className="text-sm text-slate-400">
          Astralis Shipyard renders its viewport with WebGL2, which this browser does not
          report support for. Try a recent Chrome, Edge, Firefox or Safari, and check that
          hardware acceleration is enabled.
        </p>
      </div>
    </div>
  );
}

export function Viewport({
  blueprint,
  mode,
  environment,
  protrusions,
  burning,
  autoRotate,
  rotationSpeed,
  lightIntensity,
  cameraPreset,
  onShipReady,
  cinematicActive = false,
  cinematicCut = 'gantry_dolly',
  assemblyProgress,
  isRepairing = false,
  showDrones = false,
  showShuttles,
}: ViewportProps) {
  // Evaluated once on mount rather than during render, so SSR/tests do not
  // touch the DOM unexpectedly.
  const [supported, setSupported] = useState<boolean | null>(null);
  useEffect(() => setSupported(detectWebGL2()), []);

  if (supported === false) return <UnsupportedNotice />;

  return (
    <Canvas
      shadows={{ type: PCFShadowMap }}
      dpr={[1, 2]}
      camera={{ position: PRESET_POSITIONS.hero, fov: 45, near: 0.1, far: 400 }}
      gl={{
        antialias: false, // SMAA in the composer handles this
        toneMapping: ACESFilmicToneMapping,
        powerPreference: 'high-performance',
        // Lets the framebuffer be read back after render — required by the
        // visual regression suite, and by any future "save a still" feature.
        preserveDrawingBuffer: true,
      }}
    >
      <Suspense fallback={null}>
        <SceneEnvironment environment={environment} intensity={lightIntensity} />
        <LightingRig intensity={lightIntensity} />

        <Ship
          blueprint={blueprint}
          mode={mode}
          protrusions={protrusions}
          burning={burning}
          assemblyProgress={assemblyProgress}
          onReady={onShipReady}
        />

        <DroneSwarm enabled={showDrones} isRepairing={isRepairing} />
        <ShuttleCraft enabled={showShuttles ?? environment === 'drydock'} />

        {/*
          No PCSS here, deliberately.

          three 0.185 deprecated PCFSoftShadowMap and silently substitutes
          PCFShadowMap, so the obvious upgrade is drei's <SoftShadows>. It does
          not work on this three: the PCSS chunk it injects calls
          `unpackRGBAToDepth`, which 0.185 no longer defines, so EVERY
          MeshStandardMaterial fails to compile and the entire opaque scene
          disappears — only additive emissives survive, which looks like the
          ship vanishing rather than like a shader error.

          Revisit when drei ships a fix. Until then PCFShadowMap is what we ask
          for and what we get — asking for the deprecated constant bought a
          console warning and the same shadows.
        */}
        {cinematicActive ? (
          <CinematicDirector active={true} cut={cinematicCut} />
        ) : (
          <>
            <CameraRig preset={cameraPreset} />
            <OrbitControls
              makeDefault
              enableDamping
              dampingFactor={0.08}
              minDistance={8}
              maxDistance={90}
              // The entire auto-rotate fix. In the prototype these were read once
              // inside a useEffect(..., []) render loop and could never change;
              // here they are props, re-read by the controls on every update.
              autoRotate={autoRotate}
              autoRotateSpeed={rotationSpeed * 2}
            />
          </>
        )}

        {/*
          No ambient occlusion, and the reason is measured rather than assumed.

          N8AO is an already-installed, unused dependency, and on paper it is the
          obvious fix for the one thing flat `ambientLight` cannot do — darken a
          crevice. Wired up and measured on this scene it costs about 3x the
          frame time (2.09 fps baseline against 0.72-0.88 with the normal pass,
          under SwiftShader at 1440x900) and returns roughly 1-5% mean luminance
          change on the hull.

          The payoff is small here because the scene is already dark, largely
          metallic and lit by IBL, which is exactly the case ambient occlusion
          flatters least. The cost is not small: CI renders under SwiftShader,
          and the visual suite is this project's main safety net — tripling frame
          time pushes it past its timeouts.

          Revisit if the scene gains lighter, more diffuse surfaces, or if the
          suite moves to hardware rendering.
        */}
        <EffectComposer enableNormalPass={false}>
          <Bloom
            intensity={mode === 'thermal' ? 1.1 : 0.55}
            luminanceThreshold={mode === 'wireframe' ? 0.1 : 0.72}
            luminanceSmoothing={0.28}
            mipmapBlur
          />
          <SMAA />
        </EffectComposer>
      </Suspense>
    </Canvas>
  );
}
