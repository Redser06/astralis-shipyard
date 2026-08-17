import type { SocketKind, SocketSize, Vec3, WeaponId, WearChannels } from './types';

/**
 * The bolt-on component registry.
 *
 * WHY THIS EXISTS. Hardware used to be a `switch` in `render/parts/Parts.tsx`:
 * every new weapon meant a new `case`, a new hand-built cluster of JSX meshes,
 * and a new opportunity to forget the authoring convention. Four of the six
 * pickers once produced no geometry at all, and the ones that did disagreed
 * about where their mounting face was. Adding a component should be a data
 * change, so here the *shape* of a component is data: a recipe list that the
 * renderer executes. `render/parts/Fitting.tsx` is the only code that knows how
 * to turn a recipe into geometry, and it is written once.
 *
 * WHAT LIVES HERE AND WHAT DOES NOT. Definitions only — this module is pure and
 * must never import `three`, which is what lets the invariants below be tested
 * without a GPU:
 *   - every fitting's mounting face is at local y = 0 (`fittingBounds`),
 *   - every pipe run resolves both of its anchors (`fittingIssues`),
 *   - a fitting's declared shape family matches the recipes it actually uses.
 * That last one is not pedantry. The two families are a deliberate design
 * vocabulary: `smooth` parts are revolved or capsular, `blocky` parts are
 * chamfered slabs and greebled panels, and a ship reads as designed rather
 * than as assembled from a parts bin when a component commits to one.
 *
 * WHERE THE STATS LIVE. `components.ts` still owns damage, heat and tier — the
 * numbers that feed `deriveStats()`. This module owns the geometry. They are
 * tied together by `WEAPON_FITTINGS` being a `Record<WeaponId, …>`, so adding a
 * weapon to the catalogue without giving it a shape fails `tsc`, and neither
 * half can be added without the other.
 *
 * AUTHORING CONVENTION, inherited from Parts.tsx and enforced by a test:
 *   a fitting points +Y, with its mounting face at local y = 0. `at` is the
 *   *centre* of a piece, matching three's own primitives, so a 0.4-tall box
 *   sitting on the plate is authored `at: [0, 0.2, 0]`.
 */

/* ------------------------------------------------------------------ */
/* Recipes                                                             */
/* ------------------------------------------------------------------ */

/**
 * How a component is built, visually.
 *
 * `smooth` — lathed, revolved, capsular. Reads as pressed or spun metal.
 * `blocky` — chamfered slabs and greebled panels. Reads as welded plate.
 */
export type ShapeFamily = 'smooth' | 'blocky';

/** A control point of a revolved profile: radius from the +Y axis, height. */
export interface LathePoint {
  r: number;
  y: number;
}

export type Recipe =
  /* --- smooth --- */
  | { kind: 'lathe'; profile: readonly LathePoint[]; segments?: number }
  | { kind: 'capsule'; radius: number; length: number }
  | { kind: 'sphere'; radius: number; /** Fraction of the sphere kept, from the top. */ cap?: number }
  /* --- blocky --- */
  | { kind: 'slab'; size: Vec3; chamfer: number }
  | {
      kind: 'greeble';
      size: Vec3;
      chamfer: number;
      /** Studs per unit of face area. Deterministic from `seed`. */
      density: number;
      seed: number;
    }
  /* --- neutral: barrels, rings, crystals, plumbing --- */
  | { kind: 'cylinder'; radiusTop: number; radiusBottom: number; height: number; sides?: number }
  | { kind: 'torus'; radius: number; tube: number; sides?: number }
  | { kind: 'crystal'; shape: 'octahedron' | 'icosahedron' | 'tetrahedron'; radius: number; detail?: number }
  /**
   * A pipe run between two anchors — a first-class component, not decoration.
   * Endpoints are anchor names (or literal points), so moving the thing a pipe
   * feeds moves the pipe. `bow` is how far the run bellies out sideways, which
   * is what makes it read as routed plumbing rather than as a strut.
   */
  | { kind: 'pipe'; from: string | Vec3; to: string | Vec3; radius: number; bow?: number };

