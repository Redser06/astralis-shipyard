import { useEffect, useMemo, useRef, useState } from 'react';
import { useFrame } from '@react-three/fiber';
import { Vector3, type Group } from 'three';
import type { Blueprint, MissionState, MissionTelemetry, ShipStats } from '../domain/types';
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
  assemblyProgress?: number | null;
  missionState?: MissionState | null;
  missionProgress?: number;
  missionTelemetry?: MissionTelemetry | null;
  shipStats?: ShipStats;
  /** Hands the assembled ship group out so it can be exported to .glb. */
  onReady?: (group: Group) => void;
}

/**
 * Critically-damped analytical spring step (zero overshoot, C1-continuous across
 * mission phase transitions, zero per-frame allocations).
 */
function stepSpring(
  value: number,
  velocity: number,
  target: number,
  omega: number,
  dt: number,
): [number, number] {
  const clampedDt = Math.min(0.05, Math.max(0, dt));
  const delta = value - target;
  const exp = Math.exp(-omega * clampedDt);
  const temp = (velocity + omega * delta) * clampedDt;
  return [
    target + (delta + temp) * exp,
    (velocity - omega * temp) * exp,
  ];
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

export function Ship({
  blueprint,
  mode,
  protrusions,
  burning,
  assemblyProgress,
  missionState,
  missionProgress,
  missionTelemetry,
  shipStats,
  onReady,
}: ShipProps) {
  const groupRef = useRef<Group>(null);
  const reducedMotion = useReducedMotion();

  // Persistent 6-DOF spring state (zero allocations per frame)
  const linPosRef = useRef({ x: 0, y: 0, z: 0 });
  const linVelRef = useRef({ x: 0, y: 0, z: 0 });
  const angPosRef = useRef({ x: 0, y: 0, z: 0 });
  const angVelRef = useRef({ x: 0, y: 0, z: 0 });

  // Live hostile interceptor targeting vector (mutated in-place at 60Hz)
  const [combatTarget] = useState(() => new Vector3(0, 8, 22));
  const [combatFiring, setCombatFiring] = useState(false);
  const firingPulseRef = useRef(false);

  useEffect(() => {
    if (groupRef.current) onReady?.(groupRef.current);
  }, [onReady]);

  const isAssembling = assemblyProgress !== undefined && assemblyProgress !== null;
  const progress = isAssembling ? Math.min(1, Math.max(0, assemblyProgress)) : 1;

  // Frame 0-2s (progress < 0.25): Keel wireframe hologram
  const effectiveMode = isAssembling && progress < 0.25 ? 'wireframe' : mode;

  // Frame 2-4s (progress < 0.5): Core & engines slide in on tracks
  const coreOffsetZ = isAssembling && progress < 0.5 ? (0.5 - progress) * 16 : 0;

  // Frame 6-8s: Lighting rig snaps from dark to amber to full power
  const isDerelictShip = isDerelict(blueprint.condition);
  const lightsDead = isDerelictShip || (isAssembling && progress < 0.75);

  // Active engine plume & thermal burn across flight phases as well as Test Burn
  const activeBurn =
    (burning || (missionState != null && missionState !== 'docked' && missionState !== 'repair')) &&
    !isAssembling;

  const isInstalled = (socketId: string) => {
    if (isAssembling && progress < 0.75) {
      return false;
    }
    return blueprint.installedComponents?.[socketId] ?? true;
  };

  const wear = useMemo(
    () => deriveWear(blueprint.condition, blueprint.seed),
    [blueprint.condition, blueprint.seed],
  );
  const dead = isDerelictShip;
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
      mode={effectiveMode}
      wear={wear}
    />
  );

  useFrame((state, delta) => {
    const group = groupRef.current;
    if (!group) return;

    const linPos = linPosRef.current;
    const linVel = linVelRef.current;
    const angPos = angPosRef.current;
    const angVel = angVelRef.current;

    if (reducedMotion) {
      // Decorative motion only. A derelict still reads as one — it holds a
      // dead, canted attitude instead of tumbling.
      linPos.x = 0;
      linPos.y = 0;
      linPos.z = 0;
      linVel.x = 0;
      linVel.y = 0;
      linVel.z = 0;
      angPos.x = dead ? 0.09 : 0;
      angPos.y = 0;
      angPos.z = dead ? 0.22 : 0;
      angVel.x = 0;
      angVel.y = 0;
      angVel.z = 0;
      group.position.set(0, 0, 0);
      group.rotation.order = 'YXZ';
      group.rotation.set(angPos.x, 0, angPos.z);
      if (firingPulseRef.current) {
        firingPulseRef.current = false;
        setCombatFiring(false);
      }
      return;
    }

    const t = state.clock.elapsedTime;

    // Combat turret targeting & salvo firing synchronization
    const inCombat = !dead && missionState === 'combat';
    if (inCombat) {
      const slot = Math.floor(t / 2.4) % 3;
      const phase = t * 1.6;
      if (slot === 0) {
        combatTarget.set(
          Math.sin(phase) * 14,
          7 + Math.cos(phase * 0.8) * 3,
          20 + Math.sin(phase * 0.5) * 6,
        );
      } else if (slot === 1) {
        combatTarget.set(
          12 + Math.cos(phase * 1.1) * 6,
          9 + Math.sin(phase) * 3,
          14 + Math.sin(phase * 0.7) * 8,
        );
      } else {
        combatTarget.set(
          -12 + Math.sin(phase * 1.2) * 6,
          8 + Math.cos(phase * 0.9) * 3,
          16 + Math.cos(phase * 0.6) * 8,
        );
      }

      const salvoActive = missionTelemetry
        ? missionTelemetry.weaponsHot && missionTelemetry.combatAction === 'firing_salvo'
        : true;
      const pulse = salvoActive && t % 0.44 < 0.18;
      if (pulse !== firingPulseRef.current) {
        firingPulseRef.current = pulse;
        setCombatFiring(pulse);
      }
    } else if (firingPulseRef.current) {
      firingPulseRef.current = false;
      setCombatFiring(false);
    }

    if (dead) {
      // Powerless and tumbling. Slow, uncommanded, slightly off every axis.
      group.rotation.order = 'XYZ';
      group.rotation.z += delta * 0.09;
      group.rotation.x += delta * 0.035;
      group.position.set(0, Math.sin(t * 0.3) * 0.06, 0);
      linPos.y = group.position.y;
      angPos.x = group.rotation.x;
      angPos.z = group.rotation.z;
      return;
    }

    let tx = 0;
    let ty = 0;
    let tz = 0;
    let rx = 0;
    let ry = 0;
    let rz = 0;
    let linOmega = 4.5;
    let angOmega = 5.0;

    if (missionState) {
      const p = Math.min(1, Math.max(0, missionProgress ?? 0));
      const agility = shipStats ? 0.65 + (shipStats.speed / 100) * 0.7 : 1.0;

      switch (missionState) {
        case 'docked':
        case 'repair': {
          // Exact magnetic keel capture so spacedock clamps & tunnels seat flush
          tx = 0;
          ty = 0;
          tz = 0;
          rx = 0;
          ry = 0;
          rz = 0;
          linOmega = 5.2;
          angOmega = 5.8;
          break;
        }

        case 'departing': {
          if (p < 0.28) {
            // Micro-RCS release drift clearing gantry clamps
            const u = p / 0.28;
            tx = 0;
            ty = 0.14 * u * u;
            tz = 0.7 * u;
            rx = -0.015 * u;
            ry = 0;
            rz = Math.sin(t * 6.5) * 0.006;
            linOmega = 4.8;
            angOmega = 5.5;
          } else {
            // Main drive spool-up pitch-up (+Y climb + forward surge +Z)
            const u = (p - 0.28) / 0.72;
            const s = u * u * (3 - 2 * u);
            tx = Math.sin(s * Math.PI * 0.5) * 0.45;
            ty = 0.14 + s * 2.7;
            tz = 0.7 + s * 5.2;
            rx = -0.15 * Math.sin(s * Math.PI * 0.85);
            ry = 0.08 * s;
            rz = -0.04 * Math.sin(s * Math.PI);
            linOmega = 4.2;
            angOmega = 4.8;
          }
          break;
        }

        case 'warp': {
          // Deterministic Alcubierre harmonic spool-up & longitudinal surge
          const env = Math.min(1, p / 0.14) * Math.min(1, (1 - p) / 0.12 + 0.15);
          tx = 0.025 * Math.sin(t * 19.1) * env;
          ty = 0.022 * Math.cos(t * 27.3) * env;
          tz = 1.65 * env + 0.045 * Math.sin(t * 23.7) * Math.cos(t * 11.3) * env;
          rx = 0.012 * Math.sin(t * 13.1) * env;
          ry = 0.008 * Math.cos(t * 15.7) * env;
          rz = 0.014 * Math.sin(t * 17.3) * env;
          linOmega = 9.0;
          angOmega = 9.0;
          break;
        }

        case 'asteroid_field': {
          // Slalom banking physics: roll & yaw lead derived from lateral velocity
          tx = (Math.sin(t * 0.85) * 2.3 + Math.sin(t * 1.9 + 0.7) * 0.8) * agility;
          ty = Math.sin(t * 1.15 + 0.5) * 0.9 + Math.cos(t * 2.1) * 0.35;
          tz = Math.cos(t * 0.65) * 0.9;
          const vx = (Math.cos(t * 0.85) * 2.3 * 0.85 + Math.cos(t * 1.9 + 0.7) * 0.8 * 1.9) * agility;
          const vy = Math.cos(t * 1.15 + 0.5) * 0.9 * 1.15 - Math.sin(t * 2.1) * 0.35 * 2.1;
          rx = Math.max(-0.18, Math.min(0.18, -vy * 0.085));
          ry = Math.max(-0.24, Math.min(0.24, vx * 0.08));
          rz = Math.max(-0.34, Math.min(0.34, -vx * 0.13));
          linOmega = 5.5;
          angOmega = 6.0;
          break;
        }

        case 'planet_orbit': {
          // Majestic slow orbital roll/bank sweep appreciating planetary horizon
          tx = Math.sin(t * 0.32) * 1.4;
          ty = Math.cos(t * 0.28) * 0.55;
          tz = Math.sin(t * 0.22) * 0.7;
          rx = Math.sin(t * 0.28) * 0.05;
          ry = Math.cos(t * 0.32) * 0.08;
          rz = -Math.cos(t * 0.32) * 0.15;
          linOmega = 3.5;
          angOmega = 3.8;
          break;
        }

        case 'combat': {
          // Sweeping jinking bank-and-pitch turns (±16° = ±0.28 rad) coupled with yaw lead
          tx = (Math.sin(t * 1.35) * 2.5 + Math.cos(t * 2.65) * 0.7) * agility;
          ty = Math.sin(t * 1.75) * 1.1 + Math.sin(t * 0.9) * 0.45;
          tz = Math.sin(t * 1.1) * 1.1;
          const vx = (Math.cos(t * 1.35) * 2.5 * 1.35 - Math.sin(t * 2.65) * 0.7 * 2.65) * agility;
          const vy = Math.cos(t * 1.75) * 1.1 * 1.75 + Math.cos(t * 0.9) * 0.45 * 0.9;
          rx = Math.max(-0.18, Math.min(0.18, -vy * 0.075));
          ry = Math.max(-0.22, Math.min(0.22, vx * 0.06));
          rz = Math.max(-0.28, Math.min(0.28, -vx * 0.08));
          linOmega = 6.5;
          angOmega = 7.0;
          break;
        }

        case 'return_transit': {
          // Smooth deceleration flare, pitch leveling, and berth alignment to [0, 0, 0]
          const flareRaw = Math.max(0, 1 - p / 0.85);
          const flare = flareRaw * flareRaw * (3 - 2 * flareRaw);
          tx = Math.sin(p * Math.PI * 1.5) * 1.6 * flare;
          ty = 1.6 * flare + Math.sin(p * Math.PI) * 0.35 * flare;
          tz = 5.0 * flare;
          rx = -0.07 * flare;
          ry = -0.05 * Math.sin(p * Math.PI) * flare;
          rz = -0.08 * Math.sin(p * Math.PI * 1.5) * flare;
          linOmega = 4.5;
          angOmega = 5.2;
          break;
        }
      }
    }

    [linPos.x, linVel.x] = stepSpring(linPos.x, linVel.x, tx, linOmega, delta);
    [linPos.y, linVel.y] = stepSpring(linPos.y, linVel.y, ty, linOmega, delta);
    [linPos.z, linVel.z] = stepSpring(linPos.z, linVel.z, tz, linOmega, delta);
    [angPos.x, angVel.x] = stepSpring(angPos.x, angVel.x, rx, angOmega, delta);
    [angPos.y, angVel.y] = stepSpring(angPos.y, angVel.y, ry, angOmega, delta);
    [angPos.z, angVel.z] = stepSpring(angPos.z, angVel.z, rz, angOmega, delta);

    group.position.set(linPos.x, linPos.y, linPos.z);
    group.rotation.order = 'YXZ';
    group.rotation.set(angPos.x, angPos.y, angPos.z);
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
          const retracted = !isInstalled(socket.id);
          switch (socket.kind) {
            case 'engine':
              return (
                <group key={socket.id} position={[0, 0, -coreOffsetZ]}>
                  <SocketMount socket={socket} retracted={retracted}>
                    <EngineBell
                      sublight={blueprint.sublight}
                      burning={activeBurn}
                      dead={dead}
                      reducedMotion={reducedMotion}
                    />
                    {/* Starts at the bell's mouth, which now depends on the drive
                        fitted rather than on a constant that suited one of them. */}
                    <group position={[0, engineBellLength(blueprint.sublight), 0]}>
                      <ExhaustPlume
                        sublight={blueprint.sublight}
                        burning={activeBurn}
                        dead={dead}
                        seed={blueprint.seed}
                        mode={effectiveMode}
                        reducedMotion={reducedMotion}
                      />
                    </group>
                  </SocketMount>
                </group>
              );

            case 'radiator':
              return protrusions.radiators ? (
                <SocketMount key={socket.id} socket={socket} retracted={retracted}>
                  <Radiator burning={activeBurn} thermalWear={wear.thermal} mode={effectiveMode} dead={dead} />
                </SocketMount>
              ) : null;

            case 'sensor':
              return protrusions.sensors ? (
                <SocketMount key={socket.id} socket={socket} retracted={retracted}>
                  <SensorArray sensor={blueprint.sensors} mode={effectiveMode} dead={dead} />
                </SocketMount>
              ) : null;

            case 'rcs':
              return protrusions.rcs ? (
                <SocketMount key={socket.id} socket={socket} retracted={retracted}>
                  <RcsQuad />
                </SocketMount>
              ) : null;

            case 'weapon':
              return (
                <SocketMount key={socket.id} socket={socket} retracted={retracted}>
                  <Turret
                    weapon={blueprint.weapons}
                    mode={effectiveMode}
                    dead={dead}
                    firing={missionState === 'combat' && !dead && !reducedMotion ? combatFiring : false}
                    targetPosition={missionState === 'combat' && !dead ? combatTarget : null}
                  />
                </SocketMount>
              );

            case 'fuel':
              return (
                <group key={socket.id} position={[0, 0, -coreOffsetZ * 0.5]}>
                  <SocketMount socket={socket} retracted={retracted}>
                    <FuelPod fuel={blueprint.fuel} mode={effectiveMode} dead={dead} />
                  </SocketMount>
                </group>
              );

            case 'ftl':
              // Deliberately not socket-mounted: the ring encircles the whole
              // hull rather than protruding from a face, so it takes the socket's
              // position but none of its orientation.
              return (
                <group
                  key={socket.id}
                  position={[
                    socket.position[0],
                    socket.position[1],
                    socket.position[2] - coreOffsetZ,
                  ]}
                >
                  <FtlCore
                    ftl={blueprint.ftl}
                    mode={effectiveMode}
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
          dead={lightsDead}
          mode={effectiveMode}
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
          mode={effectiveMode}
        />

        <ExteriorLights rig={lightRig} dead={lightsDead} mode={effectiveMode} />
      </group>
    </DamageProvider>
  );
}
