import { useMemo, useRef, type ReactNode } from 'react';
import { useFrame } from '@react-three/fiber';
import { MathUtils, Matrix4, Quaternion, Vector3, type Group, type Mesh, type MeshStandardMaterial } from 'three';
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
import { ENGINE_PROFILE } from './engineProfile';
import type { RenderMode } from '../materials/renderModes';
import { Conduit, Fitting, MountFlange } from './Fitting';
import { HYPER_SHUNT_HOUSING } from '../../domain/fittings';
import type { DamageOptions, DamageSurface } from '../../domain/damage';
import { SurfaceDamage } from '../damage/Damage';
import { ArticulatedTurret } from './ArticulatedTurret';
import { MissilePod } from './MissilePod';
import { useReducedMotion } from '../useReducedMotion';

/**
 * Hardware that mounts to hull sockets.
 *
 * In the prototype, four of the six component pickers — weapons, sensors,
 * sublight drives and fuel — changed state and produced no geometry whatsoever.
 * Every picker now resolves to a distinct mesh here.
 *
 * AUTHORING CONVENTION — one rule, and it is enforced by every part below.
 *
 *   A part is authored pointing +Y with its MOUNTING FACE AT LOCAL y = 0.
 *   Nothing of substance lives below y = 0. `SocketMount` puts local +Y on the
 *   socket's outward normal and local +Z on its `up` reference, so the part's
 *   mounting face lands exactly on the hull surface the socket was seated on.
 */

const SIZE_SCALE: Record<SocketSize, number> = { S: 0.7, M: 1.0, L: 1.4 };

export function SocketMount({
  socket,
  children,
  retracted = false,
}: {
  socket: Socket;
  children: ReactNode;
  retracted?: boolean;
}) {
  const mountGroupRef = useRef<Group>(null);
  const extensionRef = useRef(retracted ? 0.0 : 1.0);

  const transform = useMemo(() => {
    const normal = new Vector3(...socket.normal).normalize();

    // Build the full basis rather than the shortest arc from +Y to the normal.
    const up = new Vector3(...socket.up);
    const forward = up.clone().addScaledVector(normal, -up.dot(normal));
    if (forward.lengthSq() < 1e-8) {
      forward.set(0, 0, 1).addScaledVector(normal, -normal.z);
      if (forward.lengthSq() < 1e-8) forward.set(1, 0, 0);
    }
    forward.normalize();
    const right = new Vector3().crossVectors(normal, forward);

    const quaternion = new Quaternion().setFromRotationMatrix(
      new Matrix4().makeBasis(right, normal, forward),
    );

    return {
      position: new Vector3(...socket.position),
      quaternion,
      scale: SIZE_SCALE[socket.size],
    };
  }, [socket]);

  useFrame((_, delta) => {
    const target = retracted ? 0.0 : 1.0;
    extensionRef.current = MathUtils.damp(extensionRef.current, target, 5.0, delta);
    if (mountGroupRef.current) {
      mountGroupRef.current.position.y = (extensionRef.current - 1.0) * 0.35;
      const s = Math.max(0.001, extensionRef.current);
      mountGroupRef.current.scale.set(s, s, s);
      mountGroupRef.current.visible = extensionRef.current > 0.03;
    }
  });

  return (
    <group
      position={transform.position}
      quaternion={transform.quaternion}
      scale={transform.scale}
    >
      <group ref={mountGroupRef}>
        {children}
      </group>
    </group>
  );
}

/* --------------------------- Shared fittings --------------------------- */

/**
 * `MountFlange` and `Conduit` moved to `./Fitting.tsx` when the component
 * registry landed: the recipe renderer needs both, and a shared fitting that
 * exists in two files is a shared fitting that will diverge.
 */

/* --------------------------- Radiators --------------------------- */

const RADIATOR_SPAN = 1.8;
const RADIATOR_CHORD = 3.0;

/* --------------------------- Weathering --------------------------- */

/**
 * How the hand-authored parts weather, and on which of their own surfaces.
 *
 * Registry components (`domain/fittings.ts`) carry this as data on the
 * definition. These four predate the registry and are kept as code because
 * they animate — the bell pulses, the panels glow, the plume tracks the
 * burn — so the surfaces are declared here instead. Module scope, because
 * `SurfaceDamage` memoises on them: a fresh object every render would rebuild
 * every DecalGeometry every frame.
 */
const RADIATOR_PANEL: DamageSurface = {
  kind: 'plane',
  width: RADIATOR_CHORD,
  height: RADIATOR_SPAN * 0.86,
};
/** A radiator is the thinnest, most exposed thing on a ship: it gets holed. */
const RADIATOR_DAMAGE: DamageOptions = {
  exposure: { impact: 2.0, structural: 1.5, thermal: 1.2, repair: 1.3 },
  density: 0.7,
  max: 4,
};
/** Nothing on a ship scorches like the thing that is on fire. */
const ENGINE_DAMAGE: DamageOptions = {
  exposure: { thermal: 2.6, grime: 1.4, oxidation: 0.7 },
  density: 0.7,
  max: 4,
};
/** Tanks are sealed and rarely replaced: they stain rather than get patched. */
const TANK_DAMAGE: DamageOptions = {
  exposure: { oxidation: 1.7, grime: 1.4, repair: 0.5 },
  density: 0.6,
  max: 3,
};
const CRYO_TANK: DamageSurface = { kind: 'capsule', radius: 0.62, length: 2.6 };
const MAGNETIC_BOTTLE: DamageSurface = { kind: 'capsule', radius: 0.3, length: 1.5 };
const ANTIMATTER_POD: DamageSurface = { kind: 'sphere', radius: 0.55 };

/**
 * Heat-rejection panel. Glow responds to `burning` and to thermal wear.
 *
 * The animation reads its inputs from props on every frame via useFrame. The
 * prototype read them from a closure captured once, which is why Test Burn
 * never changed anything on screen.
 *
 * Assembled symmetrically about its own spine: the radiating faces are a
 * matched pair either side of the boom, so a port radiator and a starboard one
 * look the same. Previously a single offset face landed on the underside of the
 * frame to starboard and the topside to port.
 */
