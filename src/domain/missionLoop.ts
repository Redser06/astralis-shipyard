import type { CombatAction, MissionState, MissionTelemetry, ShipStats } from './types';

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

/** Reference orbital altitude of the drydock gantry berth (LEO-equivalent). */
const DRYDOCK_ALTITUDE_KM = 420.0;

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

function clamp01(value: number): number {
  return Math.max(0, Math.min(1, value));
}

function smoothstep(edge0: number, edge1: number, x: number): number {
  const t = clamp01((x - edge0) / (edge1 - edge0));
  return t * t * (3 - 2 * t);
}

function normalizeHeading(deg: number): number {
  const wrapped = ((deg % 360) + 360) % 360;
  return Math.round(wrapped * 10) / 10;
}

interface FlightKinematics {
  velocityKms: number;
  throttlePct: number;
  altitudeKm: number;
  headingDeg: number;
  bankDeg: number;
  dockingClampsEngaged: boolean;
  weaponsHot: boolean;
  combatAction: CombatAction;
  subPhaseLabel: string;
}

function computeFlightKinematics(
  state: MissionState,
  progress: number,
  hullIntegrity: number,
  activeThreats: number,
  shipStats?: ShipStats,
): FlightKinematics {
  const p = clamp01(progress);
  const speedNorm = shipStats ? clamp01(shipStats.speed / 100) : 0.55;
  const warpNorm = shipStats ? clamp01(shipStats.warp / 100) : 0.6;
  const hasFtl = shipStats ? shipStats.warp > 0 : true;
  const speedScale = 0.72 + speedNorm * 0.68;

  switch (state) {
    case 'docked': {
      let subPhaseLabel = 'Moored & Umbilicals Pressurized';
      if (p >= 0.8) subPhaseLabel = 'Departure Clearance & Ignition Hold';
      else if (p >= 0.45) subPhaseLabel = 'Pre-Flight Attitude Gyro Alignment';
      return {
        velocityKms: 0.0,
        throttlePct: 0,
        altitudeKm: DRYDOCK_ALTITUDE_KM,
        headingDeg: 0,
        bankDeg: 0,
        dockingClampsEngaged: true,
        weaponsHot: false,
        combatAction: 'standby',
        subPhaseLabel,
      };
    }

    case 'departing': {
      const clampsEngaged = p < 0.25;
      const u = clamp01((p - 0.25) / 0.7);
      const driveRamp = Math.pow(u, 0.85) * 0.5 + smoothstep(0.25, 0.95, p) * 0.5;
      const throttlePct = clampsEngaged
        ? Math.round(4 + (p / 0.25) * 14)
        : Math.round(18 + driveRamp * (68 + speedNorm * 10));
      const velocityKms =
        Math.round((clampsEngaged ? (p / 0.25) * 0.18 : 0.18 + driveRamp * 18.5 * speedScale) * 100) /
        100;
      const altitudeKm = Math.round((DRYDOCK_ALTITUDE_KM + smoothstep(0.15, 1.0, p) * 68) * 10) / 10;
      const headingDeg = normalizeHeading(smoothstep(0.28, 1.0, p) * 12);
      const bankDeg = Math.round(Math.sin(smoothstep(0.28, 1.0, p) * Math.PI) * 5 * 10) / 10;

      let subPhaseLabel = 'Umbilical Retraction & Clamp Release';
      if (p >= 0.55) subPhaseLabel = 'Sublight Main Drive Corridor Climb';
      else if (p >= 0.25) subPhaseLabel = 'RCS Translation Clear of Gantry';

      return {
        velocityKms,
        throttlePct,
        altitudeKm,
        headingDeg,
        bankDeg,
        dockingClampsEngaged: clampsEngaged,
        weaponsHot: false,
        combatAction: 'standby',
        subPhaseLabel,
      };
    }

    case 'warp': {
      const spool = smoothstep(0.0, 0.18, p) * (1 - 0.18 * smoothstep(0.82, 1.0, p));
      const throttlePct = hasFtl
        ? Math.round(84 + spool * 16)
        : Math.round(78 + spool * 18);
      const peakC = hasFtl ? 299792 * (0.45 + warpNorm * 2.4) : 138 * speedScale;
      const velocityKms = Math.round((22 * speedScale + spool * peakC) * 10) / 10;
      const altitudeKm = Math.round((488 + smoothstep(0.0, 1.0, p) * 41500) * 10) / 10;
      const headingDeg = normalizeHeading(12 + p * 6);

      let subPhaseLabel = hasFtl
        ? 'Alcubierre Field Coil Harmonics'
        : 'Sublight Relativistic Cruise (No FTL)';
      if (hasFtl) {
        if (p >= 0.8) subPhaseLabel = 'Subspace Metric Decoupling';
        else if (p >= 0.22) subPhaseLabel = 'Alcubierre Bubble Stabilization';
      }

      return {
        velocityKms,
        throttlePct,
        altitudeKm,
        headingDeg,
        bankDeg: 0,
        dockingClampsEngaged: false,
        weaponsHot: false,
        combatAction: 'standby',
        subPhaseLabel,
      };
    }

    case 'asteroid_field': {
      const wave = Math.sin(p * Math.PI * 4);
      const deriv = Math.cos(p * Math.PI * 4);
      const throttlePct = Math.round(52 + Math.abs(deriv) * (18 + speedNorm * 8));
      const velocityKms = Math.round((13.5 + speedNorm * 10.5 - Math.abs(wave) * 1.4) * 100) / 100;
      const altitudeKm = Math.round((36400 + wave * 160) * 10) / 10;
      const headingDeg = normalizeHeading(18 + wave * (14 + speedNorm * 6));
      const bankDeg = Math.round(deriv * (16 + speedNorm * 8) * 10) / 10;

      let subPhaseLabel = 'LIDAR Obstacle Slalom';
      if (p >= 0.7) subPhaseLabel = 'Belt Perimeter Exit Vector';
      else if (p >= 0.35) subPhaseLabel = 'Dense Regolith Corridor Weave';

      return {
        velocityKms,
        throttlePct,
        altitudeKm,
        headingDeg,
        bankDeg,
        dockingClampsEngaged: false,
        weaponsHot: false,
        combatAction: 'scanning',
        subPhaseLabel,
      };
    }

    case 'planet_orbit': {
      const retro = 1 - smoothstep(0.0, 0.32, p);
      const throttlePct = Math.round(20 + retro * 42);
      const velocityKms = Math.round((8.4 + retro * 3.8 + Math.sin(p * Math.PI) * 0.6) * 100) / 100;
      // Orbital altitude dips smoothly from high approach into synchronous horizon sweep
      const dip = Math.sin(p * Math.PI);
      const altitudeKm = Math.round((1650 - dip * 1340) * 10) / 10;
      const headingDeg = normalizeHeading(18 + p * 90);
      const bankDeg = Math.round(-dip * 8.5 * 10) / 10;

      let subPhaseLabel = 'Orbital Capture Retro-Burn';
      if (p >= 0.72) subPhaseLabel = 'Deep-Range Passive Telemetry Sweep';
      else if (p >= 0.28) subPhaseLabel = 'Synchronous Horizon Reconnaissance';

      return {
        velocityKms,
        throttlePct,
        altitudeKm,
        headingDeg,
        bankDeg,
        dockingClampsEngaged: false,
        weaponsHot: false,
        combatAction: 'scanning',
        subPhaseLabel,
      };
    }

    case 'combat': {
      const critical = hullIntegrity <= MIN_HULL_INTEGRITY || activeThreats <= 0;
      let combatAction: CombatAction;
      if (critical) {
        combatAction = 'countermeasures';
      } else if (p < 0.2) {
        combatAction = 'scanning';
      } else if (p < 0.5) {
        combatAction = 'firing_salvo';
      } else if (p < 0.68) {
        combatAction = 'evading';
      } else if (p < 0.9) {
        combatAction = 'firing_salvo';
      } else {
        combatAction = 'evading';
      }

      const jink = Math.sin(p * Math.PI * 6);
      const jinkDeriv = Math.cos(p * Math.PI * 6);
      const throttlePct =
        combatAction === 'evading' || combatAction === 'countermeasures'
          ? Math.round(88 + speedNorm * 12)
          : Math.round(74 + Math.abs(jinkDeriv) * 14);
      const velocityKms = Math.round((18.5 + speedNorm * 13.5 + Math.abs(jink) * 2.2) * 100) / 100;
      const altitudeKm = Math.round((520 + Math.sin(p * Math.PI * 3) * 85) * 10) / 10;
      const headingDeg = normalizeHeading(108 + jink * 24);
      const bankDeg = Math.round(jinkDeriv * (15 + speedNorm * 4) * 10) / 10;

      const subPhaseLabel =
        combatAction === 'countermeasures'
          ? 'Hull Floor Reached — Pulse ECM & Flare Break'
          : combatAction === 'scanning'
            ? 'Fire-Control Radar Target Acquisition'
            : combatAction === 'firing_salvo'
              ? 'Ballistic Turret Engagement'
              : 'High-G Evasive Jink & Deflection Roll';

      return {
        velocityKms,
        throttlePct,
        altitudeKm,
        headingDeg,
        bankDeg,
        dockingClampsEngaged: false,
        weaponsHot: !critical && activeThreats > 0,
        combatAction,
        subPhaseLabel,
      };
    }

    case 'return_transit': {
      const approach = 1 - smoothstep(0.0, 0.86, p);
      const clampsEngaged = p >= 0.88;
      const throttlePct = p >= 0.88 ? 0 : Math.round(12 + approach * 58);
      const velocityKms = Math.round(approach * (15.5 * speedScale) * 100) / 100;
      const altitudeKm = Math.round((DRYDOCK_ALTITUDE_KM + approach * 340) * 10) / 10;
      const headingDeg = normalizeHeading(108 * approach);
      const bankDeg = Math.round(Math.sin(p * Math.PI) * approach * 6 * 10) / 10;

      let subPhaseLabel = 'Inbound Retro-Braking Deceleration';
      if (p >= 0.85) subPhaseLabel = 'Magnetic Berth Capture Sequence';
      else if (p >= 0.45) subPhaseLabel = 'Precision Slipway Alignment';

      return {
        velocityKms,
        throttlePct,
        altitudeKm,
        headingDeg,
        bankDeg,
        dockingClampsEngaged: clampsEngaged,
        weaponsHot: false,
        combatAction: 'standby',
        subPhaseLabel,
      };
    }

    case 'repair': {
      let subPhaseLabel = 'Automated Gantry Scaffold Lock';
      if (p >= 0.75) subPhaseLabel = 'Structural Integrity & Reactor Certification';
      else if (p >= 0.35) subPhaseLabel = 'Autonomous Drone Hull Reconstruction';
      return {
        velocityKms: 0.0,
        throttlePct: 0,
        altitudeKm: DRYDOCK_ALTITUDE_KM,
        headingDeg: 0,
        bankDeg: 0,
        dockingClampsEngaged: true,
        weaponsHot: false,
        combatAction: 'standby',
        subPhaseLabel,
      };
    }
  }
}

