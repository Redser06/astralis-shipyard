import { describe, expect, it } from 'vitest';
import {
  createInitialMissionTelemetry,
  stepMission,
  runSimulatedSorties,
  MIN_HULL_INTEGRITY,
  MAX_HULL_INTEGRITY,
  MISSION_SEQUENCE,
} from './missionLoop';

describe('missionLoop engine', () => {
  it('initializes in docked state with 100% integrity', () => {
    const telemetry = createInitialMissionTelemetry();
    expect(telemetry.state).toBe('docked');
    expect(telemetry.hullIntegrity).toBe(1.0);
    expect(telemetry.progress).toBe(0.0);
    expect(telemetry.activeThreats).toBe(0);
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

    // Apply massive damage (1000 dps)
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
});
