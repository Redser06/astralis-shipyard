import { useMemo, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import {
  AdditiveBlending,
  Group,
  Points,
  SpotLight as ThreeSpotLight,
  Vector3,
} from 'three';
import { mulberry32 } from '../../domain/rng';
import { useReducedMotion } from '../useReducedMotion';

interface DroneSpec {
  id: string;
  station: [number, number, number];
  targetHull: [number, number, number];
  speed: number;
  phase: number;
}

const DRONE_SPECS: readonly DroneSpec[] = [
  { id: 'drone-port-bow', station: [-6.8, 1.6, 5.0], targetHull: [-2.2, 0.4, 4.0], speed: 0.6, phase: 0.0 },
  { id: 'drone-stbd-bow', station: [6.8, 1.6, 5.0], targetHull: [2.2, 0.4, 4.0], speed: 0.55, phase: 1.5 },
  { id: 'drone-dorsal-mid', station: [0.0, 5.8, 0.5], targetHull: [0.0, 1.8, 0.2], speed: 0.7, phase: 3.0 },
  { id: 'drone-port-aft', station: [-7.2, 1.0, -6.5], targetHull: [-2.8, 0.2, -5.5], speed: 0.65, phase: 4.2 },
  { id: 'drone-stbd-aft', station: [7.2, 1.0, -6.5], targetHull: [2.8, 0.2, -5.5], speed: 0.5, phase: 5.5 },
];

/**
 * Realistic golden-white electric welding sparks falling with gravity.
 */
function ElectricWeldSparks({
  origin,
  active,
}: {
  origin: Vector3;
  active: boolean;
}) {
  const pointsRef = useRef<Points>(null);
  const sparkCount = 36;
  const reducedMotion = useReducedMotion();

  const [positions, velocities] = useMemo(() => {
    const pos = new Float32Array(sparkCount * 3);
    const vel = new Float32Array(sparkCount * 3);
    const rng = mulberry32(0x8a21d4);

    for (let i = 0; i < sparkCount; i++) {
      const idx = i * 3;
      pos[idx] = origin.x;
      pos[idx + 1] = origin.y;
      pos[idx + 2] = origin.z;

      vel[idx] = (rng() - 0.5) * 2.2;
      vel[idx + 1] = 0.5 + rng() * 1.5;
      vel[idx + 2] = (rng() - 0.5) * 2.2;
    }
    return [pos, vel];
  }, [origin]);

  useFrame((_, delta) => {
    if (!pointsRef.current || !active || reducedMotion) return;
    const attr = pointsRef.current.geometry.getAttribute('position');
    const posArr = attr.array as Float32Array;

    for (let i = 0; i < sparkCount; i++) {
      const idx = i * 3;
      posArr[idx] += velocities[idx]! * delta;
      posArr[idx + 1] += velocities[idx + 1]! * delta;
      posArr[idx + 2] += velocities[idx + 2]! * delta;

      // Gravity pull
      velocities[idx + 1]! -= delta * 5.0;

      // Reset when spark drops below floor
      if (posArr[idx + 1]! < origin.y - 1.8) {
        posArr[idx] = origin.x + (Math.random() - 0.5) * 0.1;
        posArr[idx + 1] = origin.y + (Math.random() - 0.5) * 0.1;
        posArr[idx + 2] = origin.z + (Math.random() - 0.5) * 0.1;

        velocities[idx] = (Math.random() - 0.5) * 2.5;
        velocities[idx + 1] = 0.8 + Math.random() * 1.8;
        velocities[idx + 2] = (Math.random() - 0.5) * 2.5;
      }
    }
    attr.needsUpdate = true;
  });

  if (!active) return null;

  return (
    <points ref={pointsRef}>
      <bufferGeometry>
        <bufferAttribute attach="attributes-position" args={[positions, 3]} />
      </bufferGeometry>
      <pointsMaterial
        color="#fbbf24"
        size={0.08}
        transparent
        opacity={0.9}
        blending={AdditiveBlending}
        depthWrite={false}
        toneMapped={false}
      />
    </points>
  );
}

/**
 * High-fidelity industrial maintenance drone vehicle:
 * Features dark composite avionics chassis, aviation yellow hazard stripes,
 * dual outrigger thruster pods, forward work spotlight, and articulated tool head.
 */
function IndustrialMaintenanceDrone({
  spec,
  isRepairing,
}: {
  spec: DroneSpec;
  isRepairing: boolean;
}) {
  const groupRef = useRef<Group>(null);
  const spotRef = useRef<ThreeSpotLight>(null);
  const beaconRef = useRef<Group>(null);
  const targetObjRef = useRef<Group>(null);
  const reducedMotion = useReducedMotion();

  const baseStation = useMemo(() => new Vector3(...spec.station), [spec.station]);
  const hullContact = useMemo(() => new Vector3(...spec.targetHull), [spec.targetHull]);

  useFrame((state, delta) => {
    if (!groupRef.current) return;
    const t = state.clock.elapsedTime + spec.phase;

    if (!reducedMotion) {
      // Smooth methodical station hovering
      const driftX = Math.sin(t * spec.speed) * 0.35;
      const driftY = Math.cos(t * spec.speed * 0.8) * 0.25;
      const driftZ = Math.sin(t * spec.speed * 0.6) * 0.3;

      const targetPos = baseStation.clone().add(new Vector3(driftX, driftY, driftZ));
      groupRef.current.position.lerp(targetPos, 1 - Math.pow(0.01, delta));

      // Always orient tool head towards target hull work area
      groupRef.current.lookAt(hullContact);

      // Flashing navigation beacon (1.0 Hz aviation amber)
      if (beaconRef.current) {
        beaconRef.current.visible = Math.floor(t * 2) % 2 === 0;
      }
    }

    if (spotRef.current && targetObjRef.current) {
      targetObjRef.current.position.copy(hullContact);
      spotRef.current.target = targetObjRef.current;
    }
  });

  return (
    <group>
      <group ref={groupRef} position={spec.station}>
        {/* Main Avionics Chassis (Heavy Fleet Graphite Composite) */}
        <mesh castShadow receiveShadow>
          <boxGeometry args={[1.8, 0.75, 2.2]} />
          <meshStandardMaterial color="#1e293b" roughness={0.4} metalness={0.7} />
        </mesh>

        {/* High-Visibility Aviation Yellow Hazard Identification Plate */}
        <mesh position={[0, 0.39, 0]}>
          <boxGeometry args={[1.82, 0.06, 1.2]} />
          <meshStandardMaterial color="#f59e0b" roughness={0.5} metalness={0.3} />
        </mesh>

        {/* Chamfered Heavy Nose Cap */}
        <mesh position={[0, 0, 1.25]} rotation={[Math.PI / 2, 0, 0]} castShadow>
          <cylinderGeometry args={[0.55, 0.8, 0.5, 6]} />
          <meshStandardMaterial color="#0f172a" roughness={0.3} metalness={0.8} />
        </mesh>

        {/* Forward Primary Sensor Eye Dome */}
        <mesh position={[0, 0.18, 1.55]}>
          <sphereGeometry args={[0.22, 14, 12]} />
          <meshStandardMaterial color="#0284c7" roughness={0.1} metalness={0.9} />
        </mesh>

        {/* Flashing Amber Navigation Strobe */}
        <group ref={beaconRef} position={[0, 0.48, -0.7]}>
          <mesh>
            <sphereGeometry args={[0.1, 8, 8]} />
            <meshStandardMaterial
              color="#fbbf24"
              emissive="#fbbf24"
              emissiveIntensity={3.0}
              toneMapped={false}
            />
          </mesh>
          <pointLight color="#fbbf24" intensity={4} distance={8} />
        </group>

        {/* Outrigger Thruster Pods (Port & Starboard) */}
        {[-1.15, 1.15].map((x, i) => (
          <group key={`thruster-${i}`} position={[x, 0, -0.2]}>
            {/* Structural Strut Bracket */}
            <mesh>
              <boxGeometry args={[0.45, 0.18, 0.5]} />
              <meshStandardMaterial color="#334155" roughness={0.6} metalness={0.8} />
            </mesh>
            {/* Heavy Thruster Nacelle */}
            <mesh position={[x > 0 ? 0.2 : -0.2, 0, 0]} rotation={[Math.PI / 2, 0, 0]} castShadow>
              <cylinderGeometry args={[0.26, 0.3, 1.2, 12]} />
              <meshStandardMaterial color="#0f172a" roughness={0.4} metalness={0.9} />
            </mesh>
            {/* Rear Micro-RCS Nozzle */}
            <mesh position={[x > 0 ? 0.2 : -0.2, 0, -0.65]} rotation={[Math.PI / 2, 0, 0]}>
              <cylinderGeometry args={[0.14, 0.22, 0.18, 8]} />
              <meshStandardMaterial color="#475569" roughness={0.3} metalness={0.9} />
            </mesh>
            {/* Cyan Plasma Exhaust Halo */}
            <mesh position={[x > 0 ? 0.2 : -0.2, 0, -0.75]} rotation={[Math.PI / 2, 0, 0]}>
              <cylinderGeometry args={[0.12, 0.18, 0.12, 10]} />
              <meshStandardMaterial
                color="#06b6d4"
                emissive="#06b6d4"
                emissiveIntensity={4.0}
                toneMapped={false}
              />
            </mesh>
          </group>
        ))}

        {/* Articulated Forward Welding Manipulator Arm */}
        <group position={[0, -0.32, 1.1]}>
          <mesh rotation={[0.2, 0, 0]} castShadow>
            <cylinderGeometry args={[0.07, 0.08, 0.9, 8]} />
            <meshStandardMaterial color="#475569" roughness={0.5} metalness={0.8} />
          </mesh>
          {/* Heavy Torch Nozzle Tip */}
          <mesh position={[0, -0.32, 0.42]} rotation={[0.4, 0, 0]}>
            <cylinderGeometry args={[0.04, 0.07, 0.32, 8]} />
            <meshStandardMaterial color="#0f172a" roughness={0.3} metalness={0.9} />
          </mesh>
        </group>

        {/* High-Intensity Volumetric Industrial Work Spotlight */}
        <spotLight
          ref={spotRef}
          color="#fef3c7"
          intensity={isRepairing ? 28 : 12}
          angle={Math.PI / 6}
          penumbra={0.4}
          distance={30}
          castShadow
        />
      </group>

      {/* Target object in space towards hull */}
      <group ref={targetObjRef} position={spec.targetHull} />

      {/* Active Welding Arc & Falling Sparks (ONLY when actively repairing) */}
      {isRepairing && (
        <group>
          {/* Electric Welding Torch Beam connecting drone tip to hull plate */}
          <mesh
            position={[
              (spec.station[0] + spec.targetHull[0]) * 0.5,
              (spec.station[1] + spec.targetHull[1]) * 0.5,
              (spec.station[2] + spec.targetHull[2]) * 0.5,
            ]}
            onUpdate={(self) => {
              self.lookAt(hullContact);
            }}
          >
            <cylinderGeometry
              args={[
                0.015,
                0.015,
                baseStation.distanceTo(hullContact) * 0.85,
                4,
              ]}
            />
            <meshBasicMaterial
              color="#ffffff"
              transparent
              opacity={0.85}
              blending={AdditiveBlending}
              toneMapped={false}
            />
          </mesh>

          {/* Falling golden sparks from contact point */}
          <ElectricWeldSparks origin={hullContact} active={isRepairing} />
        </group>
      )}
    </group>
  );
}

export function DroneSwarm({
  enabled = false,
  isRepairing = false,
}: {
  enabled?: boolean;
  isRepairing?: boolean;
}) {
  // If drones are not active, render nothing — no clutter or floating dots
  if (!enabled && !isRepairing) return null;

  return (
    <group>
      {DRONE_SPECS.map((spec) => (
        <IndustrialMaintenanceDrone
          key={spec.id}
          spec={spec}
          isRepairing={isRepairing}
        />
      ))}
    </group>
  );
}
