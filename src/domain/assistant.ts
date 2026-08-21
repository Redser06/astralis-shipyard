import { HULL_ARCHITECTURES } from './architectures';
import {
  FTL_CORES,
  FUEL_SYSTEMS,
  MATERIALS,
  SENSORS,
  SUBLIGHT_DRIVES,
  WEAPONS,
} from './components';
import { DEFAULT_HULL_PROFILE } from './profile';
import { deriveStats } from './stats';
import { isUnlocked, type ResearchState } from './unlocks';
import type {
  ArchetypeId,
  Blueprint,
  ComponentCategory,
  ShipStats,
} from './types';

/**
 * The design assistant.
 *
 * The prototype shipped an "AI Ship Architect" that was a `setTimeout` over four
 * `String.includes` branches swapping in hardcoded presets. This module is the
 * honest replacement, and it does two jobs:
 *
 *   1. `proposeBlueprint()` — a deterministic rule engine that reads intent from
 *      the prompt and then *optimises against the real stat model*, so its
 *      choices are defensible and its rationale is true. This runs offline and
 *      needs no key.
 *
 *   2. `validateProposal()` — the gate every language-model response passes
 *      through. Model output is untrusted input: anything that is not a known
 *      catalogue id, or that the player has not researched, is rejected and
 *      falls back to the current value.
 *
 * The LLM path lives in `src/services/architect.ts` and calls a server endpoint;
 * the API key never reaches the browser.
 */

export interface DetectedIntent {
  /** Relative emphasis per stat, each in [0, 1]. */
  weights: ShipStats;
  archetypeHint: ArchetypeId | null;
  conditionHint: number | null;
  matchedTerms: string[];
}

export interface RationaleLine {
  category: string;
  choice: string;
  because: string;
}

export interface Proposal {
  blueprint: Blueprint;
  rationale: RationaleLine[];
  detected: DetectedIntent;
  summary: string;
  source: 'model' | 'rules';
  /** Anything the model got wrong that had to be corrected. */
  problems?: string[];
}

/** Nothing is worthless; see detectIntent(). */
const BASELINE_WEIGHT = 0.14;

const ZERO_WEIGHTS: ShipStats = { speed: 0, armor: 0, firepower: 0, stealth: 0, warp: 0 };

interface VocabularyEntry {
  terms: readonly string[];
  weights: Partial<ShipStats>;
  archetype?: ArchetypeId;
  condition?: number;
}

/**
 * Intent vocabulary. Multi-word phrases are matched before single words, so
 * "ghost ship" reads as derelict while "ghost" alone reads as stealth.
 */
const VOCABULARY: readonly VocabularyEntry[] = [
  // --- Condition phrases, checked first ---
  { terms: ['ghost ship', 'derelict', 'hulk', 'abandoned', 'wreck', 'dead in the water'], weights: {}, condition: 0.95 },
  { terms: ['salvage', 'scavenger', 'battered', 'patched', 'jury-rigged', 'junker', 'frontier', 'beaten up'], weights: {}, condition: 0.78 },
  { terms: ['long patrol', 'weathered', 'worn', 'grimy', 'well-used'], weights: {}, condition: 0.52 },
  { terms: ['veteran', 'in service', 'working ship', 'scuffed'], weights: {}, condition: 0.3 },
  { terms: ['pristine', 'parade', 'brand new', 'factory fresh', 'commission', 'showroom', 'mirror finish'], weights: {}, condition: 0.05 },

  // --- Role and archetype ---
  { terms: ['stealth', 'sneak', 'covert', 'silent', 'quiet', 'ghost', 'radar', 'low observable', 'shadow', 'infiltrat'], weights: { stealth: 1, speed: 0.3 }, archetype: 'angular_stealth' },
  { terms: ['hauler', 'cargo', 'freight', 'industrial', 'mining', 'tug', 'workhorse', 'modular', 'truss'], weights: { armor: 0.6, firepower: 0.2 }, archetype: 'industrial_expanse' },
  { terms: ['dreadnought', 'battleship', 'battlecruiser', 'capital', 'warship', 'brutalist', 'siege'], weights: { armor: 1, firepower: 1 }, archetype: 'brutalist_dreadnought' },
  { terms: ['science', 'research', 'survey', 'explorer', 'probe', 'telemetry', 'observatory', 'expedition'], weights: { warp: 1, speed: 0.3 }, archetype: 'outrigger_science' },
  { terms: ['atmospher', 'reentry', 're-entry', 'planetside', 'aerodynamic', 'landing', 'shuttle', 'dropship'], weights: { speed: 0.8 }, archetype: 'aerodynamic_sleek' },

  // --- Qualities ---
  { terms: ['fast', 'quick', 'speed', 'nimble', 'agile', 'interceptor', 'racer', 'swift', 'sprint'], weights: { speed: 1 } },
  { terms: ['armour', 'armor', 'armoured', 'armored', 'tough', 'tank', 'durable', 'heavy', 'brick', 'protect'], weights: { armor: 1 } },
  { terms: ['gun', 'weapon', 'firepower', 'combat', 'battle', 'attack', 'destroy', 'lethal', 'ordnance', 'hard hitting', 'hard-hitting'], weights: { firepower: 1 } },
  { terms: ['warp', 'ftl', 'jump', 'long range', 'long-range', 'deep space', 'far', 'interstellar', 'range'], weights: { warp: 1 } },
  { terms: ['escort', 'patrol', 'picket'], weights: { speed: 0.6, firepower: 0.5 } },
  { terms: ['glass cannon'], weights: { firepower: 1, speed: 0.6, armor: -0.4 } },
];

