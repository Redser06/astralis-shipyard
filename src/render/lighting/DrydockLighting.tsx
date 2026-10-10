import { useRef, useMemo } from 'react';
import { useFrame } from '@react-three/fiber';
import { Group, SpotLight as ThreeSpotLight } from 'three';
import { useReducedMotion } from '../useReducedMotion';

interface SearchlightSpec {
  id: string;
  position: [number, number, number];
  targetOffset: [number, number, number];
  color: string;
  intensity: number;
  phaseOffset: number;
}

const SEARCHLIGHT_SPECS: readonly SearchlightSpec[] = [
  { id: 'sl-port-low', position: [-18, 2, -10], targetOffset: [0, 0, -4], color: '#ffffff', intensity: 75, phaseOffset: 0.0 },
  { id: 'sl-port-mid', position: [-18, 10, 0], targetOffset: [0, 0, 0], color: '#e0f2fe', intensity: 85, phaseOffset: 1.2 },
  { id: 'sl-port-high', position: [-18, 16, 10], targetOffset: [0, 0, 4], color: '#ffffff', intensity: 90, phaseOffset: 2.4 },
  { id: 'sl-stbd-low', position: [18, 2, -10], targetOffset: [0, 0, -4], color: '#ffffff', intensity: 75, phaseOffset: 3.6 },
  { id: 'sl-stbd-mid', position: [18, 10, 0], targetOffset: [0, 0, 0], color: '#e0f2fe', intensity: 85, phaseOffset: 4.8 },
  { id: 'sl-stbd-high', position: [18, 16, 10], targetOffset: [0, 0, 4], color: '#ffffff', intensity: 90, phaseOffset: 6.0 },
];

function ArticulatedSearchlight({
  spec,
  intensityScale,
}: {
  spec: SearchlightSpec;
  intensityScale: number;
}) {
  const yokeRef = useRef<Group>(null);
  const headRef = useRef<Group>(null);
  const spotRef = useRef<ThreeSpotLight>(null);
  const targetObjRef = useRef<Group>(null);
  const reducedMotion = useReducedMotion();

  useFrame((state) => {
    if (reducedMotion) return;
    const t = state.clock.elapsedTime + spec.phaseOffset;

    // Compound Lissajous sweeping kinematics:
    // theta_y = sin(t * 0.3) * 0.6, phi_x = cos(t * 0.2) * 0.3
    const thetaY = Math.sin(t * 0.3) * 0.6;
    const phiX = Math.cos(t * 0.2) * 0.3;

    if (yokeRef.current) {
      yokeRef.current.rotation.y = thetaY;
    }
    if (headRef.current) {
      headRef.current.rotation.x = phiX;
    }

    if (targetObjRef.current && spotRef.current) {
      // Direct spot target towards midsection / nose
      targetObjRef.current.position.set(
        spec.targetOffset[0] + Math.sin(t * 0.3) * 3.5,
        spec.targetOffset[1] + Math.cos(t * 0.2) * 1.5,
        spec.targetOffset[2] + Math.sin(t * 0.25) * 4.0,
      );
      spotRef.current.target = targetObjRef.current;
    }
  });

  return (
    <group position={spec.position}>
      {/* Tower mounting bracket */}
      <mesh castShadow receiveShadow>
        <boxGeometry args={[1.4, 0.5, 1.4]} />
        <meshStandardMaterial color="#1e293b" roughness={0.7} metalness={0.8} />
      </mesh>

      {/* Articulating Yoke (Yaw / Theta_Y) */}
      <group ref={yokeRef} position={[0, 0.4, 0]}>
        <mesh position={[0, 0.25, 0]} castShadow>
          <cylinderGeometry args={[0.3, 0.35, 0.5, 12]} />
          <meshStandardMaterial color="#334155" roughness={0.6} metalness={0.8} />
        </mesh>

        {/* Head Gimbal (Pitch / Phi_X) */}
        <group ref={headRef} position={[0, 0.55, 0]}>
          {/* Industrial Lamp Canister */}
          <mesh rotation={[Math.PI / 2, 0, 0]} castShadow>
            <cylinderGeometry args={[0.42, 0.32, 0.85, 16]} />
            <meshStandardMaterial color="#0f172a" roughness={0.4} metalness={0.9} />
          </mesh>

          {/* Emissive Lamp Lens */}
          <mesh position={[0, 0, 0.43]} rotation={[Math.PI / 2, 0, 0]}>
            <circleGeometry args={[0.4, 16]} />
            <meshStandardMaterial
              color="#ffffff"
              emissive={spec.color}
              emissiveIntensity={3.5}
              roughness={0.1}
            />
          </mesh>

          {/* Focused High-Intensity SpotLight */}
          <spotLight
            ref={spotRef}
            color={spec.color}
            intensity={spec.intensity * intensityScale}
            angle={Math.PI / 6}
            penumbra={0.4}
            distance={55}
            castShadow
            shadow-mapSize={[1024, 1024]}
            shadow-bias={-0.0005}
          />
        </group>
      </group>

      {/* Target object in scene */}
      <group ref={targetObjRef} position={spec.targetOffset} />
    </group>
  );
}