const RADIATOR_LOUVERS = [-1.05, -0.52, 0.0, 0.52, 1.05] as const;
const ENGINE_PETALS_10 = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9] as const;
const ENGINE_STATORS_6 = [0, 1, 2, 3, 4, 5] as const;

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
  const reducedMotion = useReducedMotion();
  const glowRef = useRef<Mesh>(null);
  const glowRefB = useRef<Mesh>(null);

  useFrame((state) => {
    const meshes = [glowRef.current, glowRefB.current];
    const t = state.clock.elapsedTime;
    const base = burning ? 2.6 : 0.95;
    const flicker = reducedMotion
      ? 0
      : burning
        ? Math.sin(t * 12) * 0.3
        : Math.sin(t * 2) * 0.1;
    const intensity = Math.max(0, base + flicker - thermalWear * 0.45);

    for (const mesh of meshes) {
      if (!mesh) continue;
      const material = mesh.material as MeshStandardMaterial;
      material.emissiveIntensity = dead ? 0 : intensity;
    }
  });

  const panelY = RADIATOR_SPAN / 2 + 0.05;

  return (
    <group>
      <MountFlange radius={0.38} />

      {/* Central structural support boom rising from mounting flange */}
      <mesh castShadow receiveShadow position={[0, panelY, 0]}>
        <boxGeometry args={[0.18, RADIATOR_SPAN, 0.28]} />
        <meshStandardMaterial color="#334155" roughness={0.62} metalness={0.76} />
      </mesh>

      {/* Perimeter armored frame: outer cap rail + fore/aft edge columns */}
      <mesh castShadow position={[0, RADIATOR_SPAN + 0.05, 0]}>
        <boxGeometry args={[0.22, 0.1, RADIATOR_CHORD + 0.12]} />
        <meshStandardMaterial color="#1e293b" roughness={0.55} metalness={0.85} />
      </mesh>
      <mesh castShadow position={[0, 0.14, 0]}>
        <boxGeometry args={[0.24, 0.12, RADIATOR_CHORD + 0.12]} />
        <meshStandardMaterial color="#1e293b" roughness={0.55} metalness={0.85} />
      </mesh>
      {[-1, 1].map((end) => (
        <mesh
          key={`rad-edge-${end}`}
          castShadow
          position={[0, panelY, end * (RADIATOR_CHORD / 2 + 0.02)]}
        >
          <boxGeometry args={[0.22, RADIATOR_SPAN + 0.06, 0.1]} />
          <meshStandardMaterial color="#1e293b" roughness={0.55} metalness={0.85} />
        </mesh>
      ))}

      {/* Radiating core sheets on either side of spine (with SurfaceDamage directly attached) */}
      {[-1, 1].map((side) => (
        <mesh
          key={side}
          ref={side === 1 ? glowRef : glowRefB}
          position={[side * 0.095, panelY, 0]}
          rotation={[0, Math.PI / 2, 0]}
        >
          <planeGeometry args={[RADIATOR_CHORD, RADIATOR_SPAN * 0.86]} />
          <meshStandardMaterial
            color="#0b0f17"
            emissive="#f97316"
            emissiveIntensity={0.95}
            roughness={0.5}
            metalness={0.1}
            side={2}
          />
          <SurfaceDamage
            surface={RADIATOR_PANEL}
            tag={`radiator-${side}`}
            options={RADIATOR_DAMAGE}
          />
        </mesh>
      ))}

      {/* Angled heat-pipe louver fins spanning top & bottom headers */}
      {RADIATOR_LOUVERS.map((lz, idx) => (
        <mesh
          key={`louver-${idx}`}
          position={[0, panelY, lz]}
          rotation={[0, 0.38, 0]}
          castShadow
        >
          <boxGeometry args={[0.26, RADIATOR_SPAN * 0.92, 0.06]} />
          <meshStandardMaterial color="#475569" roughness={0.48} metalness={0.86} />
        </mesh>
      ))}

      {/* Longitudinal coolant header pipes with clamping collars */}
      {[0.44, 0.95, 1.46].flatMap((y) =>
        [-1, 1].map((side) => (
          <mesh
            key={`${y}-${side}`}
            position={[side * 0.12, y, 0]}
            rotation={[Math.PI / 2, 0, 0]}
            castShadow
          >
            <cylinderGeometry args={[0.044, 0.044, RADIATOR_CHORD * 0.98, 8]} />
            <EmissiveMaterial mode={mode} color="#fb923c" intensity={dead ? 0 : 0.7} />
          </mesh>
        )),
      )}

      {/* Feed and return coolant manifolds from flange to lower header */}
      <Conduit from={[0.16, 0.02, 0.2]} to={[0.1, 0.44, 1.15]} bow={0.1} />
      <Conduit from={[-0.16, 0.02, -0.2]} to={[-0.1, 0.44, -1.15]} bow={0.1} />
    </group>
  );
}

/* --------------------------- Engines --------------------------- */

/** How far the glowing cavity is recessed into the bell, as a fraction of it. */
const THROAT_DEPTH = 0.34;