/** Which family a recipe belongs to. `null` means it suits either. */
export function recipeFamily(recipe: Recipe): ShapeFamily | null {
  switch (recipe.kind) {
    case 'lathe':
    case 'capsule':
    case 'sphere':
      return 'smooth';
    case 'slab':
    case 'greeble':
      return 'blocky';
    default:
      return null;
  }
}

/* ------------------------------------------------------------------ */
/* Material hints                                                      */
/* ------------------------------------------------------------------ */

/**
 * Material hints rather than raw PBR numbers, so a component says what a
 * surface *is* and the renderer decides what that looks like in each of the
 * four render modes.
 */
export type MaterialHint =
  | 'structure'
  | 'armour'
  | 'machined'
  | 'dark'
  | 'ceramic'
  | 'plumbing';

export const MATERIAL_HINTS: Readonly<
  Record<MaterialHint, { color: string; roughness: number; metalness: number }>
> = {
  structure: { color: '#334155', roughness: 0.55, metalness: 0.85 },
  armour: { color: '#3f4a5c', roughness: 0.6, metalness: 0.8 },
  machined: { color: '#64748b', roughness: 0.35, metalness: 0.95 },
  dark: { color: '#0f172a', roughness: 0.5, metalness: 0.85 },
  ceramic: { color: '#cbd5e1', roughness: 0.45, metalness: 0.25 },
  plumbing: { color: '#5b6b82', roughness: 0.55, metalness: 0.8 },
};

/** Emissive trim on a piece. Killed outright when the ship is a derelict. */
export interface Glow {
  color: string;
  intensity: number;
}

export interface Piece {
  recipe: Recipe;
  /** Centre of the piece, in the fitting's local frame. Defaults to origin. */
  at?: Vec3;
  /** Euler XYZ, three's default order. */
  rotation?: Vec3;
  material: MaterialHint;
  glow?: Glow;
}

/** Per-channel multipliers on how hard this component weathers. */
export type WearExposure = Partial<Record<keyof WearChannels, number>>;

export interface FittingDef {
  id: string;
  name: string;
  /** The socket kind this component may be fitted to. */
  socket: SocketKind;
  /** Size class — the socket's own size still scales the whole assembly. */
  size: SocketSize;
  family: ShapeFamily;
  /** Radius of the bolt flange at the mount face. */
  flange: number;
  /** Named points other pieces (chiefly pipes) route to. */
  anchors?: Readonly<Record<string, Vec3>>;
  pieces: readonly Piece[];
  /**
   * How this component weathers relative to the hull. An engine-adjacent
   * muzzle scorches harder than a sensor mast; a sealed tank stains rather
   * than pits. Multiplies the ship's own wear channels — it never invents
   * wear of its own, so `condition` stays the single source of truth.
   */
  exposure?: WearExposure;
}

/* ------------------------------------------------------------------ */
/* Anchors and pipe routing                                            */
/* ------------------------------------------------------------------ */

export function resolveAnchor(
  point: string | Vec3,
  anchors: Readonly<Record<string, Vec3>> = {},
): Vec3 | null {
  if (typeof point !== 'string') return point;
  return anchors[point] ?? null;
}

/**
 * Control points for a pipe run between two anchors.
 *
 * Pure, so the routing can be tested — that a run starts and ends exactly on
 * its anchors, and that it bellies out in between rather than cutting the
 * corner. The renderer turns these four points into a Catmull-Rom and a tube.
 */
export function pipeRoute(from: Vec3, to: Vec3, bow = 0.14): Vec3[] {
  const along: Vec3 = [to[0] - from[0], to[1] - from[1], to[2] - from[2]];
  // Any consistent perpendicular will do; cross with +Z, falling back to +X
  // for runs that are themselves parallel to +Z.
  let perp: Vec3 = [along[1], -along[0], 0];
  if (perp[0] * perp[0] + perp[1] * perp[1] < 1e-8) {
    perp = [0, along[2], -along[1]];
  }
  const len = Math.hypot(perp[0], perp[1], perp[2]) || 1;
  const offset: Vec3 = [(perp[0] / len) * bow, (perp[1] / len) * bow, (perp[2] / len) * bow];

  const lerp = (t: number): Vec3 => [
    from[0] + along[0] * t + offset[0],
    from[1] + along[1] * t + offset[1],
    from[2] + along[2] * t + offset[2],
  ];

  return [from, lerp(0.33), lerp(0.66), to];
}

