import { useMemo, useRef } from 'react';
import { Environment, Lightformer, Stars } from '@react-three/drei';
import { useFrame } from '@react-three/fiber';
import { AdditiveBlending, type Group, type Points } from 'three';
import { mulberry32 } from '../../domain/rng';
import { useReducedMotion } from '../useReducedMotion';
import type { EnvironmentId } from '../viewportOptions';
import { DrydockLighting } from '../lighting/DrydockLighting';


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
 */
function IblRig({ env, intensity }: { env: EnvironmentId; intensity: number }) {
  const scale = intensity / 2.4;

  if (env === 'nebula') {
    return (
      <Environment resolution={256} frames={1}>
        <color attach="background" args={['#0a0618']} />
        <Lightformer intensity={2.4 * scale} color="#a855f7" position={[0, 6, -9]} scale={[12, 6, 1]} />
        <Lightformer intensity={1.8 * scale} color="#38bdf8" position={[-8, 1, 4]} scale={[8, 8, 1]} rotation={[0, Math.PI / 2, 0]} />
        <Lightformer intensity={1.4 * scale} color="#f43f5e" position={[8, -2, 2]} scale={[7, 7, 1]} rotation={[0, -Math.PI / 2, 0]} />
        <Lightformer intensity={0.9 * scale} color="#ffffff" position={[0, -7, 0]} scale={[10, 10, 1]} rotation={[Math.PI / 2, 0, 0]} />
      </Environment>
    );
  }

  if (env === 'asteroid') {
    return (
      <Environment resolution={256} frames={1}>
        <color attach="background" args={['#07090e']} />
        {/* One hard, distant sun and very little bounce — belt lighting is brutal. */}
        <Lightformer form="circle" intensity={7 * scale} color="#fff4e0" position={[10, 6, 6]} scale={[3, 3, 1]} />
        <Lightformer intensity={0.5 * scale} color="#1e3a5f" position={[-9, -2, -6]} scale={[12, 12, 1]} />
        <Lightformer intensity={0.35 * scale} color="#334155" position={[0, -8, 0]} scale={[12, 12, 1]} rotation={[Math.PI / 2, 0, 0]} />
      </Environment>
    );
  }

  // Drydock — an enclosed industrial bay. Long overhead strips plus cool fill,
  // which is what gives the hull plates their linear specular highlights.
  return (
    <Environment resolution={256} frames={1}>
      <color attach="background" args={['#0b1120']} />
      <Lightformer form="rect" intensity={5 * scale} color="#ffffff" position={[0, 9, 0]} scale={[14, 3, 1]} rotation={[Math.PI / 2, 0, 0]} />
      <Lightformer form="rect" intensity={3 * scale} color="#dbeafe" position={[0, 9, -7]} scale={[14, 2, 1]} rotation={[Math.PI / 2, 0, 0]} />
      <Lightformer intensity={2.2 * scale} color="#38bdf8" position={[-10, 0, 0]} scale={[10, 10, 1]} rotation={[0, Math.PI / 2, 0]} />
      <Lightformer intensity={1.6 * scale} color="#818cf8" position={[10, 0, 0]} scale={[10, 10, 1]} rotation={[0, -Math.PI / 2, 0]} />
      <Lightformer intensity={1.2 * scale} color="#f59e0b" position={[0, -6, 8]} scale={[8, 4, 1]} />
    </Environment>
  );
}

/* --------------------------- Drydock scenery --------------------------- */