export function EngineBell({
  sublight,
  burning,
  dead,
  reducedMotion,
}: {
  sublight: SublightId;
  burning: boolean;
  dead: boolean;
  /** Holds the throat's pulse still. See `ExhaustPlume` for the reasoning. */
  reducedMotion: boolean;
}) {
  const profile = ENGINE_PROFILE[sublight];
  const throatDepth = profile.length * THROAT_DEPTH;
  const coreRef = useRef<Mesh>(null);
  const throatRef = useRef<Mesh>(null);

  // Matches the housing's own cylinderGeometry, so the scorching lands on the
  // bell that is actually fitted rather than on the tier-2 one it was tuned to.
  const housing = useMemo<DamageSurface>(
    () => ({
      kind: 'cylinder',
      radiusTop: profile.radius,
      radiusBottom: profile.radius * 0.72,
      height: profile.length,
    }),
    [profile],
  );

  useFrame((state) => {
    const cavity = coreRef.current;
    const throat = throatRef.current;
    if (!cavity || !throat) return;

    const t = state.clock.elapsedTime;
    const pulse = reducedMotion ? 0 : Math.sin(t * (burning ? 19 : 3));
    const glow = dead ? 0 : burning ? 3.0 + pulse * 0.45 : 1.15 + pulse * 0.15;

    (cavity.material as MeshStandardMaterial).emissiveIntensity = glow;
    (throat.material as MeshStandardMaterial).emissiveIntensity = glow * 1.45;
  });

  const radiusAt = (frac: number) =>
    profile.radius * (0.72 + (1.0 - 0.72) * frac);

  return (
    <group>
      <MountFlange radius={profile.radius * 0.92} />

      {/* Main titanium engine bell housing */}
      <mesh castShadow receiveShadow position={[0, profile.length / 2, 0]}>
        <cylinderGeometry args={[profile.radius, profile.radius * 0.72, profile.length, 16]} />
        <meshStandardMaterial color="#475569" roughness={0.42} metalness={0.9} />
        <SurfaceDamage surface={housing} tag={`engine-${sublight}`} options={ENGINE_DAMAGE} />
      </mesh>

      {/* Upper turbopump manifold jacket */}
      <mesh position={[0, profile.length * 0.18, 0]} castShadow receiveShadow>
        <cylinderGeometry
          args={[profile.radius * 0.84, profile.radius * 0.88, profile.length * 0.24, 12]}
        />
        <meshStandardMaterial color="#1e293b" roughness={0.55} metalness={0.86} />
      </mesh>

      {/* Segmented thrust-vectoring actuator petals wrapping nozzle skirt */}
      {ENGINE_PETALS_10.map((k) => {
        const a = (k * Math.PI * 2) / ENGINE_PETALS_10.length;
        const r = profile.radius * 0.88;
        const petalH = profile.length * 0.56;
        const petalW = (profile.radius * 2 * Math.PI) / 11;
        return (
          <group
            key={`petal-${k}`}
            position={[Math.cos(a) * r, profile.length * 0.68, Math.sin(a) * r]}
            rotation={[0, -a, -0.12]}
          >
            <mesh castShadow receiveShadow>
              <boxGeometry args={[0.06, petalH, petalW]} />
              <meshStandardMaterial color="#334155" roughness={0.46} metalness={0.88} />
            </mesh>
            {/* Actuator rod linking upper jacket to petal spine */}
            <mesh position={[0.03, -petalH * 0.35, 0]} castShadow>
              <cylinderGeometry args={[0.018, 0.022, petalH * 0.45, 6]} />
              <meshStandardMaterial color="#64748b" roughness={0.32} metalness={0.94} />
            </mesh>
          </group>
        );
      })}

      {/* 3 Staggered regenerative cooling manifold collars */}
      {[0.32, 0.56, 0.82].map((frac, idx) => (
        <mesh
          key={`cool-ring-${idx}`}
          position={[0, profile.length * frac, 0]}
          rotation={[Math.PI / 2, 0, 0]}
          castShadow
        >
          <torusGeometry args={[radiusAt(frac) * 1.03, 0.038 + idx * 0.008, 8, 18]} />
          <meshStandardMaterial color="#1e293b" roughness={0.52} metalness={0.88} />
        </mesh>
      ))}

      {/* Inner aerospike centerbody & 6 radial turbine stator vanes inside nozzle throat */}
      <mesh position={[0, profile.length - throatDepth * 0.62, 0]} castShadow>
        <coneGeometry args={[profile.radius * 0.18, throatDepth * 0.85, 10]} />
        <meshStandardMaterial color="#1e293b" roughness={0.38} metalness={0.9} />
      </mesh>
      {ENGINE_STATORS_6.map((k) => {
        const a = (k * Math.PI) / 3;
        return (
          <mesh
            key={`stator-${k}`}
            position={[
              Math.cos(a) * profile.radius * 0.38,
              profile.length - throatDepth * 0.72,
              Math.sin(a) * profile.radius * 0.38,
            ]}
            rotation={[0, -a, 0]}
            castShadow
          >
            <boxGeometry args={[profile.radius * 0.54, throatDepth * 0.28, 0.03]} />
            <meshStandardMaterial color="#334155" roughness={0.45} metalness={0.88} />
          </mesh>
        );
      })}

      {/* Nozzle throat: recessed emissive cavity (tone-mapped so hue survives ACES) */}
      <mesh ref={coreRef} position={[0, profile.length - throatDepth / 2, 0]}>
        <cylinderGeometry
          args={[profile.radius * 0.88, profile.radius * 0.36, throatDepth, 18, 1, true]}
        />
        <meshStandardMaterial
          color="#000000"
          emissive={profile.glow}
          emissiveIntensity={dead ? 0 : 1.15}
          roughness={0.6}
          metalness={0}
          side={2}
        />
      </mesh>

      {/* Recessed throat floor */}
      <mesh
        ref={throatRef}
        position={[0, profile.length - throatDepth, 0]}
        rotation={[-Math.PI / 2, 0, 0]}
      >
        <circleGeometry args={[profile.radius * 0.36, 16]} />
        <meshStandardMaterial
          color="#000000"
          emissive={profile.glow}
          emissiveIntensity={dead ? 0 : 1.7}
          roughness={0.6}
          metalness={0}
          side={2}
        />
      </mesh>

      {/* 4 Braided turbopump propellant feed pipes from flange to regenerative manifold */}
      {[
        [1, 0],
        [-1, 0],
        [0, 1],
        [0, -1],
      ].map(([sx, sz], idx) => (
        <Conduit
          key={`feed-${idx}`}
          from={[sx * profile.radius * 0.82, 0.02, sz * profile.radius * 0.82]}
          to={[sx * profile.radius * 0.84, profile.length * 0.56, sz * profile.radius * 0.84]}
          bow={0.07}
          radius={0.03}
        />
      ))}
    </group>
  );
}

/* --------------------------- Weapons --------------------------- */

/**
 * Turret hardware, resolved from the component registry.
 *
 * This used to be a four-case `switch` of hand-built JSX — around eighty lines
 * in which each weapon re-declared its own barbette, remembered (or forgot) the
 * mounting-face convention, and could only be joined by editing this file.
 * `domain/fittings.ts` now holds the shape of every weapon as data, so a new
 * one is a catalogue entry plus a recipe list. Three shipped with R2 on exactly
 * those terms: `autocannon_pod`, `coil_battery` and `rail_lance`.
 */
