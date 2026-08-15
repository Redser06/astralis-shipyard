import type {
  FtlSpec,
  FuelSpec,
  MaterialSpec,
  SensorSpec,
  SublightSpec,
  WeaponSpec,
} from './types';

/**
 * The component catalogue, carried over verbatim from the prototype.
 *
 * Every numeric field here now feeds `deriveStats()`. In the prototype these
 * were decorative — `damage`, `armor`, `massFactor` and friends were displayed
 * as flavour text and consumed by nothing.
 */
export const SUBLIGHT_DRIVES: readonly SublightSpec[] = [
  {
    id: 'ion_pulse',
    name: 'Ion Pulse Drive Mk-I',
    tier: 1,
    thrust: 140,
    efficiency: 95,
    mass: 18,
    desc: 'High specific impulse xenon drive with steady cyan ion trail.',
  },
  {
    id: 'mpd_thruster',
    name: 'Magnetoplasmadynamic Torch',
    tier: 2,
    thrust: 320,
    efficiency: 82,
    mass: 28,
    desc: 'Electromagnetic lorentz-force plasma accelerator.',
  },
  {
    id: 'fusion_torch',
    name: 'Thermonuclear Fusion Torch',
    tier: 3,
    thrust: 780,
    efficiency: 70,
    mass: 45,
    desc: 'Direct D-He3 fusion reaction exhaust with raw impulse.',
  },
] as const;

export const FTL_CORES: readonly FtlSpec[] = [
  {
    id: 'none',
    name: 'Sublight Only (No FTL)',
    tier: 1,
    jumpRange: 0,
    powerDraw: 0,
    mass: 0,
    desc: 'Standard system-bound configuration.',
  },
  {
    id: 'hyper_shunt',
    name: 'Hyperspace Shunt Core',
    tier: 2,
    jumpRange: 8.5,
    powerDraw: 45,
    mass: 35,
    desc: 'Jumps through subspace beacon corridors.',
  },
  {
    id: 'alcubierre_ring',
    name: 'Alcubierre Spacetime Warp Ring',
    tier: 3,
    jumpRange: 32.0,
    powerDraw: 85,
    mass: 65,
    desc: 'Smooth toroidal ring bending spacetime around hull without inertial dilation.',
  },
  {
    id: 'graviton_singularity',
    name: 'Graviton Fold Engine',
    tier: 4,
    jumpRange: 95.0,
    powerDraw: 140,
    mass: 90,
    desc: 'Instantaneous spatial translation via micro-singularity manifold.',
  },
] as const;

export const WEAPONS: readonly WeaponSpec[] = [
  {
    id: 'gauss_cannons',
    name: 'Twin Gauss Railguns',
    type: 'Kinetic',
    tier: 1,
    damage: 180,
    rate: 85,
    heat: 35,
    desc: 'Magnetic coil accelerates solid depleted-uranium slugs.',
  },
  {
    id: 'plasma_lance',
    name: 'Coherent Plasma Lance',
    type: 'Energy',
    tier: 2,
    damage: 340,
    rate: 50,
    heat: 65,
    desc: 'Superheated magnetic flux beam melting armored plating.',
  },
  {
    id: 'quantum_torpedoes',
    name: 'Quantum Singularity Torpedoes',
    type: 'Ordnance',
    tier: 3,
    damage: 620,
    rate: 25,
    heat: 40,
    desc: 'Micro-collapsar warheads delivering localized gravitational crushing.',
  },
  {
    id: 'tachyon_disruptor',
    name: 'Tachyon Beam Disruptor',
    type: 'Energy',
    tier: 4,
    damage: 890,
    rate: 70,
    heat: 90,
    desc: 'Sub-atomic superluminal particle stream bypassing kinetic shields.',
  },
] as const;

export const SENSORS: readonly SensorSpec[] = [
  {
    id: 'radar_dome',
    name: 'Pulse-Doppler Radar Dome',
    tier: 1,
    range: 450,
    resolution: 60,
    desc: 'Basic orbital RF transceiver dome.',
  },
  {
    id: 'ladar_array',
    name: 'Deep Space Coherent LADAR Spine',
    tier: 2,
    range: 1200,
    resolution: 92,
    desc: 'Multi-wavelength laser telemetry for stealth craft tracking.',
  },
  {
    id: 'tachyon_scanner',
    name: 'Tachyon Spacetime Scanner',
    tier: 3,
    range: 4800,
    resolution: 98,
    desc: 'Detects superluminal hyperspace wakes and warp distortions.',
  },
] as const;

