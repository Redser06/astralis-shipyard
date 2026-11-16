import { useEffect, useMemo, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import {
  AdditiveBlending,
  ExtrudeGeometry,
  Group,
  Shape,
  Vector3,
} from 'three';
import type { MissionState } from '../../domain/types';
import type { EnvironmentId } from '../viewportOptions';
import { useReducedMotion } from '../useReducedMotion';

export interface AmbientTrafficProps {
  environment: EnvironmentId;
  missionState?: MissionState | null;
}

type TrafficKind = 'freighter' | 'corvette' | 'tanker' | 'courier';

interface TrafficLaneSpec {
  id: string;
  kind: TrafficKind;
  orbitRadius: number;
  ellipticity: number;
  baseY: number;
  inclinationAmp: number;
  initialAngle: number;
  angularSpeed: number;
  scale: number;
  hullColor: string;
  accentColor: string;
}

const TRAFFIC_LANES: readonly TrafficLaneSpec[] = [
  {
    id: 'traffic-heavy-freighter',
    kind: 'freighter',
    orbitRadius: 82,
    ellipticity: 1.08,
    baseY: -16,
    inclinationAmp: 5.5,
    initialAngle: -1.85,
    angularSpeed: 0.036,
    scale: 1.15,
    hullColor: '#64748b',
    accentColor: '#c2410c',
  },
  {
    id: 'traffic-patrol-corvette',
    kind: 'corvette',
    orbitRadius: 62,
    ellipticity: 0.94,
    baseY: 6,
    inclinationAmp: 4.0,
    initialAngle: -2.25,
    angularSpeed: -0.058,
    scale: 0.85,
    hullColor: '#475569',
    accentColor: '#38bdf8',
  },
  {
    id: 'traffic-cryo-tanker',
    kind: 'tanker',
    orbitRadius: 96,
    ellipticity: 1.04,
    baseY: 8,
    inclinationAmp: 6.5,
    initialAngle: 1.4,
    angularSpeed: 0.028,
    scale: 1.25,
    hullColor: '#94a3b8',
    accentColor: '#0f766e',
  },
  {
    id: 'traffic-fleet-courier',
    kind: 'courier',
    orbitRadius: 70,
    ellipticity: 0.96,
    baseY: -12,
    inclinationAmp: 4.5,
    initialAngle: 3.6,
    angularSpeed: 0.048,
    scale: 0.8,
    hullColor: '#334155',
    accentColor: '#eab308',
  },
];

const _lanePos = new Vector3();
const _laneAhead = new Vector3();

let cachedCorvetteGeo: ExtrudeGeometry | null = null;
let cachedCourierWingGeo: ExtrudeGeometry | null = null;

function getCorvetteHullGeo(): ExtrudeGeometry {
  if (cachedCorvetteGeo) return cachedCorvetteGeo;
  // Sleek arrowhead cruiser planform (XZ plane, +Z forward after rotateX)
  const s = new Shape();
  s.moveTo(0, 2.4);
  s.lineTo(0.85, 0.3);
  s.lineTo(1.05, -1.5);
  s.lineTo(0.45, -2.1);
  s.lineTo(-0.45, -2.1);
  s.lineTo(-1.05, -1.5);
  s.lineTo(-0.85, 0.3);
  s.closePath();

  const geo = new ExtrudeGeometry(s, {
    depth: 0.42,
    bevelEnabled: true,
    bevelThickness: 0.1,
    bevelSize: 0.08,
    bevelSegments: 2,
  });
  geo.center();
  geo.rotateX(Math.PI / 2);
  geo.computeVertexNormals();
  cachedCorvetteGeo = geo;
  return geo;
}

function getCourierWingGeo(): ExtrudeGeometry {
  if (cachedCourierWingGeo) return cachedCourierWingGeo;
  const s = new Shape();
  s.moveTo(0, 1.9);
  s.lineTo(0.45, 0.5);
  s.lineTo(1.85, -1.2);
  s.lineTo(1.65, -1.65);
  s.lineTo(0.35, -1.2);
  s.lineTo(-0.35, -1.2);
  s.lineTo(-1.65, -1.65);
  s.lineTo(-1.85, -1.2);
  s.lineTo(-0.45, 0.5);
  s.closePath();

  const geo = new ExtrudeGeometry(s, {
    depth: 0.18,
    bevelEnabled: true,
    bevelThickness: 0.04,
    bevelSize: 0.04,
    bevelSegments: 1,
  });
  geo.center();
  geo.rotateX(Math.PI / 2);
  geo.computeVertexNormals();
  cachedCourierWingGeo = geo;
  return geo;
}

function sampleLanePoint(spec: TrafficLaneSpec, theta: number, out: Vector3): Vector3 {
  const rx = spec.orbitRadius * spec.ellipticity;
  const rz = spec.orbitRadius;
  const x = Math.cos(theta) * rx;
  const z = Math.sin(theta) * rz;
  const y = spec.baseY + Math.sin(theta * 1.5) * spec.inclinationAmp;
  return out.set(x, y, z);
}

function FreighterMesh({ hullColor, accentColor }: { hullColor: string; accentColor: string }) {
  return (
    <>
      {/* Main structural cargo spine */}
      <mesh>
        <boxGeometry args={[0.75, 0.55, 7.6]} />
        <meshStandardMaterial color={hullColor} metalness={0.74} roughness={0.42} />
      </mesh>
      {/* Armored bow prow */}
      <mesh position={[0, 0.05, 4.1]}>
        <boxGeometry args={[1.15, 0.78, 1.25]} />
        <meshStandardMaterial color="#475569" metalness={0.78} roughness={0.35} />
      </mesh>
      {/* Aft command bridge & engineering block */}
      <mesh position={[0, 0.52, -2.75]}>
        <boxGeometry args={[1.35, 1.05, 1.65]} />
        <meshStandardMaterial color="#334155" metalness={0.75} roughness={0.38} />
      </mesh>
      {/* Bridge viewport strip */}
      <mesh position={[0, 0.78, -1.9]}>
        <boxGeometry args={[0.92, 0.16, 0.08]} />
        <meshStandardMaterial
          color="#0f172a"
          emissive="#fef08a"
          emissiveIntensity={0.4}
          toneMapped
        />
      </mesh>
      {/* Four stacked modular cargo containers */}
      {[
        [-0.68, 0.08, 1.55, accentColor],
        [0.68, 0.08, 1.55, '#1e3a5f'],
        [-0.68, 0.08, -0.35, '#854d0e'],
        [0.68, 0.08, -0.35, accentColor],
      ].map(([cx, cy, cz, col], idx) => (
        <mesh key={idx} position={[cx as number, cy as number, cz as number]}>
          <boxGeometry args={[0.58, 0.68, 1.65]} />
          <meshStandardMaterial color={col as string} metalness={0.55} roughness={0.52} />
        </mesh>
      ))}
      {/* Twin drive bells & subtle ion wakes */}
      {[-0.4, 0.4].map((ex, idx) => (
        <group key={idx} position={[ex, 0, -3.9]}>
          <mesh rotation={[Math.PI / 2, 0, 0]}>
            <cylinderGeometry args={[0.24, 0.18, 0.55, 10]} />
            <meshStandardMaterial
              color="#1e293b"
              emissive="#38bdf8"
              emissiveIntensity={0.85}
              metalness={0.8}
              roughness={0.3}
              toneMapped
            />
          </mesh>
          <mesh position={[0, 0, -1.4]} rotation={[-Math.PI / 2, 0, 0]}>
            <coneGeometry args={[0.26, 2.5, 10, 1, true]} />
            <meshBasicMaterial
              color="#38bdf8"
              transparent
              opacity={0.18}
              depthWrite={false}
              blending={AdditiveBlending}
            />
          </mesh>
        </group>
      ))}
      {/* Pinpoint nav beacons */}
      <mesh position={[-1.02, 0.1, 3.8]}>
        <sphereGeometry args={[0.03, 6, 6]} />
        <meshBasicMaterial color="#ef4444" toneMapped />
      </mesh>
      <mesh position={[1.02, 0.1, 3.8]}>
        <sphereGeometry args={[0.03, 6, 6]} />
        <meshBasicMaterial color="#22c55e" toneMapped />
      </mesh>
    </>
  );
}

function CorvetteMesh({ hullColor, accentColor }: { hullColor: string; accentColor: string }) {
  const hullGeo = useMemo(() => getCorvetteHullGeo(), []);
  return (
    <>
      <mesh geometry={hullGeo}>
        <meshStandardMaterial color={hullColor} metalness={0.8} roughness={0.32} />
      </mesh>
      {/* Dorsal armored bridge citadel */}
      <mesh position={[0, 0.34, -0.45]}>
        <boxGeometry args={[0.54, 0.34, 1.35]} />
        <meshStandardMaterial color="#1e293b" metalness={0.78} roughness={0.34} />
      </mesh>
      {/* Forward chin sensor mast */}
      <mesh position={[0, -0.18, 1.85]} rotation={[Math.PI / 2, 0, 0]}>
        <cylinderGeometry args={[0.05, 0.08, 0.9, 8]} />
        <meshStandardMaterial color={accentColor} metalness={0.65} roughness={0.35} />
      </mesh>
      {/* Twin outrigger drive pods + subtle ion trail */}
      {[-0.86, 0.86].map((px, idx) => (
        <group key={idx} position={[px, -0.04, -1.65]}>
          <mesh rotation={[Math.PI / 2, 0, 0]}>
            <cylinderGeometry args={[0.18, 0.15, 1.35, 10]} />
            <meshStandardMaterial
              color="#334155"
              emissive="#60a5fa"
              emissiveIntensity={0.9}
              metalness={0.82}
              roughness={0.28}
              toneMapped
            />
          </mesh>
          <mesh position={[0, 0, -1.65]} rotation={[-Math.PI / 2, 0, 0]}>
            <coneGeometry args={[0.2, 2.2, 10, 1, true]} />
            <meshBasicMaterial
              color="#60a5fa"
              transparent
              opacity={0.2}
              depthWrite={false}
              blending={AdditiveBlending}
            />
          </mesh>
        </group>
      ))}
      <mesh position={[0, 0.56, -0.6]}>
        <sphereGeometry args={[0.028, 6, 6]} />
        <meshBasicMaterial color="#f59e0b" toneMapped />
      </mesh>
    </>
  );
}

function TankerMesh({ hullColor, accentColor }: { hullColor: string; accentColor: string }) {
  return (
    <>
      {/* Longitudinal truss spine */}
      <mesh>
        <boxGeometry args={[0.45, 0.45, 8.6]} />
        <meshStandardMaterial color="#475569" metalness={0.76} roughness={0.38} />
      </mesh>
      {/* Bow docking nose + command pod */}
      <mesh position={[0, 0.1, 4.35]}>
        <boxGeometry args={[0.92, 0.72, 1.0]} />
        <meshStandardMaterial color={accentColor} metalness={0.65} roughness={0.4} />
      </mesh>
      {/* Three spherical pressurized cryo-tanks */}
      {[2.1, 0, -2.1].map((tz, idx) => (
        <mesh key={idx} position={[0, 0, tz]}>
          <sphereGeometry args={[0.88, 16, 12]} />
          <meshStandardMaterial color={hullColor} metalness={0.48} roughness={0.36} />
        </mesh>
      ))}
      {/* Aft propulsion core & radiator ring */}
      <mesh position={[0, 0, -4.15]} rotation={[Math.PI / 2, 0, 0]}>
        <cylinderGeometry args={[0.56, 0.42, 0.9, 12]} />
        <meshStandardMaterial
          color="#334155"
          emissive="#fb923c"
          emissiveIntensity={0.75}
          metalness={0.8}
          roughness={0.32}
          toneMapped
        />
      </mesh>
      {/* Subtle amber fusion ion exhaust cone */}
      <mesh position={[0, 0, -5.85]} rotation={[-Math.PI / 2, 0, 0]}>
        <coneGeometry args={[0.38, 2.8, 12, 1, true]} />
        <meshBasicMaterial
          color="#fb923c"
          transparent
          opacity={0.16}
          depthWrite={false}
          blending={AdditiveBlending}
        />
      </mesh>
      <mesh position={[0, 0.96, 0]}>
        <sphereGeometry args={[0.03, 6, 6]} />
        <meshBasicMaterial color="#e2e8f0" toneMapped />
      </mesh>
    </>
  );
}

function CourierMesh({ hullColor, accentColor }: { hullColor: string; accentColor: string }) {
  const wingGeo = useMemo(() => getCourierWingGeo(), []);
  return (
    <>
      <mesh geometry={wingGeo}>
        <meshStandardMaterial color={hullColor} metalness={0.78} roughness={0.34} />
      </mesh>
      <mesh position={[0, 0.14, 0.25]}>
        <boxGeometry args={[0.42, 0.26, 2.15]} />
        <meshStandardMaterial color="#475569" metalness={0.8} roughness={0.3} />
      </mesh>
      <mesh position={[0, 0.25, 0.72]}>
        <boxGeometry args={[0.28, 0.14, 0.6]} />
        <meshStandardMaterial
          color="#0f172a"
          emissive="#38bdf8"
          emissiveIntensity={0.25}
          metalness={0.9}
          roughness={0.14}
          toneMapped
        />
      </mesh>
      <mesh position={[0, 0.05, -1.25]} rotation={[Math.PI / 2, 0, 0]}>
        <cylinderGeometry args={[0.16, 0.12, 0.45, 10]} />
        <meshStandardMaterial
          color="#1e293b"
          emissive={accentColor}
          emissiveIntensity={0.9}
          toneMapped
        />
      </mesh>
      <mesh position={[0, 0.05, -2.55]} rotation={[-Math.PI / 2, 0, 0]}>
        <coneGeometry args={[0.18, 2.1, 10, 1, true]} />
        <meshBasicMaterial
          color="#38bdf8"
          transparent
          opacity={0.2}
          depthWrite={false}
          blending={AdditiveBlending}
        />
      </mesh>
      <mesh position={[-1.7, 0.05, -1.25]}>
        <sphereGeometry args={[0.026, 6, 6]} />
        <meshBasicMaterial color="#ef4444" toneMapped />
      </mesh>
      <mesh position={[1.7, 0.05, -1.25]}>
        <sphereGeometry args={[0.026, 6, 6]} />
        <meshBasicMaterial color="#22c55e" toneMapped />
      </mesh>
    </>
  );
}

function TrafficVessel({
  spec,
  reducedMotion,
}: {
  spec: TrafficLaneSpec;
  reducedMotion: boolean;
}) {
  const groupRef = useRef<Group>(null);

  useEffect(() => {
    const grp = groupRef.current;
    if (!grp) return;
    sampleLanePoint(spec, spec.initialAngle, _lanePos);
    const stepDir = spec.angularSpeed >= 0 ? 0.05 : -0.05;
    sampleLanePoint(spec, spec.initialAngle + stepDir, _laneAhead);
    grp.position.copy(_lanePos);
    grp.lookAt(_laneAhead);
    grp.rotateZ(spec.angularSpeed >= 0 ? -0.14 : 0.14);
  }, [spec]);

  useFrame(({ clock }) => {
    const grp = groupRef.current;
    if (!grp) return;
    const t = reducedMotion ? 0 : clock.getElapsedTime();
    const theta = spec.initialAngle + t * spec.angularSpeed;
    const stepDir = spec.angularSpeed >= 0 ? 0.04 : -0.04;
    sampleLanePoint(spec, theta, _lanePos);
    sampleLanePoint(spec, theta + stepDir, _laneAhead);
    grp.position.copy(_lanePos);
    grp.lookAt(_laneAhead);
    // Subtle realistic bank into orbital turn
    grp.rotateZ(spec.angularSpeed >= 0 ? -0.14 : 0.14);
  });

  return (
    <group ref={groupRef} name={spec.id} scale={spec.scale}>
      {spec.kind === 'freighter' && (
        <FreighterMesh hullColor={spec.hullColor} accentColor={spec.accentColor} />
      )}
      {spec.kind === 'corvette' && (
        <CorvetteMesh hullColor={spec.hullColor} accentColor={spec.accentColor} />
      )}
      {spec.kind === 'tanker' && (
        <TankerMesh hullColor={spec.hullColor} accentColor={spec.accentColor} />
      )}
      {spec.kind === 'courier' && (
        <CourierMesh hullColor={spec.hullColor} accentColor={spec.accentColor} />
      )}
    </group>
  );
}

export function AmbientTraffic({
  environment: _environment,
  missionState: _missionState = null,
}: AmbientTrafficProps) {
  const reducedMotion = useReducedMotion();

  return (
    <>
      {TRAFFIC_LANES.map((spec) => (
        <TrafficVessel key={spec.id} spec={spec} reducedMotion={reducedMotion} />
      ))}
    </>
  );
}
