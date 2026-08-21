import { useMemo, useRef, type ReactNode } from 'react';
import { useFrame } from '@react-three/fiber';
import { Matrix4, Quaternion, Vector3, type Mesh, type MeshStandardMaterial } from 'three';
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
import { HYPER_SHUNT_HOUSING, getWeaponFitting } from '../../domain/fittings';
import type { DamageOptions, DamageSurface } from '../../domain/damage';
import { SurfaceDamage } from '../damage/Damage';

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
 *
 * The file used to claim the first half of that and honour it in about half the
 * parts: the radiator and the LADAR spine were based at y = 0, but the engine
 * bell, the turret base, the RCS block, the radar collar and every fuel tank
 * were *centred* on the origin. Half of each of those sat behind the mount
 * plane, which is why one socket could bury a tier-1 cryo tank through a
 * dreadnought's armour skirt and leave a tier-4 zero-point core hanging in
 * space — the component picker silently decided whether the ship was bolted
 * together. Anything centred on its socket is now a deliberate, commented
 * exception, and there is exactly one: the FTL ring, which encircles the hull
 * rather than protruding from a face and so is not socket-mounted at all.
 *
 * Every mount also carries a flange, and the parts with a real standoff carry
 * conduits down to it, so a join reads as engineered rather than as two solids
 * happening to intersect.
 */

const SIZE_SCALE: Record<SocketSize, number> = { S: 0.7, M: 1.0, L: 1.4 };