/* ------------------------------------------------------------------ */
/* Bounds — the mounting-face invariant                                */
/* ------------------------------------------------------------------ */

export interface Bounds {
  min: Vec3;
  max: Vec3;
}

/** Euler XYZ to a row-major 3x3, matching three's default order. */
function rotationMatrix(e: Vec3): number[] {
  const [x, y, z] = e;
  const cx = Math.cos(x);
  const sx = Math.sin(x);
  const cy = Math.cos(y);
  const sy = Math.sin(y);
  const cz = Math.cos(z);
  const sz = Math.sin(z);
  return [
    cy * cz,
    -cy * sz,
    sy,
    sx * sy * cz + cx * sz,
    -sx * sy * sz + cx * cz,
    -sx * cy,
    -cx * sy * cz + sx * sz,
    cx * sy * sz + sx * cz,
    cx * cy,
  ];
}

const applyMatrix = (m: number[], v: Vec3): Vec3 => [
  (m[0] as number) * v[0] + (m[1] as number) * v[1] + (m[2] as number) * v[2],
  (m[3] as number) * v[0] + (m[4] as number) * v[1] + (m[5] as number) * v[2],
  (m[6] as number) * v[0] + (m[7] as number) * v[1] + (m[8] as number) * v[2],
];

/** Half-extents of a recipe about its own centre, before rotation. */
function recipeHalfExtents(recipe: Recipe): Vec3 | null {
  switch (recipe.kind) {
    case 'lathe': {
      let maxR = 0;
      let minY = Infinity;
      let maxY = -Infinity;
      for (const point of recipe.profile) {
        maxR = Math.max(maxR, point.r);
        minY = Math.min(minY, point.y);
        maxY = Math.max(maxY, point.y);
      }
      if (!Number.isFinite(minY)) return null;
      // A lathe is authored in absolute local height, not about a centre, so
      // its "centre" is the midpoint of its own span.
      return [maxR, (maxY - minY) / 2, maxR];
    }
    case 'capsule':
      return [recipe.radius, recipe.length / 2 + recipe.radius, recipe.radius];
    case 'sphere':
      return [recipe.radius, recipe.radius, recipe.radius];
    case 'slab':
      return [
        recipe.size[0] / 2 + recipe.chamfer,
        recipe.size[1] / 2,
        recipe.size[2] / 2 + recipe.chamfer,
      ];
    case 'greeble':
      return [
        recipe.size[0] / 2 + recipe.chamfer,
        recipe.size[1] / 2 + GREEBLE_STUD_HEIGHT,
        recipe.size[2] / 2 + recipe.chamfer,
      ];
    case 'cylinder': {
      const r = Math.max(recipe.radiusTop, recipe.radiusBottom);
      return [r, recipe.height / 2, r];
    }
    case 'torus': {
      const r = recipe.radius + recipe.tube;
      return [r, r, recipe.tube];
    }
    case 'crystal':
      return [recipe.radius, recipe.radius, recipe.radius];
    // A pipe is defined by absolute anchors rather than by a centre and a
    // size, so the caller bounds it from its own route.
    case 'pipe':
      return null;
  }
}

/** How far a greeble's studs stand proud of its face. Shared with the renderer. */
export const GREEBLE_STUD_HEIGHT = 0.035;