export function Turret({
  weapon,
  mode,
  dead,
  firing = false,
  targetPosition = null,
}: {
  weapon: WeaponId;
  mode: RenderMode;
  dead: boolean;
  firing?: boolean;
  targetPosition?: Vector3 | null;
}) {
  if (weapon === 'quantum_torpedoes') {
    return <MissilePod mode={mode} dead={dead} firing={firing} />;
  }
  return (
    <ArticulatedTurret
      weapon={weapon}
      mode={mode}
      dead={dead}
      firing={firing}
      targetPosition={targetPosition}
    />
  );
}

/* --------------------------- Sensors --------------------------- */

const RADOME_RIBS = [0, 1, 2, 3] as const;
const DISH_STRUTS_4 = [0, 1, 2, 3] as const;
const DISH_RIBS_8 = [0, 1, 2, 3, 4, 5, 6, 7] as const;
const RCS_ANGLES = [
  Math.PI / 4,
  (3 * Math.PI) / 4,
  (5 * Math.PI) / 4,
  (7 * Math.PI) / 4,
] as const;
const COIL_JACKETS_12 = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11] as const;

export function SensorArray({
  sensor,
  mode,
  dead,
}: {
  sensor: SensorId;
  mode: RenderMode;
  dead: boolean;
}) {
  const reducedMotion = useReducedMotion();
  const dishHeadRef = useRef<Group>(null);
  const ladarHeadRef = useRef<Group>(null);

  useFrame((_, delta) => {
    if (dead || reducedMotion) return;
    if (dishHeadRef.current) {
      dishHeadRef.current.rotation.y += delta * 0.35;
    }
    if (ladarHeadRef.current) {
      ladarHeadRef.current.rotation.y += delta * 0.55;
    }
  });

  switch (sensor) {
    case 'radar_dome':
      return (
        <group>
          <MountFlange radius={0.64} />
          {/* Octagonal armored transceiver pedestal */}
          <mesh position={[0, 0.14, 0]} castShadow receiveShadow>
            <cylinderGeometry args={[0.58, 0.64, 0.2, 8]} />
            <meshStandardMaterial color="#334155" roughness={0.55} metalness={0.82} />
          </mesh>
          {/* 4 Transceiver cooling manifold housings around pedestal */}
          {RADOME_RIBS.map((k) => {
            const a = (k * Math.PI) / 2;
            return (
              <mesh
                key={`rad-box-${k}`}
                position={[Math.cos(a) * 0.54, 0.14, Math.sin(a) * 0.54]}
                rotation={[0, -a, 0]}
                castShadow
              >
                <boxGeometry args={[0.16, 0.16, 0.24]} />
                <meshStandardMaterial color="#1e293b" roughness={0.5} metalness={0.88} />
              </mesh>
            );
          })}
          {/* Azimuth sealing flange collar */}
          <mesh position={[0, 0.24, 0]} rotation={[Math.PI / 2, 0, 0]} castShadow>
            <torusGeometry args={[0.56, 0.04, 8, 20]} />
            <meshStandardMaterial color="#1e293b" roughness={0.45} metalness={0.88} />
          </mesh>
          {/* Composite phased-array radome hemisphere */}
          <mesh position={[0, 0.23, 0]} castShadow receiveShadow>
            <sphereGeometry args={[0.55, 20, 14, 0, Math.PI * 2, 0, Math.PI / 2]} />
            <meshStandardMaterial color="#cbd5e1" roughness={0.42} metalness={0.35} />
          </mesh>
          {/* 4 Structural composite arch seam ribs hugging the dome */}
          {RADOME_RIBS.map((k) => (
            <mesh
              key={`arch-${k}`}
              position={[0, 0.23, 0]}
              rotation={[0, (k * Math.PI) / 4, 0]}
              castShadow
            >
              <torusGeometry args={[0.55, 0.022, 6, 18, Math.PI]} />
              <meshStandardMaterial color="#475569" roughness={0.45} metalness={0.85} />
            </mesh>
          ))}
          {/* Dorsal IFF & calibration cap */}
          <mesh position={[0, 0.78, 0]} castShadow>
            <cylinderGeometry args={[0.1, 0.14, 0.08, 10]} />
            <meshStandardMaterial color="#1e293b" roughness={0.4} metalness={0.9} />
          </mesh>
          <mesh position={[0, 0.83, 0]}>
            <sphereGeometry args={[0.045, 8, 8]} />
            <EmissiveMaterial mode={mode} color="#38bdf8" intensity={dead ? 0 : 1.5} />
          </mesh>
          <Conduit from={[0.45, 0.03, 0.28]} to={[0.54, 0.18, 0]} bow={0.05} radius={0.025} />
        </group>
      );

    case 'ladar_array':
      // Armored articulated phased-array mast fairing with optical turret head.
      return (
        <group>
          <MountFlange radius={0.44} />
          {/* Armored rotary base plinth */}
          <mesh position={[0, 0.14, 0]} castShadow receiveShadow>
            <cylinderGeometry args={[0.36, 0.42, 0.2, 8]} />
            <meshStandardMaterial color="#1e293b" roughness={0.55} metalness={0.86} />
          </mesh>
          {/* Tapered armored fairing mast replacing bare cylinder rod */}
          <mesh position={[0, 0.72, 0]} castShadow receiveShadow>
            <cylinderGeometry args={[0.2, 0.34, 1.08, 6]} />
            <meshStandardMaterial color="#334155" roughness={0.48} metalness={0.86} />
          </mesh>
          {/* 3 Stepped phased-array active emitter panels around the fairing */}
          {[0, 1, 2].map((k) => {
            const a = (k * Math.PI * 2) / 3;
            return (
              <group key={`phase-face-${k}`} rotation={[0, a, 0]}>
                <mesh position={[0, 0.72, 0.22]} rotation={[-0.12, 0, 0]} castShadow>
                  <boxGeometry args={[0.28, 0.68, 0.08]} />
                  <meshStandardMaterial color="#1e293b" roughness={0.42} metalness={0.88} />
                </mesh>
                <mesh position={[0, 0.72, 0.265]} rotation={[-0.12, 0, 0]}>
                  <boxGeometry args={[0.18, 0.52, 0.02]} />
                  <EmissiveMaterial mode={mode} color="#22d3ee" intensity={dead ? 0 : 1.1} />
                </mesh>
              </group>
            );
          })}
          {/* Lateral radiator cooling shrouds */}
          {[-0.28, 0.28].map((sx, idx) => (
            <mesh key={`cool-fin-${idx}`} position={[sx, 0.68, -0.04]} castShadow>
              <boxGeometry args={[0.06, 0.78, 0.22]} />
              <meshStandardMaterial color="#475569" roughness={0.42} metalness={0.9} />
            </mesh>
          ))}
          {/* Upper gimballed optical ladar turret head */}
          <group ref={ladarHeadRef} position={[0, 1.32, 0]}>
            <mesh castShadow>
              <cylinderGeometry args={[0.22, 0.22, 0.24, 12]} />
              <meshStandardMaterial color="#475569" roughness={0.38} metalness={0.9} />
            </mesh>
            {/* Armored sensor hood */}
            <mesh position={[0, 0.06, 0.14]} castShadow>
              <boxGeometry args={[0.32, 0.18, 0.24]} />
              <meshStandardMaterial color="#1e293b" roughness={0.45} metalness={0.88} />
            </mesh>
            {/* Dual recessed optical laser designator apertures */}
            {[-0.08, 0.08].map((lx, li) => (
              <mesh key={`lens-${li}`} position={[lx, 0.05, 0.26]} rotation={[Math.PI / 2, 0, 0]}>
                <cylinderGeometry args={[0.042, 0.042, 0.04, 10]} />
                <EmissiveMaterial mode={mode} color="#22d3ee" intensity={dead ? 0 : 2.2} />
              </mesh>
            ))}
          </group>
          {/* Twin waveguide fiber-optic conduits from flange to fairing */}
          <Conduit from={[0.26, 0.03, 0.12]} to={[0.2, 0.92, 0.08]} bow={0.07} radius={0.026} />
          <Conduit from={[-0.26, 0.03, -0.12]} to={[-0.2, 0.92, -0.08]} bow={0.07} radius={0.026} />
        </group>
      );

    case 'tachyon_scanner':
      // Gimballed multi-ribbed parabolic interferometer dish with quad feed-horn struts.
      return (
        <group>
          <MountFlange radius={0.48} />
          {/* Armored rotary elevation pedestal */}
          <mesh position={[0, 0.14, 0]} castShadow receiveShadow>
            <cylinderGeometry args={[0.38, 0.45, 0.22, 10]} />
            <meshStandardMaterial color="#1e293b" roughness={0.52} metalness={0.88} />
          </mesh>
          <group ref={dishHeadRef} position={[0, 0.25, 0]}>
            {/* Cryogenic gimbal yoke arms supporting dish from both sides */}
            <mesh position={[0, 0.1, 0]} castShadow>
              <boxGeometry args={[0.92, 0.14, 0.26]} />
              <meshStandardMaterial color="#334155" roughness={0.45} metalness={0.88} />
            </mesh>
            {[-0.42, 0.42].map((yx, yi) => (
              <mesh key={`yoke-${yi}`} position={[yx, 0.34, 0]} castShadow>
                <boxGeometry args={[0.1, 0.48, 0.22]} />
                <meshStandardMaterial color="#475569" roughness={0.42} metalness={0.9} />
              </mesh>
            ))}
            {/* Elevation trunnion axle */}
            <mesh position={[0, 0.52, 0]} rotation={[0, 0, Math.PI / 2]} castShadow>
              <cylinderGeometry args={[0.14, 0.14, 0.96, 12]} />
              <meshStandardMaterial color="#0f172a" roughness={0.4} metalness={0.92} />
            </mesh>

            {/* Dish & feed-horn assembly tilted upward along aperture axis */}
            <group position={[0, 0.54, 0]} rotation={[-0.38, 0, 0]}>
              {/* Rear receiver counter-weight & cryo cooler housing */}
              <mesh position={[0, -0.02, 0]} castShadow>
                <cylinderGeometry args={[0.24, 0.28, 0.26, 12]} />
                <meshStandardMaterial color="#334155" roughness={0.48} metalness={0.88} />
              </mesh>
              {/* Upward-concave parabolic dish bowl (vertex at y = +0.04, rim at y = +0.65, r = 0.84) */}
              <mesh position={[0, 0.92, 0]} castShadow receiveShadow>
                <sphereGeometry
                  args={[0.88, 24, 14, 0, Math.PI * 2, Math.PI * 0.6, Math.PI * 0.4]}
                />
                <meshStandardMaterial color="#e2e8f0" roughness={0.28} metalness={0.62} side={2} />
              </mesh>
              {/* Outer dish reinforcement rim ring hugging exact dish lip */}
              <mesh position={[0, 0.648, 0]} rotation={[Math.PI / 2, 0, 0]} castShadow>
                <torusGeometry args={[0.837, 0.036, 8, 24]} />
                <meshStandardMaterial color="#334155" roughness={0.45} metalness={0.88} />
              </mesh>
              {/* 8 Radial structural ribs cradling underside of parabolic dish */}
              {DISH_RIBS_8.map((k) => {
                const a = (k * Math.PI) / 4;
                return (
                  <mesh
                    key={`d-rib-${k}`}
                    position={[Math.cos(a) * 0.44, 0.32, Math.sin(a) * 0.44]}
                    rotation={[0, -a, 0.63]}
                    castShadow
                  >
                    <boxGeometry args={[0.92, 0.05, 0.05]} />
                    <meshStandardMaterial color="#475569" roughness={0.45} metalness={0.88} />
                  </mesh>
                );
              })}
              {/* Quad feed-horn struts converging from dish rim to suspended cryo receiver */}
              {DISH_STRUTS_4.map((k) => {
                const a = (k * Math.PI) / 2 + Math.PI / 4;
                return (
                  <mesh
                    key={`horn-strut-${k}`}
                    position={[Math.cos(a) * 0.445, 0.85, Math.sin(a) * 0.445]}
                    rotation={[0, -a, 1.07]}
                    castShadow
                  >
                    <cylinderGeometry args={[0.022, 0.03, 0.84, 6]} />
                    <meshStandardMaterial color="#64748b" roughness={0.35} metalness={0.92} />
                  </mesh>
                );
              })}
              {/* Suspended cryogenic interferometer receiver cage & aperture core */}
              <mesh position={[0, 1.08, 0]} castShadow>
                <cylinderGeometry args={[0.14, 0.18, 0.18, 10]} />
                <meshStandardMaterial color="#1e293b" roughness={0.4} metalness={0.9} />
              </mesh>
              <mesh position={[0, 0.96, 0]}>
                <sphereGeometry args={[0.13, 14, 12]} />
                <EmissiveMaterial mode={mode} color="#a855f7" intensity={dead ? 0 : 2.3} />
              </mesh>
            </group>
          </group>
          <Conduit from={[0.3, 0.03, 0.18]} to={[0.28, 0.34, 0.06]} bow={0.06} radius={0.026} />
        </group>
      );
  }
}