const normalise = (text: string): string => text.toLowerCase().replace(/\s+/g, ' ').trim();

export function detectIntent(prompt: string): DetectedIntent {
  const text = normalise(prompt);
  const weights: ShipStats = { ...ZERO_WEIGHTS };
  const matchedTerms: string[] = [];
  let archetypeHint: ArchetypeId | null = null;
  let conditionHint: number | null = null;

  for (const entry of VOCABULARY) {
    const hit = entry.terms.find((term) => text.includes(term));
    if (!hit) continue;

    matchedTerms.push(hit);
    for (const [key, value] of Object.entries(entry.weights)) {
      weights[key as keyof ShipStats] += value as number;
    }
    if (entry.archetype && !archetypeHint) archetypeHint = entry.archetype;
    if (entry.condition !== undefined && conditionHint === null) conditionHint = entry.condition;
  }

  // Normalise so a prompt with many terms does not simply outweigh a terse one.
  const peak = Math.max(...Object.values(weights).map(Math.abs), 0);
  if (peak > 0) {
    for (const key of Object.keys(weights) as (keyof ShipStats)[]) {
      weights[key] = weights[key] / peak;
    }
  }

  // Every capability keeps a small baseline value, so the optimiser will not
  // strip a subsystem out entirely to buy a little of something else — which is
  // how a "heavy hauler" ended up proposed with no FTL core at all. Negative
  // weights (a deliberate trade, like "glass cannon") are left alone.
  for (const key of Object.keys(weights) as (keyof ShipStats)[]) {
    if (weights[key] >= 0) weights[key] = Math.max(weights[key], BASELINE_WEIGHT);
  }

  return { weights, archetypeHint, conditionHint, matchedTerms };
}

const score = (stats: ShipStats, weights: ShipStats): number =>
  (Object.keys(stats) as (keyof ShipStats)[]).reduce(
    (total, key) => total + stats[key] * weights[key],
    0,
  );

const CATALOGUE: Record<
  Exclude<ComponentCategory, never>,
  readonly { id: string; name: string }[]
> = {
  sublight: SUBLIGHT_DRIVES,
  ftl: FTL_CORES,
  weapons: WEAPONS,
  sensors: SENSORS,
  fuel: FUEL_SYSTEMS,
  material: MATERIALS,
};

const CATEGORY_LABEL: Record<ComponentCategory, string> = {
  sublight: 'Sublight drive',
  ftl: 'FTL core',
  weapons: 'Armament',
  sensors: 'Sensors',
  fuel: 'Fuel',
  material: 'Hull composite',
};

/** Deterministic hash, so the same prompt always names the same ship. */
function hash(text: string): number {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < text.length; i++) {
    h = (Math.imul(h ^ text.charCodeAt(i), 16777619) >>> 0) || 1;
  }
  return h;
}

const HULL_CODES: Record<ArchetypeId, string> = {
  angular_stealth: 'SF',
  industrial_expanse: 'EX',
  brutalist_dreadnought: 'BC',
  outrigger_science: 'SCI',
  aerodynamic_sleek: 'AR',
};

