import { useEffect, useMemo, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import type { Group } from 'three';
import type { Blueprint } from '../domain/types';
import { getMaterial } from '../domain/components';
import { getArchetype } from '../domain/architectures';
import { deriveWear, isDerelict } from '../domain/condition';
import {
  LAMP_RADIUS,
  ftlPylonReach,
  hullReach,
  hullVolumes,
  runningLightAnchors,
  type Keepout,
} from '../domain/hullForm';
import { exteriorLightRig, rigKeepouts } from '../domain/exteriorLights';
import { placeWindows } from '../domain/windows';
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

/* --------------------------- Hull marker lights --------------------------- */

/**
 * Anonymous deck and marker lamps, sampled off the hull surface rather than out
 * of a box.
 *
 * The box was ±2.6 × ±0.8 × ±6.5 and keyed only on the seed, so the fourteen
 * positions came out byte-identical on all five archetypes: roughly half sat in
 * open vacuum beside the ship and most of the rest were sealed inside solid
 * plate. `runningLightAnchors` ray-casts the real hull instead.
 *
 * WHAT THESE ARE NOT, and why the colours here are constrained. These landed
 * before `lighting/ExteriorLights`, under the name "running lights", and every
 * third lamp was rose red. That made two systems on the same ship claiming to
 * be navigation lights, and the older one contradicted the newer: these are
 * scattered along both flanks, the dorsal spine, fore and aft with no notion of
 * which side of the hull they are on, so a ship carried its single correct port
 * lamp plus four or five more red lamps — several of them to starboard. The
 * maritime convention `domain/exteriorLights.ts` implements and unit-tests
 * (`exteriorLightIssues` asserts port is left of starboard) only means anything
 * if red and green appear exactly once each.
 *
 * So the division is now: RED AND GREEN BELONG TO THE BEACONS. These are deck
 * lighting — the ship's own trim colour and a cold white, and dimmer than any
 * beacon, so the lamps that declare the ship are still the brightest fixed
 * points on it.
 */
function HullMarkerLights({
  volumes,
  seed,
  accentColor,
  keepClear,
  dead,
  mode,
}: {
  volumes: readonly HullVolume[];
  seed: number;
  accentColor: string;
  /** Hull already claimed. A scattered lamp gives way to everything. */
  keepClear: readonly Keepout[];
  dead: boolean;
  mode: RenderMode;
}) {
  const lamps = useMemo(
    () => runningLightAnchors(volumes, seed, { keepClear }),
    [volumes, seed, keepClear],
  );

  // A derelict has no power. Killing the lights is most of what sells it.
  if (dead) return null;

  return (
    <group>
      {lamps.map((lamp, i) => (
        <mesh key={i} position={[lamp.position[0], lamp.position[1], lamp.position[2]]}>
          {/* `LAMP_RADIUS`, not a literal: the clearance arithmetic that keeps
              these off the glazing measures the same number. */}
          <sphereGeometry args={[LAMP_RADIUS, 6, 6]} />
          <EmissiveMaterial
            mode={mode}
            // Cold white broken up by the ship's trim, so the run reads as
            // deck lighting rather than as a string of identical dots.
            color={i % 3 === 0 ? '#cbd5f5' : accentColor}
            intensity={1.8}
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

  /**
   * WHO YIELDS TO WHOM. Four populations bolt fixtures to one skin, and they
   * are resolved here, together, in precedence order — rather than each
   * deriving its own copy of the hull inside its own component and meeting the
   * others for the first time on screen. That is what put floodlight housings
   * over portholes and marker lamps in the middle of the glass on all five
   * archetypes.
   *
   * The order is not arbitrary. It runs from what cannot move to what can:
   *
   *   1. SOCKETS — structural. Everything else is bolted near them.
   *   2. THE LIGHTING RIG — floods are declared per archetype and aimed at
   *      named parts of the ship; beacons are derived from the hull's own
   *      extremities and mean nothing anywhere else. Neither can be nudged.
   *   3. GLAZING — a rule engine that already discards most of its candidates,
   *      so one more exclusion costs a porthole rather than the ship.
   *   4. MARKER LAMPS — scattered and anonymous. The cheapest thing to move.
   */
  const lightRig = useMemo(
    () => exteriorLightRig(blueprint.architecture, volumes, blueprint.seed),
    [blueprint.architecture, volumes, blueprint.seed],
  );
  const rigZones = useMemo(() => rigKeepouts(lightRig), [lightRig]);

  const windows = useMemo(
    () =>
      placeWindows(blueprint.architecture, volumes, sockets, blueprint.seed, {
        keepClear: rigZones,
      }),
    [blueprint.architecture, volumes, sockets, blueprint.seed, rigZones],
  );

  // A window's keep-out is its own half-diagonal, so a lamp cannot land on the
  // corner of a pane either.
  const lampZones = useMemo<Keepout[]>(
    () => [
      ...rigZones,
      ...windows.map((window) => ({
        position: window.position,
        radius: Math.hypot(window.extent[0], window.extent[1]) + LAMP_RADIUS,
      })),
    ],
    [rigZones, windows],
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

        <HullMarkerLights
          volumes={volumes}
          seed={blueprint.seed}
          accentColor={blueprint.accentColor}
          keepClear={lampZones}
          dead={dead}
          mode={mode}
        />

        {/* Glazing, and the exterior lighting rig. Both take the same measured
            hull volumes and the same resolved sockets as everything else on the
            ship: a porthole is seated on the skin by ray cast, and it is kept
            off the fuel bays by a rule engine rather than by a coordinate
            somebody checked once. See `domain/windows.ts`. */}
        <ShipWindows
          placements={windows}
          seed={blueprint.seed}
          wear={wear}
          condition={blueprint.condition}
          mode={mode}
        />

        <ExteriorLights rig={lightRig} dead={dead} mode={mode} />
      </group>
    </DamageProvider>
  );
}