/* --------------------------- RCS --------------------------- */

export function RcsQuad() {
  return (
    <group>
      <MountFlange radius={0.3} height={0.07} />
      {/* Chamfered octagonal vernier thruster blister housing */}
      <mesh castShadow receiveShadow position={[0, 0.14, 0]}>
        <cylinderGeometry args={[0.26, 0.34, 0.18, 8]} />
        <meshStandardMaterial color="#334155" roughness={0.55} metalness={0.82} />
      </mesh>
      <mesh castShadow position={[0, 0.24, 0]}>
        <cylinderGeometry args={[0.14, 0.25, 0.08, 8]} />
        <meshStandardMaterial color="#1e293b" roughness={0.5} metalness={0.88} />
      </mesh>
      {/* 4 Angled recessed vernier thruster nozzle shrouds & bells */}
      {RCS_ANGLES.map((angle, i) => {
        const cx = Math.cos(angle);
        const cz = Math.sin(angle);
        return (
          <group
            key={i}
            position={[cx * 0.2, 0.19, cz * 0.2]}
            rotation={[0, -angle, -0.78]}
          >
            {/* Armored nozzle gimbal collar */}
            <mesh castShadow>
              <cylinderGeometry args={[0.072, 0.085, 0.08, 10]} />
              <meshStandardMaterial color="#1e293b" roughness={0.5} metalness={0.88} />
            </mesh>
            {/* Flared vernier thruster bell */}
            <mesh position={[0, 0.08, 0]} castShadow>
              <cylinderGeometry args={[0.07, 0.042, 0.12, 10]} />
              <meshStandardMaterial color="#0f172a" roughness={0.38} metalness={0.92} />
            </mesh>
          </group>
        );
      })}
    </group>
  );
}

