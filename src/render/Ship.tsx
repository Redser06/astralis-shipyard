import { useEffect, useMemo, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import { AdditiveBlending, type Group, type Points } from 'three';
import type { Blueprint } from '../domain/types';
import { getMaterial } from '../domain/components';
import { getArchetype } from '../domain/architectures';
import { deriveWear, isDerelict } from '../domain/condition';
import { ftlPylonReach, hullVolumes, runningLightAnchors } from '../domain/hullForm';
import { socketsFor } from './sockets';
import { useReducedMotion } from './useReducedMotion';
import { Hull } from './hulls/Hulls';
import { HullMaterial, EmissiveMaterial } from './materials/HullMaterial';
import type { RenderMode } from './materials/renderModes';
import type { Protrusions } from './viewportOptions';
import {
  EngineBell,
  FtlCore,
  FuelPod,
  Radiator,
  RcsQuad,
  SensorArray,
  SocketMount,
  Turret,
} from './parts/Parts';
import { engineBellLength } from './parts/engineProfile';
import type { HullVolume } from '../domain/hullForm';

interface ShipProps {
  blueprint: Blueprint;
  mode: RenderMode;
  protrusions: Protrusions;
  burning: boolean;
  /** Hands the assembled ship group out so it can be exported to .glb. */
  onReady?: (group: Group) => void;
}

/* --------------------------- Exhaust --------------------------- */

const PLUME_PARTICLES = 240;

function ExhaustPlume({
  burning,
  color,
  dead,
}: {
  burning: boolean;
  color: string;
  dead: boolean;
}) {
  const pointsRef = useRef<Points>(null);

  const positions = useMemo(() => {
    const array = new Float32Array(PLUME_PARTICLES * 3);
    for (let i = 0; i < PLUME_PARTICLES; i++) {
      array[i * 3] = (Math.random() - 0.5) * 0.4;
      array[i * 3 + 1] = Math.random() * 6;
      array[i * 3 + 2] = (Math.random() - 0.5) * 0.4;
    }
    return array;
  }, []);

  useFrame((_, delta) => {
    const points = pointsRef.current;
    if (!points || dead) return;

    const attribute = points.geometry.getAttribute('position');
    const array = attribute.array as Float32Array;
    // `burning` is read live every frame. This is the behaviour the prototype
    // intended and never achieved, because its loop closed over the initial
    // value of the flag and never saw it change.
    const speed = burning ? 22 : 7;
    const spread = burning ? 0.5 : 0.28;

    for (let i = 0; i < PLUME_PARTICLES; i++) {
      const y = i * 3 + 1;
      array[y] = (array[y] ?? 0) + speed * delta;
      if ((array[y] ?? 0) > (burning ? 9 : 4.5)) {
        array[y] = 0;
        array[i * 3] = (Math.random() - 0.5) * spread;
        array[i * 3 + 2] = (Math.random() - 0.5) * spread;
      }
    }
    attribute.needsUpdate = true;
  });

  if (dead) return null;

  return (
    <points ref={pointsRef}>
      <bufferGeometry>
        <bufferAttribute attach="attributes-position" args={[positions, 3]} />
      </bufferGeometry>
      <pointsMaterial
        color={color}
        size={burning ? 0.22 : 0.13}
        transparent
        opacity={burning ? 0.85 : 0.5}
        blending={AdditiveBlending}
        depthWrite={false}
        sizeAttenuation
        toneMapped={false}
      />
    </points>
  );
}

/* --------------------------- Running lights --------------------------- */

/**
 * Navigation lamps, sampled off the hull surface rather than out of a box.
 *
 * The box was ±2.6 × ±0.8 × ±6.5 and keyed only on the seed, so the fourteen
 * positions came out byte-identical on all five archetypes: roughly half sat in
 * open vacuum beside the ship and most of the rest were sealed inside solid
 * plate. `runningLightAnchors` ray-casts the real hull instead.
 */
function RunningLights({
  volumes,
  seed,
  accentColor,
  dead,
  mode,
}: {
  volumes: readonly HullVolume[];
  seed: number;
  accentColor: string;
  dead: boolean;
  mode: RenderMode;
}) {
  const lamps = useMemo(() => runningLightAnchors(volumes, seed), [volumes, seed]);

  // A derelict has no power. Killing the lights is most of what sells it.
  if (dead) return null;

  return (
    <group>
      {lamps.map((lamp, i) => (
        <mesh key={i} position={[lamp.position[0], lamp.position[1], lamp.position[2]]}>
          <sphereGeometry args={[0.045, 6, 6]} />
          <EmissiveMaterial
            mode={mode}
            color={i % 3 === 0 ? '#f43f5e' : accentColor}
            intensity={3}
          />
        </mesh>
      ))}
    </group>
  );
}

/* --------------------------- Ship --------------------------- */

export function Ship({ blueprint, mode, protrusions, burning, onReady }: ShipProps) {
  const groupRef = useRef<Group>(null);
  const reducedMotion = useReducedMotion();

  useEffect(() => {
    if (groupRef.current) onReady?.(groupRef.current);
  }, [onReady]);

  const wear = useMemo(
    () => deriveWear(blueprint.condition, blueprint.seed),
    [blueprint.condition, blueprint.seed],
  );
  const dead = isDerelict(blueprint.condition);
  const materialSpec = useMemo(() => getMaterial(blueprint.material), [blueprint.material]);
  const archetype = useMemo(() => getArchetype(blueprint.architecture), [blueprint.architecture]);

  // The hull as solid volumes. Sockets, lamps and the warp ring's pylons are all
  // measured against these, so hardware is seated on the hull that renders.
  const volumes = useMemo(
    () => hullVolumes(blueprint.architecture, blueprint.hullProfile),
    [blueprint.architecture, blueprint.hullProfile],
  );
  const sockets = useMemo(
    () => socketsFor(blueprint.architecture, volumes),
    [blueprint.architecture, volumes],
  );

  const hullMaterial = (
    <HullMaterial
      spec={materialSpec}
      accentColor={blueprint.accentColor}
      mode={mode}
      wear={wear}
    />
  );

  useFrame((state, delta) => {
    const group = groupRef.current;
    if (!group) return;

    if (reducedMotion) {
      // Decorative motion only. A derelict still reads as one — it holds a
      // dead, canted attitude instead of tumbling.
      group.position.y = 0;
      group.rotation.z = dead ? 0.22 : 0;
      group.rotation.x = dead ? 0.09 : 0;
      return;
    }

    const t = state.clock.elapsedTime;
    if (dead) {
      // Powerless and tumbling. Slow, uncommanded, slightly off every axis.
      group.rotation.z += delta * 0.09;
      group.rotation.x += delta * 0.035;
      group.position.y = Math.sin(t * 0.3) * 0.06;
    } else {
      group.rotation.z = 0;
      group.rotation.x = 0;
      group.position.y = Math.sin(t * 1.5) * 0.12;
    }
  });

  return (
    <group ref={groupRef}>
      <Hull
        archetype={blueprint.architecture}
        material={hullMaterial}
        profile={blueprint.hullProfile}
      />

      {sockets.map((socket) => {
        switch (socket.kind) {
          case 'engine':
            return (
              <SocketMount key={socket.id} socket={socket}>
                <EngineBell sublight={blueprint.sublight} burning={burning} dead={dead} />
                {/* Starts at the bell's mouth, which now depends on the drive
                    fitted rather than on a constant that suited one of them. */}
                <group position={[0, engineBellLength(blueprint.sublight), 0]}>
                  <ExhaustPlume
                    burning={burning}
                    color={blueprint.accentColor}
                    dead={dead}
                  />
                </group>
              </SocketMount>
            );

          case 'radiator':
            return protrusions.radiators ? (
              <SocketMount key={socket.id} socket={socket}>
                <Radiator burning={burning} thermalWear={wear.thermal} mode={mode} dead={dead} />
              </SocketMount>
            ) : null;

          case 'sensor':
            return protrusions.sensors ? (
              <SocketMount key={socket.id} socket={socket}>
                <SensorArray sensor={blueprint.sensors} mode={mode} dead={dead} />
              </SocketMount>
            ) : null;

          case 'rcs':
            return protrusions.rcs ? (
              <SocketMount key={socket.id} socket={socket}>
                <RcsQuad />
              </SocketMount>
            ) : null;

          case 'weapon':
            return (
              <SocketMount key={socket.id} socket={socket}>
                <Turret weapon={blueprint.weapons} mode={mode} dead={dead} />
              </SocketMount>
            );

          case 'fuel':
            return (
              <SocketMount key={socket.id} socket={socket}>
                <FuelPod fuel={blueprint.fuel} mode={mode} dead={dead} />
              </SocketMount>
            );

          case 'ftl':
            // Deliberately not socket-mounted: the ring encircles the whole
            // hull rather than protruding from a face, so it takes the socket's
            // position but none of its orientation.
            return (
              <group key={socket.id} position={socket.position as unknown as [number, number, number]}>
                <FtlCore
                  ftl={blueprint.ftl}
                  mode={mode}
                  dead={dead}
                  ringRadius={archetype.ringRadius}
                  pylonReach={ftlPylonReach(volumes, socket.position[2], archetype.ringRadius * 0.5)}
                />
              </group>
            );
        }
      })}

      <RunningLights
        volumes={volumes}
        seed={blueprint.seed}
        accentColor={blueprint.accentColor}
        dead={dead}
        mode={mode}
      />
    </group>
  );
}
