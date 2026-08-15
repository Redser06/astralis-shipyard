import { useMemo, useRef, type ReactNode } from 'react';
import { useFrame } from '@react-three/fiber';
import { Quaternion, Vector3, type Mesh, type MeshStandardMaterial } from 'three';
import type {
  FtlId,
  FuelId,
  SensorId,
  Socket,
  SocketSize,
  SublightId,
  WeaponId,
} from '../../domain/types';
import { EmissiveMaterial } from '../materials/HullMaterial';
import type { RenderMode } from '../materials/renderModes';

/**
 * Hardware that mounts to hull sockets.
 *
 * In the prototype, four of the six component pickers — weapons, sensors,
 * sublight drives and fuel — changed state and produced no geometry whatsoever.
 * Every picker now resolves to a distinct mesh here.
 */

const SIZE_SCALE: Record<SocketSize, number> = { S: 0.7, M: 1.0, L: 1.4 };

/** Parts are authored pointing +Y; the socket normal rotates them into place. */
const AUTHORED_AXIS = new Vector3(0, 1, 0);

export function SocketMount({
  socket,
  children,
}: {
  socket: Socket;
  children: ReactNode;
}) {
  const transform = useMemo(() => {
    const normal = new Vector3(...socket.normal).normalize();
    const quaternion = new Quaternion().setFromUnitVectors(AUTHORED_AXIS, normal);
    return {
      position: new Vector3(...socket.position),
      quaternion,
      scale: SIZE_SCALE[socket.size],
    };
  }, [socket]);

  return (
    <group
      position={transform.position}
      quaternion={transform.quaternion}
      scale={transform.scale}
    >
      {children}
    </group>
  );
}

/* --------------------------- Radiators --------------------------- */

/**
 * Heat-rejection panel. Glow responds to `burning` and to thermal wear.
 *
 * The animation reads its inputs from props on every frame via useFrame. The
 * prototype read them from a closure captured once, which is why Test Burn
 * never changed anything on screen.
 */
export function Radiator({
  burning,
  thermalWear,
  mode,
  dead,
}: {
  burning: boolean;
  thermalWear: number;
  mode: RenderMode;
  dead: boolean;
}) {
  const glowRef = useRef<Mesh>(null);

  useFrame((state) => {
    const mesh = glowRef.current;
    if (!mesh) return;
    const material = mesh.material as MeshStandardMaterial;
    if (dead) {
      material.emissiveIntensity = 0;
      return;
    }
    const t = state.clock.elapsedTime;
    // Live prop reads — not a stale closure.
    const base = burning ? 3.4 : 1.1;
    const flicker = burning ? Math.sin(t * 12) * 0.35 : Math.sin(t * 2) * 0.12;
    material.emissiveIntensity = Math.max(0, base + flicker - thermalWear * 0.5);
  });

  return (
    <group>
      {/* Structural frame */}
      <mesh castShadow receiveShadow position={[0, 0.9, 0]}>
        <boxGeometry args={[0.14, 1.8, 3.2]} />
        <meshStandardMaterial color="#334155" roughness={0.7} metalness={0.6} />
      </mesh>
      {/* Radiating face */}
      <mesh ref={glowRef} position={[0.09, 0.9, 0]} rotation={[0, Math.PI / 2, 0]}>
        <planeGeometry args={[3.0, 1.6]} />
        <meshStandardMaterial
          color="#000000"
          emissive="#f97316"
          emissiveIntensity={1.1}
          roughness={0.5}
          metalness={0}
          toneMapped={false}
          side={2}
        />
      </mesh>
      {/* Coolant runs */}
      {[-0.55, 0, 0.55].map((z, i) => (
        <mesh key={i} position={[0, 0.9, z]} rotation={[0, 0, Math.PI / 2]}>
          <cylinderGeometry args={[0.05, 0.05, 1.75, 6]} />
          <EmissiveMaterial mode={mode} color="#fb923c" intensity={dead ? 0 : 0.8} />
        </mesh>
      ))}
    </group>
  );
}

/* --------------------------- Engines --------------------------- */

const ENGINE_PROFILE: Record<SublightId, { radius: number; length: number; glow: string }> = {
  ion_pulse: { radius: 0.42, length: 1.0, glow: '#67e8f9' },
  mpd_thruster: { radius: 0.58, length: 1.35, glow: '#a78bfa' },
  fusion_torch: { radius: 0.78, length: 1.75, glow: '#fbbf24' },
};

