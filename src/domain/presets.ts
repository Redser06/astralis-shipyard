import type { Blueprint } from './types';

/**
 * Preconfigured ships.
 *
 * The prototype's hand-written `stats` blocks are deliberately absent — stats
 * are now derived from the components by `deriveStats()`. Each preset gains a
 * `condition` and a `seed` so the wear system has something to work from.
 */
export const SHIP_PRESETS: readonly Blueprint[] = [
  {
    id: 'stealth_frigate',
    name: 'SF-44 Phantom Knife',
    class: 'Stealth Frigate',
    architecture: 'angular_stealth',
    sublight: 'mpd_thruster',
    ftl: 'alcubierre_ring',
    weapons: 'plasma_lance',
    sensors: 'ladar_array',
    fuel: 'antimatter_pods',
    material: 'carbon_nanotube',
    accentColor: '#38BDF8',
    condition: 0.12,
    seed: 0x5f44a1,
  },
  {
    id: 'expanse_hauler',
    name: 'EX-9 Rocinante Heavy Rig',
    class: 'Industrial Zero-G Gunship',
    architecture: 'industrial_expanse',
    sublight: 'fusion_torch',
    ftl: 'hyper_shunt',
    weapons: 'gauss_cannons',
    sensors: 'tachyon_scanner',
    fuel: 'd_he3_bottles',
    material: 'duranium',
    accentColor: '#F59E0B',
    // A working hauler, not a showpiece.
    condition: 0.62,
    seed: 0xe9c0de,
  },
  {
    id: 'leviathan_cruiser',
    name: 'BC-99 Leviathan Dreadnought',
    class: 'Heavy Battlecruiser',
    architecture: 'brutalist_dreadnought',
    sublight: 'fusion_torch',
    ftl: 'graviton_singularity',
    weapons: 'quantum_torpedoes',
    sensors: 'tachyon_scanner',
    fuel: 'zero_point_core',
    material: 'titanium_aerogel',
    accentColor: '#F43F5E',
    condition: 0.28,
    seed: 0xbc99de,
  },
  {
    id: 'helios_science',
    name: 'SCI-7 Horizon Explorer',
    class: 'Long-Range Science Cruiser',
    architecture: 'outrigger_science',
    sublight: 'ion_pulse',
    ftl: 'alcubierre_ring',
    weapons: 'tachyon_disruptor',
    sensors: 'tachyon_scanner',
    fuel: 'zero_point_core',
    material: 'chronium_cloak',
    accentColor: '#10B981',
    condition: 0.05,
    seed: 0x5c1707,
  },
];

export const DEFAULT_BLUEPRINT: Blueprint = SHIP_PRESETS[0] as Blueprint;