export function createInitialMissionTelemetry(): MissionTelemetry {
  return {
    state: 'docked',
    progress: 0.0,
    currentWaypoint: WAYPOINTS_BY_STATE.docked,
    hullIntegrity: 1.0,
    activeThreats: 0,
    droneSorties: 0,
    combatLog: ['Mission loop initialized. Ship moored at Starbase Gantry Bay 04.'],
    velocityKms: 0.0,
    throttlePct: 0,
    altitudeKm: DRYDOCK_ALTITUDE_KM,
    headingDeg: 0,
    bankDeg: 0,
    dockingClampsEngaged: true,
    weaponsHot: false,
    combatAction: 'standby',
    subPhaseLabel: 'Moored & Umbilicals Pressurized',
  };
}

export interface StepOptions {
  /** Optional custom phase duration multiplier (default: 1.0) */
  timeScale?: number;
  /** Force incoming damage in combat (integrity per second) */
  combatDps?: number;
  /** Repair speed in repair phase (integrity per second) */
  repairHps?: number;
  /** Optional ship stats influencing velocity, evasion, armor mitigation, and firepower */
  shipStats?: ShipStats;
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
  const safeDt = Math.max(0, dt);
  const timeScale = Math.max(0.05, options.timeScale ?? 1.0);
  const baseCombatDps = options.combatDps ?? 0.12;
  const repairHps = options.repairHps ?? 0.18;
  const shipStats = options.shipStats;