export function EngineBell({
  sublight,
  burning,
  dead,
}: {
  sublight: SublightId;
  burning: boolean;
  dead: boolean;
}) {
  const profile = ENGINE_PROFILE[sublight];
  const coreRef = useRef<Mesh>(null);

  useFrame((state) => {
    const mesh = coreRef.current;
    if (!mesh) return;
    const material = mesh.material as MeshStandardMaterial;
    if (dead) {
      material.emissiveIntensity = 0;
      return;
    }
    const t = state.clock.elapsedTime;
    material.emissiveIntensity = burning
      ? 6.0 + Math.sin(t * 22) * 1.2
      : 1.8 + Math.sin(t * 3) * 0.25;
  });

  return (
    <group>
      {/* Housing */}
      <mesh castShadow receiveShadow>
        <cylinderGeometry args={[profile.radius * 0.72, profile.radius, profile.length, 14]} />
        <meshStandardMaterial color="#475569" roughness={0.45} metalness={0.9} />
      </mesh>
      {/* Nozzle throat */}
      <mesh ref={coreRef} position={[0, profile.length * 0.52, 0]}>
        <circleGeometry args={[profile.radius * 0.92, 16]} />
        <meshStandardMaterial
          color="#000000"
          emissive={profile.glow}
          emissiveIntensity={dead ? 0 : 1.8}
          toneMapped={false}
          side={2}
        />
      </mesh>
      {/* Cooling collar */}
      <mesh position={[0, -profile.length * 0.35, 0]} castShadow>
        <torusGeometry args={[profile.radius * 0.85, 0.07, 6, 16]} />
        <meshStandardMaterial color="#1e293b" roughness={0.6} metalness={0.8} />
      </mesh>
    </group>
  );
}

/* --------------------------- Weapons --------------------------- */

export function Turret({
  weapon,
  mode,
  dead,
}: {
  weapon: WeaponId;
  mode: RenderMode;
  dead: boolean;
}) {
  const base = (
    <mesh castShadow receiveShadow>
      <cylinderGeometry args={[0.42, 0.5, 0.34, 10]} />
      <meshStandardMaterial color="#334155" roughness={0.55} metalness={0.85} />
    </mesh>
  );

  switch (weapon) {
    case 'gauss_cannons':
      // Twin kinetic barrels.
      return (
        <group>
          {base}
          {[-0.16, 0.16].map((x) => (
            <mesh key={x} position={[x, 0.75, 0]} castShadow>
              <cylinderGeometry args={[0.075, 0.09, 1.4, 8]} />
              <meshStandardMaterial color="#64748b" roughness={0.4} metalness={0.95} />
            </mesh>
          ))}
        </group>
      );

    case 'plasma_lance':
      // One long focusing barrel with an emissive throat.
      return (
        <group>
          {base}
          <mesh position={[0, 0.95, 0]} castShadow>
            <cylinderGeometry args={[0.11, 0.17, 1.9, 10]} />
            <meshStandardMaterial color="#475569" roughness={0.3} metalness={0.95} />
          </mesh>
          <mesh position={[0, 1.9, 0]}>
            <sphereGeometry args={[0.13, 12, 10]} />
            <EmissiveMaterial mode={mode} color="#38bdf8" intensity={dead ? 0 : 3} />
          </mesh>
        </group>
      );

    case 'quantum_torpedoes':
      // Boxy launcher, four tubes.
      return (
        <group>
          {base}
          <mesh position={[0, 0.62, 0]} castShadow receiveShadow>
            <boxGeometry args={[0.9, 0.62, 1.0]} />
            <meshStandardMaterial color="#3f4a5c" roughness={0.6} metalness={0.8} />
          </mesh>
          {[
            [-0.24, 0.24],
            [0.24, 0.24],
            [-0.24, -0.24],
            [0.24, -0.24],
          ].map(([x, z], i) => (
            <mesh key={i} position={[x!, 0.95, z!]} rotation={[Math.PI / 2, 0, 0]}>
              <cylinderGeometry args={[0.11, 0.11, 0.14, 8]} />
              <EmissiveMaterial mode={mode} color="#c084fc" intensity={dead ? 0 : 2.2} />
            </mesh>
          ))}
        </group>
      );

    case 'tachyon_disruptor':
      // Crystalline superluminal emitter.
      return (
        <group>
          {base}
          <mesh position={[0, 0.85, 0]} castShadow>
            <octahedronGeometry args={[0.46, 0]} />
            <meshStandardMaterial
              color="#0f172a"
              emissive="#f43f5e"
              emissiveIntensity={dead ? 0 : 2.4}
              roughness={0.15}
              metalness={0.9}
              toneMapped={false}
            />
          </mesh>
          {[0, 1, 2].map((i) => (
            <mesh key={i} position={[0, 0.85, 0]} rotation={[0, (i * Math.PI) / 3, 0]}>
              <torusGeometry args={[0.6, 0.03, 5, 20]} />
              <EmissiveMaterial mode={mode} color="#fb7185" intensity={dead ? 0 : 1.6} />
            </mesh>
          ))}
        </group>
      );
  }
}

