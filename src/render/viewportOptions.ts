/**
 * Light-weight viewport option tables.
 *
 * These live apart from Viewport.tsx and Environments.tsx on purpose: the app
 * shell needs the labels to render its controls, and importing them from the
 * component modules would drag three.js, drei and postprocessing into the
 * initial chunk — defeating the lazy load of the render stack.
 */

export type CameraPreset = 'hero' | 'top' | 'side' | 'front' | 'rear';

export const CAMERA_PRESETS: ReadonlyArray<{ id: CameraPreset; label: string }> = [
  { id: 'hero', label: 'Hero' },
  { id: 'front', label: 'Bow' },
  { id: 'side', label: 'Beam' },
  { id: 'top', label: 'Plan' },
  { id: 'rear', label: 'Stern' },
] as const;

export const PRESET_POSITIONS: Record<CameraPreset, [number, number, number]> = {
  hero: [21, 11, 26],
  front: [0, 3, 30],
  side: [30, 3, 0],
  top: [0, 32, 0.01],
  rear: [0, 5, -30],
};

export type EnvironmentId = 'drydock' | 'nebula' | 'asteroid';

export const ENVIRONMENTS: ReadonlyArray<{ id: EnvironmentId; label: string }> = [
  { id: 'drydock', label: 'Orbital Drydock' },
  { id: 'nebula', label: 'Ion Nebula' },
  { id: 'asteroid', label: 'Asteroid Belt' },
] as const;

export interface Protrusions {
  radiators: boolean;
  sensors: boolean;
  rcs: boolean;
}

export type RenderMode = 'pbr' | 'wireframe' | 'xray' | 'thermal';

export const RENDER_MODES: ReadonlyArray<{ id: RenderMode; label: string }> = [
  { id: 'pbr', label: 'Photoreal PBR' },
  { id: 'wireframe', label: 'Holo Wireframe' },
  { id: 'xray', label: 'X-Ray Internal' },
  { id: 'thermal', label: 'Thermal IR' },
] as const;