function WeldingSparks() {
  const ref = useRef<Points>(null);
  const count = 160;

  const positions = useMemo(() => {
    const rng = mulberry32(0x5c0725);
    const array = new Float32Array(count * 3);
    for (let i = 0; i < count; i++) {
      array[i * 3] = (rng() > 0.5 ? 14 : -14) + (rng() - 0.5) * 4;
      array[i * 3 + 1] = rng() * 14 - 6;
      array[i * 3 + 2] = (rng() - 0.5) * 6;
    }
    return array;
  }, []);

  const reducedMotion = useReducedMotion();

  useFrame((_, delta) => {
    const points = ref.current;
    // Decorative, and the only non-deterministic thing in the scene: recycled
    // sparks draw fresh Math.random() positions, so two sessions never match.
    // Freezing them under reduced motion is both the accessibility behaviour
    // and what lets the seed-determinism eval measure the ship rather than the
    // weather behind it.
    if (!points || reducedMotion) return;
    const attribute = points.geometry.getAttribute('position');
    const array = attribute.array as Float32Array;
    for (let i = 0; i < count; i++) {
      const y = i * 3 + 1;
      array[y] = (array[y] ?? 0) - delta * 7;
      if ((array[y] ?? 0) < -6) {
        array[y] = 8 + Math.random() * 2;
        array[i * 3] = (Math.random() > 0.5 ? 14 : -14) + (Math.random() - 0.5) * 4;
        array[i * 3 + 2] = (Math.random() - 0.5) * 6;
      }
    }
    attribute.needsUpdate = true;
  });

  return (
    <points ref={ref}>
      <bufferGeometry>
        <bufferAttribute attach="attributes-position" args={[positions, 3]} />
      </bufferGeometry>
      <pointsMaterial
        color="#fbbf24"
        size={0.09}
        transparent
        opacity={0.9}
        blending={AdditiveBlending}
        depthWrite={false}
        toneMapped={false}
      />
    </points>
  );
}

function CradleRib({ z }: { z: number }) {
  return (
    <group position={[0, 0, z]}>
      {/* Port Vertical Gantry Column */}
      <mesh position={[-18, 2, 0]} castShadow receiveShadow>
        <boxGeometry args={[1.4, 20, 1.4]} />
        <meshStandardMaterial color="#1e293b" roughness={0.7} metalness={0.7} />
      </mesh>
      {/* Starboard Vertical Gantry Column */}
      <mesh position={[18, 2, 0]} castShadow receiveShadow>
        <boxGeometry args={[1.4, 20, 1.4]} />
        <meshStandardMaterial color="#1e293b" roughness={0.7} metalness={0.7} />
      </mesh>
      {/* Lower Keel Cradle Transverse Beam */}
      <mesh position={[0, -8, 0]} castShadow receiveShadow>
        <boxGeometry args={[36, 1.4, 1.4]} />
        <meshStandardMaterial color="#1e293b" roughness={0.7} metalness={0.7} />
      </mesh>
      {/* Lower Hazard Caution Plate */}
      <mesh position={[0, -7.2, 0]}>
        <boxGeometry args={[34, 0.1, 0.6]} />
        <meshStandardMaterial color="#f59e0b" roughness={0.4} metalness={0.3} />
      </mesh>
      {/* Upper Overhead Gantry Arch Beam */}
      <mesh position={[0, 12, 0]} castShadow receiveShadow>
        <boxGeometry args={[36, 1.4, 1.4]} />
        <meshStandardMaterial color="#1e293b" roughness={0.7} metalness={0.7} />
      </mesh>
      {/* Upper Hazard Caution Plate */}
      <mesh position={[0, 11.2, 0]}>
        <boxGeometry args={[34, 0.1, 0.6]} />
        <meshStandardMaterial color="#f59e0b" roughness={0.4} metalness={0.3} />
      </mesh>
      {/* Diagonal Corner Gussets */}
      {[-1, 1].map((dirX) => (
        <group key={`gusset-${dirX}`}>
          <mesh position={[dirX * 15, 9, 0]} rotation={[0, 0, (dirX * -Math.PI) / 4]}>
            <boxGeometry args={[4.5, 0.8, 0.8]} />
            <meshStandardMaterial color="#334155" roughness={0.6} metalness={0.8} />
          </mesh>
          <mesh position={[dirX * 15, -5, 0]} rotation={[0, 0, (dirX * Math.PI) / 4]}>
            <boxGeometry args={[4.5, 0.8, 0.8]} />
            <meshStandardMaterial color="#334155" roughness={0.6} metalness={0.8} />
          </mesh>
        </group>
      ))}
      {/* Port Red Clearance Strobe */}
      <mesh position={[-18.8, 12, 0]}>
        <sphereGeometry args={[0.2, 8, 8]} />
        <meshStandardMaterial color="#ef4444" emissive="#ef4444" emissiveIntensity={3.5} toneMapped={false} />
      </mesh>
      {/* Starboard Green Clearance Strobe */}
      <mesh position={[18.8, 12, 0]}>
        <sphereGeometry args={[0.2, 8, 8]} />
        <meshStandardMaterial color="#10b981" emissive="#10b981" emissiveIntensity={3.5} toneMapped={false} />
      </mesh>
    </group>
  );
}