export const FUEL_SYSTEMS: readonly FuelSpec[] = [
  {
    id: 'cryo_h2',
    name: 'Cryogenic Liquid H2 Bulk Tanks',
    tier: 1,
    capacity: 4000,
    size: 'Bulky External',
    massFactor: 1.4,
    desc: 'Large starter pressurized tanks occupying significant volume.',
  },
  {
    id: 'd_he3_bottles',
    name: 'Deuterium-He3 Magnetic Bottles',
    tier: 2,
    capacity: 8500,
    size: 'Medium Internal',
    massFactor: 1.1,
    desc: 'Pressurized magnetic confinement with improved density.',
  },
  {
    id: 'antimatter_pods',
    name: 'Matter-Antimatter Pods',
    tier: 3,
    capacity: 22000,
    size: 'Compact Core',
    massFactor: 0.7,
    desc: 'Penning-trap containment providing extreme energy density.',
  },
  {
    id: 'zero_point_core',
    name: 'Zero-Point Micro-Singularity',
    tier: 4,
    capacity: 99999,
    size: 'Micro Core',
    massFactor: 0.25,
    desc: 'Taps quantum vacuum fluctuations for near-limitless endurance.',
  },
] as const;

export const MATERIALS: readonly MaterialSpec[] = [
  {
    id: 'duranium',
    name: 'Reinforced Duranium-3 Plating',
    tier: 1,
    armor: 250,
    weight: 1.3,
    color: '#475569',
    roughness: 0.35,
    metalness: 0.85,
    desc: 'Workhorse rolled alloy plate. Heavy, cheap, forgiving.',
  },
  {
    id: 'carbon_nanotube',
    name: 'Carbon-Nanotube Weave',
    tier: 2,
    armor: 480,
    weight: 0.9,
    color: '#1E293B',
    roughness: 0.18,
    metalness: 0.92,
    desc: 'Woven filament laminate with excellent strength-to-weight.',
  },
  {
    id: 'titanium_aerogel',
    name: 'Titanium-Aerogel Matrix',
    tier: 3,
    armor: 720,
    weight: 0.7,
    color: '#94A3B8',
    roughness: 0.12,
    metalness: 0.96,
    desc: 'Foamed metal lattice combining rigidity with very low density.',
  },
  {
    id: 'chronium_cloak',
    name: 'Chronium Metamaterial Lattice',
    tier: 4,
    armor: 1150,
    weight: 0.55,
    color: '#0284C7',
    roughness: 0.04,
    metalness: 1.0,
    desc: 'Engineered negative-index lattice that bends incident radiation.',
  },
] as const;

export const COMPONENT_DATABASE = {
  sublight: SUBLIGHT_DRIVES,
  ftl: FTL_CORES,
  weapons: WEAPONS,
  sensors: SENSORS,
  fuel: FUEL_SYSTEMS,
  material: MATERIALS,
} as const;

/** Narrow lookup helpers. Each throws on an unknown id rather than silently
 *  falling back to index 0 — the prototype's `|| [0]` fallbacks hid typos. */
function lookup<T extends { id: string }>(list: readonly T[], id: string, label: string): T {
  const found = list.find((entry) => entry.id === id);
  if (!found) throw new Error(`Unknown ${label}: ${id}`);
  return found;
}

export const getSublight = (id: string) => lookup(SUBLIGHT_DRIVES, id, 'sublight drive');
export const getFtl = (id: string) => lookup(FTL_CORES, id, 'FTL core');
export const getWeapon = (id: string) => lookup(WEAPONS, id, 'weapon');
export const getSensor = (id: string) => lookup(SENSORS, id, 'sensor');
export const getFuel = (id: string) => lookup(FUEL_SYSTEMS, id, 'fuel system');
export const getMaterial = (id: string) => lookup(MATERIALS, id, 'material');
