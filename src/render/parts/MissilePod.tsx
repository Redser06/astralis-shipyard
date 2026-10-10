import { useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import { Group, MathUtils } from 'three';
import type { RenderMode } from '../materials/renderModes';
import { MountFlange } from './Fitting';
import { EmissiveMaterial } from '../materials/HullMaterial';

interface MissilePodProps {
  mode: RenderMode;
  dead: boolean;
  firing?: boolean;
}

/**
 * Kinetic Missile Bay & Rotary Salvo Pod.
 *
 * Modeled after BotForge PR #17 kinetic missile systems:
 * - Armored bay doors pivot outward when active.
 * - Rotary magazine indices tube positions.
 * - Missiles launch with emissive flame trails.
 * - Strict mounting face convention at local y = 0.
 */
export function MissilePod({ mode, dead, firing = false }: MissilePodProps) {
  const leftDoorRef = useRef<Group>(null);
  const rightDoorRef = useRef<Group>(null);
  const magazineRef = useRef<Group>(null);
  const missileRackRef = useRef<Group>(null);

  // Door opening progress (0.0 = closed, 1.0 = fully open)
  const doorOpenRef = useRef(0);
  const launchProgressRef = useRef(0);

  useFrame((state, delta) => {
    if (dead) return;

    // Target door state: open when firing or during autonomous ready cycle
    const targetDoor = firing ? 1.0 : Math.sin(state.clock.elapsedTime * 0.4) > 0.5 ? 0.8 : 0.0;
    doorOpenRef.current = MathUtils.damp(doorOpenRef.current, targetDoor, 3.5, delta);

    // Apply door rotation (pivot outward along Z axis)
    if (leftDoorRef.current && rightDoorRef.current) {
      leftDoorRef.current.rotation.z = -doorOpenRef.current * 1.15;
      rightDoorRef.current.rotation.z = doorOpenRef.current * 1.15;
    }

    // Rotary magazine indexing
    if (magazineRef.current) {
      if (firing) {
        magazineRef.current.rotation.y += delta * 2.5;
        launchProgressRef.current = (launchProgressRef.current + delta * 2.0) % 1.0;
      } else {
        magazineRef.current.rotation.y += delta * 0.2;
        launchProgressRef.current = 0;
      }
    }
  });

  return (
    <group>
      {/* Base mounting flange flush at y = 0 */}
      <MountFlange radius={0.65} height={0.06} />

      {/* Main armored bay housing */}
      <mesh position={[0, 0.24, 0]} castShadow receiveShadow>
        <boxGeometry args={[0.92, 0.44, 1.3]} />
        <meshStandardMaterial color="#1e293b" roughness={0.7} metalness={0.75} />
      </mesh>

      {/* Left armored bay door (pivots outward from hinge at x = -0.46) */}
      <group ref={leftDoorRef} position={[-0.46, 0.46, 0]}>
        <mesh position={[0.22, 0.04, 0]} castShadow>
          <boxGeometry args={[0.44, 0.08, 1.28]} />
          <meshStandardMaterial color="#334155" roughness={0.6} metalness={0.8} />
        </mesh>
      </group>

      {/* Right armored bay door (pivots outward from hinge at x = 0.46) */}
      <group ref={rightDoorRef} position={[0.46, 0.46, 0]}>
        <mesh position={[-0.22, 0.04, 0]} castShadow>
          <boxGeometry args={[0.44, 0.08, 1.28]} />
          <meshStandardMaterial color="#334155" roughness={0.6} metalness={0.8} />
        </mesh>
      </group>

      {/* Internal Rotary Magazine */}
      <group ref={magazineRef} position={[0, 0.25, 0]}>
        <mesh castShadow rotation={[Math.PI / 2, 0, 0]}>
          <cylinderGeometry args={[0.34, 0.34, 0.95, 12]} />
          <meshStandardMaterial color="#0f172a" roughness={0.4} metalness={0.9} />
        </mesh>

        {/* 6 Rotary Missile Launch Tubes */}
        {Array.from({ length: 6 }).map((_, i) => {
          const angle = (i * Math.PI * 2) / 6;
          const r = 0.22;
          const x = Math.cos(angle) * r;
          const y = Math.sin(angle) * r;
          return (
            <group key={`tube-${i}`} position={[x, y, 0]}>
              <mesh rotation={[Math.PI / 2, 0, 0]} castShadow>
                <cylinderGeometry args={[0.07, 0.07, 1.05, 10]} />
                <meshStandardMaterial color="#475569" roughness={0.4} metalness={0.95} />
              </mesh>
              {/* Kinetic Missile Head */}
              <mesh position={[0, 0, 0.52]} rotation={[Math.PI / 2, 0, 0]}>
                <coneGeometry args={[0.065, 0.16, 10]} />
                <meshStandardMaterial color="#f59e0b" roughness={0.3} metalness={0.8} />
              </mesh>
              {/* Rocket Motor Exhaust Glow (when firing) */}
              {firing && (
                <mesh position={[0, 0, -0.55]}>
                  <sphereGeometry args={[0.05, 8, 8]} />
                  <EmissiveMaterial mode={mode} color="#ef4444" intensity={3.5} />
                </mesh>
              )}
            </group>
          );
        })}
      </group>

      {/* Launching Salvo Missile VFX (Active when firing) */}
      {firing && (
        <group ref={missileRackRef} position={[0, 0.6, 0.6]}>
          <mesh rotation={[Math.PI / 2, 0, 0]}>
            <cylinderGeometry args={[0.06, 0.06, 0.45, 8]} />
            <meshStandardMaterial color="#cbd5e1" metalness={0.8} />
          </mesh>
          <mesh position={[0, 0, -0.3]} rotation={[-Math.PI / 2, 0, 0]}>
            <coneGeometry args={[0.09, 0.35, 8]} />
            <EmissiveMaterial mode={mode} color="#f97316" intensity={4.5} />
          </mesh>
        </group>
      )}
    </group>
  );
}