function ServiceGantryArm({ side, y, z }: { side: 'port' | 'stbd'; y: number; z: number }) {
  const isPort = side === 'port';
  const rootX = isPort ? -18 : 18;
  const reachDir = isPort ? 1 : -1;

  return (
    <group position={[rootX, y, z]}>
      {/* Hydraulic Mounting Barbette Base */}
      <mesh castShadow>
        <cylinderGeometry args={[0.8, 0.9, 1.2, 10]} />
        <meshStandardMaterial color="#0f172a" roughness={0.4} metalness={0.9} />
      </mesh>
      {/* Cantilever Gantry Truss Arm extending inward */}
      <mesh position={[reachDir * 4.8, 0, 0]} castShadow receiveShadow>
        <boxGeometry args={[9.2, 0.5, 1.4]} />
        <meshStandardMaterial color="#334155" roughness={0.6} metalness={0.8} />
      </mesh>
      {/* Walkway Surface with Perforated Grate Texture */}
      <mesh position={[reachDir * 4.8, 0.3, 0]}>
        <boxGeometry args={[9.0, 0.08, 0.9]} />
        <meshStandardMaterial color="#1e293b" roughness={0.9} metalness={0.4} />
      </mesh>
      {/* Safety Handrail Stanchions */}
      {[-0.55, 0.55].map((railZ) => (
        <mesh key={railZ} position={[reachDir * 4.8, 0.7, railZ]}>
          <boxGeometry args={[9.0, 0.04, 0.04]} />
          <meshStandardMaterial color="#f59e0b" roughness={0.4} metalness={0.5} />
        </mesh>
      ))}
      {/* Magnetic Clamping Head / Fuel Umbilical Nozzle at Tip */}
      <group position={[reachDir * 9.5, -0.3, 0]}>
        <mesh castShadow>
          <cylinderGeometry args={[0.4, 0.5, 0.9, 10]} />
          <meshStandardMaterial color="#0f172a" roughness={0.3} metalness={0.9} />
        </mesh>
        {/* Cyan Status Indicator Ring */}
        <mesh position={[0, -0.45, 0]}>
          <cylinderGeometry args={[0.3, 0.3, 0.1, 10]} />
          <meshStandardMaterial color="#06b6d4" emissive="#06b6d4" emissiveIntensity={3.5} toneMapped={false} />
        </mesh>
        {/* Pulsing Work Beacon */}
        <mesh position={[0, 0.55, 0]}>
          <sphereGeometry args={[0.12, 8, 8]} />
          <meshStandardMaterial color="#fbbf24" emissive="#fbbf24" emissiveIntensity={3.0} toneMapped={false} />
        </mesh>
      </group>
    </group>
  );
}

function HabitationRing() {
  return (
    <group position={[0, 16.5, 0]}>
      {/* Toroidal Pressurized Station Habitation Habitat Ring */}
      <mesh rotation={[Math.PI / 2, 0, 0]} castShadow receiveShadow>
        <torusGeometry args={[13, 1.8, 12, 32]} />
        <meshStandardMaterial color="#1e293b" roughness={0.5} metalness={0.8} />
      </mesh>
      {/* Glowing Observation Viewport Bands */}
      <mesh rotation={[Math.PI / 2, 0, 0]}>
        <torusGeometry args={[13, 1.84, 6, 32]} />
        <meshStandardMaterial
          color="#38bdf8"
          emissive="#38bdf8"
          emissiveIntensity={1.8}
          roughness={0.2}
          metalness={0.9}
        />
      </mesh>
      {/* 4 Radial Structural Spokes connecting Habitat Torus to Central Spine */}
      {[0, Math.PI / 2, Math.PI, (3 * Math.PI) / 2].map((angle, idx) => (
        <mesh key={`spoke-${idx}`} rotation={[0, angle, 0]} position={[0, 0, 0]}>
          <cylinderGeometry args={[0.45, 0.45, 24, 8]} />
          <meshStandardMaterial color="#334155" roughness={0.6} metalness={0.8} />
        </mesh>
      ))}
    </group>
  );
}

