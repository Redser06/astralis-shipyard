import { useEffect, useMemo, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import {
  DynamicDrawUsage,
  Group,
  InstancedMesh,
  Object3D,
  SpotLight as ThreeSpotLight,
} from 'three';
import type { MissionState } from '../../domain/types';
import { useReducedMotion } from '../useReducedMotion';

interface SearchlightSpec {
  id: string;
  position: [number, number, number];
  targetOffset: [number, number, number];
  color: string;
  intensity: number;
  phaseOffset: number;
}

/**
 * Six articulating robotic work searchlights mounted directly onto the port and
 * starboard spacedock gantry truss columns (x = ±13.2).
 *
 * Forward stations sit at y = 6.2, z = 9 so the top-left sky corner of the
 * hero camera ([21, 11, 26]) remains unobstructed dark space for RC-3.
 */
const SEARCHLIGHT_SPECS: readonly SearchlightSpec[] = [
  { id: 'sl-port-aft', position: [-13.2, -2.5, -13], targetOffset: [0, 0, -4.5], color: '#f8fafc', intensity: 65, phaseOffset: 0.0 },
  { id: 'sl-port-mid', position: [-13.2, 8.8, -3], targetOffset: [0, 0.2, 0], color: '#e0f2fe', intensity: 75, phaseOffset: 1.2 },
  { id: 'sl-port-fwd', position: [-13.2, 6.2, 9], targetOffset: [0, 0.1, 4.5], color: '#f8fafc', intensity: 80, phaseOffset: 2.4 },
  { id: 'sl-stbd-aft', position: [13.2, -2.5, -13], targetOffset: [0, 0, -4.5], color: '#f8fafc', intensity: 65, phaseOffset: 3.6 },
  { id: 'sl-stbd-mid', position: [13.2, 8.8, -3], targetOffset: [0, 0.2, 0], color: '#e0f2fe', intensity: 75, phaseOffset: 4.8 },
  { id: 'sl-stbd-fwd', position: [13.2, 6.2, 9], targetOffset: [0, 0.1, 4.5], color: '#f8fafc', intensity: 80, phaseOffset: 6.0 },
];

const BAY_STROBE_POSITIONS: readonly [number, number, number][] = [
  [-13.2, 7.2, 11],
  [13.2, 7.2, 11],
  [-13.2, 9.6, 3],
  [13.2, 9.6, 3],
  [-13.2, 9.6, -6],
  [13.2, 9.6, -6],
  [-13.2, 9.6, -15],
  [13.2, 9.6, -15],
];

const CORRIDOR_BEACONS: readonly { pos: [number, number, number]; tier: number }[] = [
  { pos: [-10.5, -4.5, 14], tier: 0 },
  { pos: [10.5, -4.5, 14], tier: 0 },
  { pos: [-10.5, 3.0, 14], tier: 0 },
  { pos: [10.5, 3.0, 14], tier: 0 },
  { pos: [-10.5, -4.5, 19], tier: 1 },
  { pos: [10.5, -4.5, 19], tier: 1 },
  { pos: [-10.5, 3.0, 19], tier: 1 },
  { pos: [10.5, 3.0, 19], tier: 1 },
  { pos: [-10.5, -4.5, 24], tier: 2 },
  { pos: [10.5, -4.5, 24], tier: 2 },
  { pos: [-10.5, 3.0, 24], tier: 2 },
  { pos: [10.5, 3.0, 24], tier: 2 },
  { pos: [-10.5, -4.5, 29], tier: 3 },
  { pos: [10.5, -4.5, 29], tier: 3 },
  { pos: [-10.5, 3.0, 29], tier: 3 },
  { pos: [10.5, 3.0, 29], tier: 3 },
];

function ArticulatedSearchlight({
  spec,
  intensityScale,
  shipPresent,
}: {
  spec: SearchlightSpec;
  intensityScale: number;
  shipPresent: boolean;
}) {
  const yokeRef = useRef<Group>(null);
  const headRef = useRef<Group>(null);
  const spotRef = useRef<ThreeSpotLight>(null);
  const targetObjRef = useRef<Group>(null);
  const reducedMotion = useReducedMotion();

  useEffect(() => {
    if (spotRef.current && targetObjRef.current) {
      spotRef.current.target = targetObjRef.current;
    }
  }, []);

  useFrame((state) => {
    if (spotRef.current && targetObjRef.current && spotRef.current.target !== targetObjRef.current) {
      spotRef.current.target = targetObjRef.current;
    }
    if (reducedMotion) return;

    const t = state.clock.elapsedTime + spec.phaseOffset;
    const sweepAmp = shipPresent ? 1.0 : 0.35;
    const thetaY = Math.sin(t * 0.28) * 0.45 * sweepAmp;
    const phiX = Math.cos(t * 0.21) * 0.22 * sweepAmp;

    if (yokeRef.current) {
      yokeRef.current.rotation.y = thetaY;
    }
    if (headRef.current) {
      headRef.current.rotation.x = phiX;
    }

    if (targetObjRef.current) {
      targetObjRef.current.position.set(
        spec.targetOffset[0] + Math.sin(t * 0.28) * 2.4 * sweepAmp,
        spec.targetOffset[1] + Math.cos(t * 0.21) * 1.1 * sweepAmp,
        spec.targetOffset[2] + Math.sin(t * 0.24) * 3.0 * sweepAmp,
      );
    }
  });

  const inwardDir = spec.position[0] < 0 ? 1 : -1;
  const activeScale = shipPresent ? intensityScale : intensityScale * 0.55;

  return (
    <group>
      <group position={spec.position}>
        {/* Armoured gimbal yoke bolted onto gantry truss face */}
        <group ref={yokeRef} rotation={[0, inwardDir * 0.3, 0]}>
          <mesh position={[0, 0.22, 0]}>
            <cylinderGeometry args={[0.24, 0.3, 0.44, 10]} />
            <meshStandardMaterial color="#334155" roughness={0.55} metalness={0.85} />
          </mesh>

          <group ref={headRef} position={[0, 0.48, 0]}>
            {/* Lamp housing canister */}
            <mesh rotation={[Math.PI / 2, 0, 0]}>
              <cylinderGeometry args={[0.34, 0.26, 0.72, 12]} />
              <meshStandardMaterial color="#0f172a" roughness={0.4} metalness={0.9} />
            </mesh>

            {/* Tone-mapped lens disc so bloom never smears into white blobs */}
            <mesh position={[0, 0, 0.37]} rotation={[Math.PI / 2, 0, 0]}>
              <circleGeometry args={[0.31, 14]} />
              <meshStandardMaterial
                color="#e2e8f0"
                emissive={spec.color}
                emissiveIntensity={2.2}
                roughness={0.15}
                toneMapped
              />
            </mesh>

            {/* Focused SpotLight without redundant shadow passes (key light owns shadows) */}
            <spotLight
              ref={spotRef}
              color={spec.color}
              intensity={spec.intensity * activeScale}
              angle={Math.PI / 6}
              penumbra={0.5}
              distance={52}
              decay={1.6}
              castShadow={false}
            />
          </group>
        </group>
      </group>

      {/* World-space target inside the DrydockLighting frame */}
      <group ref={targetObjRef} position={spec.targetOffset} />
    </group>
  );
}

/**
 * Instanced gantry strobe beacons and approach alignment corridor beacons.
 *
 * Uses InstancedMesh so all 24 spacedock beacons add only 4 meshes total and
 * never trigger bloom smear (`toneMapped={true}`, compact bulb radius).
 */
function DockingStatusBeacons({
  missionState,
  missionProgress,
}: {
  missionState?: MissionState | null;
  missionProgress?: number;
}) {
  const reducedMotion = useReducedMotion();

  const housingRef = useRef<InstancedMesh>(null);
  const amberStrobeRef = useRef<InstancedMesh>(null);
  const clearStrobeRef = useRef<InstancedMesh>(null);
  const corridorRef = useRef<InstancedMesh>(null);
  const corridorHousingRef = useRef<InstancedMesh>(null);

  const dummy = useMemo(() => new Object3D(), []);

  // Amber while clamps are engaged or actively retracting (departing progress < 0.35);
  // cyan-emerald once clamps are clear for departure through deep-space flight.
  const clampsRetracting = missionState === 'departing' && (missionProgress ?? 0) < 0.35;
  const departureClear =
    (missionState === 'departing' && !clampsRetracting) ||
    missionState === 'warp' ||
    missionState === 'asteroid_field' ||
    missionState === 'planet_orbit' ||
    missionState === 'combat';

  const undockingFinal = clampsRetracting;

  // Populate static housings once
  useEffect(() => {
    if (housingRef.current) {
      BAY_STROBE_POSITIONS.forEach(([x, y, z], i) => {
        dummy.position.set(x, y, z);
        dummy.rotation.set(0, 0, 0);
        dummy.scale.set(1, 1, 1);
        dummy.updateMatrix();
        housingRef.current!.setMatrixAt(i, dummy.matrix);
      });
      housingRef.current.instanceMatrix.needsUpdate = true;
    }

    if (corridorHousingRef.current) {
      CORRIDOR_BEACONS.forEach(({ pos: [x, y, z] }, i) => {
        dummy.position.set(x, y, z);
        dummy.rotation.set(0, 0, 0);
        dummy.scale.set(1, 1, 1);
        dummy.updateMatrix();
        corridorHousingRef.current!.setMatrixAt(i, dummy.matrix);
      });
      corridorHousingRef.current.instanceMatrix.needsUpdate = true;
    }
  }, [dummy]);

  // Configure dynamic instanced buffers and set initial deterministic pose
  useEffect(() => {
    if (amberStrobeRef.current) {
      amberStrobeRef.current.instanceMatrix.setUsage(DynamicDrawUsage);
      BAY_STROBE_POSITIONS.forEach(([x, y, z], i) => {
        dummy.position.set(x, y + 0.16, z);
        dummy.rotation.set(0, 0, 0);
        const s = departureClear ? 0.001 : 1.0;
        dummy.scale.set(s, s, s);
        dummy.updateMatrix();
        amberStrobeRef.current!.setMatrixAt(i, dummy.matrix);
      });
      amberStrobeRef.current.instanceMatrix.needsUpdate = true;
    }

    if (clearStrobeRef.current) {
      clearStrobeRef.current.instanceMatrix.setUsage(DynamicDrawUsage);
      BAY_STROBE_POSITIONS.forEach(([x, y, z], i) => {
        dummy.position.set(x, y + 0.16, z);
        dummy.rotation.set(0, 0, 0);
        const s = departureClear ? 1.0 : 0.001;
        dummy.scale.set(s, s, s);
        dummy.updateMatrix();
        clearStrobeRef.current!.setMatrixAt(i, dummy.matrix);
      });
      clearStrobeRef.current.instanceMatrix.needsUpdate = true;
    }

    if (corridorRef.current) {
      corridorRef.current.instanceMatrix.setUsage(DynamicDrawUsage);
      CORRIDOR_BEACONS.forEach(({ pos: [x, y, z] }, i) => {
        dummy.position.set(x, y, z);
        dummy.rotation.set(0, 0, 0);
        dummy.scale.set(1, 1, 1);
        dummy.updateMatrix();
        corridorRef.current!.setMatrixAt(i, dummy.matrix);
      });
      corridorRef.current.instanceMatrix.needsUpdate = true;
    }
  }, [departureClear, dummy]);

  useFrame((state) => {
    if (reducedMotion) return;
    const t = state.clock.elapsedTime;
    const pulseHalf = Math.floor(t * 2.4) % 2;

    if (amberStrobeRef.current && clearStrobeRef.current) {
      BAY_STROBE_POSITIONS.forEach(([x, y, z], i) => {
        const pairPhase = (Math.floor(i / 2) + pulseHalf) % 2;
        const showAmber = !departureClear && (pairPhase === 0 || !undockingFinal);
        const showClear = departureClear && pairPhase === 0;

        dummy.position.set(x, y + 0.16, z);
        dummy.rotation.set(0, 0, 0);

        const sA = showAmber ? (pairPhase === 0 ? 1.15 : 0.45) : 0.001;
        dummy.scale.set(sA, sA, sA);
        dummy.updateMatrix();
        amberStrobeRef.current!.setMatrixAt(i, dummy.matrix);

        const sC = showClear ? 1.15 : 0.001;
        dummy.scale.set(sC, sC, sC);
        dummy.updateMatrix();
        clearStrobeRef.current!.setMatrixAt(i, dummy.matrix);
      });
      amberStrobeRef.current.instanceMatrix.needsUpdate = true;
      clearStrobeRef.current.instanceMatrix.needsUpdate = true;
    }

    if (corridorRef.current) {
      // Sequential chase: inbound (3->0) during return_transit, outbound (0->3) during departure
      const inbound = missionState === 'return_transit';
      const activeTier = inbound
        ? 3 - (Math.floor(t * 3.2) % 4)
        : Math.floor(t * 3.2) % 4;

      CORRIDOR_BEACONS.forEach(({ pos: [x, y, z], tier }, i) => {
        const active = tier === activeTier;
        const s = active ? 1.35 : 0.65;
        dummy.position.set(x, y, z);
        dummy.rotation.set(0, 0, 0);
        dummy.scale.set(s, s, s);
        dummy.updateMatrix();
        corridorRef.current!.setMatrixAt(i, dummy.matrix);
      });
      corridorRef.current.instanceMatrix.needsUpdate = true;
    }
  });

  const corridorColor = departureClear ? '#10b981' : '#06b6d4';

  return (
    <group>
      {/* Bay strobe housings */}
      <instancedMesh ref={housingRef} args={[undefined, undefined, BAY_STROBE_POSITIONS.length]}>
        <cylinderGeometry args={[0.16, 0.22, 0.2, 8]} />
        <meshStandardMaterial color="#1e293b" roughness={0.5} metalness={0.85} />
      </instancedMesh>

      {/* Amber clamping/welding strobe bulbs */}
      <instancedMesh ref={amberStrobeRef} args={[undefined, undefined, BAY_STROBE_POSITIONS.length]}>
        <sphereGeometry args={[0.15, 8, 8]} />
        <meshStandardMaterial
          color="#f59e0b"
          emissive="#f59e0b"
          emissiveIntensity={2.0}
          roughness={0.2}
          toneMapped
        />
      </instancedMesh>

      {/* Cyan/Emerald departure-clear strobe bulbs */}
      <instancedMesh ref={clearStrobeRef} args={[undefined, undefined, BAY_STROBE_POSITIONS.length]}>
        <sphereGeometry args={[0.15, 8, 8]} />
        <meshStandardMaterial
          color="#10b981"
          emissive="#10b981"
          emissiveIntensity={2.0}
          roughness={0.2}
          toneMapped
        />
      </instancedMesh>

      {/* Approach alignment corridor ring frames */}
      <instancedMesh ref={corridorHousingRef} args={[undefined, undefined, CORRIDOR_BEACONS.length]}>
        <torusGeometry args={[0.38, 0.06, 6, 12]} />
        <meshStandardMaterial color="#334155" roughness={0.55} metalness={0.85} />
      </instancedMesh>

      {/* Approach alignment corridor beacon cores */}
      <instancedMesh ref={corridorRef} args={[undefined, undefined, CORRIDOR_BEACONS.length]}>
        <sphereGeometry args={[0.14, 8, 8]} />
        <meshStandardMaterial
          color={corridorColor}
          emissive={corridorColor}
          emissiveIntensity={1.85}
          roughness={0.2}
          toneMapped
        />
      </instancedMesh>
    </group>
  );
}

export interface DrydockLightingProps {
  intensity?: number;
  missionState?: MissionState | null;
  missionProgress?: number;
}

export function DrydockLighting({
  intensity = 1.0,
  missionState,
  missionProgress = 0,
}: DrydockLightingProps) {
  const shipPresent =
    missionState == null ||
    missionState === 'docked' ||
    missionState === 'repair' ||
    missionState === 'departing' ||
    missionState === 'return_transit';

  return (
    <group name="drydock-lighting">
      {/* 6 Articulating robotic searchlight towers bolted onto gantry columns */}
      {SEARCHLIGHT_SPECS.map((spec) => (
        <ArticulatedSearchlight
          key={spec.id}
          spec={spec}
          intensityScale={intensity}
          shipPresent={shipPresent}
        />
      ))}

      {/* Instanced bay status strobes & approach corridor chase lights */}
      <DockingStatusBeacons missionState={missionState} missionProgress={missionProgress} />
    </group>
  );
}