const NAME_WORDS = [
  'Vantage', 'Kestrel', 'Harrow', 'Meridian', 'Pallas', 'Verdict', 'Lantern',
  'Sable', 'Quarrel', 'Aurora', 'Tessellate', 'Bastion', 'Wayfarer', 'Ember',
  'Solace', 'Rampart', 'Tacit', 'Halcyon',
] as const;

function nameFor(architecture: ArchetypeId, prompt: string): string {
  const h = hash(prompt);
  const word = NAME_WORDS[h % NAME_WORDS.length] as string;
  return `${HULL_CODES[architecture]}-${(h % 90) + 10} ${word}`;
}

/**
 * Rule-based proposal.
 *
 * Chooses greedily per category, but scores each candidate through the real
 * `deriveStats()` — so the rationale it reports is the actual reason the choice
 * won, not a caption written next to a hardcoded answer.
 */
export function proposeBlueprint(
  prompt: string,
  base: Blueprint,
  research: ResearchState,
): Proposal {
  const detected = detectIntent(prompt);
  const hasIntent = detected.matchedTerms.length > 0;

  // With no recognisable intent, keep a balanced brief rather than inventing one.
  const weights: ShipStats = hasIntent
    ? detected.weights
    : { speed: 0.5, armor: 0.5, firepower: 0.5, stealth: 0.4, warp: 0.5 };

  let working: Blueprint = { ...base };

  // Architecture first — it shifts every downstream stat.
  if (detected.archetypeHint) {
    working = { ...working, architecture: detected.archetypeHint };
  } else {
    let best = working.architecture;
    let bestScore = -Infinity;
    for (const arch of HULL_ARCHITECTURES) {
      const candidate = { ...working, architecture: arch.id };
      const value = score(deriveStats(candidate), weights);
      if (value > bestScore) {
        bestScore = value;
        best = arch.id;
      }
    }
    working = { ...working, architecture: best };
  }

  if (detected.conditionHint !== null) {
    working = { ...working, condition: detected.conditionHint };
  }

  const rationale: RationaleLine[] = [];
  const archetype = HULL_ARCHITECTURES.find((a) => a.id === working.architecture);
  rationale.push({
    category: 'Architecture',
    choice: archetype?.name ?? working.architecture,
    because: detected.archetypeHint
      ? 'Named directly in the brief.'
      : 'Scored highest against the requested balance of characteristics.',
  });

  // Then each component category, scored through the real stat model.
  for (const category of Object.keys(CATALOGUE) as ComponentCategory[]) {
    const options = CATALOGUE[category].filter((option) => isUnlocked(option.id, research));
    if (options.length === 0) continue;

    let best = working[category] as string;
    let bestScore = -Infinity;
    for (const option of options) {
      const candidate = { ...working, [category]: option.id } as Blueprint;
      const value = score(deriveStats(candidate), weights);
      if (value > bestScore) {
        bestScore = value;
        best = option.id;
      }
    }
    working = { ...working, [category]: best } as Blueprint;

    const chosen = options.find((option) => option.id === best);
    rationale.push({
      category: CATEGORY_LABEL[category],
      choice: chosen?.name ?? best,
      because: describeChoice(category, weights),
    });
  }

  const archetypeForName = HULL_ARCHITECTURES.find((a) => a.id === working.architecture);
  working = {
    ...working,
    id: `assist-${hash(prompt).toString(16)}`,
    name: nameFor(working.architecture, prompt),
    // Inheriting the previous ship's class left "Stealth Frigate" printed over
    // a hull that was nothing of the sort.
    class: archetypeForName?.name ?? working.class,
    seed: hash(prompt),
  };

  return {
    blueprint: working,
    rationale,
    detected,
    source: 'rules',
    summary: hasIntent
      ? `Optimised for ${describeEmphasis(weights)}.`
      : 'No specific requirements detected, so this is a balanced general-purpose fit.',
  };
}

function describeEmphasis(weights: ShipStats): string {
  const ranked = (Object.keys(weights) as (keyof ShipStats)[])
    .filter((key) => weights[key] > 0.25)
    .sort((a, b) => weights[b] - weights[a])
    .slice(0, 3);
  if (ranked.length === 0) return 'an even spread of characteristics';
  const labels: Record<keyof ShipStats, string> = {
    speed: 'sublight speed',
    armor: 'armour',
    firepower: 'firepower',
    stealth: 'stealth',
    warp: 'warp range',
  };
  return ranked.map((key) => labels[key]).join(', ');
}