/* --------------------------- Sensors --------------------------- */

export function SensorArray({
  sensor,
  mode,
  dead,
}: {
  sensor: SensorId;
  mode: RenderMode;
  dead: boolean;
}) {
  switch (sensor) {
    case 'radar_dome':
      return (
        <group>
          <mesh position={[0, 0.3, 0]} castShadow receiveShadow>
            <sphereGeometry args={[0.55, 18, 12, 0, Math.PI * 2, 0, Math.PI / 2]} />
            <meshStandardMaterial color="#cbd5e1" roughness={0.5} metalness={0.3} />
          </mesh>
          <mesh castShadow>
            <cylinderGeometry args={[0.6, 0.6, 0.14, 16]} />
            <meshStandardMaterial color="#334155" roughness={0.6} metalness={0.8} />
          </mesh>
        </group>
      );

    case 'ladar_array':
      // Tall coherent-laser spine with stacked collector rings.
      return (
        <group>
          <mesh position={[0, 1.1, 0]} castShadow>
            <cylinderGeometry args={[0.07, 0.11, 2.2, 8]} />
            <meshStandardMaterial color="#475569" roughness={0.4} metalness={0.92} />
          </mesh>
          {[0.5, 1.0, 1.5, 2.0].map((y, i) => (
            <mesh key={i} position={[0, y, 0]} rotation={[Math.PI / 2, 0, 0]} castShadow>
              <torusGeometry args={[0.26 - i * 0.04, 0.028, 5, 18]} />
              <meshStandardMaterial color="#64748b" roughness={0.35} metalness={0.95} />
            </mesh>
          ))}
          <mesh position={[0, 2.28, 0]}>
            <sphereGeometry args={[0.1, 12, 10]} />
            <EmissiveMaterial mode={mode} color="#22d3ee" intensity={dead ? 0 : 3} />
          </mesh>
        </group>
      );

    case 'tachyon_scanner':
      // High-gain dish over a glowing spacetime-distortion core.
      return (
        <group>
          <mesh position={[0, 0.85, 0]} rotation={[-0.35, 0, 0]} castShadow receiveShadow>
            <sphereGeometry args={[0.95, 22, 14, 0, Math.PI * 2, 0, Math.PI / 2.6]} />
            <meshStandardMaterial
              color="#e2e8f0"
              roughness={0.25}
              metalness={0.6}
              side={2}
            />
          </mesh>
          <mesh position={[0, 0.45, 0]} castShadow>
            <cylinderGeometry args={[0.09, 0.14, 0.9, 8]} />
            <meshStandardMaterial color="#475569" roughness={0.45} metalness={0.9} />
          </mesh>
          <mesh position={[0, 1.0, 0]}>
            <sphereGeometry args={[0.16, 14, 12]} />
            <EmissiveMaterial mode={mode} color="#a855f7" intensity={dead ? 0 : 3.2} />
          </mesh>
        </group>
      );
  }
}

/* --------------------------- RCS --------------------------- */

export function RcsQuad() {
  return (
    <group>
      <mesh castShadow>
        <boxGeometry args={[0.34, 0.2, 0.34]} />
        <meshStandardMaterial color="#334155" roughness={0.65} metalness={0.75} />
      </mesh>
      {[
        [0.1, 0.1],
        [-0.1, 0.1],
        [0.1, -0.1],
        [-0.1, -0.1],
      ].map(([x, z], i) => (
        <mesh key={i} position={[x!, 0.16, z!]} castShadow>
          <coneGeometry args={[0.07, 0.16, 8]} />
          <meshStandardMaterial color="#0f172a" roughness={0.5} metalness={0.85} />
        </mesh>
      ))}
    </group>
  );
}

/* --------------------------- FTL --------------------------- */

