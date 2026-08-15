import { Suspense, useEffect, useMemo, useRef, useState } from 'react';
import { Canvas, useFrame, useThree } from '@react-three/fiber';
import { OrbitControls } from '@react-three/drei';
import { Bloom, EffectComposer, SMAA } from '@react-three/postprocessing';
import { ACESFilmicToneMapping, PCFSoftShadowMap, Vector3, type Group } from 'three';
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
}: ViewportProps) {
  // Evaluated once on mount rather than during render, so SSR/tests do not
  // touch the DOM unexpectedly.
  const [supported, setSupported] = useState<boolean | null>(null);
  useEffect(() => setSupported(detectWebGL2()), []);

  if (supported === false) return <UnsupportedNotice />;

  return (
    <Canvas
      shadows={{ type: PCFSoftShadowMap }}
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
          onReady={onShipReady}
        />

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