function describeChoice(category: ComponentCategory, weights: ShipStats): string {
  switch (category) {
    case 'sublight':
      return weights.speed > 0.5
        ? 'Best thrust-to-weight for the requested speed.'
        : 'Balanced against the mass budget.';
    case 'ftl':
      return weights.warp > 0.5
        ? 'Longest jump range available to you.'
        : 'Adequate range without the mass penalty.';
    case 'weapons':
      return weights.firepower > 0.5
        ? 'Highest weighted damage of the unlocked options.'
        : 'Enough to defend itself without the heat signature.';
    case 'sensors':
      return 'Best resolution available at this tier.';
    case 'fuel':
      return weights.stealth > 0.5 || weights.speed > 0.5
        ? 'Compact containment — less mass and a smaller silhouette.'
        : 'Capacity favoured over volume.';
    case 'material':
      return weights.armor > 0.5
        ? 'Highest armour rating you have researched.'
        : 'Best strength-to-weight for the profile.';
  }
}

/* --------------------------- Validation --------------------------- */

const VALID_IDS: Record<ComponentCategory, ReadonlySet<string>> = {
  sublight: new Set(SUBLIGHT_DRIVES.map((entry) => entry.id)),
  ftl: new Set(FTL_CORES.map((entry) => entry.id)),
  weapons: new Set(WEAPONS.map((entry) => entry.id)),
  sensors: new Set(SENSORS.map((entry) => entry.id)),
  fuel: new Set(FUEL_SYSTEMS.map((entry) => entry.id)),
  material: new Set(MATERIALS.map((entry) => entry.id)),
};

const VALID_ARCHETYPES = new Set(HULL_ARCHITECTURES.map((entry) => entry.id));

export interface ValidationResult {
  blueprint: Blueprint;
  problems: string[];
}

/**
 * Coerce an arbitrary object — typically a language model's tool call — into a
 * blueprint we are willing to render.
 *
 * Never throws. Every field that fails validation falls back to the current
 * value and is reported, so a confused model degrades into "kept what you had"
 * rather than a crash or, worse, a silently invalid ship.
 */
export function validateProposal(
  raw: unknown,
  base: Blueprint,
  research: ResearchState,
): ValidationResult {
  const problems: string[] = [];
  const input = (typeof raw === 'object' && raw !== null ? raw : {}) as Record<string, unknown>;
  const blueprint: Blueprint = { ...base };

  const architecture = input.architecture;
  if (typeof architecture === 'string' && VALID_ARCHETYPES.has(architecture as ArchetypeId)) {
    blueprint.architecture = architecture as ArchetypeId;
  } else if (architecture !== undefined) {
    problems.push(`Unknown architecture "${String(architecture)}" — kept ${base.architecture}.`);
  }

  for (const category of Object.keys(VALID_IDS) as ComponentCategory[]) {
    const value = input[category];
    if (value === undefined) continue;

    if (typeof value !== 'string' || !VALID_IDS[category].has(value)) {
      problems.push(`Unknown ${CATEGORY_LABEL[category].toLowerCase()} "${String(value)}".`);
      continue;
    }
    if (!isUnlocked(value, research)) {
      problems.push(`${CATEGORY_LABEL[category]} "${value}" is not researched yet.`);
      continue;
    }
    (blueprint as unknown as Record<string, unknown>)[category] = value;
  }

  const condition = input.condition;
  if (typeof condition === 'number' && Number.isFinite(condition)) {
    blueprint.condition = Math.min(1, Math.max(0, condition));
  } else if (condition !== undefined) {
    problems.push('Condition was not a number between 0 and 1.');
  }

  if (typeof input.name === 'string' && input.name.trim()) {
    blueprint.name = input.name.trim().slice(0, 60);
  }
  if (typeof input.class === 'string' && input.class.trim()) {
    blueprint.class = input.class.trim().slice(0, 60);
  }
  if (typeof input.accentColor === 'string' && /^#[0-9a-fA-F]{6}$/.test(input.accentColor)) {
    blueprint.accentColor = input.accentColor;
  }

  blueprint.seed = base.seed;
  blueprint.hullProfile = base.hullProfile ?? DEFAULT_HULL_PROFILE;

  return { blueprint, problems };
}
