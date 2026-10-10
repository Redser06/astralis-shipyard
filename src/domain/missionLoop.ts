import type { MissionState, MissionTelemetry } from './types';

/**
 * The autonomous deep-space mission loop finite state machine.
 *
 * Drives continuous simulated sorties with zero user intervention:
 *   docked -> departing -> warp -> asteroid_field -> planet_orbit -> combat -> return_transit -> repair -> docked
 *
 * NON-NEGOTIABLE SURVIVAL CONSTRAINTS:
 * 1. Hard Integrity Floor: 0.35 (35%). Defensive countermeasures auto-deploy when critical.
 * 2. Full Drone Reconstruction: Hull integrity is fully repaired to 1.0 (100%) upon docking.
 * 3. Pure domain execution: Zero dependencies on Three.js or DOM so it can be 100% unit-tested.
 */

export const MIN_HULL_INTEGRITY = 0.35;
export const MAX_HULL_INTEGRITY = 1.0;

export const MISSION_SEQUENCE: readonly MissionState[] = [
  'docked',
  'departing',
  'warp',
  'asteroid_field',
  'planet_orbit',
  'combat',
  'return_transit',
  'repair',
] as const;

export const WAYPOINTS_BY_STATE: Readonly<Record<MissionState, string>> = {
  docked: 'Starbase Gantry Bay 04',
  departing: 'Orbital Clearance Corridor Zulu',
  warp: 'Subspace Conduit Sector 7',
  asteroid_field: 'Vesta Belt Dense Perimeter',
  planet_orbit: 'Kepler-452b High Synchronous Orbit',
  combat: 'Hostile Incursion Zone Delta',
  return_transit: 'Inbound Vector Sol-Drydock',
  repair: 'Drydock Automated Scaffold & Repair Slipway',
};

export const PHASE_DURATIONS: Readonly<Record<MissionState, number>> = {
  docked: 5.0,
  departing: 4.0,
  warp: 6.0,
  asteroid_field: 7.0,
  planet_orbit: 6.0,
  combat: 8.0,
  return_transit: 5.0,
  repair: 6.0,
};

export function createInitialMissionTelemetry(): MissionTelemetry {
  return {
    state: 'docked',
    progress: 0.0,
    currentWaypoint: WAYPOINTS_BY_STATE.docked,
    hullIntegrity: 1.0,
    activeThreats: 0,
    droneSorties: 0,
    combatLog: ['Mission loop initialized. Ship moored at Starbase Gantry Bay 04.'],
  };
}

export interface StepOptions {
  /** Optional custom phase duration multiplier (default: 1.0) */
  timeScale?: number;
  /** Force incoming damage in combat (integrity per second) */
  combatDps?: number;
  /** Repair speed in repair phase (integrity per second) */
  repairHps?: number;
}

export interface MissionStepResult {
  telemetry: MissionTelemetry;
  integrityDelta: number;
  combatEvent?: string;
  stateChanged: boolean;
}

/**
 * Deterministically steps the mission FSM forward by dt seconds.
 */
