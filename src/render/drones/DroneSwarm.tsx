import { useMemo, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import {
  AdditiveBlending,
  Euler,
  Group,
  InstancedMesh,
  Matrix4,
  Quaternion,
  Vector3,
  type Points,
} from 'three';
import { mulberry32 } from '../../domain/rng';
import { useReducedMotion } from '../useReducedMotion';

const DRONE_COUNT = 18;

interface DroneState {
  baseAngle: number;
  speed: number;
  radius: number;
  height: number;
  zOffset: number;
  currentPos: Vector3;
  targetPos: Vector3;
  targetNormal: Vector3;
  repairTarget: Vector3;
}

/**
 * Procedural electric weld sparks emitted during repair mode.
 */
function WeldSparks({ active }: { active: boolean }) {
  const pointsRef = useRef<Points>(null);
  const sparkCount = 60;
  const reducedMotion = useReducedMotion();

  const positions = useMemo(() => {
    const array = new Float32Array(sparkCount * 3);
    const rng = mulberry32(0x9a41b2);
    for (let i = 0; i < sparkCount; i++) {
      array[i * 3] = (rng() - 0.5) * 4;
      array[i * 3 + 1] = (rng() - 0.5) * 2;
      array[i * 3 + 2] = (rng() - 0.5) * 8;
    }
    return array;
  }, []);

  useFrame((_, delta) => {
    if (!pointsRef.current || !active || reducedMotion) return;
    const attr = pointsRef.current.geometry.getAttribute('position');
    const arr = attr.array as Float32Array;
    for (let i = 0; i < sparkCount; i++) {
      const idx = i * 3;
      arr[idx + 1] -= delta * 3.5;
      if (arr[idx + 1] < -1.5) {
        arr[idx] = (Math.random() - 0.5) * 3;
        arr[idx + 1] = 0.5 + Math.random() * 0.8;
        arr[idx + 2] = (Math.random() - 0.5) * 6;
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
        color="#38bdf8"
        size={0.12}
        transparent
        opacity={0.95}
        blending={AdditiveBlending}
        depthWrite={false}
        toneMapped={false}
      />
    </points>
  );
}

/**
 * Laser welding beam lines drawn from drones to hull target spots.
 */
function LaserWeldingArcs({
  dronePositions,
  active,
}: {
  dronePositions: Vector3[];
  active: boolean;
}) {
  const reducedMotion = useReducedMotion();
  const lineGroupRef = useRef<Group>(null);

  useFrame((state) => {
    if (reducedMotion || !active || !lineGroupRef.current) return;
    // Jitter opacity slightly for electric welding flicker
    const flicker = 0.75 + Math.sin(state.clock.elapsedTime * 45) * 0.25;
    lineGroupRef.current.children.forEach((child) => {
      const mesh = child as unknown as { material?: { opacity?: number } };
      if (mesh.material && typeof mesh.material.opacity === 'number') {
        mesh.material.opacity = flicker;
      }
    });
  });

  if (!active) return null;

  return (
    <group ref={lineGroupRef}>
      {dronePositions.slice(0, 8).map((pos, i) => {
        // Target is closer to hull center
        const target = new Vector3(pos.x * 0.25, pos.y * 0.25, pos.z);
        const mid = pos.clone().lerp(target, 0.5);
        const dist = pos.distanceTo(target);

        return (
          <group key={i}>
            <mesh
              position={[mid.x, mid.y, mid.z]}
              onUpdate={(self) => {
                self.lookAt(target);
              }}
            >
              <cylinderGeometry args={[0.02, 0.02, dist, 4]} />
              <meshBasicMaterial
                color="#f8fafc"
                transparent
                opacity={0.9}
                blending={AdditiveBlending}
                toneMapped={false}
              />
            </mesh>
            {/* Lidar/Laser impact spark hot spot on hull */}
            <mesh position={[target.x, target.y, target.z]}>
              <sphereGeometry args={[0.09, 8, 8]} />
              <meshBasicMaterial
                color="#38bdf8"
                transparent
                opacity={0.95}
                blending={AdditiveBlending}
                toneMapped={false}
              />
            </mesh>
          </group>
        );
      })}
    </group>
  );
}

export function DroneSwarm({
  condition = 1.0,
  isRepairing = false,
}: {
  condition?: number;
  isRepairing?: boolean;
}) {
  const instancedRef = useRef<InstancedMesh>(null);
  const reducedMotion = useReducedMotion();
  const needsRepair = condition < 0.98 || isRepairing;

  const drones = useMemo<DroneState[]>(() => {
    const rng = mulberry32(0x4a88bc);
    return Array.from({ length: DRONE_COUNT }, (_, i) => {
      const angle = (i / DRONE_COUNT) * Math.PI * 2;
      return {
        baseAngle: angle,
        speed: 0.35 + rng() * 0.45,
        radius: 4.5 + rng() * 2.2,
        height: (rng() - 0.5) * 4.0,
        zOffset: (rng() - 0.5) * 14.0,
        currentPos: new Vector3(
          Math.cos(angle) * (4.5 + rng() * 2),
          (rng() - 0.5) * 4.0,
          (rng() - 0.5) * 14.0,
        ),
        targetPos: new Vector3(),
        targetNormal: new Vector3(0, 1, 0),
        repairTarget: new Vector3((rng() - 0.5) * 3, (rng() - 0.5) * 1.5, (rng() - 0.5) * 10),
      };
    });
  }, []);

  const dummyMatrix = useMemo(() => new Matrix4(), []);
  const dummyQuat = useMemo(() => new Quaternion(), []);
  const dummyScale = useMemo(() => new Vector3(1, 1, 1), []);
  const livePositions = useRef<Vector3[]>(drones.map((d) => d.currentPos));

  useFrame((state, delta) => {
    if (reducedMotion || !instancedRef.current) return;
    const t = state.clock.elapsedTime;

    drones.forEach((drone, idx) => {
      if (needsRepair) {
        // Repair Mode: converge near hull damage targets and hover at 0.8m - 1.5m
        const target = drone.repairTarget.clone();
        const hoverOffset = new Vector3(
          Math.sin(t * 1.2 + idx) * 0.4,
          0.8 + Math.cos(t * 1.5 + idx) * 0.2,
          Math.sin(t * 0.8 + idx) * 0.3,
        );
        drone.targetPos.copy(target).add(hoverOffset);
      } else {
        // Patrol Mode: fly perimeter inspection splines at 4-6 m distance
        const currentAngle = drone.baseAngle + t * drone.speed * 0.4;
        const rad = drone.radius + Math.sin(t * 0.5 + idx) * 0.8;
        drone.targetPos.set(
          Math.cos(currentAngle) * rad,
          drone.height + Math.sin(t * 0.7 + idx) * 1.2,
          drone.zOffset + Math.cos(currentAngle) * 3.0,
        );
      }

      // Smooth interpolation to target
      drone.currentPos.lerp(drone.targetPos, 1 - Math.pow(0.02, delta));
      livePositions.current[idx] = drone.currentPos;

      // Look toward ship center or repair point
      const lookTarget = needsRepair ? drone.repairTarget : new Vector3(0, 0, drone.currentPos.z);
      const forward = lookTarget.clone().sub(drone.currentPos).normalize();
      dummyQuat.setFromEuler(
        new Euler(
          Math.atan2(-forward.y, Math.hypot(forward.x, forward.z)),
          Math.atan2(forward.x, forward.z),
          Math.sin(t * 2 + idx) * 0.15, // slight roll bob
        ),
      );

      dummyMatrix.compose(drone.currentPos, dummyQuat, dummyScale);
      instancedRef.current?.setMatrixAt(idx, dummyMatrix);
    });

    instancedRef.current.instanceMatrix.needsUpdate = true;
  });

  return (
    <group>
      {/* Instanced Drone Bodies */}
      <instancedMesh
        ref={instancedRef}
        args={[undefined, undefined, DRONE_COUNT]}
        castShadow
      >
        {/* Hex-thruster maintenance drone chassis */}
        <cylinderGeometry args={[0.22, 0.28, 0.14, 6]} />
        <meshStandardMaterial
          color="#334155"
          roughness={0.4}
          metalness={0.8}
          emissive="#38bdf8"
          emissiveIntensity={needsRepair ? 0.9 : 0.3}
        />
      </instancedMesh>

      {/* Laser welding arcs and spark bursts during repair mode */}
      <LaserWeldingArcs dronePositions={livePositions.current} active={needsRepair} />
      <WeldSparks active={needsRepair} />
    </group>
  );
}