/* --------------------------- FTL --------------------------- */

export function FtlCore({
  ftl,
  mode,
  dead,
  ringRadius,
  pylonReach,
  dorsalReach,
}: {
  ftl: FtlId;
  mode: RenderMode;
  dead: boolean;
  /** Radius the ring must clear — comes from the archetype, not a constant. */
  ringRadius: number;
  /**
   * Distance from the ship's axis to the hull surface along each pylon, at the
   * ring's own station. Measured off the hull, so the spokes land on plate.
   */
  pylonReach?: readonly number[];
  /**
   * Height of the dorsal skin above the FTL station, measured the same way.
   * The hyperspace shunt is a surface fitting and needs somewhere to sit.
   */
  dorsalReach?: number;
}) {
  const reducedMotion = useReducedMotion();
  const spinRef = useRef<Group>(null);

  useFrame((_, delta) => {
    if (spinRef.current && !dead && !reducedMotion) {
      spinRef.current.rotation.z += delta * 0.55;
    }
  });

  switch (ftl) {
    case 'none':
      return null;

    case 'hyper_shunt':
      return (
        <group position={[0, dorsalReach ?? 0.9, 0]}>
          <Fitting def={HYPER_SHUNT_HOUSING} mode={mode} dead={dead} />
        </group>
      );

    case 'alcubierre_ring': {
      const tube = ringRadius * 0.075;
      return (
        <group>
          <group ref={spinRef}>
            {/* Primary armored structural warp nacelle ring */}
            <mesh castShadow>
              <torusGeometry args={[ringRadius, tube, 14, 56]} />
              <meshStandardMaterial color="#1e293b" roughness={0.42} metalness={0.9} />
            </mesh>
            {/* Glowing inner superconducting field-emitter louver channel */}
            <mesh>
              <torusGeometry args={[ringRadius - tube * 0.65, tube * 0.36, 10, 56]} />
              <EmissiveMaterial mode={mode} color="#818cf8" intensity={dead ? 0 : 1.7} />
            </mesh>
            {/* 12 Radial field-coil capacitor shrouds segmented around ring */}
            {COIL_JACKETS_12.map((k) => {
              const a = (k * Math.PI) / 6;
              return (
                <group
                  key={`coil-${k}`}
                  position={[Math.cos(a) * ringRadius, Math.sin(a) * ringRadius, 0]}
                  rotation={[0, 0, a]}
                >
                  <mesh castShadow>
                    <boxGeometry args={[tube * 2.55, tube * 2.2, tube * 2.9]} />
                    <meshStandardMaterial color="#334155" roughness={0.45} metalness={0.88} />
                  </mesh>
                  <mesh position={[tube * 1.25, 0, 0]}>
                    <boxGeometry args={[tube * 0.35, tube * 1.35, tube * 2.1]} />
                    <EmissiveMaterial mode={mode} color="#6366f1" intensity={dead ? 0 : 1.5} />
                  </mesh>
                </group>
              );
            })}
          </group>
          <RingPylons ringRadius={ringRadius} reach={pylonReach} />
        </group>
      );
    }

    case 'graviton_singularity': {
      const core = ringRadius * 0.3;
      return (
        <group>
          {/* Gyroscopic multi-ring metallic containment cage */}
          <group ref={spinRef}>
            <mesh>
              <icosahedronGeometry args={[core, 1]} />
              <meshBasicMaterial
                color="#a855f7"
                wireframe
                transparent
                opacity={dead ? 0.15 : 0.62}
              />
            </mesh>
            <mesh rotation={[Math.PI / 2.2, 0.3, 0]}>
              <torusGeometry args={[core * 0.85, 0.055, 8, 40]} />
              <meshStandardMaterial color="#334155" roughness={0.4} metalness={0.92} />
            </mesh>
            <mesh rotation={[0.4, Math.PI / 3, 0]}>
              <torusGeometry args={[core * 0.96, 0.05, 8, 40]} />
              <meshStandardMaterial color="#475569" roughness={0.4} metalness={0.92} />
            </mesh>
          </group>
          {/* Glowing containment confinement halo */}
          <mesh rotation={[Math.PI / 2.2, 0.3, 0]}>
            <torusGeometry args={[core * 0.68, 0.055, 8, 40]} />
            <EmissiveMaterial mode={mode} color="#c084fc" intensity={dead ? 0 : 2.3} />
          </mesh>
          {/* The singularity itself — a black event horizon sphere */}
          <mesh>
            <sphereGeometry args={[core * 0.42, 24, 18]} />
            <meshBasicMaterial color="#000000" />
          </mesh>
          {/* Anchor struts securing containment gimbal to hull spine */}
          <RingPylons ringRadius={core * 0.95} reach={pylonReach} compact />
        </group>
      );
    }
  }
}

