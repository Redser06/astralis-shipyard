import { useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import { Group, MathUtils, Vector3 } from 'three';
import type { WeaponId } from '../../domain/types';
import type { RenderMode } from '../materials/renderModes';
import { Conduit, MountFlange } from './Fitting';
import { EmissiveMaterial } from '../materials/HullMaterial';
import { useReducedMotion } from '../useReducedMotion';

interface ArticulatedTurretProps {
  weapon: WeaponId;
  mode: RenderMode;
  dead: boolean;
  /** Active target position in ship-local coordinates, or null for autonomous scan sweep */
  targetPosition?: Vector3 | null;
  /** Whether the weapon is actively firing (triggers recoil & muzzle energy) */
  firing?: boolean;
}

const RADIAL_6 = [0, 1, 2, 3, 4, 5] as const;
const RADIAL_3 = [0, 1, 2] as const;

/**
 * 2-Axis Articulated Weapon Turret with weapon-specific armored housing &
 * barrel assemblies.
 *
 * Implements a dual-pivot kinematic hierarchy:
 * 1. Barbette Base: bolted flush to hull flange at local y = 0.
 * 2. Turret Carriage: Azimuth rotation (yaw about local Y axis).
 * 3. Gun Mantlet: Elevation rotation (pitch -5° to 75° about local X axis).
 * 4. Recoil Barrels: Physical impulse (-dz kickback followed by spring return).
 */
export function ArticulatedTurret({
  weapon,
  mode,
  dead,
  targetPosition,
  firing = false,
}: ArticulatedTurretProps) {
  const reducedMotion = useReducedMotion();
  const carriageRef = useRef<Group>(null);
  const mantletRef = useRef<Group>(null);
  const barrelsRef = useRef<Group>(null);
  const rotaryRef = useRef<Group>(null);
  const muzzleGroupRef = useRef<Group>(null);

  // Recoil & muzzle flash animation state
  const recoilRef = useRef(0);
  const muzzleFlashRef = useRef(0);

  useFrame((state, delta) => {
    if (dead) return;

    const t = state.clock.elapsedTime;

    // Azimuth & Elevation tracking
    if (carriageRef.current && mantletRef.current) {
      if (targetPosition) {
        const targetAzimuth = Math.atan2(targetPosition.x, targetPosition.z);
        const horizontalDist = Math.hypot(targetPosition.x, targetPosition.z);
        const targetElevation = Math.atan2(targetPosition.y, horizontalDist);
        const clampedElev = MathUtils.clamp(targetElevation, -0.09, 1.3);

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
      } else if (reducedMotion) {
        carriageRef.current.rotation.y = 0;
        mantletRef.current.rotation.x = 0.22;
      } else {
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

    // Physical recoil kickback & muzzle flash bloom scale
    if (firing) {
      recoilRef.current = weapon === 'rail_lance' ? 0.26 : 0.18;
      muzzleFlashRef.current = 1.0;
    } else {
      recoilRef.current = Math.max(0, recoilRef.current - delta * 1.8);
      muzzleFlashRef.current = Math.max(0, muzzleFlashRef.current - delta * 6.5);
    }

    if (barrelsRef.current) {
      barrelsRef.current.position.z = -recoilRef.current;
    }
    if (rotaryRef.current && !reducedMotion) {
      rotaryRef.current.rotation.z += delta * (firing ? 18.0 : 0.8);
    }
    if (muzzleGroupRef.current) {
      const s = firing ? 1.35 : 0.55 + muzzleFlashRef.current * 0.8;
      muzzleGroupRef.current.scale.setScalar(s);
    }
  });

  const isWide = weapon === 'coil_battery' || weapon === 'rail_lance';
  const flashColor =
    weapon === 'tachyon_disruptor'
      ? '#f43f5e'
      : weapon === 'plasma_lance'
        ? '#38bdf8'
        : weapon === 'coil_battery' || weapon === 'rail_lance'
          ? '#60a5fa'
          : '#f59e0b';

  return (
    <group>
      {/* Barbette flange firmly anchored at local y = 0 */}
      <MountFlange radius={isWide ? 0.78 : 0.72} height={0.08} />

      {/* Sloped barbette ring */}
      <mesh position={[0, 0.12, 0]} castShadow receiveShadow>
        <cylinderGeometry args={[0.68, isWide ? 0.76 : 0.72, 0.16, 16]} />
        <meshStandardMaterial color="#1e293b" roughness={0.6} metalness={0.82} />
      </mesh>

      {/* Azimuth Carriage (Rotates in Yaw about local Y) */}
      <group ref={carriageRef} position={[0, 0.2, 0]}>
        {/* Lower turret bustle base shared across weapon classes */}
        <mesh
          position={[0, 0.2, weapon === 'rail_lance' ? -0.14 : 0]}
          castShadow
          receiveShadow
        >
          <boxGeometry
            args={[
              weapon === 'coil_battery' ? 1.06 : weapon === 'autocannon_pod' ? 0.72 : 0.86,
              0.36,
              weapon === 'rail_lance' ? 1.48 : weapon === 'autocannon_pod' ? 0.92 : 1.12,
            ]}
          />
          <meshStandardMaterial color="#334155" roughness={0.5} metalness={0.86} />
        </mesh>

        {/* Sloped composite cheek armor plates */}
        {[-1, 1].map((side) => (
          <mesh
            key={`cheek-${side}`}
            position={[
              side * (weapon === 'coil_battery' ? 0.54 : 0.45),
              0.2,
              weapon === 'rail_lance' ? -0.08 : 0.04,
            ]}
            rotation={[0, 0, side * 0.28]}
            castShadow
          >
            <boxGeometry
              args={[0.18, 0.34, weapon === 'rail_lance' ? 1.25 : 0.92]}
            />
            <meshStandardMaterial color="#1e293b" roughness={0.56} metalness={0.88} />
          </mesh>
        ))}

        {/* Dorsal electro-optical rangefinder / target acquisition turret blister */}
        <group position={[0.22, 0.4, -0.18]}>
          <mesh castShadow>
            <boxGeometry args={[0.24, 0.14, 0.34]} />
            <meshStandardMaterial color="#475569" roughness={0.45} metalness={0.85} />
          </mesh>
          <mesh position={[0, 0.01, 0.17]} rotation={[Math.PI / 2, 0, 0]}>
            <cylinderGeometry args={[0.045, 0.045, 0.04, 10]} />
            <EmissiveMaterial mode={mode} color={flashColor} intensity={dead ? 0 : 1.4} />
          </mesh>
        </group>

        {/* Weapon-specific carriage superstructures */}
        {weapon === 'plasma_lance' &&
          [-1, 1].map((side) => (
            <group key={`cryo-pod-${side}`} position={[side * 0.46, 0.24, -0.16]}>
              <mesh rotation={[Math.PI / 2, 0, 0]} castShadow>
                <capsuleGeometry args={[0.13, 0.46, 6, 12]} />
                <meshStandardMaterial color="#475569" roughness={0.42} metalness={0.88} />
              </mesh>
              <Conduit
                from={[-side * 0.12, -0.05, 0.1]}
                to={[0, 0.08, 0.2]}
                bow={0.05}
                radius={0.028}
              />
            </group>
          ))}

        {weapon === 'autocannon_pod' &&
          [-1, 1].map((side) => (
            <group key={`ammo-drum-${side}`} position={[side * 0.48, 0.26, -0.12]}>
              <mesh rotation={[0, 0, Math.PI / 2]} castShadow>
                <cylinderGeometry args={[0.21, 0.21, 0.26, 14]} />
                <meshStandardMaterial color="#475569" roughness={0.5} metalness={0.85} />
              </mesh>
              <Conduit
                from={[-side * 0.06, 0.05, 0.12]}
                to={[-side * 0.28, 0.08, 0.22]}
                bow={0.06}
                radius={0.032}
                color="#64748b"
              />
            </group>
          ))}

        {(weapon === 'coil_battery' || weapon === 'rail_lance') && (
          <group position={[0, 0.4, -0.45]}>
            <mesh castShadow>
              <boxGeometry args={[0.72, 0.22, 0.44]} />
              <meshStandardMaterial color="#1e293b" roughness={0.55} metalness={0.85} />
            </mesh>
            {[-0.24, 0, 0.24].map((rx, idx) => (
              <mesh key={`cap-fin-${idx}`} position={[rx, 0.12, 0]} castShadow>
                <boxGeometry args={[0.08, 0.12, 0.36]} />
                <meshStandardMaterial color="#64748b" roughness={0.35} metalness={0.9} />
              </mesh>
            ))}
          </group>
        )}

        {/* Gun Mantlet Trunnion (Elevates in Pitch about local X) */}
        <group ref={mantletRef} position={[0, 0.28, 0.35]}>
          <mesh castShadow rotation={[0, 0, Math.PI / 2]}>
            <cylinderGeometry args={[0.25, 0.25, isWide ? 0.78 : 0.64, 14]} />
            <meshStandardMaterial color="#0f172a" roughness={0.48} metalness={0.9} />
          </mesh>
          {/* Armored trunnion dust boots */}
          {[-1, 1].map((side) => (
            <mesh
              key={`boot-${side}`}
              position={[side * (isWide ? 0.36 : 0.28), 0, 0.06]}
              castShadow
            >
              <boxGeometry args={[0.14, 0.32, 0.26]} />
              <meshStandardMaterial color="#334155" roughness={0.52} metalness={0.86} />
            </mesh>
          ))}

          {/* Recoiling Barrel & Emitter Cluster */}
          <group ref={barrelsRef}>
            {weapon === 'gauss_cannons' && (
              <group>
                {[-0.19, 0.19].map((x, i) => (
                  <group key={`gauss-${i}`} position={[x, 0, 0.1]}>
                    {/* Thermal cooling jacket */}
                    <mesh position={[0, 0, 0.45]} rotation={[Math.PI / 2, 0, 0]} castShadow>
                      <cylinderGeometry args={[0.095, 0.105, 0.68, 12]} />
                      <meshStandardMaterial color="#334155" roughness={0.45} metalness={0.88} />
                    </mesh>
                    {/* Rifled core barrel */}
                    <mesh position={[0, 0, 0.74]} rotation={[Math.PI / 2, 0, 0]} castShadow>
                      <cylinderGeometry args={[0.065, 0.08, 1.32, 12]} />
                      <meshStandardMaterial color="#64748b" roughness={0.32} metalness={0.94} />
                    </mesh>
                    {/* Cooling ribs */}
                    {[0.32, 0.52, 0.72].map((rz, ri) => (
                      <mesh key={`g-rib-${ri}`} position={[0, 0, rz]} castShadow>
                        <torusGeometry args={[0.1, 0.018, 6, 14]} />
                        <meshStandardMaterial color="#0f172a" roughness={0.4} metalness={0.9} />
                      </mesh>
                    ))}
                    {/* Under-barrel recoil shock cylinder */}
                    <mesh position={[0, -0.1, 0.35]} rotation={[Math.PI / 2, 0, 0]} castShadow>
                      <cylinderGeometry args={[0.038, 0.038, 0.55, 8]} />
                      <meshStandardMaterial color="#1e293b" roughness={0.4} metalness={0.9} />
                    </mesh>
                    {/* Muzzle brake collar */}
                    <mesh position={[0, 0, 1.4]} rotation={[Math.PI / 2, 0, 0]} castShadow>
                      <cylinderGeometry args={[0.092, 0.072, 0.18, 10]} />
                      <meshStandardMaterial color="#0f172a" roughness={0.38} metalness={0.92} />
                    </mesh>
                  </group>
                ))}
                <group ref={muzzleGroupRef} position={[0, 0, 1.48]}>
                  {[-0.19, 0.19].map((x, i) => (
                    <mesh key={`g-flash-${i}`} position={[x, 0, 0]}>
                      <sphereGeometry args={[0.09, 10, 8]} />
                      <EmissiveMaterial
                        mode={mode}
                        color="#f59e0b"
                        intensity={dead ? 0 : firing ? 3.2 : 0.4}
                      />
                    </mesh>
                  ))}
                </group>
              </group>
            )}

            {weapon === 'plasma_lance' && (
              <group position={[0, 0, 0.12]}>
                {/* Heavy central magnetic accelerator shroud */}
                <mesh position={[0, 0, 0.88]} rotation={[Math.PI / 2, 0, 0]} castShadow>
                  <cylinderGeometry args={[0.115, 0.17, 1.68, 14]} />
                  <meshStandardMaterial color="#475569" roughness={0.32} metalness={0.92} />
                </mesh>
                {/* Dorsal & ventral waveguide stabilizer fins */}
                <mesh position={[0, 0, 0.78]} castShadow>
                  <boxGeometry args={[0.06, 0.34, 1.38]} />
                  <meshStandardMaterial color="#1e293b" roughness={0.5} metalness={0.86} />
                </mesh>
                {/* Glowing cyan magnetic pinch coils */}
                {[0.46, 0.82, 1.18, 1.52].map((pz, idx) => (
                  <mesh key={`p-coil-${idx}`} position={[0, 0, pz]} castShadow>
                    <torusGeometry args={[0.165 - idx * 0.01, 0.026, 8, 16]} />
                    <EmissiveMaterial
                      mode={mode}
                      color="#38bdf8"
                      intensity={dead ? 0 : firing ? 2.8 : 1.3}
                    />
                  </mesh>
                ))}
                <group ref={muzzleGroupRef} position={[0, 0, 1.72]}>
                  <mesh>
                    <sphereGeometry args={[0.125, 12, 10]} />
                    <EmissiveMaterial
                      mode={mode}
                      color="#38bdf8"
                      intensity={dead ? 0 : firing ? 3.6 : 1.4}
                    />
                  </mesh>
                </group>
              </group>
            )}

            {weapon === 'tachyon_disruptor' && (
              <group position={[0, 0, 0.1]}>
                {/* Octagonal emitter breech */}
                <mesh position={[0, 0, 0.22]} rotation={[Math.PI / 2, 0, 0]} castShadow>
                  <cylinderGeometry args={[0.2, 0.24, 0.36, 8]} />
                  <meshStandardMaterial color="#334155" roughness={0.42} metalness={0.9} />
                </mesh>
                {/* Central magnetic emitter core rod anchoring crystal to breech */}
                <mesh position={[0, 0, 0.62]} rotation={[Math.PI / 2, 0, 0]} castShadow>
                  <cylinderGeometry args={[0.045, 0.065, 0.72, 10]} />
                  <meshStandardMaterial color="#475569" roughness={0.35} metalness={0.92} />
                </mesh>
                {/* Triple radial emitter fork prongs */}
                {RADIAL_3.map((k) => {
                  const a = (k * Math.PI * 2) / 3 + Math.PI / 6;
                  return (
                    <mesh
                      key={`prong-${k}`}
                      position={[Math.cos(a) * 0.24, Math.sin(a) * 0.24, 0.75]}
                      rotation={[0, 0, a]}
                      castShadow
                    >
                      <boxGeometry args={[0.1, 0.07, 1.15]} />
                      <meshStandardMaterial color="#64748b" roughness={0.32} metalness={0.94} />
                    </mesh>
                  );
                })}
                {/* Concentric collimator aperture rings */}
                {[0.58, 0.98].map((tz, ti) => (
                  <mesh key={`t-ring-${ti}`} position={[0, 0, tz]} castShadow>
                    <torusGeometry args={[0.26 - ti * 0.03, 0.028, 8, 18]} />
                    <meshStandardMaterial color="#1e293b" roughness={0.4} metalness={0.9} />
                  </mesh>
                ))}
                {/* Floating crimson tachyon crystal core */}
                <group ref={muzzleGroupRef} position={[0, 0, 0.96]}>
                  <mesh>
                    <octahedronGeometry args={[0.19, 0]} />
                    <EmissiveMaterial
                      mode={mode}
                      color="#f43f5e"
                      intensity={dead ? 0 : firing ? 3.6 : 1.7}
                    />
                  </mesh>
                </group>
              </group>
            )}

            {weapon === 'autocannon_pod' && (
              <group position={[0, 0, 0.12]}>
                {/* Spun rotary barrel cowling shroud */}
                <mesh position={[0, 0, 0.32]} rotation={[Math.PI / 2, 0, 0]} castShadow>
                  <cylinderGeometry args={[0.21, 0.25, 0.56, 16]} />
                  <meshStandardMaterial color="#334155" roughness={0.45} metalness={0.88} />
                </mesh>
                {/* 6-barrel Gatling rotary cluster */}
                <group ref={rotaryRef}>
                  {RADIAL_6.map((k) => {
                    const a = (k * Math.PI) / 3;
                    return (
                      <mesh
                        key={`gatling-${k}`}
                        position={[Math.cos(a) * 0.12, Math.sin(a) * 0.12, 0.72]}
                        rotation={[Math.PI / 2, 0, 0]}
                        castShadow
                      >
                        <cylinderGeometry args={[0.034, 0.04, 1.24, 8]} />
                        <meshStandardMaterial color="#64748b" roughness={0.32} metalness={0.95} />
                      </mesh>
                    );
                  })}
                  {/* Mid-barrel & muzzle clamp rings */}
                  {[0.82, 1.22].map((cz, ci) => (
                    <mesh key={`g-clamp-${ci}`} position={[0, 0, cz]} castShadow>
                      <torusGeometry args={[0.15, 0.025, 6, 14]} />
                      <meshStandardMaterial color="#0f172a" roughness={0.4} metalness={0.92} />
                    </mesh>
                  ))}
                </group>
                <group ref={muzzleGroupRef} position={[0, 0, 1.34]}>
                  <mesh>
                    <sphereGeometry args={[0.11, 10, 8]} />
                    <EmissiveMaterial
                      mode={mode}
                      color="#f59e0b"
                      intensity={dead ? 0 : firing ? 3.4 : 0.35}
                    />
                  </mesh>
                </group>
              </group>
            )}

            {weapon === 'coil_battery' && (
              <group position={[0, 0, 0.12]}>
                {/* Armored quad cradle side rails */}
                {[-0.31, 0.31].map((rx, ri) => (
                  <mesh key={`c-rail-${ri}`} position={[rx, 0, 0.52]} castShadow>
                    <boxGeometry args={[0.08, 0.4, 0.88]} />
                    <meshStandardMaterial color="#334155" roughness={0.5} metalness={0.86} />
                  </mesh>
                ))}
                {/* 2x2 Quad coilgun barrels */}
                {[
                  [-0.17, -0.13],
                  [0.17, -0.13],
                  [-0.17, 0.13],
                  [0.17, 0.13],
                ].map(([bx, by], bi) => (
                  <group key={`coil-tube-${bi}`} position={[bx, by, 0.72]}>
                    <mesh rotation={[Math.PI / 2, 0, 0]} castShadow>
                      <cylinderGeometry args={[0.05, 0.064, 1.34, 10]} />
                      <meshStandardMaterial color="#64748b" roughness={0.32} metalness={0.94} />
                    </mesh>
                    <mesh position={[0, 0, 0.64]} rotation={[Math.PI / 2, 0, 0]} castShadow>
                      <cylinderGeometry args={[0.068, 0.056, 0.12, 10]} />
                      <meshStandardMaterial color="#0f172a" roughness={0.38} metalness={0.92} />
                    </mesh>
                  </group>
                ))}
                {/* 3 Electromagnetic accelerator coils encircling all 4 barrels */}
                {[0.46, 0.84, 1.18].map((cz, ci) => (
                  <mesh key={`c-torus-${ci}`} position={[0, 0, cz]} castShadow>
                    <torusGeometry args={[0.29, 0.036, 8, 18]} />
                    <EmissiveMaterial
                      mode={mode}
                      color="#60a5fa"
                      intensity={dead ? 0 : firing ? 2.8 : 1.15}
                    />
                  </mesh>
                ))}
                <group ref={muzzleGroupRef} position={[0, 0, 1.4]}>
                  <mesh>
                    <sphereGeometry args={[0.12, 10, 8]} />
                    <EmissiveMaterial
                      mode={mode}
                      color="#60a5fa"
                      intensity={dead ? 0 : firing ? 3.2 : 0.4}
                    />
                  </mesh>
                </group>
              </group>
            )}

            {weapon === 'rail_lance' && (
              <group position={[0, 0, 0.12]}>
                {/* Heavy armored breech jacket */}
                <mesh position={[0, 0, 0.36]} castShadow>
                  <boxGeometry args={[0.64, 0.34, 0.64]} />
                  <meshStandardMaterial color="#1e293b" roughness={0.5} metalness={0.88} />
                </mesh>
                {/* Extra-long twin magnetic slab rails */}
                {[-0.22, 0.22].map((rx, ri) => (
                  <mesh key={`r-slab-${ri}`} position={[rx, 0, 1.28]} castShadow>
                    <boxGeometry args={[0.13, 0.22, 2.35]} />
                    <meshStandardMaterial color="#64748b" roughness={0.28} metalness={0.95} />
                  </mesh>
                ))}
                {/* 5 Transverse magnetic accelerator yoke gates */}
                {[0.72, 1.16, 1.6, 2.04, 2.4].map((rz, yi) => (
                  <mesh key={`r-yoke-${yi}`} position={[0, 0, rz]} castShadow>
                    <boxGeometry args={[0.66, 0.28, 0.14]} />
                    <meshStandardMaterial color="#334155" roughness={0.44} metalness={0.88} />
                  </mesh>
                ))}
                {/* Illuminated inner armature rail gap */}
                <mesh position={[0, 0, 1.32]}>
                  <boxGeometry args={[0.18, 0.06, 2.05]} />
                  <EmissiveMaterial
                    mode={mode}
                    color="#93c5fd"
                    intensity={dead ? 0 : firing ? 2.8 : 0.85}
                  />
                </mesh>
                <group ref={muzzleGroupRef} position={[0, 0, 2.46]}>
                  <mesh>
                    <sphereGeometry args={[0.13, 10, 8]} />
                    <EmissiveMaterial
                      mode={mode}
                      color="#60a5fa"
                      intensity={dead ? 0 : firing ? 3.6 : 0.45}
                    />
                  </mesh>
                </group>
              </group>
            )}
          </group>
        </group>
      </group>
    </group>
  );
}