  const armorMitigation = shipStats ? 1 - clamp01(shipStats.armor / 100) * 0.42 : 1.0;
  const evasionMitigation = shipStats ? 1 - clamp01(shipStats.speed / 100) * 0.18 : 1.0;
  const combatDps = baseCombatDps * armorMitigation * evasionMitigation;

  const duration = (PHASE_DURATIONS[current.state] ?? 5.0) / timeScale;
  const newProgress = current.progress + (duration > 0 ? safeDt / duration : 1.0);

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

  const crossed = (threshold: number) =>
    current.progress < threshold && newProgress >= threshold;

  // Phase-specific mechanics
  if (current.state === 'combat') {
    activeThreats = current.hullIntegrity <= MIN_HULL_INTEGRITY ? 0 : Math.max(1, current.activeThreats || 3);

    // Apply combat damage until reaching hard floor of 0.35
    if (nextHullIntegrity > MIN_HULL_INTEGRITY && activeThreats > 0) {
      const damage = Math.min(combatDps * safeDt, nextHullIntegrity - MIN_HULL_INTEGRITY);
      nextHullIntegrity = Math.max(MIN_HULL_INTEGRITY, nextHullIntegrity - damage);
      integrityDelta = -damage;
    }

    if (nextHullIntegrity <= MIN_HULL_INTEGRITY && current.hullIntegrity > MIN_HULL_INTEGRITY) {
      combatEvent = 'SHIELDS_CRITICAL_COUNTERMEASURES_DEPLOYED';
      logEvent('SHIELDS CRITICAL (35% integrity)! Defensive flares & pulse ECM deployed. Hostiles broke off.');
      activeThreats = 0;
    } else if (newProgress < 1.0) {
      if (crossed(0.25)) {
        logEvent('Fire-control solution locked. Port & starboard turrets opening salvo.');
      }
      if (crossed(0.55) && nextHullIntegrity > MIN_HULL_INTEGRITY) {
        logEvent('Kinetic slug impact absorbed by forward deflection grid.');
      }
      if (crossed(0.8) && activeThreats > 0) {
        if (shipStats && shipStats.firepower >= 65) {
          activeThreats = Math.max(1, activeThreats - 1);
          logEvent('Direct heavy salvo hit — hostile interceptor disabled.');
        } else {
          logEvent('Counter-battery fire forcing hostile interceptors off attack vector.');
        }
      }
    }
  } else if (current.state === 'repair' || current.state === 'docked') {
    activeThreats = 0;
    // Repair drone swarm regenerates hull to 1.0
    if (nextHullIntegrity < MAX_HULL_INTEGRITY) {
      const heal = Math.min(repairHps * safeDt, MAX_HULL_INTEGRITY - nextHullIntegrity);
      nextHullIntegrity = Math.min(MAX_HULL_INTEGRITY, nextHullIntegrity + heal);
      integrityDelta = heal;
      droneSorties += Math.ceil(safeDt * 2);
    }
  } else {
    activeThreats = 0;
    if (newProgress < 1.0) {
      if (current.state === 'departing' && crossed(0.25)) {
        logEvent('Gantry clamps disengaged. Main drive corridor burn initiated.');
      } else if (current.state === 'asteroid_field' && crossed(0.5)) {
        logEvent('LIDAR corridor slalom nominal — RCS attitude thrusters compensating drift.');
      } else if (current.state === 'planet_orbit' && crossed(0.5)) {
        logEvent('Kepler-452b synchronous periapsis reached. Gravitational telemetry nominal.');
      } else if (current.state === 'return_transit' && crossed(0.88)) {
        logEvent('Docking collar aligned — magnetic berth clamps capturing keel.');
      }
    }
  }