/**
 * Spokes holding the warp ring or singularity containment cage to the hull.
 * Each spoke anchors on hull plate (`reach[i]`) with root pad + clamping shoe.
 */
function RingPylons({
  ringRadius,
  reach,
  compact = false,
}: {
  ringRadius: number;
  reach?: readonly number[];
  compact?: boolean;
}) {
  const angles = [Math.PI / 4, (3 * Math.PI) / 4, (5 * Math.PI) / 4, (7 * Math.PI) / 4];
  return (
    <group>
      {angles.map((angle, i) => {
        const inner = Math.min(reach?.[i] ?? ringRadius * 0.45, ringRadius - 0.12);
        const span = ringRadius - inner;
        if (span <= 0.04) return null;
        const mid = inner + span / 2;
        return (
          <group
            key={angle}
            position={[Math.cos(angle) * mid, Math.sin(angle) * mid, 0]}
            rotation={[0, 0, angle - Math.PI / 2]}
          >
            {/* Primary structural truss spar */}
            <mesh castShadow receiveShadow>
              <boxGeometry args={[compact ? 0.12 : 0.18, span, compact ? 0.22 : 0.36]} />
              <meshStandardMaterial color="#334155" roughness={0.48} metalness={0.88} />
            </mesh>
            {/* Root hull mounting flange shoe & ring clamp */}
            <mesh position={[0, -span / 2 + 0.06, 0]} castShadow>
              <boxGeometry args={[compact ? 0.2 : 0.3, 0.12, compact ? 0.3 : 0.46]} />
              <meshStandardMaterial color="#1e293b" roughness={0.55} metalness={0.86} />
            </mesh>
            <mesh position={[0, span / 2 - 0.06, 0]} castShadow>
              <boxGeometry args={[compact ? 0.18 : 0.28, 0.14, compact ? 0.3 : 0.48]} />
              <meshStandardMaterial color="#1e293b" roughness={0.5} metalness={0.88} />
            </mesh>
          </group>
        );
      })}
    </group>
  );
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
        <group>
          <MountFlange radius={0.38} />
          {/* Cryogenic pressure vessel with SurfaceDamage */}
          <mesh position={[0, 0.68, 0]} rotation={[Math.PI / 2, 0, 0]} castShadow receiveShadow>
            <capsuleGeometry args={[0.62, 2.6, 8, 16]} />
            <meshStandardMaterial color="#e2e8f0" roughness={0.35} metalness={0.52} />
            <SurfaceDamage surface={CRYO_TANK} tag="fuel-cryo" options={TANK_DAMAGE} />
          </mesh>
          {/* Armored structural retention cradle hoops & longitudinal roll-cage rails */}
          {[-0.95, 0, 0.95].map((hz, idx) => (
            <mesh key={`cryo-hoop-${idx}`} position={[0, 0.68, hz]} castShadow>
              <torusGeometry args={[0.625, 0.04, 8, 20]} />
              <meshStandardMaterial color="#334155" roughness={0.48} metalness={0.88} />
            </mesh>
          ))}
          {[-0.64, 0.64].map((sx, si) => (
            <mesh key={`cryo-rail-${si}`} position={[sx, 0.68, 0]} castShadow>
              <boxGeometry args={[0.07, 0.12, 2.4]} />
              <meshStandardMaterial color="#1e293b" roughness={0.5} metalness={0.86} />
            </mesh>
          ))}
          {/* Base saddle pedestal tying center hoop solidly to flange */}
          <mesh position={[0, 0.14, 0]} castShadow>
            <boxGeometry args={[0.56, 0.22, 1.9]} />
            <meshStandardMaterial color="#1e293b" roughness={0.55} metalness={0.86} />
          </mesh>
          {/* End-cap dome relief valves */}
          {[-1.88, 1.88].map((ez, ei) => (
            <mesh
              key={`cryo-cap-${ei}`}
              position={[0, 0.68, ez]}
              rotation={[Math.PI / 2, 0, 0]}
              castShadow
            >
              <cylinderGeometry args={[0.14, 0.22, 0.16, 10]} />
              <meshStandardMaterial color="#475569" roughness={0.4} metalness={0.9} />
            </mesh>
          ))}
          <Conduit from={[0.2, 0.02, 0.2]} to={[0.38, 0.42, 0.95]} bow={0.08} />
          <Conduit from={[-0.2, 0.02, -0.2]} to={[-0.38, 0.42, -0.95]} bow={0.08} />
        </group>
      );

    case 'd_he3_bottles':
      return (
        <group>
          <MountFlange radius={0.44} />
          {/* Bridging structural manifold saddle tying twin bottles to flange */}
          <mesh position={[0, 0.2, 0]} castShadow receiveShadow>
            <boxGeometry args={[0.96, 0.22, 0.96]} />
            <meshStandardMaterial color="#1e293b" roughness={0.55} metalness={0.86} />
          </mesh>
          {[-0.42, 0.42].map((x) => (
            <group key={x}>
              <mesh
                position={[x, 0.36, 0]}
                rotation={[Math.PI / 2, 0, 0]}
                castShadow
                receiveShadow
              >
                <capsuleGeometry args={[0.3, 1.5, 6, 12]} />
                <meshStandardMaterial color="#94a3b8" roughness={0.3} metalness={0.75} />
                <SurfaceDamage
                  surface={MAGNETIC_BOTTLE}
                  tag={`fuel-bottle-${x}`}
                  options={TANK_DAMAGE}
                />
              </mesh>
              {/* Pressure retention collars & end-cap valve assemblies */}
              {[-0.48, 0.48].map((bz, bi) => (
                <mesh key={`b-strap-${bi}`} position={[x, 0.36, bz]} castShadow>
                  <torusGeometry args={[0.31, 0.032, 6, 16]} />
                  <meshStandardMaterial color="#334155" roughness={0.46} metalness={0.88} />
                </mesh>
              ))}
              <mesh
                position={[x, 0.36, 1.02]}
                rotation={[Math.PI / 2, 0, 0]}
                castShadow
              >
                <cylinderGeometry args={[0.09, 0.14, 0.14, 8]} />
                <meshStandardMaterial color="#475569" roughness={0.4} metalness={0.9} />
              </mesh>
            </group>
          ))}
          {/* Protective overhead cross roll-bar straps */}
          {[-0.48, 0.48].map((rz, ri) => (
            <mesh key={`roll-${ri}`} position={[0, 0.67, rz]} castShadow>
              <boxGeometry args={[0.94, 0.06, 0.08]} />
              <meshStandardMaterial color="#475569" roughness={0.45} metalness={0.88} />
            </mesh>
          ))}
          <Conduit from={[-0.42, 0.06, 0.5]} to={[0.42, 0.36, 0.5]} bow={0.12} radius={0.035} />
          <Conduit from={[0.42, 0.06, -0.5]} to={[-0.42, 0.36, -0.5]} bow={0.12} radius={0.035} />
        </group>
      );

    case 'antimatter_pods':
      return (
        <group>
          <MountFlange radius={0.38} />
          {/* Armored magnetic bottle cradle pedestal */}
          <mesh position={[0, 0.14, 0]} castShadow>
            <cylinderGeometry args={[0.38, 0.44, 0.18, 12]} />
            <meshStandardMaterial color="#1e293b" roughness={0.5} metalness={0.88} />
          </mesh>
          <mesh position={[0, 0.62, 0]} castShadow receiveShadow>
            <sphereGeometry args={[0.55, 20, 14]} />
            <meshStandardMaterial color="#1e293b" roughness={0.22} metalness={0.94} />
            <SurfaceDamage surface={ANTIMATTER_POD} tag="fuel-antimatter" options={TANK_DAMAGE} />
          </mesh>
          {/* Equatorial glowing magnetic containment field ring */}
          <mesh position={[0, 0.62, 0]} rotation={[Math.PI / 2, 0, 0]}>
            <torusGeometry args={[0.66, 0.048, 8, 28]} />
            <EmissiveMaterial mode={mode} color="#f43f5e" intensity={dead ? 0 : 2.3} />
          </mesh>
          {/* 4 Diagonal structural field-clamp cage arches tying ring to pedestal & polar cap */}
          {RADOME_RIBS.map((k) => {
            const a = (k * Math.PI) / 2 + Math.PI / 4;
            return (
              <mesh
                key={`am-rib-${k}`}
                position={[0, 0.62, 0]}
                rotation={[0, a, 0]}
                castShadow
              >
                <torusGeometry args={[0.61, 0.035, 6, 20]} />
                <meshStandardMaterial color="#475569" roughness={0.4} metalness={0.9} />
              </mesh>
            );
          })}
          {/* Dorsal polar magnetic pinch cap */}
          <mesh position={[0, 1.18, 0]} castShadow>
            <cylinderGeometry args={[0.16, 0.24, 0.12, 12]} />
            <meshStandardMaterial color="#334155" roughness={0.4} metalness={0.9} />
          </mesh>
          <Conduit from={[0.24, 0.04, 0.18]} to={[0.36, 0.56, 0.36]} bow={0.07} />
          <Conduit from={[-0.24, 0.04, -0.18]} to={[-0.36, 0.56, -0.36]} bow={0.07} />
        </group>
      );

    case 'zero_point_core':
      // Ultra-compact zero-point micro-core: dramatic contrast with bulky cryo pods.
      return (
        <group>
          <MountFlange radius={0.24} height={0.07} />
          <mesh position={[0, 0.14, 0]} castShadow>
            <cylinderGeometry args={[0.16, 0.22, 0.16, 10]} />
            <meshStandardMaterial color="#1e293b" roughness={0.45} metalness={0.9} />
          </mesh>
          <mesh position={[0, 0.35, 0]}>
            <sphereGeometry args={[0.16, 16, 12]} />
            <EmissiveMaterial mode={mode} color="#10b981" intensity={dead ? 0 : 2.8} />
          </mesh>
          {/* Twin nested precision gimbal armature rings connected by micro struts */}
          <mesh position={[0, 0.35, 0]} rotation={[0.6, 0.3, 0]}>
            <torusGeometry args={[0.29, 0.022, 6, 24]} />
            <EmissiveMaterial mode={mode} color="#6ee7b7" intensity={dead ? 0 : 1.7} />
          </mesh>
          <mesh position={[0, 0.35, 0]} rotation={[-0.6, -0.3, Math.PI / 2]}>
            <torusGeometry args={[0.24, 0.02, 6, 20]} />
            <meshStandardMaterial color="#475569" roughness={0.35} metalness={0.94} />
          </mesh>
          {[-1, 1].map((side) => (
            <mesh
              key={`zp-arm-${side}`}
              position={[side * 0.2, 0.26, 0]}
              rotation={[0, 0, -side * 0.45]}
              castShadow
            >
              <boxGeometry args={[0.04, 0.22, 0.05]} />
              <meshStandardMaterial color="#334155" roughness={0.4} metalness={0.9} />
            </mesh>
          ))}
        </group>
      );
  }
}
