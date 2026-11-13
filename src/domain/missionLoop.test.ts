import { describe, expect, it } from 'vitest';
import {
  createInitialMissionTelemetry,
  stepMission,
  runSimulatedSorties,
  MIN_HULL_INTEGRITY,
  MAX_HULL_INTEGRITY,
  MISSION_SEQUENCE,
  PHASE_DURATIONS,
} from './missionLoop';
import type { ShipStats } from './types';

describe('missionLoop engine', () => {
  it('initializes in docked state with 100% integrity and moored telemetry', () => {
    const telemetry = createInitialMissionTelemetry();
    expect(telemetry.state).toBe('docked');
    expect(telemetry.hullIntegrity).toBe(1.0);
    expect(telemetry.progress).toBe(0.0);
    expect(telemetry.activeThreats).toBe(0);
    expect(telemetry.velocityKms).toBe(0);
    expect(telemetry.throttlePct).toBe(0);
    expect(telemetry.dockingClampsEngaged).toBe(true);
    expect(telemetry.weaponsHot).toBe(false);
    expect(telemetry.combatAction).toBe('standby');
    expect(telemetry.subPhaseLabel.length).toBeGreaterThan(0);
  });

  it('progresses through all 8 mission states in sequence', () => {
    let telemetry = createInitialMissionTelemetry();
    const visitedStates: string[] = [telemetry.state];

    // Step through states with large dt
    for (let i = 0; i < MISSION_SEQUENCE.length * 2; i++) {
      const result = stepMission(telemetry, 10.0);
      telemetry = result.telemetry;
      if (visitedStates[visitedStates.length - 1] !== telemetry.state) {
        visitedStates.push(telemetry.state);
      }
    }

    // Verify all states visited in order
    for (let i = 0; i < MISSION_SEQUENCE.length; i++) {
      expect(visitedStates[i]).toBe(MISSION_SEQUENCE[i]);
    }
  });

  it('strictly respects the non-negotiable 35% minimum integrity constraint in combat', () => {
    const telemetry = createInitialMissionTelemetry();
    telemetry.state = 'combat';
    telemetry.hullIntegrity = 0.50;

    // Apply massive damage within the combat phase -> countermeasures deploy at floor
    const inPhase = stepMission(telemetry, 2.0, { combatDps: 1000 });
    expect(inPhase.telemetry.state).toBe('combat');
    expect(inPhase.telemetry.hullIntegrity).toBeGreaterThanOrEqual(MIN_HULL_INTEGRITY);
    expect(inPhase.telemetry.hullIntegrity).toBe(MIN_HULL_INTEGRITY);
    expect(inPhase.combatEvent).toBe('SHIELDS_CRITICAL_COUNTERMEASURES_DEPLOYED');
    expect(inPhase.telemetry.combatAction).toBe('countermeasures');
    expect(inPhase.telemetry.weaponsHot).toBe(false);

    // Even massive damage over a long step crossing out of combat preserves the 35% floor
    const result = stepMission(telemetry, 10.0, { combatDps: 1000 });
    expect(result.telemetry.hullIntegrity).toBeGreaterThanOrEqual(MIN_HULL_INTEGRITY);
    expect(result.telemetry.hullIntegrity).toBe(MIN_HULL_INTEGRITY);
    expect(result.combatEvent).toBe('SHIELDS_CRITICAL_COUNTERMEASURES_DEPLOYED');
  });

  it('restores hull integrity back to 100% during repair and docking', () => {
    let telemetry = createInitialMissionTelemetry();
    telemetry.state = 'repair';
    telemetry.hullIntegrity = 0.35;

    // Run repair steps until complete
    for (let i = 0; i < 20; i++) {
      telemetry = stepMission(telemetry, 1.0, { repairHps: 0.2 }).telemetry;
    }

    expect(telemetry.hullIntegrity).toBe(MAX_HULL_INTEGRITY);
  });

  it('runs 10 consecutive simulated sorties with zero errors, floor preservation, and 100% final integrity', () => {
    const simulation = runSimulatedSorties(10, 0.2);
    expect(simulation.completedSorties).toBe(10);
    expect(simulation.minIntegrity).toBeGreaterThanOrEqual(MIN_HULL_INTEGRITY);
    expect(simulation.finalIntegrity).toBe(MAX_HULL_INTEGRITY);
  });

  it('is 100% deterministic across identical sortie runs', () => {
    const run = () => {
      let t = createInitialMissionTelemetry();
      const snapshots = [];
      for (let i = 0; i < 120; i++) {
        t = stepMission(t, 0.45, { timeScale: 1.0 }).telemetry;
        snapshots.push(t);
      }
      return snapshots;
    };

    expect(run()).toEqual(run());
  });

  it('enforces docking clamp interlocks on departure release and return capture', () => {
    let t = createInitialMissionTelemetry();
    expect(t.dockingClampsEngaged).toBe(true);

    // Advance into departing (initial progress 0.0 -> still releasing clamps)
    t = stepMission(t, PHASE_DURATIONS.docked).telemetry;
    expect(t.state).toBe('departing');
    expect(t.dockingClampsEngaged).toBe(true);

    // Step past 25% of departing -> clamps disengaged
    t = stepMission(t, PHASE_DURATIONS.departing * 0.35).telemetry;
    expect(t.state).toBe('departing');
    expect(t.dockingClampsEngaged).toBe(false);
    expect(t.throttlePct).toBeGreaterThan(25);
    expect(t.velocityKms).toBeGreaterThan(0);

    // Step to return_transit -> clamps remain disengaged during inbound approach
    while (t.state !== 'return_transit') {
      t = stepMission(t, 0.5).telemetry;
    }
    expect(t.dockingClampsEngaged).toBe(false);

    // Advance near end of return_transit (>= 88%) -> clamps capture keel
    t = stepMission(t, PHASE_DURATIONS.return_transit * 0.9).telemetry;
    expect(t.state).toBe('return_transit');
    expect(t.dockingClampsEngaged).toBe(true);

    // Advance into repair -> clamps stay locked
    t = stepMission(t, PHASE_DURATIONS.return_transit * 0.2).telemetry;
    expect(t.state).toBe('repair');
    expect(t.dockingClampsEngaged).toBe(true);
  });

  it('cycles weaponsHot, combatAction, and orbital altitude realistically across phases', () => {
    const t = createInitialMissionTelemetry();
    const orbitStart = stepMission({ ...t, state: 'planet_orbit', progress: 0.05 }, 0.1).telemetry;
    const orbitPeriapsis = stepMission({ ...t, state: 'planet_orbit', progress: 0.48 }, 0.1).telemetry;
    expect(orbitPeriapsis.altitudeKm).toBeLessThan(orbitStart.altitudeKm);

    const warpMid = stepMission({ ...t, state: 'warp', progress: 0.45 }, 0.1).telemetry;
    expect(warpMid.velocityKms).toBeGreaterThan(100_000);
    expect(warpMid.throttlePct).toBeGreaterThan(90);

    const combatSalvo = stepMission(
      { ...t, state: 'combat', progress: 0.3, activeThreats: 3, hullIntegrity: 0.9 },
      0.1,
    ).telemetry;
    expect(combatSalvo.weaponsHot).toBe(true);
    expect(combatSalvo.combatAction).toBe('firing_salvo');
    expect(Math.abs(combatSalvo.bankDeg)).toBeGreaterThan(0);
  });

  it('responds to shipStats for speed, armor mitigation, firepower, and FTL availability', () => {
    const lightFast: ShipStats = { speed: 95, armor: 15, firepower: 40, stealth: 80, warp: 90 };
    const heavyTank: ShipStats = { speed: 30, armor: 95, firepower: 85, stealth: 20, warp: 0 };

    const fastDepart = stepMission(
      { ...createInitialMissionTelemetry(), state: 'departing', progress: 0.85 },
      0.05,
      { shipStats: lightFast },
    ).telemetry;
    const slowDepart = stepMission(
      { ...createInitialMissionTelemetry(), state: 'departing', progress: 0.85 },
      0.05,
      { shipStats: heavyTank },
    ).telemetry;
    expect(fastDepart.velocityKms).toBeGreaterThan(slowDepart.velocityKms);

    const fastCombat = stepMission(
      { ...createInitialMissionTelemetry(), state: 'combat', progress: 0.2, activeThreats: 3, hullIntegrity: 1.0 },
      2.0,
      { shipStats: lightFast },
    ).telemetry;
    const tankCombat = stepMission(
      { ...createInitialMissionTelemetry(), state: 'combat', progress: 0.2, activeThreats: 3, hullIntegrity: 1.0 },
      2.0,
      { shipStats: heavyTank },
    ).telemetry;
    expect(tankCombat.hullIntegrity).toBeGreaterThan(fastCombat.hullIntegrity);

    // No FTL core falls back to sublight relativistic cruise rather than superluminal
    const noFtlWarp = stepMission(
      { ...createInitialMissionTelemetry(), state: 'warp', progress: 0.5 },
      0.1,
      { shipStats: heavyTank },
    ).telemetry;
    expect(noFtlWarp.velocityKms).toBeLessThan(500);
    expect(noFtlWarp.subPhaseLabel).toContain('No FTL');

    // High firepower neutralizes a hostile interceptor at 80% progress milestone
    const highFpEnd = stepMission(
      { ...createInitialMissionTelemetry(), state: 'combat', progress: 0.78, activeThreats: 3, hullIntegrity: 0.9 },
      0.5,
      { shipStats: heavyTank },
    ).telemetry;
    expect(highFpEnd.activeThreats).toBeLessThan(3);
  });
});
