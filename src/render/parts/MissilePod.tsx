import { useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import { Group, MathUtils } from 'three';
import type { RenderMode } from '../materials/renderModes';
import { Conduit, MountFlange } from './Fitting';
import { EmissiveMaterial } from '../materials/HullMaterial';
import { useReducedMotion } from '../useReducedMotion';

interface MissilePodProps {
  mode: RenderMode;
  dead: boolean;
  firing?: boolean;
}

const SALVO_SLOTS = [0, 1, 2, 3, 4, 5] as const;

/**
 * Kinetic Missile Bay & Rotary Salvo Pod.
 *
 * - Stepped armored salvo bay with corner reinforcement bumpers and aft seeker dome.
 * - Hinged armored blast doors with actuator knuckles pivot outward when active.
 * - 6-tube rotary magazine indexes rounds and launches glowing salvo missiles.
 * - Strict mounting face convention at local y = 0.
 */
export function MissilePod({ mode, dead, firing = false }: MissilePodProps) {
  const reducedMotion = useReducedMotion();
  const leftDoorRef = useRef<Group>(null);
  const rightDoorRef = useRef<Group>(null);
  const magazineRef = useRef<Group>(null);
  const missileRackRef = useRef<Group>(null);

  const doorOpenRef = useRef(0);
  const launchProgressRef = useRef(0);

  useFrame((state, delta) => {
    if (dead) return;

    const targetDoor = firing
      ? 1.0
      : reducedMotion
        ? 0.0
        : Math.sin(state.clock.elapsedTime * 0.4) > 0.5
          ? 0.8
          : 0.0;
    doorOpenRef.current = MathUtils.damp(doorOpenRef.current, targetDoor, 3.5, delta);

    if (leftDoorRef.current && rightDoorRef.current) {
      leftDoorRef.current.rotation.z = -doorOpenRef.current * 1.15;
      rightDoorRef.current.rotation.z = doorOpenRef.current * 1.15;
    }

    if (magazineRef.current) {
      if (firing) {
        if (!reducedMotion) {
          magazineRef.current.rotation.z += delta * 2.5;
        }
        launchProgressRef.current = (launchProgressRef.current + delta * 2.2) % 1.0;
      } else if (!reducedMotion) {
        magazineRef.current.rotation.z += delta * 0.18;
        launchProgressRef.current = 0;
      } else {
        launchProgressRef.current = 0;
      }
    }

    if (missileRackRef.current && firing) {
      const p = launchProgressRef.current;
      missileRackRef.current.position.set(0, 0.44 + p * 0.45, 0.35 + p * 1.15);
    }
  });

  return (
    <group>
      {/* Base mounting flange flush at y = 0 */}
      <MountFlange radius={0.68} height={0.07} />

      {/* Main armored bay housing */}
      <mesh position={[0, 0.24, 0]} castShadow receiveShadow>
        <boxGeometry args={[0.96, 0.44, 1.32]} />
        <meshStandardMaterial color="#1e293b" roughness={0.65} metalness={0.78} />
      </mesh>

      {/* Corner structural armor gusset ribs */}
      {[-0.45, 0.45].map((sx, xi) =>
        [-0.58, 0.58].map((sz, zi) => (
          <mesh key={`pod-rib-${xi}-${zi}`} position={[sx, 0.25, sz]} castShadow>
            <boxGeometry args={[0.1, 0.42, 0.16]} />
            <meshStandardMaterial color="#334155" roughness={0.5} metalness={0.86} />
          </mesh>
        )),
      )}

      {/* Side propellant & hydraulic door manifold lines */}
      {[-1, 1].map((side) => (
        <Conduit
          key={`pod-pipe-${side}`}
          from={[side * 0.4, 0.05, -0.45]}
          to={[side * 0.46, 0.38, -0.2]}
          bow={0.08}
          radius={0.028}
        />
      ))}

      {/* Aft optical target acquisition sensor dome */}
      <group position={[0, 0.48, -0.5]}>
        <mesh castShadow>
          <cylinderGeometry args={[0.14, 0.18, 0.12, 10]} />
          <meshStandardMaterial color="#334155" roughness={0.45} metalness={0.88} />
        </mesh>
        <mesh position={[0, 0.08, 0]} castShadow>
          <sphereGeometry args={[0.11, 12, 8]} />
          <meshStandardMaterial color="#0f172a" roughness={0.3} metalness={0.92} />
        </mesh>
        <mesh position={[0, 0.08, 0.09]}>
          <sphereGeometry args={[0.04, 8, 8]} />
          <EmissiveMaterial mode={mode} color="#c084fc" intensity={dead ? 0 : 1.5} />
        </mesh>
      </group>

      {/* Door hinge actuator knuckles along outer bay rims */}
      {[-1, 1].map((side) =>
        [-0.38, 0.38].map((hz, hi) => (
          <mesh
            key={`hinge-${side}-${hi}`}
            position={[side * 0.47, 0.45, hz]}
            rotation={[Math.PI / 2, 0, 0]}
            castShadow
          >
            <cylinderGeometry args={[0.045, 0.045, 0.14, 8]} />
            <meshStandardMaterial color="#475569" roughness={0.4} metalness={0.9} />
          </mesh>
        )),
      )}

      {/* Left armored bay door (pivots outward from hinge at x = -0.46) */}
      <group ref={leftDoorRef} position={[-0.46, 0.46, 0]}>
        <mesh position={[0.23, 0.04, 0]} castShadow>
          <boxGeometry args={[0.45, 0.075, 1.28]} />
          <meshStandardMaterial color="#334155" roughness={0.55} metalness={0.84} />
        </mesh>
        <mesh position={[0.23, 0.085, 0]} castShadow>
          <boxGeometry args={[0.28, 0.03, 1.05]} />
          <meshStandardMaterial color="#475569" roughness={0.45} metalness={0.88} />
        </mesh>
      </group>

      {/* Right armored bay door (pivots outward from hinge at x = 0.46) */}
      <group ref={rightDoorRef} position={[0.46, 0.46, 0]}>
        <mesh position={[-0.23, 0.04, 0]} castShadow>
          <boxGeometry args={[0.45, 0.075, 1.28]} />
          <meshStandardMaterial color="#334155" roughness={0.55} metalness={0.84} />
        </mesh>
        <mesh position={[-0.23, 0.085, 0]} castShadow>
          <boxGeometry args={[0.28, 0.03, 1.05]} />
          <meshStandardMaterial color="#475569" roughness={0.45} metalness={0.88} />
        </mesh>
      </group>

      {/* Internal Rotary Magazine */}
      <group ref={magazineRef} position={[0, 0.25, 0]}>
        <mesh castShadow rotation={[Math.PI / 2, 0, 0]}>
          <cylinderGeometry args={[0.34, 0.34, 0.96, 12]} />
          <meshStandardMaterial color="#0f172a" roughness={0.4} metalness={0.9} />
        </mesh>

        {/* 6 Rotary Missile Launch Tubes */}
        {SALVO_SLOTS.map((i) => {
          const angle = (i * Math.PI * 2) / 6;
          const r = 0.22;
          const x = Math.cos(angle) * r;
          const y = Math.sin(angle) * r;
          return (
            <group key={`tube-${i}`} position={[x, y, 0]}>
              <mesh rotation={[Math.PI / 2, 0, 0]} castShadow>
                <cylinderGeometry args={[0.072, 0.072, 1.06, 10]} />
                <meshStandardMaterial color="#475569" roughness={0.4} metalness={0.95} />
              </mesh>
              <mesh position={[0, 0, 0.54]} castShadow>
                <torusGeometry args={[0.068, 0.015, 6, 12]} />
                <meshStandardMaterial color="#1e293b" roughness={0.45} metalness={0.9} />
              </mesh>
              {/* Kinetic Missile Warhead Nose */}
              <mesh position={[0, 0, 0.54]} rotation={[Math.PI / 2, 0, 0]}>
                <coneGeometry args={[0.062, 0.16, 10]} />
                <meshStandardMaterial color="#f59e0b" roughness={0.3} metalness={0.8} />
              </mesh>
              {/* Rocket Motor Ignition Glow (when firing) */}
              {firing && (
                <mesh position={[0, 0, -0.55]}>
                  <sphereGeometry args={[0.048, 8, 8]} />
                  <EmissiveMaterial mode={mode} color="#ef4444" intensity={3.0} />
                </mesh>
              )}
            </group>
          );
        })}
      </group>

      {/* Launching Salvo Missile VFX (Active when firing) */}
      {firing && (
        <group ref={missileRackRef} position={[0, 0.44, 0.35]}>
          <mesh rotation={[Math.PI / 2, 0, 0]}>
            <cylinderGeometry args={[0.058, 0.058, 0.45, 8]} />
            <meshStandardMaterial color="#cbd5e1" metalness={0.8} />
          </mesh>
          <mesh position={[0, 0, 0.28]} rotation={[Math.PI / 2, 0, 0]}>
            <coneGeometry args={[0.058, 0.16, 8]} />
            <meshStandardMaterial color="#f59e0b" roughness={0.3} metalness={0.8} />
          </mesh>
          <mesh position={[0, 0, -0.3]} rotation={[-Math.PI / 2, 0, 0]}>
            <coneGeometry args={[0.085, 0.34, 8]} />
            <EmissiveMaterial mode={mode} color="#f97316" intensity={3.8} />
          </mesh>
        </group>
      )}
    </group>
  );
}