/** Axis-aligned bounds of a whole fitting, in its own local frame. */
export function fittingBounds(def: FittingDef): Bounds {
  const min: number[] = [Infinity, Infinity, Infinity];
  const max: number[] = [-Infinity, -Infinity, -Infinity];

  const include = (p: Vec3): void => {
    for (let i = 0; i < 3; i++) {
      min[i] = Math.min(min[i] as number, p[i] as number);
      max[i] = Math.max(max[i] as number, p[i] as number);
    }
  };

  // The flange itself sits fractionally into the plate — see MountFlange.
  include([-def.flange, -0.03, -def.flange]);
  include([def.flange, 0.06, def.flange]);

  for (const piece of def.pieces) {
    const at = piece.at ?? [0, 0, 0];

    if (piece.recipe.kind === 'pipe') {
      const from = resolveAnchor(piece.recipe.from, def.anchors);
      const to = resolveAnchor(piece.recipe.to, def.anchors);
      if (!from || !to) continue;
      const r = piece.recipe.radius;
      for (const point of pipeRoute(from, to, piece.recipe.bow)) {
        include([point[0] - r, point[1] - r, point[2] - r]);
        include([point[0] + r, point[1] + r, point[2] + r]);
      }
      continue;
    }

    const half = recipeHalfExtents(piece.recipe);
    if (!half) continue;

    // A lathe's profile is absolute in y, so its box is not centred on `at`.
    let centre: Vec3 = at;
    if (piece.recipe.kind === 'lathe') {
      let minY = Infinity;
      let maxY = -Infinity;
      for (const point of piece.recipe.profile) {
        minY = Math.min(minY, point.y);
        maxY = Math.max(maxY, point.y);
      }
      centre = [at[0], at[1] + (minY + maxY) / 2, at[2]];
    }

    const matrix = piece.rotation ? rotationMatrix(piece.rotation) : null;
    for (const sx of [-1, 1]) {
      for (const sy of [-1, 1]) {
        for (const sz of [-1, 1]) {
          const corner: Vec3 = [sx * half[0], sy * half[1], sz * half[2]];
          const rotated = matrix ? applyMatrix(matrix, corner) : corner;
          include([centre[0] + rotated[0], centre[1] + rotated[1], centre[2] + rotated[2]]);
        }
      }
    }
  }

  return { min: min as unknown as Vec3, max: max as unknown as Vec3 };
}

/**
 * Everything wrong with a definition, as prose. Empty means it is sound.
 *
 * Run over the whole registry by a unit test, so a malformed component is
 * caught by `npm test` rather than by squinting at a screenshot.
 */
export function fittingIssues(def: FittingDef): string[] {
  const problems: string[] = [];

  for (const [i, piece] of def.pieces.entries()) {
    const where = `${def.id} piece ${i} (${piece.recipe.kind})`;

    const family = recipeFamily(piece.recipe);
    if (family && family !== def.family) {
      problems.push(`${where}: ${family} recipe in a ${def.family} component`);
    }

    if (piece.recipe.kind === 'pipe') {
      for (const end of [piece.recipe.from, piece.recipe.to]) {
        if (resolveAnchor(end, def.anchors) === null) {
          problems.push(`${where}: unknown anchor "${String(end)}"`);
        }
      }
    }

    if (piece.recipe.kind === 'lathe') {
      if (piece.recipe.profile.length < 2) problems.push(`${where}: needs two profile points`);
      if (piece.recipe.profile.some((point) => point.r < 0)) {
        problems.push(`${where}: negative radius`);
      }
    }
  }

  if (def.family === 'blocky' && !def.pieces.some((p) => recipeFamily(p.recipe) === 'blocky')) {
    problems.push(`${def.id}: declared blocky but uses no slab or greebled panel`);
  }
  if (def.family === 'smooth' && !def.pieces.some((p) => recipeFamily(p.recipe) === 'smooth')) {
    problems.push(`${def.id}: declared smooth but revolves nothing`);
  }

  const bounds = fittingBounds(def);
  if (bounds.min[1] < -0.05) {
    problems.push(
      `${def.id}: reaches ${bounds.min[1].toFixed(2)} below its mounting face — it will sink into the hull`,
    );
  }

  return problems;
}

/* ------------------------------------------------------------------ */
/* The weapon registry                                                 */
/* ------------------------------------------------------------------ */