  // Handle phase transitions
  let stateChanged = false;
  if (newProgress >= 1.0) {
    const currentIndex = MISSION_SEQUENCE.indexOf(current.state);
    const nextIndex = (currentIndex + 1) % MISSION_SEQUENCE.length;
    nextState = MISSION_SEQUENCE[nextIndex] ?? 'docked';
    nextProgress = 0.0;
    stateChanged = true;

    switch (nextState) {
      case 'departing':
        logEvent('Undocking latches released. Sublight thrusters maneuvering past gantry.');
        break;
      case 'warp':
        logEvent(
          shipStats && shipStats.warp <= 0
            ? 'No FTL core fitted. Engaging high-sublight relativistic transit.'
            : 'Alcubierre warp drive engaged. Cruising in subspace transit.',
        );
        break;
      case 'asteroid_field':
        logEvent('Dropped to sublight in asteroid field. LIDAR scanning navigational hazards.');
        break;
      case 'planet_orbit':
        logEvent('Orbit established above target world. Atmospheric telemetry online.');
        break;
      case 'combat':
        activeThreats = 3;
        logEvent('RED ALERT: Hostile alien interceptors detected! Articulated turrets tracking.');
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

  const clampedIntegrity = Math.max(
    MIN_HULL_INTEGRITY,
    Math.min(MAX_HULL_INTEGRITY, nextHullIntegrity),
  );
  const clampedProgress = Math.min(1.0, nextProgress);
  const kinematics = computeFlightKinematics(
    nextState,
    clampedProgress,
    clampedIntegrity,
    activeThreats,
    shipStats,
  );

  return {
    telemetry: {
      state: nextState,
      progress: clampedProgress,
      currentWaypoint: WAYPOINTS_BY_STATE[nextState],
      hullIntegrity: clampedIntegrity,
      activeThreats,
      droneSorties,
      combatLog,
      ...kinematics,
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
