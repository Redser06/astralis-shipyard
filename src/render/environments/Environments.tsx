import { memo, useMemo } from 'react';
import { Environment, Lightformer } from '@react-three/drei';
import type { Blueprint, MissionState } from '../../domain/types';
import type { EnvironmentId } from '../viewportOptions';
import { AmbientTraffic } from './AmbientTraffic';
import { DrydockStation } from './DrydockStation';
import { AsteroidField, SpaceBackdrop } from './SpaceBackdrop';

/**
 * Image-based lighting.
 *
 * This is the single most important change in the whole render rebuild. The
 * prototype ran hull materials at metalness 0.85–1.0 with no environment map
 * anywhere, and a metallic BRDF has no diffuse term — with nothing to reflect,
 * those hulls were *correctly* rendering as near-black silhouettes.
 *
 * The rig is built from Lightformers rather than a downloaded HDRI, so it
 * costs no network request, works offline, and can be tinted per environment.
 *
 * Memoized on `(env, intensity)` with `useMemo` children so `<Environment frames={1}>`
 * never re-renders its 6-face cubemap portal (`virtualScene`) on blueprint edits or
 * 10 Hz mission ticks.
 */
const IblRig = memo(function IblRig({ env, intensity }: { env: EnvironmentId; intensity: number }) {
  const scale = intensity / 2.4;

  const children = useMemo(() => {
    if (env === 'nebula') {
      return (
        <>
          <color attach="background" args={['#0a0618']} />
          <Lightformer intensity={2.4 * scale} color="#a855f7" position={[0, 6, -9]} scale={[12, 6, 1]} />
          <Lightformer intensity={1.8 * scale} color="#38bdf8" position={[-8, 1, 4]} scale={[8, 8, 1]} rotation={[0, Math.PI / 2, 0]} />
          <Lightformer intensity={1.4 * scale} color="#f43f5e" position={[8, -2, 2]} scale={[7, 7, 1]} rotation={[0, -Math.PI / 2, 0]} />
          <Lightformer intensity={0.9 * scale} color="#ffffff" position={[0, -7, 0]} scale={[10, 10, 1]} rotation={[Math.PI / 2, 0, 0]} />
        </>
      );
    }

    if (env === 'asteroid') {
      return (
        <>
          <color attach="background" args={['#07090e']} />
          {/* One hard, distant sun and very little bounce — belt lighting is brutal. */}
          <Lightformer form="circle" intensity={7 * scale} color="#fff4e0" position={[10, 6, 6]} scale={[3, 3, 1]} />
          <Lightformer intensity={0.5 * scale} color="#1e3a5f" position={[-9, -2, -6]} scale={[12, 12, 1]} />
          <Lightformer intensity={0.35 * scale} color="#334155" position={[0, -8, 0]} scale={[12, 12, 1]} rotation={[Math.PI / 2, 0, 0]} />
        </>
      );
    }

    // Drydock — an enclosed industrial bay. Long overhead strips plus cool fill,
    // which is what gives the hull plates their linear specular highlights.
    return (
      <>
        <color attach="background" args={['#0b1120']} />
        <Lightformer form="rect" intensity={5 * scale} color="#ffffff" position={[0, 9, 0]} scale={[14, 3, 1]} rotation={[Math.PI / 2, 0, 0]} />
        <Lightformer form="rect" intensity={3 * scale} color="#dbeafe" position={[0, 9, -7]} scale={[14, 2, 1]} rotation={[Math.PI / 2, 0, 0]} />
        <Lightformer intensity={2.2 * scale} color="#38bdf8" position={[-10, 0, 0]} scale={[10, 10, 1]} rotation={[0, Math.PI / 2, 0]} />
        <Lightformer intensity={1.6 * scale} color="#818cf8" position={[10, 0, 0]} scale={[10, 10, 1]} rotation={[0, -Math.PI / 2, 0]} />
        <Lightformer intensity={1.2 * scale} color="#f59e0b" position={[0, -6, 8]} scale={[8, 4, 1]} />
      </>
    );
  }, [env, scale]);

  return (
    <Environment resolution={256} frames={1}>
      {children}
    </Environment>
  );
});

/* --------------------------- Entry point --------------------------- */

export function SceneEnvironment({
  environment,
  intensity,
  blueprint,
  missionState,
  missionProgress,
  dockingConnected = true,
}: {
  environment: EnvironmentId;
  intensity: number;
  blueprint?: Blueprint;
  missionState?: MissionState | null;
  missionProgress?: number;
  dockingConnected?: boolean;
}) {
  return (
    <>
      <IblRig env={environment} intensity={intensity} />
      <SpaceBackdrop environment={environment} intensity={intensity} />
      <AmbientTraffic environment={environment} />
      {environment === 'drydock' && (
        <DrydockStation
          intensity={intensity}
          blueprint={blueprint}
          missionState={missionState}
          missionProgress={missionProgress}
          dockingConnected={dockingConnected}
        />
      )}
      {environment === 'asteroid' && <AsteroidField />}
    </>
  );
}