/** Every turret shares a barbette; it is the ring the mount bolts through. */
const barbette = (radius = 0.5, height = 0.34): Piece => ({
  recipe: { kind: 'cylinder', radiusTop: radius * 0.84, radiusBottom: radius, height, sides: 10 },
  at: [0, height / 2 + 0.06, 0],
  material: 'structure',
});

/**
 * Turret hardware.
 *
 * Typed as a total record over `WeaponId`, so the catalogue and the registry
 * cannot drift: adding an id to `WeaponId` without a shape here is a type
 * error, and a shape with no catalogue entry has nothing to select it.
 */
export const WEAPON_FITTINGS: Readonly<Record<WeaponId, FittingDef>> = {
  /* --- kinetic, tier 1: the workhorse pair of railguns --- */
  gauss_cannons: {
    id: 'gauss_cannons',
    name: 'Twin Gauss Railguns',
    socket: 'weapon',
    size: 'M',
    family: 'blocky',
    flange: 0.56,
    anchors: {
      feed: [0.24, 0.04, 0.26],
      breech: [0.2, 0.56, 0.3],
    },
    exposure: { thermal: 1.4, abrasion: 1.3 },
    pieces: [
      barbette(),
      // Welded receiver box between the barbette and the barrels.
      {
        recipe: { kind: 'slab', size: [0.66, 0.34, 0.78], chamfer: 0.05 },
        at: [0, 0.57, 0],
        material: 'armour',
      },
      ...[-0.16, 0.16].map(
        (x): Piece => ({
          recipe: { kind: 'cylinder', radiusTop: 0.075, radiusBottom: 0.09, height: 1.4 },
          at: [x, 0.95, 0],
          material: 'machined',
        }),
      ),
      { recipe: { kind: 'pipe', from: 'feed', to: 'breech', radius: 0.035 }, material: 'plumbing' },
    ],
  },

  /* --- energy, tier 2 --- */
  plasma_lance: {
    id: 'plasma_lance',
    name: 'Coherent Plasma Lance',
    socket: 'weapon',
    size: 'M',
    family: 'smooth',
    flange: 0.56,
    anchors: {
      feed: [0.26, 0.04, 0.2],
      collar: [0.19, 0.95, 0.06],
    },
    exposure: { thermal: 1.8 },
    pieces: [
      barbette(),
      // A spun focusing barrel: waisted at the breech, belled at the muzzle.
      {
        recipe: {
          kind: 'lathe',
          profile: [
            { r: 0.02, y: 0.38 },
            { r: 0.2, y: 0.45 },
            { r: 0.17, y: 0.72 },
            { r: 0.125, y: 1.6 },
            { r: 0.115, y: 2.02 },
            { r: 0.165, y: 2.16 },
            { r: 0.12, y: 2.24 },
          ],
          segments: 16,
        },
        material: 'machined',
      },
      {
        recipe: { kind: 'sphere', radius: 0.13 },
        at: [0, 2.3, 0],
        material: 'dark',
        glow: { color: '#38bdf8', intensity: 3 },
      },
      { recipe: { kind: 'pipe', from: 'feed', to: 'collar', radius: 0.035 }, material: 'plumbing' },
    ],
  },

  /* --- ordnance, tier 3 --- */
  quantum_torpedoes: {
    id: 'quantum_torpedoes',
    name: 'Quantum Singularity Torpedoes',
    socket: 'weapon',
    size: 'M',
    family: 'blocky',
    flange: 0.56,
    anchors: {
      magazine: [0.34, 0.16, -0.36],
      loader: [0.3, 0.72, -0.44],
    },
    exposure: { impact: 1.3 },
    pieces: [
      barbette(),
      {
        recipe: { kind: 'greeble', size: [0.9, 0.62, 1.0], chamfer: 0.05, density: 5, seed: 0x51ce },
        at: [0, 0.82, 0],
        material: 'armour',
      },
      ...[
        [-0.24, 0.24],
        [0.24, 0.24],
        [-0.24, -0.24],
        [0.24, -0.24],
      ].map(
        ([x, z]): Piece => ({
          recipe: { kind: 'cylinder', radiusTop: 0.11, radiusBottom: 0.11, height: 0.14 },
          at: [x as number, 1.15, z as number],
          rotation: [Math.PI / 2, 0, 0],
          material: 'dark',
          glow: { color: '#c084fc', intensity: 2.2 },
        }),
      ),
      { recipe: { kind: 'pipe', from: 'magazine', to: 'loader', radius: 0.04 }, material: 'plumbing' },
    ],
  },

  /* --- energy, tier 4 --- */
  tachyon_disruptor: {
    id: 'tachyon_disruptor',
    name: 'Tachyon Beam Disruptor',
    socket: 'weapon',
    size: 'M',
    family: 'smooth',
    flange: 0.56,
    exposure: { thermal: 1.6, oxidation: 0.6 },
    pieces: [
      barbette(),
      {
        recipe: {
          kind: 'lathe',
          profile: [
            { r: 0.02, y: 0.4 },
            { r: 0.22, y: 0.44 },
            { r: 0.19, y: 0.62 },
            { r: 0.16, y: 0.82 },
          ],
          segments: 14,
        },
        material: 'armour',
      },
      {
        recipe: { kind: 'crystal', shape: 'octahedron', radius: 0.46 },
        at: [0, 1.15, 0],
        material: 'dark',
        glow: { color: '#f43f5e', intensity: 2.4 },
      },
      ...[0, 1, 2].map(
        (i): Piece => ({
          recipe: { kind: 'torus', radius: 0.6, tube: 0.03, sides: 20 },
          at: [0, 1.15, 0],
          rotation: [0, (i * Math.PI) / 3, 0],
          material: 'dark',
          glow: { color: '#fb7185', intensity: 1.6 },
        }),
      ),
    ],
  },

  /* ---------------------------------------------------------------- */
  /* New in R2. These three exist to prove the mechanism: each is a    */
  /* data change and nothing else, and between them they exercise both */
  /* shape families and anchor-routed plumbing.                        */
  /* ---------------------------------------------------------------- */

  /** Tier 1 kinetic, smooth: a spun cowling over a rotary barrel cluster. */
  autocannon_pod: {
    id: 'autocannon_pod',
    name: 'Rotary Autocannon Pod',
    socket: 'weapon',
    size: 'M',
    family: 'smooth',
    flange: 0.5,
    anchors: {
      feed: [0.22, 0.04, 0.18],
      drum: [0.16, 0.44, -0.4],
      breech: [0.1, 0.72, -0.1],
    },
    exposure: { thermal: 1.5, abrasion: 1.6, grime: 1.3 },
    pieces: [
      barbette(0.44, 0.28),
      // Spun cowling — the revolved profile is the whole point of the family.
      {
        recipe: {
          kind: 'lathe',
          profile: [
            { r: 0.06, y: 0.3 },
            { r: 0.34, y: 0.4 },
            { r: 0.34, y: 0.98 },
            { r: 0.3, y: 1.16 },
            { r: 0.26, y: 1.2 },
            { r: 0.22, y: 1.22 },
          ],
          segments: 18,
        },
        material: 'machined',
      },
      // Ammunition drum, slung across the pod's back.
      {
        recipe: { kind: 'capsule', radius: 0.21, length: 0.42 },
        at: [0, 0.52, -0.42],
        rotation: [0, 0, Math.PI / 2],
        material: 'structure',
      },
      // Three barrels on a rotary head, standing proud of the cowling.
      ...[0, 1, 2].map((i): Piece => {
        const angle = (i * Math.PI * 2) / 3;
        return {
          recipe: { kind: 'cylinder', radiusTop: 0.045, radiusBottom: 0.055, height: 1.5 },
          at: [Math.cos(angle) * 0.13, 0.98, Math.sin(angle) * 0.13],
          material: 'machined',
        };
      }),
      {
        recipe: { kind: 'torus', radius: 0.2, tube: 0.035, sides: 14 },
        at: [0, 1.62, 0],
        rotation: [Math.PI / 2, 0, 0],
        material: 'dark',
      },
      { recipe: { kind: 'pipe', from: 'feed', to: 'drum', radius: 0.035 }, material: 'plumbing' },
      { recipe: { kind: 'pipe', from: 'drum', to: 'breech', radius: 0.03, bow: 0.08 }, material: 'plumbing' },
    ],
  },

  /** Tier 2 kinetic, blocky: four coilgun tubes off a greebled capacitor bank. */
  coil_battery: {
    id: 'coil_battery',
    name: 'Quad Coilgun Battery',
    socket: 'weapon',
    size: 'M',
    family: 'blocky',
    flange: 0.6,
    anchors: {
      capacitor: [0.36, 0.78, -0.44],
      'breech-s': [0.3, 0.66, 0.22],
      'breech-p': [-0.3, 0.66, 0.22],
      bus: [-0.36, 0.14, -0.3],
    },
    exposure: { thermal: 1.5, abrasion: 1.2 },
    pieces: [
      barbette(0.54),
      // Receiver: a chamfered slab, welded plate rather than pressed metal.
      {
        recipe: { kind: 'slab', size: [1.02, 0.44, 0.92], chamfer: 0.07 },
        at: [0, 0.62, 0],
        material: 'armour',
      },
      // Capacitor bank behind the breech, greebled so it reads as machinery.
      {
        recipe: { kind: 'greeble', size: [0.72, 0.34, 0.36], chamfer: 0.04, density: 9, seed: 0xc0117 },
        at: [0, 0.98, -0.42],
        material: 'structure',
      },
      // Four coil tubes.
      ...[
        [-0.19, -0.19],
        [0.19, -0.19],
        [-0.19, 0.19],
        [0.19, 0.19],
      ].map(
        ([x, z]): Piece => ({
          recipe: { kind: 'cylinder', radiusTop: 0.055, radiusBottom: 0.07, height: 1.45 },
          at: [x as number, 1.5, z as number],
          material: 'machined',
        }),
      ),
      // Accelerator coils encircling the cluster: the emissive signature.
      ...[1.06, 1.5, 1.94].map(
        (y): Piece => ({
          recipe: { kind: 'torus', radius: 0.32, tube: 0.05, sides: 18 },
          at: [0, y, 0],
          rotation: [Math.PI / 2, 0, 0],
          material: 'dark',
          glow: { color: '#7dd3fc', intensity: 1.5 },
        }),
      ),
      { recipe: { kind: 'pipe', from: 'bus', to: 'capacitor', radius: 0.04 }, material: 'plumbing' },
      { recipe: { kind: 'pipe', from: 'capacitor', to: 'breech-s', radius: 0.03, bow: 0.1 }, material: 'plumbing' },
      { recipe: { kind: 'pipe', from: 'capacitor', to: 'breech-p', radius: 0.03, bow: 0.1 }, material: 'plumbing' },
    ],
  },

  /** Tier 3 kinetic, blocky: twin rails, a cooling loop, and a long throw. */
  rail_lance: {
    id: 'rail_lance',
    name: 'Mk-VII Heavy Rail Lance',
    socket: 'weapon',
    size: 'M',
    family: 'blocky',
    flange: 0.62,
    anchors: {
      'coolant-in': [0.34, 0.06, -0.22],
      'breech-s': [0.34, 0.72, -0.1],
      'breech-p': [-0.34, 0.72, -0.1],
      'muzzle-s': [0.34, 2.62, -0.1],
      'muzzle-p': [-0.34, 2.62, -0.1],
    },
    exposure: { thermal: 2.0, abrasion: 1.4, impact: 1.2 },
    pieces: [
      barbette(0.58, 0.36),
      // Breech block.
      {
        recipe: { kind: 'greeble', size: [0.86, 0.56, 1.0], chamfer: 0.06, density: 6, seed: 0x7a11 },
        at: [0, 0.7, 0],
        material: 'armour',
      },
      // The rails themselves — two long chamfered slabs.
      ...[-0.26, 0.26].map(
        (x): Piece => ({
          recipe: { kind: 'slab', size: [0.15, 2.1, 0.34], chamfer: 0.03 },
          at: [x, 1.95, 0],
          material: 'machined',
        }),
      ),
      // Armature gap between the rails: where the slug is accelerated. Kept
      // narrow and dim — at full width it read as a lit billboard rather than
      // as the gap between two rails.
      {
        recipe: { kind: 'slab', size: [0.2, 1.86, 0.07], chamfer: 0.01 },
        at: [0, 1.95, 0],
        material: 'dark',
        glow: { color: '#93c5fd', intensity: 0.7 },
      },
      // Muzzle brace, tying the rails together so they do not splay.
      {
        recipe: { kind: 'slab', size: [0.92, 0.16, 0.5], chamfer: 0.04 },
        at: [0, 3.02, 0],
        material: 'structure',
      },
      // Cooling loop: breech to muzzle, one run down each rail. This is the
      // case the pipe recipe exists for — the runs are defined by what they
      // connect, so moving a rail moves its plumbing.
      { recipe: { kind: 'pipe', from: 'coolant-in', to: 'breech-s', radius: 0.035 }, material: 'plumbing' },
      { recipe: { kind: 'pipe', from: 'breech-s', to: 'muzzle-s', radius: 0.03, bow: 0.07 }, material: 'plumbing' },
      { recipe: { kind: 'pipe', from: 'breech-p', to: 'muzzle-p', radius: 0.03, bow: 0.07 }, material: 'plumbing' },
    ],
  },
};