export function stepMission(
  current: MissionTelemetry,
  dt: number,
  options: StepOptions = {},
): MissionStepResult {
  const timeScale = options.timeScale ?? 1.0;
  const combatDps = options.combatDps ?? 0.12;
  const repairHps = options.repairHps ?? 0.18;

  const duration = (PHASE_DURATIONS[current.state] ?? 5.0) / timeScale;
  const newProgress = current.progress + (duration > 0 ? dt / duration : 1.0);

  let nextState: MissionState = current.state;
  let nextProgress = newProgress;
  let integrityDelta = 0;
  let activeThreats = current.activeThreats;
  let droneSorties = current.droneSorties;
  let nextHullIntegrity = current.hullIntegrity;
  let combatEvent: string | undefined;
  const combatLog = [...current.combatLog];

  const logEvent = (msg: string) => {
    combatLog.push(msg);
    if (combatLog.length > 25) combatLog.shift();
  };

  // Phase-specific mechanics
  if (current.state === 'combat') {
    activeThreats = 3;
    // Apply combat damage until reaching hard floor of 0.35
    if (nextHullIntegrity > MIN_HULL_INTEGRITY) {
      const damage = Math.min(combatDps * dt, nextHullIntegrity - MIN_HULL_INTEGRITY);
      nextHullIntegrity = Math.max(MIN_HULL_INTEGRITY, nextHullIntegrity - damage);
      integrityDelta = -damage;
    }

    if (nextHullIntegrity <= MIN_HULL_INTEGRITY && current.hullIntegrity > MIN_HULL_INTEGRITY) {
      combatEvent = 'SHIELDS_CRITICAL_COUNTERMEASURES_DEPLOYED';
      logEvent('⚠️ SHIELDS CRITICAL (35% integrity)! Defensive flares & pulse ECM deployed. Hostiles broke off.');
      activeThreats = 0;
    } else if (Math.random() < 0.05 * dt * 10) {
      logEvent('Kinetic slug impact absorbed by forward deflection grid.');
    }
  } else if (current.state === 'repair' || current.state === 'docked') {
    activeThreats = 0;
    // Repair drone swarm regenerates hull to 1.0
    if (nextHullIntegrity < MAX_HULL_INTEGRITY) {
      const heal = Math.min(repairHps * dt, MAX_HULL_INTEGRITY - nextHullIntegrity);
      nextHullIntegrity = Math.min(MAX_HULL_INTEGRITY, nextHullIntegrity + heal);
      integrityDelta = heal;
      droneSorties += Math.ceil(dt * 2);
    }
  } else {
    activeThreats = 0;
  }

  // Handle phase transitions
  let stateChanged = false;
  if (newProgress >= 1.0) {
    const currentIndex = MISSION_SEQUENCE.indexOf(current.state);
    const nextIndex = (currentIndex + 1) % MISSION_SEQUENCE.length;
    nextState = MISSION_SEQUENCE[nextIndex] ?? 'docked';
    nextProgress = 0.0;
    stateChanged = true;

    // Transition notifications
    switch (nextState) {
      case 'departing':
        logEvent('Undocking latches released. Sublight thrusters maneuvering past gantry.');
        break;
      case 'warp':
        logEvent('Alcubierre warp drive engaged. Cruising in subspace transit.');
        break;
      case 'asteroid_field':
        logEvent('Dropped to sublight in asteroid field. LIDAR scanning navigational hazards.');
        break;
      case 'planet_orbit':
        logEvent('Orbit established above target world. Atmospheric telemetry online.');
        break;
      case 'combat':
        activeThreats = 3;
        logEvent('🚨 RED ALERT: Hostile alien interceptors detected! Articulated turrets tracking.');
        break;
      case 'return_transit':
        activeThreats = 0;
        logEvent('Combat egress successful. Plotting return transit back to drydock.');
        break;
      case 'repair':
        droneSorties += 12;
        logEvent('Docking locked. Autonomous drone swarm deployed for structural welding.');
        break;
      case 'docked':
        nextHullIntegrity = 1.0; // Ensure 100% reconstruction on dock
        logEvent('Sortie complete. Ship fully reconstructed and moored at station.');
        break;
    }
  }

  return {
    telemetry: {
      state: nextState,
      progress: Math.min(1.0, nextProgress),
      currentWaypoint: WAYPOINTS_BY_STATE[nextState],
      hullIntegrity: Math.max(MIN_HULL_INTEGRITY, Math.min(MAX_HULL_INTEGRITY, nextHullIntegrity)),
      activeThreats,
      droneSorties,
      combatLog,
    },
    integrityDelta,
    combatEvent,
    stateChanged,
  };
}

/**
 * Simulates N continuous sorties to verify loop determinism, boundary guarantees, and repair completion.
 */
export function runSimulatedSorties(
  count: number,
  stepSize = 0.5,
): {
  completedSorties: number;
  minIntegrity: number;
  finalIntegrity: number;
  totalSteps: number;
} {
  let telemetry = createInitialMissionTelemetry();
  let completedSorties = 0;
  let minIntegrity = 1.0;
  let previousState: MissionState = telemetry.state;
  let totalSteps = 0;

  // Run steps until count sorties are completed
  const maxSteps = count * 2000;
  while (completedSorties < count && totalSteps < maxSteps) {
    const result = stepMission(telemetry, stepSize, { timeScale: 4.0 });
    telemetry = result.telemetry;
    totalSteps++;

    minIntegrity = Math.min(minIntegrity, telemetry.hullIntegrity);

    if (previousState === 'repair' && telemetry.state === 'docked') {
      completedSorties++;
    }
    previousState = telemetry.state;
  }

  return {
    completedSorties,
    minIntegrity,
    finalIntegrity: telemetry.hullIntegrity,
    totalSteps,
  };
}
