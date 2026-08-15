import { useMemo, useRef } from 'react';
import { Environment, Lightformer, Stars } from '@react-three/drei';
import { useFrame } from '@react-three/fiber';
import { AdditiveBlending, type Group, type Points } from 'three';
import { mulberry32 } from '../../domain/rng';
import type { EnvironmentId } from '../viewportOptions';


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

  useFrame((_, delta) => {
    const points = ref.current;
    if (!points) return;
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

function Drydock() {
  const gantryRef = useRef<Group>(null);

  useFrame((state) => {
    if (gantryRef.current) {
      gantryRef.current.rotation.y = Math.sin(state.clock.elapsedTime * 0.4) * 0.08;
    }
  });

  return (
    <group>
      <group ref={gantryRef}>
        {[-19, 19].map((x) => (
          <group key={x} position={[x, 0, 0]}>
            <mesh castShadow receiveShadow>
              <boxGeometry args={[1.2, 18, 1.2]} />
              <meshStandardMaterial color="#1e293b" roughness={0.8} metalness={0.6} />
            </mesh>
            {[-5, 0, 5].map((z) => (
              <mesh key={z} position={[0, 4, z]} castShadow>
                <boxGeometry args={[0.5, 0.5, 3]} />
                <meshStandardMaterial color="#334155" roughness={0.7} metalness={0.7} />
              </mesh>
            ))}
          </group>
        ))}
        {/* Overhead spine */}
        <mesh position={[0, 9, 0]} castShadow>
          <boxGeometry args={[38, 0.8, 0.8]} />
          <meshStandardMaterial color="#1e293b" roughness={0.8} metalness={0.6} />
        </mesh>
      </group>
      <WeldingSparks />
      {/* Deck plate — gives the shadows something to land on */}
      <mesh position={[0, -11, 0]} rotation={[-Math.PI / 2, 0, 0]} receiveShadow>
        <planeGeometry args={[80, 80]} />
        <meshStandardMaterial color="#070b14" roughness={0.98} metalness={0.1} />
      </mesh>
    </group>
  );
}

/* --------------------------- Nebula scenery --------------------------- */

function Nebula() {
  const cloudsRef = useRef<Group>(null);

  useFrame((state) => {
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
