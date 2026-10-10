import type { Archetype, ArchetypeId } from './types';

/**
 * The five structural philosophies. Copy is carried over verbatim from the
 * prototype; `modifiers` and `ringRadius` are new — the first makes archetype
 * choice affect the stat readout rather than only the silhouette, the second
 * stops an encircling FTL ring cutting through the hull it surrounds.
 */
export const HULL_ARCHITECTURES: readonly Archetype[] = [
  {
    id: 'angular_stealth',
    name: 'Angular Stealth Frigate',
    tag: 'Chiseled Radar-Deflecting Plates',
    desc: 'Faceted angular geometric armor with razor-sharp chines and low-observability weapon sponsons.',
    icon: 'Shield',
    modifiers: { speed: 6, armor: -5, firepower: 0, stealth: 35, warp: 0, massFactor: 0.9 },
    ringRadius: 2.9,
  },
  {
    id: 'industrial_expanse',
    name: 'Industrial Heavy Modular',
    tag: 'Zero-G Exposed Trusses & Radiators',
    desc: 'Unapologetic space architecture with massive heat radiator fins, structural girders, and outboard engine pods.',
    icon: 'Boxes',
    modifiers: { speed: -8, armor: 10, firepower: 4, stealth: -20, warp: 0, massFactor: 1.25 },
    ringRadius: 4.4,
  },
  {
    id: 'brutalist_dreadnought',
    name: 'Brutalist Battlecruiser',
    tag: 'Armored Citadel & Heavy Prow',
    desc: 'Heavily armored hammerhead prow, elevated command tower, spinal mass-driver trenches, and flanked battery turrets.',
    icon: 'Crosshair',
    modifiers: { speed: -14, armor: 22, firepower: 14, stealth: -28, warp: 0, massFactor: 1.5 },
    ringRadius: 5.2,
  },
  {
    id: 'outrigger_science',
    name: 'Outrigger Long-Range Science',
    tag: 'Twin Boom Spars & Sensor Mast',
    desc: 'Dual outrigger nacelle booms with extensive telemetry arrays, communications dishes, and habitat modules.',
    icon: 'Radio',
    modifiers: { speed: 2, armor: -10, firepower: -8, stealth: 8, warp: 8, massFactor: 1.0 },
    ringRadius: 5.6,
  },
  {
    id: 'aerodynamic_sleek',
    name: 'Aerodynamic Hybrid Cruiser',
    tag: 'Smooth Swept Lathe Profile',
    desc: 'Smooth lofted delta airframe engineered for atmospheric reentry and high-speed orbital interception.',
    icon: 'Rocket',
    modifiers: { speed: 12, armor: -4, firepower: -2, stealth: 10, warp: -4, massFactor: 0.85 },
    ringRadius: 4.4,
  },
  {
    id: 'starfleet_explorer',
    name: 'Federation Heavy Explorer',
    tag: 'Saucer Primary & Dual Outrigger Nacelles',
    desc: 'Elliptical saucer primary hull with swept neck pylon, cylindrical engineering hull, and dual outrigger warp nacelles on angled pylons.',
    icon: 'Radio',
    modifiers: { speed: 4, armor: 6, firepower: 8, stealth: -5, warp: 24, massFactor: 1.15 },
    ringRadius: 6.8,
  },
  {
    id: 'delta_strikefighter',
    name: 'Starfighter Dagger Interceptor',
    tag: 'Sharp Triangular Wedge & Articulated S-Foils',
    desc: 'Sharp triangular wedge hull with chamfered dorsal ridge, recessed canopy, and articulating quad strike wings with wingtip blasters.',
    icon: 'Rocket',
    modifiers: { speed: 22, armor: -8, firepower: 12, stealth: 15, warp: -12, massFactor: 0.65 },
    ringRadius: 3.8,
  },
  {
    id: 'deep_space_cruiser',
    name: 'Hard-SciFi Vertical Kilomaster',
    tag: 'Skyscraper Cylindrical Stack & Fusion Drive',
    desc: 'Tall vertical-stack cylindrical skyscraper hull with counter-rotating hab drum, forward spinal railgun trench, and massive magnetic fusion bell.',
    icon: 'Boxes',
    modifiers: { speed: -4, armor: 26, firepower: 18, stealth: -35, warp: -8, massFactor: 1.6 },
    ringRadius: 5.4,
  },
] as const;

const BY_ID = new Map<ArchetypeId, Archetype>(HULL_ARCHITECTURES.map((a) => [a.id, a]));

export function getArchetype(id: ArchetypeId): Archetype {
  const found = BY_ID.get(id);
  if (!found) throw new Error(`Unknown archetype: ${id}`);
  return found;
}
