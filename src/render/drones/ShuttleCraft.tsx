import { useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import { Group, Vector3, Quaternion, Euler } from 'three';
import { useReducedMotion } from '../useReducedMotion';

/**
 * Heavy cargo tender shuttlecraft:
 * Industrial boxy profile with dual outboard engines and freight hull.
 */
function CargoTender({ position, rotation }: { position?: [number, number, number]; rotation?: [number, number, number] }) {
  return (
    <group position={position} rotation={rotation}>
      {/* Central cargo body */}
      <mesh castShadow>
        <boxGeometry args={[1.2, 0.7, 2.4]} />
        <meshStandardMaterial color="#475569" roughness={0.7} metalness={0.6} />
      </mesh>
      {/* Cockpit canopy */}
      <mesh position={[0, 0.22, 1.0]}>
        <boxGeometry args={[0.8, 0.35, 0.6]} />
        <meshStandardMaterial color="#0284c7" emissive="#0284c7" emissiveIntensity={0.6} roughness={0.2} metalness={0.9} />
      </mesh>
      {/* Port engine nacelle */}
      <mesh position={[-0.9, 0, -0.4]} castShadow>
        <boxGeometry args={[0.45, 0.5, 1.8]} />
        <meshStandardMaterial color="#334155" roughness={0.6} metalness={0.8} />
      </mesh>
      {/* Starboard engine nacelle */}
      <mesh position={[0.9, 0, -0.4]} castShadow>
        <boxGeometry args={[0.45, 0.5, 1.8]} />
        <meshStandardMaterial color="#334155" roughness={0.6} metalness={0.8} />
      </mesh>
      {/* Engine exhausts */}
      {[-0.9, 0.9].map((x) => (
        <mesh key={x} position={[x, 0, -1.35]} rotation={[Math.PI / 2, 0, 0]}>
          <cylinderGeometry args={[0.15, 0.18, 0.1, 12]} />
          <meshStandardMaterial color="#38bdf8" emissive="#38bdf8" emissiveIntensity={2.5} toneMapped={false} />
        </mesh>
      ))}
    </group>
  );
}

/**
 * Arrow-wing tactical shuttle:
 * Sleek delta-wing interceptor tender with forward cockpit and dorsal stabilizer.
 */
function TacticalShuttle({ position, rotation }: { position?: [number, number, number]; rotation?: [number, number, number] }) {
  return (
    <group position={position} rotation={rotation}>
      {/* Wedge fuselage */}
      <mesh castShadow>
        <coneGeometry args={[0.9, 2.6, 4]} />
        <meshStandardMaterial color="#1e293b" roughness={0.5} metalness={0.8} />
      </mesh>
      {/* Swept delta wings */}
      <mesh position={[0, -0.1, -0.4]} rotation={[0, 0, 0]} castShadow>
        <boxGeometry args={[2.8, 0.08, 1.4]} />
        <meshStandardMaterial color="#334155" roughness={0.4} metalness={0.9} />
      </mesh>
      {/* Dorsal vertical stabilizer */}
      <mesh position={[0, 0.5, -0.7]} rotation={[0.3, 0, 0]}>
        <boxGeometry args={[0.06, 0.7, 0.8]} />
        <meshStandardMaterial color="#475569" roughness={0.5} metalness={0.8} />
      </mesh>
      {/* Ion engine exhaust */}
      <mesh position={[0, -0.05, -1.35]} rotation={[Math.PI / 2, 0, 0]}>
        <cylinderGeometry args={[0.2, 0.24, 0.12, 16]} />
        <meshStandardMaterial color="#06b6d4" emissive="#06b6d4" emissiveIntensity={3.0} toneMapped={false} />
      </mesh>
    </group>
  );
}

/**
 * Calculates a smooth 3D looping flightpath for auxiliary craft.
 * Parameters: cycle time t, orbit radius R, height H, stretch Z.
 */
function evaluateFlightSpline(
  t: number,
  radiusX: number,
  heightY: number,
  stretchZ: number,
  phaseOffset: number,
): { pos: Vector3; tangent: Vector3 } {
  const theta = (t * 0.18 + phaseOffset) % (Math.PI * 2);
  const nextTheta = theta + 0.05;

  const pos = new Vector3(
    Math.sin(theta) * radiusX,
    Math.cos(theta * 2) * (heightY * 0.4) + heightY,
    Math.cos(theta) * stretchZ,
  );

  const nextPos = new Vector3(
    Math.sin(nextTheta) * radiusX,
    Math.cos(nextTheta * 2) * (heightY * 0.4) + heightY,
    Math.cos(nextTheta) * stretchZ,
  );

  const tangent = nextPos.clone().sub(pos).normalize();
  return { pos, tangent };
}

export function ShuttleCraft({ enabled = true }: { enabled?: boolean } = {}) {
  const cargoRef = useRef<Group>(null);
  const tacticalRef = useRef<Group>(null);
  const reducedMotion = useReducedMotion();

  const dummyQuat = useRef(new Quaternion());

  useFrame((state) => {
    if (reducedMotion || !enabled) return;
    const t = state.clock.elapsedTime;

    // Heavy cargo tender on wide outer delivery loop
    if (cargoRef.current) {
      const { pos, tangent } = evaluateFlightSpline(t, 22, -4, 26, 0.0);
      cargoRef.current.position.copy(pos);
      const euler = new Euler(
        Math.atan2(-tangent.y, Math.hypot(tangent.x, tangent.z)),
        Math.atan2(tangent.x, tangent.z),
        Math.sin(t * 0.5) * 0.15,
      );
      dummyQuat.current.setFromEuler(euler);
      cargoRef.current.quaternion.copy(dummyQuat.current);
    }

    // Arrow-wing tactical shuttle on tighter forward escort sweep
    if (tacticalRef.current) {
      const { pos, tangent } = evaluateFlightSpline(t * 1.3, 16, 7, 20, Math.PI);
      tacticalRef.current.position.copy(pos);
      const euler = new Euler(
        Math.atan2(-tangent.y, Math.hypot(tangent.x, tangent.z)),
        Math.atan2(tangent.x, tangent.z),
        Math.sin(t * 0.8) * 0.25,
      );
      dummyQuat.current.setFromEuler(euler);
      tacticalRef.current.quaternion.copy(dummyQuat.current);
    }
  });

  if (!enabled) return null;

  return (
    <group>
      <group ref={cargoRef} position={[20, -4, 0]}>
        <CargoTender />
      </group>
      <group ref={tacticalRef} position={[-16, 7, 0]}>
        <TacticalShuttle />
      </group>
    </group>
  );
}
