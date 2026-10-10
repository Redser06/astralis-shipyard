import { useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import { Group, MathUtils, Vector3 } from 'three';
import type { WeaponId } from '../../domain/types';
import type { RenderMode } from '../materials/renderModes';
import { MountFlange } from './Fitting';
import { EmissiveMaterial } from '../materials/HullMaterial';

interface ArticulatedTurretProps {
  weapon: WeaponId;
  mode: RenderMode;
  dead: boolean;
  /** Active target position in ship-local coordinates, or null for autonomous scan sweep */
  targetPosition?: Vector3 | null;
  /** Whether the weapon is actively firing (triggers recoil & muzzle energy) */
  firing?: boolean;
}

/**
 * 2-Axis Articulated Weapon Turret.
 *
 * Implements a dual-pivot kinematic hierarchy:
 * 1. Barbette Base: bolted flush to hull flange at local y = 0.
 * 2. Turret Carriage: Azimuth rotation (yaw 0° - 360° about local Y axis).
 * 3. Gun Mantlet: Elevation rotation (pitch -5° to 75° about local X axis).
 * 4. Recoil Barrels: Physical impulse (-dy kickback followed by spring restoration).
 */
export function ArticulatedTurret({
  weapon,
  mode,
  dead,
  targetPosition,
  firing = false,
}: ArticulatedTurretProps) {
  const carriageRef = useRef<Group>(null);
  const mantletRef = useRef<Group>(null);
  const barrelsRef = useRef<Group>(null);

  // Recoil animation state
  const recoilRef = useRef(0);
  const muzzleFlashRef = useRef(0);

  useFrame((state, delta) => {
    if (dead) return;

    const t = state.clock.elapsedTime;

    // Azimuth & Elevation tracking
    if (carriageRef.current && mantletRef.current) {
      if (targetPosition) {
        // Track target position relative to turret base
        const localTarget = targetPosition.clone();
        const targetAzimuth = Math.atan2(localTarget.x, localTarget.z);
        const horizontalDist = Math.hypot(localTarget.x, localTarget.z);
        const targetElevation = Math.atan2(localTarget.y, horizontalDist);

        // Clamped elevation (-5° to 75°)
        const clampedElev = MathUtils.clamp(targetElevation, -0.09, 1.3);

        // Smooth azimuth and elevation slerp/lerp
        carriageRef.current.rotation.y = MathUtils.damp(
          carriageRef.current.rotation.y,
          targetAzimuth,
          4.5,
          delta,
        );
        mantletRef.current.rotation.x = MathUtils.damp(
          mantletRef.current.rotation.x,
          clampedElev,
          4.5,
          delta,
        );
      } else {
        // Autonomous sweeping radar / search pattern
        const sweepAzimuth = Math.sin(t * 0.7) * 0.85;
        const sweepElevation = Math.sin(t * 0.4) * 0.25 + 0.2;

        carriageRef.current.rotation.y = MathUtils.damp(
          carriageRef.current.rotation.y,
          sweepAzimuth,
          2.5,
          delta,
        );
        mantletRef.current.rotation.x = MathUtils.damp(
          mantletRef.current.rotation.x,
          sweepElevation,
          2.5,
          delta,
        );
      }
    }

    // Physical Recoil Kickback & Spring Restoration
    if (firing) {
      recoilRef.current = 0.22; // Kickback impulse
      muzzleFlashRef.current = 1.0;
    } else {
      recoilRef.current = Math.max(0, recoilRef.current - delta * 1.8);
      muzzleFlashRef.current = Math.max(0, muzzleFlashRef.current - delta * 6.0);
    }

    if (barrelsRef.current) {
      // Barrels kick backwards along local Z axis
      barrelsRef.current.position.z = -recoilRef.current;
    }
  });

  const isEnergy =
    weapon === 'plasma_lance' ||
    weapon === 'tachyon_disruptor';

  const isHeavy = weapon === 'rail_lance' || weapon === 'coil_battery';

  return (
    <group>
      {/* Barbette flange firmly anchored at local y = 0 */}
      <MountFlange radius={0.72} height={0.08} />

      {/* Barbette collar */}
      <mesh position={[0, 0.12, 0]} castShadow receiveShadow>
        <cylinderGeometry args={[0.68, 0.72, 0.16, 18]} />
        <meshStandardMaterial color="#1e293b" roughness={0.65} metalness={0.8} />
      </mesh>

      {/* Azimuth Carriage (Rotates in Yaw about local Y) */}
      <group ref={carriageRef} position={[0, 0.2, 0]}>
        {/* Armored Turret Housing */}
        <mesh position={[0, 0.22, 0]} castShadow receiveShadow>
          <boxGeometry args={[0.82, 0.36, 1.1]} />
          <meshStandardMaterial color="#334155" roughness={0.55} metalness={0.85} />
        </mesh>

        {/* Sloped Cheek Armor */}
        {[-1, 1].map((side) => (
          <mesh
            key={`cheek-${side}`}
            position={[side * 0.45, 0.2, 0.05]}
            rotation={[0, 0, side * 0.28]}
            castShadow
          >
            <boxGeometry args={[0.18, 0.32, 0.9]} />
            <meshStandardMaterial color="#1e293b" roughness={0.6} metalness={0.9} />
          </mesh>
        ))}

        {/* Gun Mantlet Trunnion (Elevates in Pitch about local X) */}
        <group ref={mantletRef} position={[0, 0.28, 0.35]}>
          <mesh castShadow rotation={[0, 0, Math.PI / 2]}>
            <cylinderGeometry args={[0.26, 0.26, 0.65, 14]} />
            <meshStandardMaterial color="#0f172a" roughness={0.5} metalness={0.9} />
          </mesh>

          {/* Barrels with Recoil Kickback */}
          <group ref={barrelsRef}>
            {/* Twin heavy kinetic / energy cannon barrels */}
            {[-0.18, 0.18].map((x, i) => (
              <group key={`barrel-${i}`} position={[x, 0, 0.2]}>
                <mesh
                  position={[0, 0, isHeavy ? 0.9 : 0.6]}
                  rotation={[Math.PI / 2, 0, 0]}
                  castShadow
                >
                  <cylinderGeometry
                    args={[
                      isHeavy ? 0.09 : 0.065,
                      isHeavy ? 0.11 : 0.08,
                      isHeavy ? 1.8 : 1.2,
                      12,
                    ]}
                  />
                  <meshStandardMaterial color="#475569" roughness={0.35} metalness={0.95} />
                </mesh>

                {/* Muzzle brake */}
                <mesh
                  position={[0, 0, isHeavy ? 1.82 : 1.22]}
                  rotation={[Math.PI / 2, 0, 0]}
                  castShadow
                >
                  <cylinderGeometry
                    args={[
                      isHeavy ? 0.12 : 0.09,
                      isHeavy ? 0.09 : 0.07,
                      0.22,
                      12,
                    ]}
                  />
                  <meshStandardMaterial color="#0f172a" roughness={0.4} metalness={0.9} />
                </mesh>

                {/* Muzzle Glow / Flash */}
                <mesh position={[0, 0, isHeavy ? 1.95 : 1.35]}>
                  <sphereGeometry args={[0.12, 10, 8]} />
                  <EmissiveMaterial
                    mode={mode}
                    color={isEnergy ? '#38bdf8' : '#f59e0b'}
                    intensity={dead ? 0 : muzzleFlashRef.current * 4.0 + 0.2}
                  />
                </mesh>
              </group>
            ))}
          </group>
        </group>
      </group>
    </group>
  );
}