export function SocketMount({
  socket,
  children,
}: {
  socket: Socket;
  children: ReactNode;
}) {
  const transform = useMemo(() => {
    const normal = new Vector3(...socket.normal).normalize();

    // Build the full basis rather than the shortest arc from +Y to the normal.
    // `socket.up` was declared, documented as "roll reference, so parts do not
    // spin arbitrarily about their normal", populated on all 43 sockets — and
    // never read, so every part's roll was whatever setFromUnitVectors happened
    // to produce, and for the ventral sockets (normal exactly antiparallel to
    // +Y) it came from three's arbitrary-perpendicular fallback. Mirrored pairs
    // rolled differently from each other as a result.
    const up = new Vector3(...socket.up);
    const forward = up.clone().addScaledVector(normal, -up.dot(normal));
    if (forward.lengthSq() < 1e-8) {
      // `up` is parallel to the normal and cannot resolve roll. Any stable
      // perpendicular will do; pick one deterministically.
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
  const glowRefB = useRef<Mesh>(null);

  useFrame((state) => {
    const meshes = [glowRef.current, glowRefB.current];
    const t = state.clock.elapsedTime;
    // Live prop reads — not a stale closure.
    const base = burning ? 3.4 : 1.1;
    const flicker = burning ? Math.sin(t * 12) * 0.35 : Math.sin(t * 2) * 0.12;
    const intensity = Math.max(0, base + flicker - thermalWear * 0.5);

    for (const mesh of meshes) {
      if (!mesh) continue;
      const material = mesh.material as MeshStandardMaterial;
      material.emissiveIntensity = dead ? 0 : intensity;
    }
  });

  return (
    <group>
      <MountFlange radius={0.34} />

      {/* Spine: runs outboard from the flange, carrying the panels */}
      <mesh castShadow receiveShadow position={[0, RADIATOR_SPAN / 2 + 0.05, 0]}>
        <boxGeometry args={[0.16, RADIATOR_SPAN, 0.26]} />
        <meshStandardMaterial color="#334155" roughness={0.7} metalness={0.6} />
      </mesh>

      {/* Radiating faces, one either side of the spine */}
      {[-1, 1].map((side) => (
        <mesh
          key={side}
          ref={side === 1 ? glowRef : glowRefB}
          position={[side * 0.09, RADIATOR_SPAN / 2 + 0.05, 0]}
          rotation={[0, Math.PI / 2, 0]}
        >
          <planeGeometry args={[RADIATOR_CHORD, RADIATOR_SPAN * 0.86]} />
          <meshStandardMaterial
            color="#000000"
            emissive="#f97316"
            emissiveIntensity={1.1}
            roughness={0.5}
            metalness={0}
            toneMapped={false}
            side={2}
          />
          <SurfaceDamage
            surface={RADIATOR_PANEL}
            tag={`radiator-${side}`}
            options={RADIATOR_DAMAGE}
          />
        </mesh>
      ))}

      {/* Coolant runs, lying ACROSS the faces. They used to be rotated about z,
          which put their axis along the panel's own normal, so the three pipes
          impaled it and stuck 0.79 out of either face. */}
      {[0.45, 0.95, 1.45].flatMap((y) =>
        [-1, 1].map((side) => (
          <mesh
            key={`${y}-${side}`}
            position={[side * 0.115, y, 0]}
            rotation={[Math.PI / 2, 0, 0]}
          >
            <cylinderGeometry args={[0.05, 0.05, RADIATOR_CHORD * 0.96, 6]} />
            <EmissiveMaterial mode={mode} color="#fb923c" intensity={dead ? 0 : 0.8} />
          </mesh>
        )),
      )}

      {/* Feed and return, hull flange to the first coolant run */}
      <Conduit from={[0.16, 0.02, 0.2]} to={[0.06, 0.45, 1.2]} bow={0.1} />
      <Conduit from={[-0.16, 0.02, -0.2]} to={[-0.06, 0.45, -1.2]} bow={0.1} />
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

    // TONE MAPPED, and nowhere near an intensity of 6. The throat used to run
    // `toneMapped={false}` at 6.0, which clips every channel to 1 before the
    // composer sees it: a cyan ion throat and an amber fusion throat both came
    // out flat white, and the bloom pass then smeared that white over the
    // engine deck. Through ACES at these intensities the drive keeps its hue
    // and still reads as the brightest thing on the ship.
    const t = state.clock.elapsedTime;
    const pulse = reducedMotion ? 0 : Math.sin(t * (burning ? 19 : 3));
    const glow = dead ? 0 : burning ? 3.1 + pulse * 0.45 : 1.15 + pulse * 0.15;

    (cavity.material as MeshStandardMaterial).emissiveIntensity = glow;
    // The throat proper sits deepest and runs hotter than the walls around it.
    (throat.material as MeshStandardMaterial).emissiveIntensity = glow * 1.5;
  });

  return (
    <group>
      <MountFlange radius={profile.radius * 0.9} />

      {/* Housing: narrow throat at the mount face, flaring to the mouth. It was
          centred on the socket, so half the bell was inside the hull. */}
      <mesh castShadow receiveShadow position={[0, profile.length / 2, 0]}>
        <cylinderGeometry args={[profile.radius, profile.radius * 0.72, profile.length, 14]} />
        <meshStandardMaterial color="#475569" roughness={0.45} metalness={0.9} />
        <SurfaceDamage surface={housing} tag={`engine-${sublight}`} options={ENGINE_DAMAGE} />
      </mesh>

      {/* Nozzle throat: a RECESSED CAVITY, not a disc.
          It was a zero-thickness `circleGeometry` across the mouth, so from any
          angle but dead astern the whole engine glow degenerated to a razor-thin
          sliver — the brightest fitting on the ship, invisible from the hero
          camera. A cone standing inside the bell mouth is lit from every angle
          that can see into the bell at all, and it gives the drive somewhere to
          glow FROM: the throat behind it is what the plume appears to leave. */}
      <mesh ref={coreRef} position={[0, profile.length - throatDepth / 2, 0]}>
        <cylinderGeometry
          args={[profile.radius * 0.9, profile.radius * 0.36, throatDepth, 18, 1, true]}
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

      {/* The throat itself, closing the bottom of the cavity. */}
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

      {/* Cooling collar, encircling the bell */}
      <mesh
        position={[0, profile.length * 0.35, 0]}
        rotation={[Math.PI / 2, 0, 0]}
        castShadow
      >
        <torusGeometry args={[profile.radius * 0.82, 0.07, 6, 16]} />
        <meshStandardMaterial color="#1e293b" roughness={0.6} metalness={0.8} />
      </mesh>

      {/* Propellant feeds from the mount flange to the collar */}
      {[-1, 1].map((side) => (
        <Conduit
          key={side}
          from={[side * profile.radius * 0.8, 0.02, 0]}
          to={[side * profile.radius * 0.78, profile.length * 0.35, 0]}
          bow={0.05}
          radius={0.035}
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
}: {
  weapon: WeaponId;
  mode: RenderMode;
  dead: boolean;
}) {
  return <Fitting def={getWeaponFitting(weapon)} mode={mode} dead={dead} />;
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
          <MountFlange radius={0.62} />
          <mesh position={[0, 0.11, 0]} castShadow>
            <cylinderGeometry args={[0.6, 0.6, 0.14, 16]} />
            <meshStandardMaterial color="#334155" roughness={0.6} metalness={0.8} />
          </mesh>
          <mesh position={[0, 0.18, 0]} castShadow receiveShadow>
            <sphereGeometry args={[0.55, 18, 12, 0, Math.PI * 2, 0, Math.PI / 2]} />
            <meshStandardMaterial color="#cbd5e1" roughness={0.5} metalness={0.3} />
          </mesh>
        </group>
      );

    case 'ladar_array':
      // Tall coherent-laser spine with stacked collector rings.
      return (
        <group>
          <MountFlange radius={0.3} />
          <mesh position={[0, 1.15, 0]} castShadow>
            <cylinderGeometry args={[0.07, 0.11, 2.2, 8]} />
            <meshStandardMaterial color="#475569" roughness={0.4} metalness={0.92} />
          </mesh>
          {[0.55, 1.05, 1.55, 2.05].map((y, i) => (
            <mesh key={i} position={[0, y, 0]} rotation={[Math.PI / 2, 0, 0]} castShadow>
              <torusGeometry args={[0.26 - i * 0.04, 0.028, 5, 18]} />
              <meshStandardMaterial color="#64748b" roughness={0.35} metalness={0.95} />
            </mesh>
          ))}
          <mesh position={[0, 2.33, 0]}>
            <sphereGeometry args={[0.1, 12, 10]} />
            <EmissiveMaterial mode={mode} color="#22d3ee" intensity={dead ? 0 : 3} />
          </mesh>
          {/* Signal run from the mast up to the second collector ring */}
          <Conduit from={[0.14, 0.03, 0]} to={[0.1, 1.05, 0]} bow={0.06} radius={0.028} />
        </group>
      );

    case 'tachyon_scanner':
      // High-gain dish over a glowing spacetime-distortion core.
      return (
        <group>
          <MountFlange radius={0.34} />
          <mesh position={[0, 0.5, 0]} castShadow>
            <cylinderGeometry args={[0.09, 0.14, 0.9, 8]} />
            <meshStandardMaterial color="#475569" roughness={0.45} metalness={0.9} />
          </mesh>
          <mesh position={[0, 0.9, 0]} rotation={[-0.35, 0, 0]} castShadow receiveShadow>
            <sphereGeometry args={[0.95, 22, 14, 0, Math.PI * 2, 0, Math.PI / 2.6]} />
            <meshStandardMaterial color="#e2e8f0" roughness={0.25} metalness={0.6} side={2} />
          </mesh>
          <mesh position={[0, 1.05, 0]}>
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
      <MountFlange radius={0.26} height={0.06} />
      <mesh castShadow position={[0, 0.14, 0]}>
        <boxGeometry args={[0.34, 0.2, 0.34]} />
        <meshStandardMaterial color="#334155" roughness={0.65} metalness={0.75} />
      </mesh>
      {[
        [0.1, 0.1],
        [-0.1, 0.1],
        [0.1, -0.1],
        [-0.1, -0.1],
      ].map(([x, z], i) => (
        <mesh key={i} position={[x!, 0.3, z!]} castShadow>
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
  const spinRef = useRef<Mesh>(null);

  useFrame((_, delta) => {
    if (spinRef.current && !dead) spinRef.current.rotation.z += delta * 0.6;
  });

  switch (ftl) {
    case 'none':
      return null;

    case 'hyper_shunt':
      // R1-11. This used to be a 1.5 x 0.85 x 1.5 box drawn *at* the FTL
      // socket — and that socket is on the centreline of every archetype, so
      // fitting the tier-1 FTL dropped WARP to 8 and produced no visible
      // geometry anywhere on the ship. On the Industrial hull its side faces
      // were also exactly coplanar with the 1.5-wide spine, so what little of
      // it could have shown would have z-fought. It is now a registry fitting
      // raised onto the dorsal skin, measured at the shunt's own station.
      return (
        <group position={[0, dorsalReach ?? 0.9, 0]}>
          <Fitting def={HYPER_SHUNT_HOUSING} mode={mode} dead={dead} />
        </group>
      );

    case 'alcubierre_ring':
      // Authored in the XY plane so its axis already runs along the ship's
      // length; it encircles the hull rather than lying across it.
      return (
        <group>
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
          <RingPylons ringRadius={ringRadius} reach={pylonReach} />
        </group>
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

/**
 * Spokes holding the warp ring off the hull.
 *
 * A warp ring should not touch the hull — but a hoop with two units of clear
 * air all round it and no visible support reads as scenery. The reach comes
 * from a ray cast at the ring's own station, so each spoke starts on plate.
 */
function RingPylons({
  ringRadius,
  reach,
}: {
  ringRadius: number;
  reach?: readonly number[];
}) {
  const angles = [Math.PI / 4, (3 * Math.PI) / 4, (5 * Math.PI) / 4, (7 * Math.PI) / 4];
  return (
    <group>
      {angles.map((angle, i) => {
        const inner = Math.min(reach?.[i] ?? ringRadius * 0.5, ringRadius - 0.15);
        const span = ringRadius - inner;
        if (span <= 0.05) return null;
        const mid = inner + span / 2;
        return (
          <mesh
            key={angle}
            position={[Math.cos(angle) * mid, Math.sin(angle) * mid, 0]}
            rotation={[0, 0, angle - Math.PI / 2]}
            castShadow
            receiveShadow
          >
            <boxGeometry args={[0.16, span, 0.34]} />
            <meshStandardMaterial color="#334155" roughness={0.5} metalness={0.9} />
          </mesh>
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
 *
 * Every tank is lifted clear of the mount plane by its own radius. Centred on
 * the socket, a tier-1 capsule ran clean through a dreadnought's armour skirt
 * while a tier-4 core hovered in space off the same socket.
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
          <MountFlange radius={0.34} />
          <mesh position={[0, 0.68, 0]} rotation={[Math.PI / 2, 0, 0]} castShadow receiveShadow>
            <capsuleGeometry args={[0.62, 2.6, 6, 14]} />
            <meshStandardMaterial color="#e2e8f0" roughness={0.35} metalness={0.5} />
            <SurfaceDamage surface={CRYO_TANK} tag="fuel-cryo" options={TANK_DAMAGE} />
          </mesh>
          <Conduit from={[0.12, 0.02, 0.1]} to={[0.1, 0.62, 0.9]} bow={0.08} />
        </group>
      );

    case 'd_he3_bottles':
      return (
        <group>
          <MountFlange radius={0.4} />
          {[-0.42, 0.42].map((x) => (
            <mesh
              key={x}
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
          ))}
          <Conduit from={[-0.42, 0.05, 0.5]} to={[0.42, 0.36, 0.5]} bow={0.1} radius={0.035} />
        </group>
      );

    case 'antimatter_pods':
      return (
        <group>
          <MountFlange radius={0.34} />
          <mesh position={[0, 0.62, 0]} castShadow receiveShadow>
            <sphereGeometry args={[0.55, 20, 14]} />
            <meshStandardMaterial color="#1e293b" roughness={0.2} metalness={0.95} />
            <SurfaceDamage surface={ANTIMATTER_POD} tag="fuel-antimatter" options={TANK_DAMAGE} />
          </mesh>
          <mesh position={[0, 0.62, 0]} rotation={[Math.PI / 2, 0, 0]}>
            <torusGeometry args={[0.68, 0.05, 8, 28]} />
            <EmissiveMaterial mode={mode} color="#f43f5e" intensity={dead ? 0 : 2.6} />
          </mesh>
          <Conduit from={[0.14, 0.02, 0.12]} to={[0.16, 0.5, 0.34]} bow={0.06} />
        </group>
      );

    case 'zero_point_core':
      // Almost nothing there — which is the point.
      return (
        <group>
          <MountFlange radius={0.22} height={0.07} />
          <mesh position={[0, 0.34, 0]}>
            <sphereGeometry args={[0.16, 16, 12]} />
            <EmissiveMaterial mode={mode} color="#10b981" intensity={dead ? 0 : 4} />
          </mesh>
          <mesh position={[0, 0.34, 0]} rotation={[0.6, 0.3, 0]}>
            <torusGeometry args={[0.3, 0.02, 6, 24]} />
            <EmissiveMaterial mode={mode} color="#6ee7b7" intensity={dead ? 0 : 2} />
          </mesh>
        </group>
      );
  }
}