export function FtlCore({
  ftl,
  mode,
  dead,
  ringRadius,
}: {
  ftl: FtlId;
  mode: RenderMode;
  dead: boolean;
  /** Radius the ring must clear — comes from the archetype, not a constant. */
  ringRadius: number;
}) {
  const spinRef = useRef<Mesh>(null);

  useFrame((_, delta) => {
    if (spinRef.current && !dead) spinRef.current.rotation.z += delta * 0.6;
  });

  switch (ftl) {
    case 'none':
      return null;

    case 'hyper_shunt':
      return (
        <group>
          <mesh castShadow receiveShadow>
            <boxGeometry args={[1.5, 0.85, 1.5]} />
            <meshStandardMaterial color="#334155" roughness={0.55} metalness={0.85} />
          </mesh>
          {[-0.5, 0, 0.5].map((z, i) => (
            <mesh key={i} position={[0.78, 0, z]} rotation={[0, 0, Math.PI / 2]}>
              <planeGeometry args={[0.5, 0.12]} />
              <EmissiveMaterial mode={mode} color="#38bdf8" intensity={dead ? 0 : 2.4} />
            </mesh>
          ))}
        </group>
      );

    case 'alcubierre_ring':
      // Authored in the XY plane so its axis already runs along the ship's
      // length; it encircles the hull rather than lying across it.
      return (
        <mesh ref={spinRef} castShadow>
          <torusGeometry args={[ringRadius, ringRadius * 0.075, 14, 56]} />
          <meshStandardMaterial
            color="#0b1120"
            emissive="#818cf8"
            emissiveIntensity={dead ? 0 : 1.6}
            roughness={0.2}
            metalness={0.95}
            toneMapped={false}
          />
        </mesh>
      );

    case 'graviton_singularity': {
      const core = ringRadius * 0.3;
      return (
        <group>
          {/* Containment lattice */}
          <mesh ref={spinRef}>
            <icosahedronGeometry args={[core, 1]} />
            <meshBasicMaterial color="#a855f7" wireframe transparent opacity={dead ? 0.15 : 0.65} />
          </mesh>
          {/* The singularity itself — a hole, not a light */}
          <mesh>
            <sphereGeometry args={[core * 0.42, 24, 18]} />
            <meshBasicMaterial color="#000000" />
          </mesh>
          <mesh rotation={[Math.PI / 2.2, 0.3, 0]}>
            <torusGeometry args={[core * 0.66, 0.06, 8, 40]} />
            <EmissiveMaterial mode={mode} color="#c084fc" intensity={dead ? 0 : 3} />
          </mesh>
        </group>
      );
    }
  }
}

/* --------------------------- Fuel --------------------------- */

/**
 * Fuel is a genuine design axis, not a stat bump: tier-1 cryogenic tanks are
 * bulky external volume, tier-4 is a micro-core. Miniaturisation buys back
 * hull space, and you can see it.
 */
export function FuelPod({
  fuel,
  mode,
  dead,
}: {
  fuel: FuelId;
  mode: RenderMode;
  dead: boolean;
}) {
  switch (fuel) {
    case 'cryo_h2':
      return (
        <mesh rotation={[Math.PI / 2, 0, 0]} castShadow receiveShadow>
          <capsuleGeometry args={[0.62, 2.6, 6, 14]} />
          <meshStandardMaterial color="#e2e8f0" roughness={0.35} metalness={0.5} />
        </mesh>
      );

    case 'd_he3_bottles':
      return (
        <group>
          {[-0.42, 0.42].map((x) => (
            <mesh key={x} position={[x, 0, 0]} rotation={[Math.PI / 2, 0, 0]} castShadow receiveShadow>
              <capsuleGeometry args={[0.3, 1.5, 6, 12]} />
              <meshStandardMaterial color="#94a3b8" roughness={0.3} metalness={0.75} />
            </mesh>
          ))}
        </group>
      );

    case 'antimatter_pods':
      return (
        <group>
          <mesh castShadow receiveShadow>
            <sphereGeometry args={[0.55, 20, 14]} />
            <meshStandardMaterial color="#1e293b" roughness={0.2} metalness={0.95} />
          </mesh>
          <mesh rotation={[Math.PI / 2, 0, 0]}>
            <torusGeometry args={[0.68, 0.05, 8, 28]} />
            <EmissiveMaterial mode={mode} color="#f43f5e" intensity={dead ? 0 : 2.6} />
          </mesh>
        </group>
      );

    case 'zero_point_core':
      // Almost nothing there — which is the point.
      return (
        <group>
          <mesh>
            <sphereGeometry args={[0.16, 16, 12]} />
            <EmissiveMaterial mode={mode} color="#10b981" intensity={dead ? 0 : 4} />
          </mesh>
          <mesh rotation={[0.6, 0.3, 0]}>
            <torusGeometry args={[0.3, 0.02, 6, 24]} />
            <EmissiveMaterial mode={mode} color="#6ee7b7" intensity={dead ? 0 : 2} />
          </mesh>
        </group>
      );
  }
}
