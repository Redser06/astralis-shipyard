import type { Blueprint, MissionState } from '../../domain/types';

export interface DrydockStationProps {
  intensity?: number;
  blueprint?: Blueprint;
  missionState?: MissionState | null;
  missionProgress?: number;
}

export function DrydockStation(_props: DrydockStationProps) {
  return null;
}
