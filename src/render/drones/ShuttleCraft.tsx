import { useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import { Group, Vector3, Quaternion, Euler } from 'three';
import { useReducedMotion } from '../useReducedMotion';

/**
 * Argo-class heavy cargo tender shuttlecraft:
 * Faceted heavy bow, raised glass cockpit canopy, longitudinal spine lattice,
 * 3 modular pressurized freight containers, outrigger engine nacelles, and dual ion plumes.
 */
function ArgoClassCargoTender({
  position,
  rotation,
}: {
  position?: [number, number, number];
  rotation?: [number, number, number];
}) {
  return (
    <group position={position} rotation={rotation}>
      {/* Primary Faceted Bow Fuselage */}
      <mesh position={[0, 0, 0.4]} castShadow receiveShadow>
        <boxGeometry args={[1.6, 0.85, 2.2]} />
        <meshStandardMaterial color="#334155" roughness={0.6} metalness={0.7} />
      </mesh>

      {/* Chamfered Forward Chin Deflector */}
      <mesh position={[0, -0.32, 1.2]} rotation={[-0.4, 0, 0]} castShadow>
        <boxGeometry args={[1.58, 0.4, 0.9]} />
        <meshStandardMaterial color="#1e293b" roughness={0.5} metalness={0.8} />
      </mesh>

      {/* Raised Cockpit Canopy with Polarized Cyan Glass */}
      <mesh position={[0, 0.44, 0.7]} rotation={[0.2, 0, 0]}>
        <boxGeometry args={[0.88, 0.4, 0.85]} />
        <meshStandardMaterial
          color="#0284c7"
          emissive="#0284c7"
          emissiveIntensity={0.8}
          roughness={0.1}
          metalness={0.95}
        />
      </mesh>

      {/* Longitudinal Spine Lattice Girder */}
      <mesh position={[0, 0.15, -1.2]} castShadow>
        <boxGeometry args={[0.45, 0.35, 2.6]} />
        <meshStandardMaterial color="#1e293b" roughness={0.7} metalness={0.8} />
      </mesh>

      {/* 3 Modular Pressurized Cylindrical Cargo Pods */}
      {[-0.4, -1.2, -2.0].map((z, idx) => (
        <group key={`pod-${idx}`} position={[0, -0.05, z]}>
          {/* Main Cylindrical Freight Drum */}
          <mesh rotation={[0, 0, Math.PI / 2]} castShadow>
            <cylinderGeometry args={[0.62, 0.62, 1.35, 16]} />
            <meshStandardMaterial
              color={idx === 1 ? '#f59e0b' : '#cbd5e1'}
              roughness={0.5}
              metalness={0.4}
            />
          </mesh>
          {/* Heavy Structural Retaining Clamp Collar */}
          <mesh>
            <boxGeometry args={[1.42, 0.08, 0.22]} />
            <meshStandardMaterial color="#0f172a" roughness={0.6} metalness={0.9} />
          </mesh>
        </group>
      ))}

      {/* Outboard Engine Pylons & Nacelles (Port & Starboard) */}
      {[-1.35, 1.35].map((x) => (
        <group key={`pylon-${x}`} position={[x, 0, -1.1]}>
          {/* Cantilever Structural Pylon Strut */}
          <mesh rotation={[0, 0, x > 0 ? -0.15 : 0.15]}>
            <boxGeometry args={[0.85, 0.14, 0.7]} />
            <meshStandardMaterial color="#334155" roughness={0.6} metalness={0.8} />
          </mesh>
          {/* Heavy Engine Nacelle Cylinder */}
          <mesh position={[x > 0 ? 0.35 : -0.35, 0, 0]} rotation={[Math.PI / 2, 0, 0]} castShadow>
            <cylinderGeometry args={[0.3, 0.34, 2.2, 12]} />
            <meshStandardMaterial color="#1e293b" roughness={0.4} metalness={0.85} />
          </mesh>
          {/* Exhaust Bell Nozzle */}
          <mesh position={[x > 0 ? 0.35 : -0.35, 0, -1.15]} rotation={[Math.PI / 2, 0, 0]}>
            <cylinderGeometry args={[0.2, 0.28, 0.25, 12]} />
            <meshStandardMaterial color="#0f172a" roughness={0.3} metalness={0.9} />
          </mesh>
          {/* Bright Cyan Ion Exhaust Halo */}
          <mesh position={[x > 0 ? 0.35 : -0.35, 0, -1.3]} rotation={[Math.PI / 2, 0, 0]}>
            <cylinderGeometry args={[0.16, 0.22, 0.18, 12]} />
            <meshStandardMaterial
              color="#38bdf8"
              emissive="#38bdf8"
              emissiveIntensity={3.5}
              toneMapped={false}
            />
          </mesh>
        </group>
      ))}

      {/* Forward Micro-RCS Quad Clusters */}
      {[-0.82, 0.82].map((x) => (
        <mesh key={`rcs-${x}`} position={[x, 0.1, 1.1]}>
          <boxGeometry args={[0.12, 0.12, 0.12]} />
          <meshStandardMaterial color="#f59e0b" roughness={0.3} metalness={0.8} />
        </mesh>
      ))}
    </group>
  );
}

/**
 * Valkyrie-class tactical interceptor shuttle:
 * Chined delta lifting-body fuselage, forward swept cockpit canopy,
 * twin canted vertical stabilizers with navigation beacons, and dual afterburning nozzles.
 */
function ValkyrieClassTacticalShuttle({
  position,
  rotation,
}: {
  position?: [number, number, number];
  rotation?: [number, number, number];
}) {
  return (
    <group position={position} rotation={rotation}>
      {/* Primary Chined Lifting-Body Fuselage */}
      <mesh position={[0, 0, 0]} castShadow receiveShadow>
        <boxGeometry args={[1.3, 0.42, 3.4]} />
        <meshStandardMaterial color="#0f172a" roughness={0.35} metalness={0.85} />
      </mesh>

      {/* Forward Tapered Bow Chined Wedge */}
      <mesh position={[0, -0.02, 2.1]} rotation={[Math.PI / 2, 0, 0]} castShadow>
        <coneGeometry args={[0.65, 1.2, 4]} />
        <meshStandardMaterial color="#1e293b" roughness={0.3} metalness={0.9} />
      </mesh>

      {/* Forward Swept Cockpit Canopy */}
      <mesh position={[0, 0.24, 0.7]} rotation={[0.25, 0, 0]}>
        <boxGeometry args={[0.55, 0.28, 1.3]} />
        <meshStandardMaterial
          color="#38bdf8"
          emissive="#0284c7"
          emissiveIntensity={1.2}
          roughness={0.1}
          metalness={0.98}
        />
      </mesh>

      {/* Swept Delta Strike Wings */}
      <mesh position={[0, -0.06, -0.3]} castShadow>
        <boxGeometry args={[3.6, 0.08, 1.7]} />
        <meshStandardMaterial color="#1e293b" roughness={0.4} metalness={0.85} />
      </mesh>

      {/* Leading Edge Wing Chined Strakes */}
      <mesh position={[0, -0.05, 0.7]} rotation={[0, 0, 0]} castShadow>
        <boxGeometry args={[2.2, 0.07, 1.1]} />
        <meshStandardMaterial color="#334155" roughness={0.4} metalness={0.8} />
      </mesh>

      {/* Port & Starboard Wingtip Navigation Strobes */}
      <mesh position={[-1.82, -0.04, -0.3]}>
        <sphereGeometry args={[0.06, 8, 8]} />
        <meshStandardMaterial color="#ef4444" emissive="#ef4444" emissiveIntensity={4.0} toneMapped={false} />
      </mesh>
      <mesh position={[1.82, -0.04, -0.3]}>
        <sphereGeometry args={[0.06, 8, 8]} />
        <meshStandardMaterial color="#10b981" emissive="#10b981" emissiveIntensity={4.0} toneMapped={false} />
      </mesh>

      {/* Twin Canted Vertical Stabilizers */}
      {[-0.65, 0.65].map((x) => (
        <group key={`fin-${x}`} position={[x, 0.45, -1.0]} rotation={[0.15, 0, x > 0 ? 0.32 : -0.32]}>
          <mesh castShadow>
            <boxGeometry args={[0.06, 0.85, 0.95]} />
            <meshStandardMaterial color="#334155" roughness={0.4} metalness={0.8} />
          </mesh>
          {/* Fin Tip White Beacon */}
          <mesh position={[0, 0.44, 0]}>
            <sphereGeometry args={[0.04, 8, 8]} />
            <meshStandardMaterial color="#ffffff" emissive="#ffffff" emissiveIntensity={3.0} toneMapped={false} />
          </mesh>
        </group>
      ))}

      {/* Twin Afterburning Engine Exhaust Nozzles */}
      {[-0.38, 0.38].map((x) => (
        <group key={`thrust-${x}`} position={[x, -0.02, -1.75]}>
          <mesh rotation={[Math.PI / 2, 0, 0]}>
            <cylinderGeometry args={[0.2, 0.25, 0.3, 12]} />
            <meshStandardMaterial color="#0f172a" roughness={0.3} metalness={0.9} />
          </mesh>
          <mesh position={[0, 0, -0.18]} rotation={[Math.PI / 2, 0, 0]}>
            <cylinderGeometry args={[0.16, 0.2, 0.16, 12]} />
            <meshStandardMaterial
              color="#06b6d4"
              emissive="#06b6d4"
              emissiveIntensity={4.0}
              toneMapped={false}
            />
          </mesh>
        </group>
      ))}
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
        <ArgoClassCargoTender />
      </group>
      <group ref={tacticalRef} position={[-16, 7, 0]}>
        <ValkyrieClassTacticalShuttle />
      </group>
    </group>
  );
}
