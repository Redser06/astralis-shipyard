/**
 * Domain types.
 *
 * This module — and everything else under `src/domain` — must never import
 * `three`. That constraint is load-bearing: it is what lets stats, unlock
 * gating and wear determinism be unit-tested without a GPU or a canvas.
 */

export type ArchetypeId =
  | 'angular_stealth'
  | 'industrial_expanse'
  | 'brutalist_dreadnought'
  | 'outrigger_science'
  | 'aerodynamic_sleek';

export type SublightId = 'ion_pulse' | 'mpd_thruster' | 'fusion_torch';
export type FtlId = 'none' | 'hyper_shunt' | 'alcubierre_ring' | 'graviton_singularity';
export type WeaponId =
  | 'gauss_cannons'
  | 'plasma_lance'
  | 'quantum_torpedoes'
  | 'tachyon_disruptor';
export type SensorId = 'radar_dome' | 'ladar_array' | 'tachyon_scanner';
export type FuelId = 'cryo_h2' | 'd_he3_bottles' | 'antimatter_pods' | 'zero_point_core';
export type MaterialId =
  | 'duranium'
  | 'carbon_nanotube'
  | 'titanium_aerogel'
  | 'chronium_cloak';

export type TechId = SublightId | FtlId | WeaponId | SensorId | FuelId | MaterialId;

export type ComponentCategory =
  | 'sublight'
  | 'ftl'
  | 'weapons'
  | 'sensors'
  | 'fuel'
  | 'material';

export type Tier = 1 | 2 | 3 | 4;

/** Shared shape across every catalogue entry. */
export interface CatalogueEntry {
  id: TechId;
  name: string;
  tier: Tier;
  desc: string;
}

export interface SublightSpec extends CatalogueEntry {
  id: SublightId;
  thrust: number;
  efficiency: number;
  mass: number;
}

export interface FtlSpec extends CatalogueEntry {
  id: FtlId;
  jumpRange: number;
  powerDraw: number;
  mass: number;
}

export interface WeaponSpec extends CatalogueEntry {
  id: WeaponId;
  type: 'Kinetic' | 'Energy' | 'Ordnance';
  damage: number;
  rate: number;
  heat: number;
}

export interface SensorSpec extends CatalogueEntry {
  id: SensorId;
  range: number;
  resolution: number;
}

export interface FuelSpec extends CatalogueEntry {
  id: FuelId;
  capacity: number;
  /** Human-readable volume class — drives how bulky the tank geometry is. */
  size: 'Bulky External' | 'Medium Internal' | 'Compact Core' | 'Micro Core';
  massFactor: number;
}

export interface MaterialSpec extends CatalogueEntry {
  id: MaterialId;
  armor: number;
  weight: number;
  color: string;
  roughness: number;
  metalness: number;
}

/** Per-archetype tuning applied on top of component-derived stats. */
export interface ArchetypeModifiers {
  speed: number;
  armor: number;
  firepower: number;
  stealth: number;
  warp: number;
  /** Structural mass multiplier — a dreadnought carries more hull per metre. */
  massFactor: number;
}

export interface Archetype {
  id: ArchetypeId;
  name: string;
  tag: string;
  desc: string;
  icon: string;
  modifiers: ArchetypeModifiers;
  /**
   * Radius an encircling FTL ring must clear to sit outside the hull and its
   * outboard hardware. Varies enormously — the Outrigger's booms are more than
   * twice as far out as the stealth frigate's chines — which is why a single
   * hardcoded ring size clipped through half the archetypes.
   */
  ringRadius: number;
}

/**
 * A ship. Note there is no `stats` field: stats are *derived* from the
 * component choices by `deriveStats()`. Storing them was how the prototype
 * ended up with numbers that never changed and never displayed.
 */
export interface Blueprint {
  id: string;
  name: string;
  class: string;
  architecture: ArchetypeId;
  sublight: SublightId;
  ftl: FtlId;
  weapons: WeaponId;
  sensors: SensorId;
  fuel: FuelId;
  material: MaterialId;
  accentColor: string;
  /** 0 = factory-fresh parade finish, 1 = derelict hulk. */
  condition: number;
  /** Seeds every stochastic wear decision, so a ship renders identically forever. */
  seed: number;
}

export interface ShipStats {
  speed: number;
  armor: number;
  firepower: number;
  stealth: number;
  warp: number;
}

/* --- Sockets: declared attachment points, replacing hardcoded world coords --- */

export type SocketKind =
  | 'engine'
  | 'radiator'
  | 'sensor'
  | 'weapon'
  | 'rcs'
  | 'ftl'
  | 'fuel';

export type SocketSize = 'S' | 'M' | 'L';

export type Vec3 = readonly [number, number, number];

export interface Socket {
  id: string;
  kind: SocketKind;
  /** Attachment point in hull-local space. */
  position: Vec3;
  /** Outward direction the mounted part faces. */
  normal: Vec3;
  /** Roll reference, so parts do not spin arbitrarily about their normal. */
  up: Vec3;
  size: SocketSize;
  /** When true, an identical socket is generated mirrored across x. */
  mirror?: boolean;
}

/* --- Wear --- */

export interface WearChannels {
  abrasion: number;
  grime: number;
  thermal: number;
  impact: number;
  oxidation: number;
  repair: number;
  structural: number;
}

export interface ConditionPreset {
  id: string;
  name: string;
  /** Inclusive range this preset spans. */
  min: number;
  max: number;
  blurb: string;
}