function OperationsControlTower() {
  const radarRef = useRef<Group>(null);
  const reducedMotion = useReducedMotion();

  useFrame((state) => {
    if (reducedMotion || !radarRef.current) return;
    radarRef.current.rotation.y = state.clock.elapsedTime * 0.8;
  });

  return (
    <group position={[0, 18, -14]}>
      {/* Traffic Operations Support Column */}
      <mesh castShadow receiveShadow>
        <cylinderGeometry args={[2.2, 2.8, 8, 8]} />
        <meshStandardMaterial color="#1e293b" roughness={0.6} metalness={0.8} />
      </mesh>
      {/* Multi-Faceted Panoramic Observation Cupola */}
      <mesh position={[0, 4.2, 0]} castShadow>
        <cylinderGeometry args={[3.8, 2.5, 2.4, 8]} />
        <meshStandardMaterial color="#0f172a" roughness={0.3} metalness={0.9} />
      </mesh>
      {/* Observation Glass Windows Band */}
      <mesh position={[0, 4.4, 0]}>
        <cylinderGeometry args={[3.85, 3.2, 1.1, 8]} />
        <meshStandardMaterial
          color="#38bdf8"
          emissive="#0284c7"
          emissiveIntensity={2.5}
          roughness={0.1}
          metalness={0.95}
        />
      </mesh>
      {/* Elevated Communications Mast Needle */}
      <mesh position={[0, 8.5, 0]}>
        <cylinderGeometry args={[0.08, 0.22, 6.5, 8]} />
        <meshStandardMaterial color="#475569" roughness={0.4} metalness={0.9} />
      </mesh>
      {/* Red Obstruction Beacon at Mast Tip */}
      <mesh position={[0, 11.8, 0]}>
        <sphereGeometry args={[0.18, 8, 8]} />
        <meshStandardMaterial color="#ef4444" emissive="#ef4444" emissiveIntensity={5.0} toneMapped={false} />
        <pointLight color="#ef4444" intensity={3} distance={10} />
      </mesh>
      {/* Rotating Primary Orbital Radar Dish */}
      <group ref={radarRef} position={[1.4, 6.2, 1.2]}>
        <mesh rotation={[0.4, 0, 0]}>
          <cylinderGeometry args={[1.5, 0.1, 0.4, 16]} />
          <meshStandardMaterial color="#f59e0b" roughness={0.3} metalness={0.8} />
        </mesh>
      </group>
    </group>
  );
}

function Drydock() {
  const gantryRef = useRef<Group>(null);
  const reducedMotion = useReducedMotion();

  useFrame((state) => {
    if (reducedMotion) return;
    if (gantryRef.current) {
      gantryRef.current.rotation.y = Math.sin(state.clock.elapsedTime * 0.2) * 0.02;
    }
  });

  return (
    <group>
      <group ref={gantryRef}>
        {/* 4 Octagonal Structural Berth Cradle Rings */}
        {[-18, -6, 6, 18].map((z) => (
          <CradleRib key={`rib-${z}`} z={z} />
        ))}

        {/* 4 Longitudinal Heavy Box Spine Trusses linking the rings */}
        <mesh position={[-18, 12, 0]} castShadow receiveShadow>
          <boxGeometry args={[1.2, 1.2, 44]} />
          <meshStandardMaterial color="#1e293b" roughness={0.7} metalness={0.7} />
        </mesh>
        <mesh position={[18, 12, 0]} castShadow receiveShadow>
          <boxGeometry args={[1.2, 1.2, 44]} />
          <meshStandardMaterial color="#1e293b" roughness={0.7} metalness={0.7} />
        </mesh>
        <mesh position={[-18, -8, 0]} castShadow receiveShadow>
          <boxGeometry args={[1.2, 1.2, 44]} />
          <meshStandardMaterial color="#1e293b" roughness={0.7} metalness={0.7} />
        </mesh>
        <mesh position={[18, -8, 0]} castShadow receiveShadow>
          <boxGeometry args={[1.2, 1.2, 44]} />
          <meshStandardMaterial color="#1e293b" roughness={0.7} metalness={0.7} />
        </mesh>

        {/* 6 Articulated Hydraulic Service Gantry Arms (Port & Starboard pairs) */}
        {[-12, 0, 12].map((z) => (
          <group key={`gantry-pair-${z}`}>
            <ServiceGantryArm side="port" y={2} z={z} />
            <ServiceGantryArm side="stbd" y={2} z={z} />
          </group>
        ))}

        {/* Overhead Pressurized Station Habitation Habitat Ring */}
        <HabitationRing />

        {/* Elevated Traffic Control & Operations Cupola */}
        <OperationsControlTower />
      </group>

      <WeldingSparks />
      <DrydockLighting intensity={1.0} />

      {/* Heavy Modular Slipway Deck Floor with Berth Boundary Guide Rails */}
      <mesh position={[0, -11, 0]} rotation={[-Math.PI / 2, 0, 0]} receiveShadow>
        <planeGeometry args={[90, 90]} />
        <meshStandardMaterial color="#070b14" roughness={0.98} metalness={0.1} />
      </mesh>
      {/* Illuminated Berth Guide Lines */}
      {[-9, 9].map((lineX) => (
        <mesh key={`guide-${lineX}`} position={[lineX, -10.95, 0]} rotation={[-Math.PI / 2, 0, 0]}>
          <planeGeometry args={[0.3, 44]} />
          <meshStandardMaterial color="#06b6d4" emissive="#06b6d4" emissiveIntensity={2.5} toneMapped={false} />
        </mesh>
      ))}
    </group>
  );
}