/* ------------------------------------------------------------------ */
/* Other socket kinds                                                  */
/* ------------------------------------------------------------------ */

/**
 * The hyperspace shunt's external housing.
 *
 * The tier-1 FTL used to be a 1.5 × 0.85 × 1.5 box drawn at the FTL socket,
 * which sits on the centreline of every archetype — so fitting it produced no
 * visible geometry at all, and on the Industrial hull its side faces were
 * exactly coplanar with the spine (guaranteed z-fighting). A shunt is a real
 * machine, so it gets a real dorsal housing: mounted on the skin like every
 * other fitting, with its emissive field vents outboard where they can be seen.
 */
export const HYPER_SHUNT_HOUSING: FittingDef = {
  id: 'hyper_shunt',
  name: 'Hyperspace Shunt Core',
  socket: 'ftl',
  size: 'M',
  family: 'blocky',
  flange: 0.5,
  anchors: {
    tap: [0.3, 0.06, 0.6],
    manifold: [0.5, 0.42, 0.2],
  },
  exposure: { thermal: 1.3, grime: 1.2 },
  pieces: [
    {
      recipe: { kind: 'greeble', size: [1.5, 0.62, 2.3], chamfer: 0.1, density: 3, seed: 0x5401 },
      at: [0, 0.31, 0],
      material: 'armour',
    },
    // Field vents down each flank.
    ...[-1, 1].flatMap((side) =>
      [-0.66, 0, 0.66].map(
        (z): Piece => ({
          recipe: { kind: 'slab', size: [0.06, 0.3, 0.44], chamfer: 0.02 },
          at: [side * 0.79, 0.34, z],
          material: 'dark',
          glow: { color: '#38bdf8', intensity: 2.4 },
        }),
      ),
    ),
    // Beacon horn — a shunt jumps between beacon corridors, so it points home.
    {
      recipe: { kind: 'cylinder', radiusTop: 0.16, radiusBottom: 0.07, height: 0.5 },
      at: [0, 0.82, 0.72],
      rotation: [0.5, 0, 0],
      material: 'machined',
    },
    { recipe: { kind: 'pipe', from: 'tap', to: 'manifold', radius: 0.04 }, material: 'plumbing' },
  ],
};

/** Every definition in the registry, for validation and for tooling. */
export const ALL_FITTINGS: readonly FittingDef[] = [
  ...Object.values(WEAPON_FITTINGS),
  HYPER_SHUNT_HOUSING,
];

export function getWeaponFitting(id: WeaponId): FittingDef {
  const found = WEAPON_FITTINGS[id];
  if (!found) throw new Error(`No fitting registered for weapon: ${id}`);
  return found;
}
