import { useEffect, useMemo, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import type { Group } from 'three';
import type { Blueprint } from '../domain/types';
import { getMaterial } from '../domain/components';
import { getArchetype } from '../domain/architectures';
import { deriveWear, isDerelict } from '../domain/condition';
import { ftlPylonReach, hullReach, hullVolumes, runningLightAnchors } from '../domain/hullForm';
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
import { ExhaustPlume } from './parts/Plume';
import { DamageProvider } from './damage/Damage';
import { ShipWindows } from './windows/Windows';
import { ExteriorLights } from './lighting/ExteriorLights';
import type { HullVolume } from '../domain/hullForm';

interface ShipProps {
  blueprint: Blueprint;
  mode: RenderMode;
  protrusions: Protrusions;
  burning: boolean;
  /** Hands the assembled ship group out so it can be exported to .glb. */
  onReady?: (group: Group) => void;
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
    /**
     * Everything inside reads its wear from here. Damage is photoreal-only:
     * a soot stamp on a holographic wireframe or a thermal false-colour pass
     * is noise, not information.
     */
    <DamageProvider wear={wear} seed={blueprint.seed} enabled={mode === 'pbr'}>
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
                  <EngineBell
                    sublight={blueprint.sublight}
                    burning={burning}
                    dead={dead}
                    reducedMotion={reducedMotion}
                  />
                  {/* Starts at the bell's mouth, which now depends on the drive
                      fitted rather than on a constant that suited one of them. */}
                  <group position={[0, engineBellLength(blueprint.sublight), 0]}>
                    <ExhaustPlume
                      sublight={blueprint.sublight}
                      burning={burning}
                      dead={dead}
                      seed={blueprint.seed}
                      mode={mode}
                      reducedMotion={reducedMotion}
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
                    // The hyperspace shunt is a surface fitting, so it needs the
                    // dorsal skin at its own station rather than the ring radius.
                    dorsalReach={hullReach(volumes, [0, 0, socket.position[2]], [0, 1, 0]) ?? undefined}
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

        {/* Glazing, and the exterior lighting rig. Both take the same measured
            hull volumes and the same resolved sockets as everything else on the
            ship: a porthole is seated on the skin by ray cast, and it is kept
            off the fuel bays by a rule engine rather than by a coordinate
            somebody checked once. See `domain/windows.ts`. */}
        <ShipWindows
          archetype={blueprint.architecture}
          volumes={volumes}
          sockets={sockets}
          seed={blueprint.seed}
          wear={wear}
          condition={blueprint.condition}
          mode={mode}
        />

        <ExteriorLights
          archetype={blueprint.architecture}
          volumes={volumes}
          seed={blueprint.seed}
          dead={dead}
          mode={mode}
        />
      </group>
    </DamageProvider>
  );
}
