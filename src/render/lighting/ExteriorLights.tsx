import { useMemo, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import { Matrix4, Object3D, Quaternion, Vector3, type MeshStandardMaterial } from 'three';
import type { Vec3 } from '../../domain/types';
import {
  FLOOD_STANDOFF,
  beamDirection,
  lensPosition,
  type ExteriorLightRig,
  type Floodlight,
  type NavigationBeacon,
} from '../../domain/exteriorLights';
import { EmissiveMaterial } from '../materials/HullMaterial';
import type { RenderMode } from '../materials/renderModes';

/**
 * Exterior lighting: floodlights that genuinely cast light, and navigation
 * lamps that genuinely blink.
 *
 * Two things this deliberately is not. It is not an emissive decal pretending
 * to be a lamp — each flood is a real `spotLight` with a cone and a falloff, so
 * it puts a moving pool on the plate it is aimed at and picks out the form of
 * the hull the way nothing else in the scene does. And it is not a set of
 * hardcoded coordinates: `domain/exteriorLights.ts` seats every fixture on the
 * measured skin and a unit test asserts every beam lands on the ship.
 *
 * SHADOWS ARE OFF on the floods, on purpose. The key light already casts, and
 * four more shadow-casting spots is four more 2048² depth passes for detail
 * nobody reads on a hull this size. The fixtures cast shadows themselves.
 *
 * A DERELICT HAS NO POWER. Everything here goes out with the running lights and
 * the drive glow — the lamps stay, unlit, which is most of what makes a hulk
 * read as a hulk rather than as a ship on a dark background.
 */

interface ExteriorLightsProps {
  /**
   * Resolved upstream, in `Ship`, rather than derived here from
   * (archetype, volumes, seed).
   *
   * The beacon positions are needed in two places — here, to render the lamps,
   * and by the hull marker lamps, which have to keep out of their way. Deriving
   * the rig in both would mean two ray-cast passes over the hull per frame's
   * worth of props and, worse, two things that are only equal by construction.
   */
  rig: ExteriorLightRig;
  dead: boolean;
  mode: RenderMode;
}

const asTuple = (v: Vec3): [number, number, number] => [v[0], v[1], v[2]];

/** Swing a fixture authored about +Y onto its beam. */
function beamQuaternion(direction: Vec3): Quaternion {
  const up = new Vector3(direction[0], direction[1], direction[2]).normalize();
  // Any stable perpendicular: the housing is a cylinder, so its roll is free.
  const seed = Math.abs(up.y) > 0.95 ? new Vector3(0, 0, 1) : new Vector3(0, 1, 0);
  const right = new Vector3().crossVectors(seed, up).normalize();
  const forward = new Vector3().crossVectors(right, up);
  return new Quaternion().setFromRotationMatrix(new Matrix4().makeBasis(right, up, forward));
}

/* --------------------------- Floodlights --------------------------- */

const HOUSING = { color: '#2f3a4d', roughness: 0.55, metalness: 0.85 } as const;

function Flood({ flood, dead, mode }: { flood: Floodlight; dead: boolean; mode: RenderMode }) {
  const beam = useMemo(() => beamDirection(flood), [flood]);
  const lens = useMemo(() => lensPosition(flood), [flood]);
  const quaternion = useMemo(() => beamQuaternion(beam), [beam]);

  // three points a spot at an Object3D rather than along its own axis, and that
  // object has to be in the scene graph for its world matrix to update. It is a
  // plain transform, not a GPU resource, so there is nothing here to leak.
  const target = useMemo(() => new Object3D(), []);

  const mount = useMemo<Vec3>(() => {
    const n = flood.normal;
    const length = Math.hypot(n[0], n[1], n[2]) || 1;
    return [
      flood.position[0] + (n[0] / length) * (FLOOD_STANDOFF / 2),
      flood.position[1] + (n[1] / length) * (FLOOD_STANDOFF / 2),
      flood.position[2] + (n[2] / length) * (FLOOD_STANDOFF / 2),
    ];
  }, [flood]);

  const mountQuaternion = useMemo(() => beamQuaternion(flood.normal), [flood.normal]);

  return (
    <group>
      {/* Yoke: the stalk that stands the lamp off the plate. */}
      <mesh position={asTuple(mount)} quaternion={mountQuaternion} castShadow>
        <cylinderGeometry args={[flood.size * 0.28, flood.size * 0.34, FLOOD_STANDOFF, 8]} />
        <meshStandardMaterial {...HOUSING} />
      </mesh>

      {/* Housing, swung onto the beam. Its mouth is the emitting end. */}
      <group position={asTuple(lens)} quaternion={quaternion}>
        <mesh position={[0, -flood.size * 0.6, 0]} castShadow receiveShadow>
          <cylinderGeometry args={[flood.size, flood.size * 0.74, flood.size * 1.4, 12]} />
          <meshStandardMaterial {...HOUSING} />
        </mesh>
        {/* Flared hood, so the fixture reads as directional even with the lamp
            cold — and so the lens is shaded from the camera at grazing angles. */}
        <mesh position={[0, flood.size * 0.28, 0]} castShadow>
          <cylinderGeometry
            args={[flood.size * 1.26, flood.size * 0.96, flood.size * 0.5, 12, 1, true]}
          />
          <meshStandardMaterial {...HOUSING} side={2} />
        </mesh>
        {/* Lens, standing just proud of the housing's own end cap. Sunk level
            with it (as it first was) the cap occluded it from every angle and
            the fixture read as a dark stub. */}
        <mesh position={[0, flood.size * 0.13, 0]} rotation={[-Math.PI / 2, 0, 0]}>
          <circleGeometry args={[flood.size * 0.8, 12]} />
          <EmissiveMaterial
            mode={mode}
            color={flood.colour}
            intensity={dead ? 0 : 2.6}
          />
        </mesh>
      </group>

      <primitive object={target} position={asTuple(flood.aim)} />
      {!dead && (
        <spotLight
          position={asTuple(lens)}
          target={target}
          color={flood.colour}
          intensity={flood.intensity}
          angle={flood.angle}
          // Soft-edged. A hard cone edge on flat plate reads as a decal.
          penumbra={0.85}
          distance={flood.range}
          decay={2}
        />
      )}
    </group>
  );
}

/* --------------------------- Navigation lamps --------------------------- */

/** Duty cycle of an anti-collision strobe: a short, hard flash. */
const STROBE_DUTY = 0.11;

function Beacon({
  beacon,
  dead,
  mode,
}: {
  beacon: NavigationBeacon;
  dead: boolean;
  mode: RenderMode;
}) {
  const lampRef = useRef<MeshStandardMaterial>(null);
  const quaternion = useMemo(() => beamQuaternion(beacon.normal), [beacon.normal]);

  useFrame((state) => {
    const material = lampRef.current;
    if (!material) return;
    // `dead`, `period` and `phase` are read live off props every frame. The
    // prototype's animation loops closed over their initial values, which is
    // why nothing in this codebase animates from a captured variable any more.
    if (dead) {
      material.emissiveIntensity = 0;
      return;
    }
    if (beacon.period <= 0) {
      material.emissiveIntensity = 3.2;
      return;
    }
    const cycle = (state.clock.elapsedTime / beacon.period + beacon.phase) % 1;
    material.emissiveIntensity = cycle < STROBE_DUTY ? 6.5 : 0.2;
  });

  return (
    <group position={asTuple(beacon.position)} quaternion={quaternion}>
      {/* Base: the lamp is bolted through the plate, not stuck on it. */}
      <mesh position={[0, 0.012, 0]} castShadow>
        <cylinderGeometry args={[beacon.radius * 1.5, beacon.radius * 1.8, 0.04, 8]} />
        <meshStandardMaterial color="#1d2534" roughness={0.6} metalness={0.85} />
      </mesh>
      <mesh position={[0, beacon.radius + 0.03, 0]}>
        <sphereGeometry args={[beacon.radius, 10, 8]} />
        {/*
          Kept on the un-tone-mapped path with the rest of the trim: a lamp this
          small should clip and bloom into a star. That is the opposite call from
          window glazing, and for the opposite reason — see `windows/Windows.tsx`.
        */}
        <meshStandardMaterial
          ref={lampRef}
          color="#000000"
          emissive={beacon.colour}
          emissiveIntensity={dead ? 0 : 3.2}
          roughness={0.35}
          metalness={0}
          toneMapped={false}
        />
      </mesh>
      {beacon.casts && !dead && mode === 'pbr' && (
        // Only the steady red and green pool colour on the plate around them.
        // The strobes do not: a light that appears for a tenth of a second at a
        // frame rate the user cannot control reads as a flicker bug.
        <pointLight
          position={[0, beacon.radius + 0.03, 0]}
          color={beacon.colour}
          intensity={2.4}
          distance={2.6}
          decay={2}
        />
      )}
    </group>
  );
}

/* --------------------------- The rig --------------------------- */

export function ExteriorLights({ rig, dead, mode }: ExteriorLightsProps) {
  return (
    <group>
      {rig.floods.map((flood) => (
        <Flood key={flood.id} flood={flood} dead={dead} mode={mode} />
      ))}
      {rig.beacons.map((beacon) => (
        <Beacon key={beacon.id} beacon={beacon} dead={dead} mode={mode} />
      ))}
    </group>
  );
}