/* --------------------------- Nebula scenery --------------------------- */

function Nebula() {
  const cloudsRef = useRef<Group>(null);
  const reducedMotion = useReducedMotion();

  useFrame((state) => {
    if (reducedMotion) return;
    if (cloudsRef.current) {
      cloudsRef.current.rotation.z = state.clock.elapsedTime * 0.012;
    }
  });

  const clouds = useMemo(() => {
    const rng = mulberry32(0x4eb01a);
    return Array.from({ length: 9 }, () => ({
      position: [
        (rng() - 0.5) * 70,
        (rng() - 0.5) * 40,
        -20 - rng() * 40,
      ] as [number, number, number],
      scale: 12 + rng() * 22,
      color: ['#a855f7', '#38bdf8', '#f43f5e', '#818cf8'][Math.floor(rng() * 4)] as string,
      opacity: 0.05 + rng() * 0.07,
    }));
  }, []);

  return (
    <group ref={cloudsRef}>
      {clouds.map((cloud, i) => (
        <mesh key={i} position={cloud.position} scale={cloud.scale}>
          <sphereGeometry args={[1, 16, 12]} />
          <meshBasicMaterial
            color={cloud.color}
            transparent
            opacity={cloud.opacity}
            blending={AdditiveBlending}
            depthWrite={false}
          />
        </mesh>
      ))}
    </group>
  );
}

/* --------------------------- Asteroid scenery --------------------------- */

function AsteroidField() {
  const fieldRef = useRef<Group>(null);
  const reducedMotion = useReducedMotion();

  const rocks = useMemo(() => {
    const rng = mulberry32(0xa57e01);
    return Array.from({ length: 90 }, () => ({
      position: [
        (rng() - 0.5) * 90,
        (rng() - 0.5) * 50,
        (rng() - 0.5) * 90,
      ] as [number, number, number],
      rotation: [rng() * Math.PI, rng() * Math.PI, rng() * Math.PI] as [number, number, number],
      scale: 0.4 + rng() * 2.6,
      detail: rng() > 0.7 ? 1 : 0,
    }));
  }, []);

  useFrame((_, delta) => {
    if (reducedMotion) return;
    if (fieldRef.current) fieldRef.current.rotation.y += delta * 0.008;
  });

  return (
    <group ref={fieldRef}>
      {rocks.map((rock, i) => (
        <mesh
          key={i}
          position={rock.position}
          rotation={rock.rotation}
          scale={rock.scale}
          castShadow
          receiveShadow
        >
          <icosahedronGeometry args={[1, rock.detail]} />
          <meshStandardMaterial color="#3f3a35" roughness={0.95} metalness={0.1} flatShading />
        </mesh>
      ))}
    </group>
  );
}

/* --------------------------- Entry point --------------------------- */

export function SceneEnvironment({
  environment,
  intensity,
}: {
  environment: EnvironmentId;
  intensity: number;
}) {
  return (
    <>
      <IblRig env={environment} intensity={intensity} />
      <Stars radius={120} depth={60} count={4000} factor={3} saturation={0} fade speed={0.4} />
      {environment === 'drydock' && <Drydock />}
      {environment === 'nebula' && <Nebula />}
      {environment === 'asteroid' && <AsteroidField />}
    </>
  );
}