/**
 * Docking bay warning strobes: alternating aviation yellow (#f59e0b)
 * and hazard cyan (#06b6d4) at 1.2 Hz.
 */
function DockingStrobeBeacons() {
  const yellowRef = useRef<Group>(null);
  const cyanRef = useRef<Group>(null);
  const reducedMotion = useReducedMotion();

  const strobePositions = useMemo<[number, number, number][]>(
    () => [
      [-19, 18, -12],
      [-19, 18, 12],
      [19, 18, -12],
      [19, 18, 12],
      [-19, -8, 0],
      [19, -8, 0],
    ],
    [],
  );

  useFrame((state) => {
    if (reducedMotion) return;
    const t = state.clock.elapsedTime;
    // 1.2 Hz frequency -> period = 1 / 1.2 = 0.833s
    const phase = Math.floor(t * 2.4) % 2;
    if (yellowRef.current && cyanRef.current) {
      yellowRef.current.visible = phase === 0;
      cyanRef.current.visible = phase === 1;
    }
  });

  return (
    <group>
      <group ref={yellowRef}>
        {strobePositions.map((pos, i) => (
          <group key={`strobe-y-${i}`} position={pos}>
            <mesh>
              <sphereGeometry args={[0.22, 10, 8]} />
              <meshStandardMaterial
                color="#f59e0b"
                emissive="#f59e0b"
                emissiveIntensity={4.5}
                toneMapped={false}
              />
            </mesh>
            <pointLight color="#f59e0b" intensity={8} distance={8} />
          </group>
        ))}
      </group>

      <group ref={cyanRef}>
        {strobePositions.map((pos, i) => (
          <group key={`strobe-c-${i}`} position={pos}>
            <mesh>
              <sphereGeometry args={[0.22, 10, 8]} />
              <meshStandardMaterial
                color="#06b6d4"
                emissive="#06b6d4"
                emissiveIntensity={4.5}
                toneMapped={false}
              />
            </mesh>
            <pointLight color="#06b6d4" intensity={8} distance={8} />
          </group>
        ))}
      </group>
    </group>
  );
}

/**
 * Umbilical fueling & data cables stretching from gantry to ship.
 */
function UmbilicalCables() {
  return (
    <group>
      {[-1, 1].map((side) => (
        <group key={`umbilical-${side}`}>
          {/* Heavy power & propellant conduit drooping towards ship centre */}
          <mesh position={[side * 10, 1.2, -1.8]} rotation={[0, 0, side * 0.45]}>
            <cylinderGeometry args={[0.12, 0.12, 16, 8]} />
            <meshStandardMaterial color="#0f172a" roughness={0.8} metalness={0.5} />
          </mesh>
          {/* Cryo line insulation rings */}
          {[-5, 0, 5].map((z) => (
            <mesh key={`ring-${z}`} position={[side * 12, 2.0, z]}>
              <torusGeometry args={[0.22, 0.05, 6, 12]} />
              <meshStandardMaterial color="#fbbf24" roughness={0.4} metalness={0.8} />
            </mesh>
          ))}
        </group>
      ))}
    </group>
  );
}

export function DrydockLighting({ intensity = 1.0 }: { intensity?: number }) {
  return (
    <group>
      {/* 6 Articulating robotic searchlight towers */}
      {SEARCHLIGHT_SPECS.map((spec) => (
        <ArticulatedSearchlight key={spec.id} spec={spec} intensityScale={intensity} />
      ))}

      {/* Docking Bay warning strobes */}
      <DockingStrobeBeacons />

      {/* Gantry service umbilicals */}
      <UmbilicalCables />
    </group>
  );
}
