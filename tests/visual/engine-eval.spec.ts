import { expect, test, type Page } from '@playwright/test';
import { mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import type { Camera, Object3D, Scene } from 'three';

/**
 * THE ENGINE EVAL HARNESS.
 *
 * The four render requirements are claims about geometry, and a screenshot
 * cannot settle any of them — a hull with a radiator floating two metres off
 * its flank photographs perfectly well from the other side. So this suite
 * measures the scene rather than looking at it: it walks the ship's own scene
 * graph in the page, computes world-space bounds, and asserts against numbers
 * that come out of the same domain modules the renderer consumes.
 *
 *   R1 CONNECTIVITY  every solid mesh touches another solid mesh
 *   R3 WINDOW SAFETY no glazing in a fuel bay, none in a drive's exclusion,
 *                    shrunk or absent by a weapon, and the bridge is the
 *                    biggest aperture on the ship
 *   R4 THRUST        the framebuffer aft of the drives brightens under throttle
 *   R2 DAMAGE        a derelict is marked differently from a parade ship, and
 *                    the same seed puts the same marks in the same places
 *                    across a reload
 *
 * All five archetypes, three condition values each. Nothing here is sampled at
 * one hull and assumed for the rest: four of the five hulls were invisible to
 * the suite until `every archetype composes all four subsystems cleanly`
 * landed, and that is exactly how hardware ends up in vacuum on the hulls
 * nobody screenshots.
 *
 * WHY SOFT ASSERTIONS. `expect.soft` does not weaken a check — a failed soft
 * assertion still fails the test — it stops the first failure hiding the other
 * fourteen. A repair phase needs the whole list, not the first item on it.
 *
 * HOW THE PAGE IS INSTRUMENTED, and why it needs no product code. Three's
 * `WebGLRenderer` announces itself to `window.__THREE_DEVTOOLS__` if one
 * exists, so an init script installs one, wraps `renderer.render`, and keeps
 * the R3F-managed scene and the live camera. Everything else — the R3F store,
 * and through it the camera and the orbit controls — hangs off `scene.__r3f`.
 * Nothing in `src/` knows this suite exists, which is the point: an eval that
 * requires the subject to cooperate is measuring the cooperation.
 */

/* ------------------------------------------------------------------ */
/* Shapes shared with the page                                         */
/* ------------------------------------------------------------------ */

type Vec3T = readonly [number, number, number];

/** The archetype ids, and the labels their Designer buttons carry. */
const ARCHETYPES = [
  { id: 'angular_stealth', label: 'Angular Stealth Frigate' },
  { id: 'industrial_expanse', label: 'Industrial Heavy Modular' },
  { id: 'brutalist_dreadnought', label: 'Brutalist Battlecruiser' },
  { id: 'outrigger_science', label: 'Outrigger Long-Range Science' },
  { id: 'aerodynamic_sleek', label: 'Aerodynamic Hybrid Cruiser' },
] as const;

/**
 * The three points on the wear scale, and what each one is meant to prove.
 *
 * 0.95 is past `DERELICT_THRESHOLD` (0.9) on purpose. A derelict is a different
 * ship in every subsystem — no running lights, no glazing light, cold drives —
 * so it is where a subsystem that only ever ran alive falls over.
 */
const CONDITIONS = [
  { value: 0.05, name: 'pristine' },
  { value: 0.55, name: 'worn' },
  { value: 0.95, name: 'derelict' },
] as const;

/** Where the human-review stills go. */
const SHOT_DIR = '/tmp/astralis-eval';

/**
 * Connectivity tolerance, in world units.
 *
 * The ships span roughly 18–20 units nose to tail, so 0.05 is about a
 * quarter of a percent of the hull — tight enough that a part resting a
 * centimetre off its collar still counts as bolted on, loose enough that two
 * surfaces that meet exactly are not called apart by floating point.
 */
const TOUCH_TOLERANCE = 0.05;

/**
 * What counts as a material rise in exhaust luminance under throttle.
 *
 * Both thresholds are fixed here, before any number came back from the scene:
 * a fifth again as bright, and at least three levels out of 255 so that a
 * proportional rise on an almost-black region cannot pass on rounding.
 */
const THRUST_RELATIVE = 1.2;
const THRUST_ABSOLUTE = 3;

/**
 * A dead drive must stay dead. Same units as above; this is the ceiling a
 * derelict's aft region is allowed to move by when Test Burn is pressed.
 */
const DEAD_DRIVE_CEILING = 3;

/**
 * The framing every comparable sample is taken from — the app's own `hero`
 * preset position, set directly rather than by clicking the preset button.
 *
 * WHY NOT THE BUTTON. `setCameraPreset` is React state, so pressing `Hero`
 * while the preset is already `hero` changes nothing and `CameraRig` never
 * re-aims — which, after a close-up has moved the camera by hand, leaves the
 * next sample framed on a porthole and calls it a hero shot. Setting the
 * camera outright is both deterministic and independent of that.
 */
const HERO_EYE: Vec3T = [21, 11, 26];
const HERO_TARGET: Vec3T = [0, 0, 0];

/** Thresholds lifted from `render.spec.ts` rather than invented here. */
const DAMAGE_DIFFERENCE = 0.03;
const RELOAD_DIFFERENCE = 0.02;

interface SocketLike {
  id: string;
  kind: string;
  position: Vec3T;
  normal: Vec3T;
  up: Vec3T;
  size: 'S' | 'M' | 'L';
}

interface WindowLike {
  id: string;
  class: 'flight_deck' | 'porthole';
  position: Vec3T;
  normal: Vec3T;
  up: Vec3T;
  extent: readonly [number, number];
  panes: number;
  area: number;
}

interface Orphan {
  path: string;
  geometry: string;
  material: string;
  centre: Vec3T;
  size: Vec3T;
  nearest: number;
}

interface ConnectivityReport {
  solids: number;
  /** Every mesh excused from the check, counted by the rule that excused it. */
  exempt: Record<string, number>;
  /** Geometry whose world bounds are not finite. A NaN here is a hard defect. */
  degenerate: string[];
  orphans: Orphan[];
  /** Islands of mutually touching solids. One is the healthy answer. */
  components: number;
  largestComponent: number;
  /** Members of every island that is not the largest. */
  strays: string[];
}

interface WindowViolation {
  window: string;
  socket: string;
  gap: number;
  needed: number;
}

interface WindowReport {
  placements: number;
  portholes: number;
  flightDecks: number;
  /** Windows inside a fuel socket's exclusion. Must be empty. Rule 1. */
  fuelViolations: WindowViolation[];
  /** Windows inside a drive's exclusion. Must be empty. Rule 2. */
  engineViolations: WindowViolation[];
  /** Inside a weapon's exclusion — must be empty. Rule 3, first half. */
  weaponViolations: WindowViolation[];
  /** Inside the blast radius and NOT shrunk. Must be empty. Rule 3, second half. */
  oversizeNearWeapon: Array<{ window: string; socket: string; gap: number; radius: number }>;
  /** Smallest clearance to a fuel socket, as evidence rather than as a pass. */
  minFuelClearance: number | null;
  minEngineClearance: number | null;
  /** The small-size threshold the weapon rule is measured against. */
  smallThreshold: number;
  bridgeArea: number | null;
  largestPortholeArea: number;
  /** Placements with no mesh seated at them in the rendered scene. */
  unrendered: string[];
}

interface Region {
  x: number;
  y: number;
  w: number;
  h: number;
}

interface Luminance {
  mean: number;
  max: number;
}

interface DamagePrint {
  marks: number;
  /** Rounded world centres of every damage decal, sorted. The seed's signature. */
  digest: string;
}

interface EvalApi {
  ready(): boolean;
  identify(): { shipMeshes: number; runnerUpMeshes: number } | null;
  connectivity(tolerance: number): ConnectivityReport | null;
  windows(archetype: string, seed: number): Promise<WindowReport | null>;
  /** Screen-space box aft of the drives, for the thrust measurement. */
  aftRegion(archetype: string, size: number): Promise<Region | null>;
  luminance(region: Region): Luminance;
  /** The ship's own screen-space box, so a comparison excludes the backdrop. */
  shipRegion(): Region | null;
  /**
   * Pins the render clock at a fixed elapsed time and hides the point clouds,
   * so a frame can be compared with another frame. Restored by `resumeFrame`.
   */
  freezeFrame(at: number): boolean;
  resumeFrame(): boolean;
  signature(region?: Region | null): string;
  damagePrint(): DamagePrint | null;
  /** Frames the camera on a hull-local point. Returns false if it cannot. */
  frame(target: Vec3T, direction: Vec3T, distance: number): boolean;
  /** Places the camera in world space, for a framing that must not move. */
  frameAbsolute(eye: Vec3T, target: Vec3T): boolean;
  /** Hull-local anchors worth photographing, resolved from the domain rules. */
  subjects(
    archetype: string,
    seed: number,
  ): Promise<Record<string, { target: Vec3T; direction: Vec3T; distance: number }> | null>;
}

declare global {
  interface Window {
    __eval?: EvalApi;
  }
}

/* ------------------------------------------------------------------ */
/* The in-page harness                                                 */
/* ------------------------------------------------------------------ */

/**
 * Installed before any application script runs, on every navigation.
 *
 * Everything below executes in the browser and may only close over itself —
 * no Node values, no imports from this file. The domain modules it needs are
 * pulled from the dev server at call time, which is what lets the window rules
 * be checked against the very constants `windows.ts` exports rather than
 * against a copy of them that would drift.
 */
function installHarness(): void {
  /** three's `AdditiveBlending`. Inlined: three is not importable from here. */
  const ADDITIVE_BLENDING = 2;

  interface RendererLike {
    render(scene: Scene, camera: Camera): void;
    __evalPatched?: boolean;
  }

  interface Vector3Like {
    x: number;
    y: number;
    z: number;
    set(x: number, y: number, z: number): Vector3Like;
    clone(): Vector3Like;
    copy(other: Vector3Like): Vector3Like;
    add(other: Vector3Like): Vector3Like;
    addScaledVector(other: Vector3Like, scale: number): Vector3Like;
    sub(other: Vector3Like): Vector3Like;
    applyMatrix4(matrix: unknown): Vector3Like;
    project(camera: Camera): Vector3Like;
    normalize(): Vector3Like;
    crossVectors(a: Vector3Like, b: Vector3Like): Vector3Like;
    length(): number;
    toArray(): number[];
  }

  interface Box3Like {
    min: Vector3Like;
    max: Vector3Like;
    clone(): Box3Like;
    applyMatrix4(matrix: unknown): Box3Like;
    expandByScalar(amount: number): Box3Like;
    intersectsBox(other: Box3Like): boolean;
    distanceToPoint(point: Vector3Like): number;
    getCenter(target: Vector3Like): Vector3Like;
    getSize(target: Vector3Like): Vector3Like;
  }

  interface MaterialLike {
    type: string;
    transparent?: boolean;
    depthWrite?: boolean;
    blending?: number;
  }

  interface MeshLike extends Object3D {
    isMesh?: boolean;
    isPoints?: boolean;
    isSprite?: boolean;
    isLine?: boolean;
    isLight?: boolean;
    geometry?: {
      type: string;
      boundingBox: Box3Like | null;
      computeBoundingBox(): void;
    };
    material?: MaterialLike | MaterialLike[];
  }

  interface ControlsLike {
    target: Vector3Like;
    update(): void;
  }

  interface ClockLike {
    elapsedTime: number;
    oldTime: number;
    running: boolean;
  }

  interface R3FState {
    clock: ClockLike;
    camera: Camera & {
      position: Vector3Like;
      updateMatrixWorld(force?: boolean): void;
      updateProjectionMatrix(): void;
      lookAt(x: number, y: number, z: number): void;
    };
    controls: ControlsLike | null;
  }

  interface R3FObject extends Object3D {
    __r3f?: { root: { getState(): R3FState } };
  }

  let captured: { scene: Scene; camera: Camera } | null = null;

  const devtools = new EventTarget();
  devtools.addEventListener('observe', (event: Event) => {
    const detail = (event as CustomEvent).detail as RendererLike | undefined;
    if (!detail || typeof detail.render !== 'function' || detail.__evalPatched) return;
    detail.__evalPatched = true;
    const original = detail.render.bind(detail);
    detail.render = (scene: Scene, camera: Camera) => {
      // The composer renders its own fullscreen-quad scene through the same
      // renderer, and it renders it last. Keying on `__r3f` keeps the scene
      // the application actually declared rather than the output pass.
      if ((scene as R3FObject).__r3f) captured = { scene, camera };
      original(scene, camera);
    };
  });
  (window as unknown as { __THREE_DEVTOOLS__: EventTarget }).__THREE_DEVTOOLS__ = devtools;

  /* --------------------------- Resolution --------------------------- */

  const meshCount = (root: Object3D): number => {
    let n = 0;
    root.traverse((object) => {
      if ((object as MeshLike).isMesh) n += 1;
    });
    return n;
  };

  /**
   * The ship, found by rule rather than by name.
   *
   * The scene's direct children are the environment rig, the three key lights,
   * the scenery and the ship. Only one of them is a densely populated group:
   * the ship carries 150–250 meshes where the drydock carries ten. The margin
   * is asserted by the caller, so a day when this stops being true fails the
   * eval loudly instead of quietly measuring the gantry.
   */
  const resolve = (): { scene: Scene; camera: Camera; ship: Object3D; runnerUp: number } | null => {
    if (!captured) return null;
    const { scene, camera } = captured;
    let ship: Object3D | null = null;
    let best = -1;
    let runnerUp = -1;
    for (const child of scene.children) {
      const n = meshCount(child);
      if (n > best) {
        runnerUp = best;
        best = n;
        ship = child;
      } else if (n > runnerUp) {
        runnerUp = n;
      }
    }
    if (!ship || best <= 0) return null;
    scene.updateMatrixWorld(true);
    return { scene, camera, ship, runnerUp: Math.max(runnerUp, 0) };
  };

  const state = (): R3FState | null => {
    const found = resolve();
    if (!found) return null;
    return (found.scene as R3FObject).__r3f?.root.getState() ?? null;
  };

  /* --------------------------- Classification --------------------------- */

  /**
   * Why a mesh is or is not load-bearing structure.
   *
   * The exemptions are stated as rules and counted in the report, so that
   * "the eval passed" can never mean "the eval skipped it". A point cloud has
   * no surface to abut with; a sprite is a camera-facing billboard; a light is
   * not geometry at all; and a decal is a projection onto a mesh that is
   * already in the graph — asserting that it touches something would be
   * asserting that the thing it is painted on exists, twice.
   */
  const classify = (object: MeshLike): string => {
    if (object.isPoints) return 'exempt:points-cloud';
    if (object.isSprite) return 'exempt:sprite';
    if (object.isLight) return 'exempt:light';
    if (object.isLine) return 'exempt:line';
    if (!object.isMesh) return 'skip:not-a-mesh';

    let visible: Object3D | null = object;
    while (visible) {
      if (!visible.visible) return 'exempt:hidden';
      visible = visible.parent;
    }

    const material = Array.isArray(object.material) ? object.material[0] : object.material;
    if (!material) return 'exempt:no-material';
    if (material.blending === ADDITIVE_BLENDING) return 'exempt:additive-glow';
    // drei's `<Decal>` is a mesh carrying a DecalGeometry, and `damage/Damage`
    // gives it a transparent, non-depth-writing material. Both halves are
    // required, so an ordinary transparent part is still structure.
    if (material.depthWrite === false && material.transparent === true) {
      return 'exempt:decal-or-glow';
    }
    return 'solid';
  };

  const isDecal = (object: MeshLike): boolean => {
    if (!object.isMesh || !object.geometry) return false;
    const material = Array.isArray(object.material) ? object.material[0] : object.material;
    if (!material) return false;
    return (
      material.depthWrite === false &&
      material.transparent === true &&
      material.blending !== ADDITIVE_BLENDING
    );
  };

  const worldBox = (object: MeshLike): Box3Like | null => {
    const geometry = object.geometry;
    if (!geometry) return null;
    if (!geometry.boundingBox) geometry.computeBoundingBox();
    const box = geometry.boundingBox;
    if (!box) return null;
    const world = box.clone().applyMatrix4((object as unknown as { matrixWorld: unknown }).matrixWorld);
    const finite =
      Number.isFinite(world.min.x) &&
      Number.isFinite(world.min.y) &&
      Number.isFinite(world.min.z) &&
      Number.isFinite(world.max.x) &&
      Number.isFinite(world.max.y) &&
      Number.isFinite(world.max.z);
    return finite ? world : null;
  };

  /** Where a node sits in the ship's own tree, so an orphan can be found again. */
  const walk = (
    root: Object3D,
    visit: (object: Object3D, path: string) => void,
    path = 'ship',
  ): void => {
    visit(root, path);
    root.children.forEach((child, index) => walk(child, visit, `${path}/${index}`));
  };

  /* --------------------------- Domain modules --------------------------- */

  interface DomainModules {
    hullVolumes(archetype: string, profile: unknown): unknown[];
    socketsFor(archetype: string, volumes: unknown[]): SocketLike[];
    exteriorLightRig(archetype: string, volumes: unknown[], seed: number): unknown;
    rigKeepouts(rig: unknown): unknown[];
    placeWindows(
      archetype: string,
      volumes: unknown[],
      sockets: SocketLike[],
      seed: number,
      options: { keepClear: unknown[] },
    ): WindowLike[];
    exclusionRadius(socket: SocketLike): number;
    apertureReach(window: WindowLike): number;
    presets: Array<{ seed: number; hullProfile: unknown; sublight: string }>;
    WEAPON_BLAST_RADIUS: number;
    PORTHOLE_RADIUS: number;
    BLAST_SHRINK: number;
    engineBellLength(sublight: string): number;
    SIZE_SCALE: Record<string, number>;
  }

  let modules: DomainModules | null = null;

  /**
   * The pure modules, pulled straight off the dev server.
   *
   * This is the whole reason the window rules can be checked rather than
   * eyeballed: `EXCLUSION_BASE`, `WEAPON_BLAST_RADIUS` and `BLAST_SHRINK` are
   * read from the module under test, so a repair that quietly relaxes one of
   * them cannot also quietly relax the eval.
   */
  const domain = async (): Promise<DomainModules> => {
    if (modules) return modules;
    const load = (path: string): Promise<Record<string, unknown>> => import(/* @vite-ignore */ path);
    const [hullForm, sockets, lights, windows, presets, engines] = await Promise.all([
      load('/src/domain/hullForm.ts'),
      load('/src/render/sockets.ts'),
      load('/src/domain/exteriorLights.ts'),
      load('/src/domain/windows.ts'),
      load('/src/domain/presets.ts'),
      load('/src/render/parts/engineProfile.ts'),
    ]);
    modules = {
      hullVolumes: hullForm.hullVolumes as DomainModules['hullVolumes'],
      socketsFor: sockets.socketsFor as DomainModules['socketsFor'],
      exteriorLightRig: lights.exteriorLightRig as DomainModules['exteriorLightRig'],
      rigKeepouts: lights.rigKeepouts as DomainModules['rigKeepouts'],
      placeWindows: windows.placeWindows as DomainModules['placeWindows'],
      exclusionRadius: windows.exclusionRadius as DomainModules['exclusionRadius'],
      apertureReach: windows.apertureReach as DomainModules['apertureReach'],
      presets: presets.SHIP_PRESETS as DomainModules['presets'],
      WEAPON_BLAST_RADIUS: windows.WEAPON_BLAST_RADIUS as number,
      PORTHOLE_RADIUS: windows.PORTHOLE_RADIUS as number,
      BLAST_SHRINK: windows.BLAST_SHRINK as number,
      engineBellLength: engines.engineBellLength as DomainModules['engineBellLength'],
      SIZE_SCALE: windows.SOCKET_EXTENT as Record<string, number>,
    };
    return modules;
  };

  const distance3 = (a: Vec3T, b: Vec3T): number =>
    Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);

  /** Hull-local to world, through the ship group's own transform. */
  const toWorld = (ship: Object3D, point: Vec3T): Vector3Like => {
    const vector = (ship as unknown as { position: Vector3Like }).position.clone();
    vector.set(point[0], point[1], point[2]);
    return vector.applyMatrix4((ship as unknown as { matrixWorld: unknown }).matrixWorld);
  };

  /** A hull-local direction rotated into world space (no translation). */
  const dirToWorld = (ship: Object3D, direction: Vec3T): Vector3Like => {
    const origin = toWorld(ship, [0, 0, 0]);
    const tip = toWorld(ship, direction);
    return tip.sub(origin);
  };

  const canvasOf = (): HTMLCanvasElement | null => document.querySelector('canvas');

  /* --------------------------- The API --------------------------- */

  const api: EvalApi = {
    ready: () => resolve() !== null,

    identify: () => {
      const found = resolve();
      if (!found) return null;
      return { shipMeshes: meshCount(found.ship), runnerUpMeshes: found.runnerUp };
    },

    connectivity: (tolerance: number) => {
      const found = resolve();
      if (!found) return null;

      const exempt: Record<string, number> = {};
      const degenerate: string[] = [];
      const solids: Array<{ path: string; geometry: string; material: string; box: Box3Like }> = [];

      walk(found.ship, (object, path) => {
        const mesh = object as MeshLike;
        const verdict = classify(mesh);
        if (verdict !== 'solid') {
          if (verdict !== 'skip:not-a-mesh') exempt[verdict] = (exempt[verdict] ?? 0) + 1;
          return;
        }
        const box = worldBox(mesh);
        if (!box) {
          degenerate.push(`${path} (${mesh.geometry?.type ?? 'no geometry'})`);
          return;
        }
        const material = Array.isArray(mesh.material) ? mesh.material[0] : mesh.material;
        solids.push({
          path,
          geometry: mesh.geometry?.type ?? 'unknown',
          material: material?.type ?? 'unknown',
          box,
        });
      });

      // Touch graph. n is a few hundred, so the honest quadratic beats anything
      // clever that could get the answer subtly wrong.
      const links: number[][] = solids.map(() => []);
      for (let i = 0; i < solids.length; i++) {
        const grown = solids[i]!.box.clone().expandByScalar(tolerance);
        for (let j = i + 1; j < solids.length; j++) {
          if (grown.intersectsBox(solids[j]!.box)) {
            links[i]!.push(j);
            links[j]!.push(i);
          }
        }
      }

      const orphans: Orphan[] = [];
      for (let i = 0; i < solids.length; i++) {
        if (links[i]!.length > 0) continue;
        const entry = solids[i]!;
        const centre = entry.box.getCenter(entry.box.min.clone());
        const size = entry.box.getSize(entry.box.min.clone());
        let nearest = Infinity;
        for (let j = 0; j < solids.length; j++) {
          if (i === j) continue;
          const gap = solids[j]!.box.distanceToPoint(centre);
          if (gap < nearest) nearest = gap;
        }
        orphans.push({
          path: entry.path,
          geometry: entry.geometry,
          material: entry.material,
          centre: [
            Number(centre.x.toFixed(3)),
            Number(centre.y.toFixed(3)),
            Number(centre.z.toFixed(3)),
          ],
          size: [
            Number(size.x.toFixed(3)),
            Number(size.y.toFixed(3)),
            Number(size.z.toFixed(3)),
          ],
          nearest: Number(nearest.toFixed(3)),
        });
      }

      // Islands. Reported rather than asserted: the requirement is that no mesh
      // stands alone, and a second, weaker claim asserted here would be a rule
      // nobody agreed to. Two parts bolted to each other and to nothing else
      // still show up, in `strays`.
      const seen = new Array<boolean>(solids.length).fill(false);
      let components = 0;
      let largest = 0;
      const islands: string[][] = [];
      for (let i = 0; i < solids.length; i++) {
        if (seen[i]) continue;
        components += 1;
        const queue = [i];
        const members: string[] = [];
        seen[i] = true;
        while (queue.length > 0) {
          const node = queue.pop() as number;
          members.push(solids[node]!.path);
          for (const next of links[node]!) {
            if (!seen[next]) {
              seen[next] = true;
              queue.push(next);
            }
          }
        }
        islands.push(members);
        if (members.length > largest) largest = members.length;
      }
      const strays = islands
        .filter((island) => island.length < largest)
        .flatMap((island) => island);

      return {
        solids: solids.length,
        exempt,
        degenerate,
        orphans,
        components,
        largestComponent: largest,
        strays,
      };
    },

    windows: async (archetype: string, seed: number) => {
      const found = resolve();
      if (!found) return null;
      const m = await domain();
      const profile = m.presets[0]!.hullProfile;
      const volumes = m.hullVolumes(archetype, profile);
      const sockets = m.socketsFor(archetype, volumes);
      const rig = m.exteriorLightRig(archetype, volumes, seed);
      const placements = m.placeWindows(archetype, volumes, sockets, seed, {
        keepClear: m.rigKeepouts(rig),
      });

      const small = m.PORTHOLE_RADIUS * m.BLAST_SHRINK;
      const fuelViolations: WindowViolation[] = [];
      const engineViolations: WindowViolation[] = [];
      const weaponViolations: WindowViolation[] = [];
      const oversizeNearWeapon: WindowReport['oversizeNearWeapon'] = [];
      let minFuel = Infinity;
      let minEngine = Infinity;

      for (const window of placements) {
        const reach = m.apertureReach(window);
        for (const socket of sockets) {
          const gap = distance3(window.position, socket.position);
          const needed = m.exclusionRadius(socket) + reach;
          const violation = { window: window.id, socket: socket.id, gap, needed };
          if (socket.kind === 'fuel') {
            minFuel = Math.min(minFuel, gap - needed);
            if (gap < needed) fuelViolations.push(violation);
          }
          if (socket.kind === 'engine') {
            minEngine = Math.min(minEngine, gap - needed);
            if (gap < needed) engineViolations.push(violation);
          }
          if (socket.kind === 'weapon') {
            if (gap < needed) weaponViolations.push(violation);
            else if (
              gap < m.WEAPON_BLAST_RADIUS + reach &&
              window.class === 'porthole' &&
              window.extent[0] > small + 1e-6
            ) {
              oversizeNearWeapon.push({
                window: window.id,
                socket: socket.id,
                gap,
                radius: window.extent[0],
              });
            }
          }
        }
      }

      // Is the glass actually drawn where the rules put it? Every aperture is a
      // group at the placement's own position, so a seated bezel or coaming
      // must show up within a few centimetres of it in world space.
      const drawn: Vector3Like[] = [];
      walk(found.ship, (object) => {
        const mesh = object as MeshLike;
        if (!mesh.isMesh) return;
        const target = toWorld(found.ship, [0, 0, 0]);
        drawn.push(
          (object as unknown as {
            getWorldPosition(into: Vector3Like): Vector3Like;
          }).getWorldPosition(target),
        );
      });
      const unrendered: string[] = [];
      for (const window of placements) {
        const expected = toWorld(found.ship, window.position);
        const hit = drawn.some(
          (point) =>
            Math.hypot(point.x - expected.x, point.y - expected.y, point.z - expected.z) < 0.06,
        );
        if (!hit) unrendered.push(window.id);
      }

      const portholes = placements.filter((w) => w.class === 'porthole');
      const decks = placements.filter((w) => w.class === 'flight_deck');

      return {
        placements: placements.length,
        portholes: portholes.length,
        flightDecks: decks.length,
        fuelViolations,
        engineViolations,
        weaponViolations,
        oversizeNearWeapon,
        minFuelClearance: Number.isFinite(minFuel) ? Number(minFuel.toFixed(3)) : null,
        minEngineClearance: Number.isFinite(minEngine) ? Number(minEngine.toFixed(3)) : null,
        smallThreshold: small,
        bridgeArea: decks.length > 0 ? decks[0]!.area : null,
        largestPortholeArea: portholes.reduce((most, w) => Math.max(most, w.area), 0),
        unrendered,
      };
    },

    aftRegion: async (archetype: string, size: number) => {
      const found = resolve();
      const canvas = canvasOf();
      if (!found || !canvas) return null;
      const m = await domain();
      const volumes = m.hullVolumes(archetype, m.presets[0]!.hullProfile);
      const sockets = m.socketsFor(archetype, volumes);
      const engines = sockets.filter((socket) => socket.kind === 'engine');
      if (engines.length === 0) return null;

      const bell = m.engineBellLength(m.presets[0]!.sublight);
      const camera = found.camera as R3FState['camera'];

      // Every drive is tried, and the one whose exhaust lands furthest inside
      // the frame is measured. A region half off-screen would average in the
      // letterbox and report the plume as dim.
      let best: Region | null = null;
      let bestMargin = -Infinity;
      for (const socket of engines) {
        const scale = m.SIZE_SCALE[socket.size] ?? 1;
        // The plume starts at the bell's mouth and runs along the socket's
        // normal; 1.6 units past it is clear of the bell but well inside the
        // shortest column any drive tier produces.
        const along = bell * scale + 1.6;
        const local: Vec3T = [
          socket.position[0] + socket.normal[0] * along,
          socket.position[1] + socket.normal[1] * along,
          socket.position[2] + socket.normal[2] * along,
        ];
        const projected = toWorld(found.ship, local).project(camera);
        const x = (projected.x * 0.5 + 0.5) * canvas.width;
        const y = (-projected.y * 0.5 + 0.5) * canvas.height;
        const half = size / 2;
        const margin = Math.min(x - half, y - half, canvas.width - (x + half), canvas.height - (y + half));
        if (margin > bestMargin) {
          bestMargin = margin;
          best = { x: Math.round(x - half), y: Math.round(y - half), w: size, h: size };
        }
      }
      // Off-screen is reported as null rather than clamped: a clamped box is a
      // measurement of somewhere else.
      return bestMargin >= 0 ? best : null;
    },

    luminance: (region: Region) => {
      const canvas = canvasOf();
      if (!canvas) return { mean: 0, max: 0 };
      const off = document.createElement('canvas');
      off.width = region.w;
      off.height = region.h;
      const ctx = off.getContext('2d');
      if (!ctx) return { mean: 0, max: 0 };
      ctx.drawImage(canvas, region.x, region.y, region.w, region.h, 0, 0, region.w, region.h);
      const { data } = ctx.getImageData(0, 0, region.w, region.h);
      let sum = 0;
      let max = 0;
      for (let i = 0; i < data.length; i += 4) {
        const level = ((data[i] ?? 0) + (data[i + 1] ?? 0) + (data[i + 2] ?? 0)) / 3;
        sum += level;
        if (level > max) max = level;
      }
      return { mean: sum / (data.length / 4), max };
    },

    freezeFrame: (at: number) => {
      const found = resolve();
      const store = state();
      if (!found || !store) return false;
      // Every useFrame in the app reads `state.clock.elapsedTime` or the frame
      // delta. Pinning the clock pins all of them at one phase, and a stopped
      // clock returns a zero delta, so nothing accumulates either.
      store.clock.elapsedTime = at;
      store.clock.running = false;
      found.scene.traverse((object) => {
        if ((object as MeshLike).isPoints) object.visible = false;
      });
      return true;
    },

    resumeFrame: () => {
      const found = resolve();
      const store = state();
      if (!found || !store) return false;
      // `oldTime` is stale after the pause, and three derives the delta from
      // it — leaving it alone hands the next frame however many seconds the
      // sample took.
      store.clock.oldTime = performance.now();
      store.clock.running = true;
      found.scene.traverse((object) => {
        if ((object as MeshLike).isPoints) object.visible = true;
      });
      return true;
    },

    shipRegion: () => {
      const found = resolve();
      const canvas = canvasOf();
      if (!found || !canvas) return null;

      // Union of every solid mesh's world box, projected corner by corner.
      let hull: Box3Like | null = null;
      walk(found.ship, (object) => {
        const mesh = object as MeshLike;
        if (classify(mesh) !== 'solid') return;
        const box = worldBox(mesh);
        if (!box) return;
        if (!hull) {
          hull = box;
          return;
        }
        const current = hull as Box3Like;
        current.min.set(
          Math.min(current.min.x, box.min.x),
          Math.min(current.min.y, box.min.y),
          Math.min(current.min.z, box.min.z),
        );
        current.max.set(
          Math.max(current.max.x, box.max.x),
          Math.max(current.max.y, box.max.y),
          Math.max(current.max.z, box.max.z),
        );
      });
      if (!hull) return null;
      const bounds = hull as Box3Like;

      const camera = found.camera as R3FState['camera'];
      let left = Infinity;
      let top = Infinity;
      let right = -Infinity;
      let bottom = -Infinity;
      for (let corner = 0; corner < 8; corner++) {
        const point = bounds.min.clone();
        point.set(
          corner & 1 ? bounds.max.x : bounds.min.x,
          corner & 2 ? bounds.max.y : bounds.min.y,
          corner & 4 ? bounds.max.z : bounds.min.z,
        );
        const projected = point.project(camera);
        const x = (projected.x * 0.5 + 0.5) * canvas.width;
        const y = (-projected.y * 0.5 + 0.5) * canvas.height;
        left = Math.min(left, x);
        right = Math.max(right, x);
        top = Math.min(top, y);
        bottom = Math.max(bottom, y);
      }

      const x = Math.max(0, Math.floor(left));
      const y = Math.max(0, Math.floor(top));
      const w = Math.min(canvas.width - x, Math.ceil(right - left));
      const h = Math.min(canvas.height - y, Math.ceil(bottom - top));
      if (w < 8 || h < 8) return null;
      return { x, y, w, h };
    },

    signature: (region?: Region | null) => {
      const canvas = canvasOf();
      if (!canvas) return '';
      const box = region ?? { x: 0, y: 0, w: canvas.width, h: canvas.height };
      const off = document.createElement('canvas');
      off.width = 48;
      off.height = 30;
      const ctx = off.getContext('2d');
      if (!ctx) return '';
      ctx.drawImage(canvas, box.x, box.y, box.w, box.h, 0, 0, 48, 30);
      return Array.from(ctx.getImageData(0, 0, 48, 30).data).join(',');
    },

    damagePrint: () => {
      const found = resolve();
      if (!found) return null;
      const centres: string[] = [];
      walk(found.ship, (object) => {
        const mesh = object as MeshLike;
        if (!isDecal(mesh)) return;
        const box = worldBox(mesh);
        if (!box) return;
        const centre = box.getCenter(box.min.clone());
        const size = box.getSize(box.max.clone());
        // Position and footprint both, so a mark that moved and a mark that
        // changed size are each visible in the digest. Three decimals is well
        // inside the reproducibility a seeded stream owes us and well outside
        // float noise from a matrix multiply.
        centres.push(
          `${centre.x.toFixed(3)},${centre.y.toFixed(3)},${centre.z.toFixed(3)}` +
            `:${size.x.toFixed(3)}x${size.y.toFixed(3)}x${size.z.toFixed(3)}`,
        );
      });
      centres.sort();
      return { marks: centres.length, digest: centres.join('|') };
    },

    frame: (target: Vec3T, direction: Vec3T, distance: number) => {
      const found = resolve();
      const store = state();
      if (!found || !store) return false;
      const camera = store.camera;
      const focus = toWorld(found.ship, target);
      const away = dirToWorld(found.ship, direction).normalize();
      const eye = focus.clone().addScaledVector(away, distance);

      camera.position.set(eye.x, eye.y, eye.z);
      if (store.controls) {
        // The orbit controls own the camera's orientation — they re-aim it at
        // their own target every frame — so the target is what has to move.
        store.controls.target.set(focus.x, focus.y, focus.z);
        store.controls.update();
      } else {
        camera.lookAt(focus.x, focus.y, focus.z);
      }
      camera.updateMatrixWorld(true);
      return true;
    },

    frameAbsolute: (eye: Vec3T, target: Vec3T) => {
      const store = state();
      if (!store) return false;
      const camera = store.camera;
      camera.position.set(eye[0], eye[1], eye[2]);
      if (store.controls) {
        store.controls.target.set(target[0], target[1], target[2]);
        store.controls.update();
      } else {
        camera.lookAt(target[0], target[1], target[2]);
      }
      camera.updateMatrixWorld(true);
      return true;
    },

    subjects: async (archetype: string, seed: number) => {
      const m = await domain();
      const volumes = m.hullVolumes(archetype, m.presets[0]!.hullProfile);
      const sockets = m.socketsFor(archetype, volumes);
      const rig = m.exteriorLightRig(archetype, volumes, seed);
      const placements = m.placeWindows(archetype, volumes, sockets, seed, {
        keepClear: m.rigKeepouts(rig),
      });

      const result: Record<string, { target: Vec3T; direction: Vec3T; distance: number }> = {};

      // A mount join: the radiator collar if the hull carries one, because that
      // is the joint R1 rebuilt — otherwise whatever else is bolted on.
      const mount =
        sockets.find((socket) => socket.kind === 'radiator') ??
        sockets.find((socket) => socket.kind === 'weapon') ??
        sockets.find((socket) => socket.kind !== 'ftl');
      if (mount) {
        result.mount = {
          target: mount.position,
          // Off the mount's own normal and a little above it, so the collar is
          // seen against the plate rather than end-on.
          direction: [mount.normal[0] + 0.35, mount.normal[1] + 0.55, mount.normal[2] + 0.35],
          distance: 3.4,
        };
      }

      // Windows: the porthole with the most neighbours, so the still shows the
      // spacing rule rather than one lonely port.
      const portholes = placements.filter((w) => w.class === 'porthole');
      let bestPort: WindowLike | null = null;
      let bestNeighbours = -1;
      for (const port of portholes) {
        const neighbours = portholes.filter(
          (other) => other !== port && distance3(other.position, port.position) < 3.5,
        ).length;
        if (neighbours > bestNeighbours) {
          bestNeighbours = neighbours;
          bestPort = port;
        }
      }
      if (bestPort) {
        result.windows = { target: bestPort.position, direction: bestPort.normal, distance: 2.2 };
      }

      const deck = placements.find((w) => w.class === 'flight_deck');
      if (deck) {
        result.bridge = { target: deck.position, direction: deck.normal, distance: 3.0 };
      }

      const engine = sockets.find((socket) => socket.kind === 'engine');
      if (engine) {
        const scale = m.SIZE_SCALE[engine.size] ?? 1;
        const along = m.engineBellLength(m.presets[0]!.sublight) * scale + 3.2;
        result.thruster = {
          target: [
            engine.position[0] + engine.normal[0] * along,
            engine.position[1] + engine.normal[1] * along,
            engine.position[2] + engine.normal[2] * along,
          ],
          // Broadside to the column, raised: a plume photographed down its own
          // axis is a bright dot.
          direction: [1, 0.35, 0.2],
          distance: 11,
        };
      }

      return result;
    },
  };

  window.__eval = api;
}

/* ------------------------------------------------------------------ */
/* Node-side helpers                                                   */
/* ------------------------------------------------------------------ */

async function waitForViewport(page: Page): Promise<void> {
  await page.waitForSelector('canvas', { timeout: 30_000 });
  await page.waitForFunction(() => {
    const canvas = document.querySelector('canvas');
    return Boolean(canvas && canvas.width > 0 && canvas.height > 0);
  });
  await page.waitForFunction(() => window.__eval?.ready() === true, undefined, { timeout: 30_000 });
  await page.waitForTimeout(1500);
}

/**
 * The elapsed time every comparable frame is pinned to. Arbitrary, and fixed.
 */
const FROZEN_AT = 20;

/**
 * A framebuffer fingerprint taken from a stopped scene.
 *
 * WHY THE SCENE IS STOPPED, and why this is a control rather than a
 * concession. Nothing about this viewport is still: the drydock gantry rocks
 * on `sin(elapsedTime)`, the anti-collision beacons strobe, and the welding
 * sparks respawn from `Math.random()` and fall at a fixed rate. Measured on a
 * motionless ship, two samples 1.5 s apart in the SAME page load differ by
 * 0.5–6.6% — which is larger than most of the differences a reload produces,
 * so an unstopped comparison is not an instrument at all. It cannot tell a
 * wear system that re-rolled its seed from a gantry that happened to be
 * further through its swing.
 *
 * So the sample pins the render clock at `FROZEN_AT` and hides the point
 * clouds, both restored immediately afterwards, and both applied identically
 * on either side of the reload. This is the same control Playwright's own
 * `toHaveScreenshot({ animations: 'disabled' })` applies to CSS, and the
 * repo's config already asks for it. Frozen, a reload reproduces the frame to
 * 0.2%.
 */
async function frozenSignature(page: Page, region: Region | null): Promise<string> {
  await page.evaluate((at) => window.__eval!.freezeFrame(at), FROZEN_AT);
  await page.waitForTimeout(900);
  const print = await page.evaluate((box) => window.__eval!.signature(box), region);
  await page.evaluate(() => window.__eval!.resumeFrame());
  return print;
}

/** How many of the sampled pixels differ, as a fraction. Same as render.spec. */
function difference(a: string, b: string): number {
  const left = a.split(',');
  const right = b.split(',');
  let changed = 0;
  for (let i = 0; i < left.length; i++) {
    if (Math.abs(Number(left[i]) - Number(right[i])) > 6) changed += 1;
  }
  return changed / left.length;
}

async function selectArchetype(page: Page, label: string): Promise<void> {
  // The hull buttons live on the Designer tab, and reading the seed or setting
  // the condition leaves the rail on another one. Asking for the tab first is
  // what stops this waiting ten minutes for a button that is not in the DOM.
  await page.getByRole('navigation', { name: 'Panels' }).getByRole('button', { name: 'Designer' }).click();
  await page.getByRole('button', { name: new RegExp(label) }).click();
  await page.waitForTimeout(1200);
}

/**
 * Drives the real condition slider to an exact value.
 *
 * Through the native value setter and a bubbled `input`, which is the path a
 * user's drag takes through React's synthetic event system — as opposed to
 * setting `blueprint.condition` from outside, which would test a state the app
 * cannot actually reach.
 */
async function setCondition(page: Page, value: number): Promise<void> {
  await page.getByRole('button', { name: 'Condition' }).click();
  await page.evaluate((next) => {
    const input = document.querySelector('#slider-condition') as HTMLInputElement | null;
    if (!input) throw new Error('condition slider not found');
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;
    setter?.call(input, String(next));
    input.dispatchEvent(new Event('input', { bubbles: true }));
  }, value);
  // The control reports the value it actually took, so this is the app
  // confirming the setting rather than the test assuming it.
  await expect(page.locator('#slider-condition')).toHaveValue(String(value));
  await page.waitForTimeout(900);
}

/** The seed the app is really rendering, read off the Condition panel. */
async function readSeed(page: Page): Promise<number> {
  await page.getByRole('button', { name: 'Condition' }).click();
  const text = await page.getByText(/^seed 0x/).innerText();
  const match = /seed 0x([0-9a-f]+)/i.exec(text);
  if (!match) throw new Error(`could not read the seed from "${text}"`);
  return parseInt(match[1] as string, 16);
}

interface Measurement {
  archetype: string;
  condition: string;
  connectivity: ConnectivityReport | null;
  windows: WindowReport | null;
  thrust: { region: Region | null; idle: Luminance | null; burning: Luminance | null };
  damage: DamagePrint | null;
  /** Frame-to-frame difference with nothing changed. The comparison's floor. */
  noiseFloor: number;
  signature: string;
}

const measurements: Measurement[] = [];

test.beforeAll(() => {
  mkdirSync(SHOT_DIR, { recursive: true });
});

/**
 * The numbers for one hull, written as they are measured.
 *
 * PER HULL, AND AFTER EVERY CONDITION, rather than once at the end. Playwright
 * replaces the worker process after a failing test, which takes the in-memory
 * accumulator with it — a single `afterAll` write produced a report containing
 * only the hulls that ran after the last failure, which is the subset least
 * worth having.
 */
function writeArchetypeReport(archetype: string): void {
  writeFileSync(
    `${SHOT_DIR}/eval-${archetype}.json`,
    JSON.stringify(
      measurements
        .filter((entry) => entry.archetype === archetype)
        // The framebuffer fingerprints are thousands of integers apiece and
        // mean nothing to a reader; the assertions that use them are recorded
        // in the test output instead.
        .map(({ signature: _signature, ...rest }) => rest),
      null,
      2,
    ),
  );
}

test.afterAll(() => {
  // Merged from whatever each hull left behind, so a restarted worker cannot
  // lose the runs that came before it.
  const merged = readdirSync(SHOT_DIR)
    .filter((name) => name.startsWith('eval-') && name.endsWith('.json') && name !== 'eval-report.json')
    .flatMap((name) => JSON.parse(readFileSync(`${SHOT_DIR}/${name}`, 'utf8')) as unknown[]);
  writeFileSync(`${SHOT_DIR}/eval-report.json`, JSON.stringify(merged, null, 2));
});

/* ------------------------------------------------------------------ */
/* The matrix                                                          */
/* ------------------------------------------------------------------ */

for (const archetype of ARCHETYPES) {
  test(`engine eval: ${archetype.label}`, async ({ page }) => {
    // Every hull runs the full matrix twice — once measured, once reloaded for
    // the determinism check — and each pass drives a real WebGL2 scene through
    // SwiftShader at a handful of frames a second. The suite's 90 s budget is
    // for a single-interaction spec.
    test.setTimeout(600_000);

    const problems: string[] = [];
    page.on('console', (message) => {
      if (message.type() === 'error') problems.push(`console: ${message.text()}`);
    });
    page.on('pageerror', (error) => problems.push(`exception: ${error.message}`));

    await page.addInitScript(installHarness);
    // The idle bob and the derelict tumble are time-based, so without this two
    // samples of the same ship are never taken at the same phase — and every
    // world-space number below would be measured from a different pose.
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.goto('/');
    await waitForViewport(page);

    const seed = await readSeed(page);
    await selectArchetype(page, archetype.label);

    const identity = await page.evaluate(() => window.__eval?.identify() ?? null);
    expect(identity, 'the harness could not find a ship in the scene').not.toBeNull();
    // The ship is found as the scene's densest child. If that ever stops being
    // unmistakable, everything below is measuring the wrong object, so the
    // margin is asserted rather than assumed.
    expect
      .soft(
        identity!.shipMeshes,
        `ship group (${identity!.shipMeshes} meshes) is not clearly denser than the next scene child (${identity!.runnerUpMeshes})`,
      )
      .toBeGreaterThan(identity!.runnerUpMeshes * 3);

    const subjects = await page.evaluate(
      (input) => window.__eval?.subjects(input.id, input.seed) ?? null,
      { id: archetype.id as string, seed },
    );
    expect(subjects, 'no photographable subjects resolved').not.toBeNull();

    const signatures: Record<string, string> = {};
    const regions: Record<string, Region | null> = {};
    const noise: Record<string, number> = {};
    const prints: Record<string, DamagePrint | null> = {};

    for (const condition of CONDITIONS) {
      await setCondition(page, condition.value);

      /* --- R1 connectivity --- */
      const connectivity = await page.evaluate(
        (tolerance) => window.__eval?.connectivity(tolerance) ?? null,
        TOUCH_TOLERANCE,
      );
      expect(connectivity, 'connectivity walk returned nothing').not.toBeNull();
      const orphanReport = (connectivity?.orphans ?? [])
        .map(
          (orphan) =>
            `${orphan.path} ${orphan.geometry}/${orphan.material} at [${orphan.centre.join(', ')}]` +
            ` size [${orphan.size.join(', ')}], nearest solid ${orphan.nearest} away`,
        )
        .join('\n  ');
      expect
        .soft(
          connectivity!.degenerate,
          `${archetype.label} @ ${condition.name}: geometry with non-finite bounds: ${connectivity!.degenerate.join(', ')}`,
        )
        .toHaveLength(0);
      expect
        .soft(
          connectivity!.orphans,
          `${archetype.label} @ ${condition.name}: ${connectivity!.orphans.length} of ${connectivity!.solids} solid meshes touch nothing (tolerance ${TOUCH_TOLERANCE}):\n  ${orphanReport}`,
        )
        .toHaveLength(0);

      /* --- R3 window safety --- */
      const windows = await page.evaluate(
        (input) => window.__eval?.windows(input.id, input.seed) ?? null,
        { id: archetype.id as string, seed },
      );
      expect(windows, 'window placement returned nothing').not.toBeNull();
      const w = windows!;
      expect
        .soft(
          w.fuelViolations,
          `${archetype.label}: glazing inside a fuel bay exclusion — ${w.fuelViolations
            .map((v) => `${v.window} is ${v.gap.toFixed(2)} from ${v.socket}, needs ${v.needed.toFixed(2)}`)
            .join('; ')}`,
        )
        .toHaveLength(0);
      expect
        .soft(
          w.engineViolations,
          `${archetype.label}: glazing inside a drive exclusion — ${w.engineViolations
            .map((v) => `${v.window} is ${v.gap.toFixed(2)} from ${v.socket}, needs ${v.needed.toFixed(2)}`)
            .join('; ')}`,
        )
        .toHaveLength(0);
      expect
        .soft(
          w.weaponViolations,
          `${archetype.label}: glazing inside a weapon exclusion — ${w.weaponViolations
            .map((v) => `${v.window} is ${v.gap.toFixed(2)} from ${v.socket}, needs ${v.needed.toFixed(2)}`)
            .join('; ')}`,
        )
        .toHaveLength(0);
      expect
        .soft(
          w.oversizeNearWeapon,
          `${archetype.label}: full-size glazing inside a weapon's blast radius (threshold ${w.smallThreshold.toFixed(3)}) — ${w.oversizeNearWeapon
            .map((v) => `${v.window} r=${v.radius.toFixed(3)} at ${v.gap.toFixed(2)} from ${v.socket}`)
            .join('; ')}`,
        )
        .toHaveLength(0);
      expect
        .soft(w.flightDecks, `${archetype.label}: expected exactly one flight deck`)
        .toBe(1);
      expect
        .soft(
          w.bridgeArea ?? 0,
          `${archetype.label}: the bridge (${(w.bridgeArea ?? 0).toFixed(3)}) is not the largest aperture — the biggest porthole is ${w.largestPortholeArea.toFixed(3)}`,
        )
        .toBeGreaterThan(w.largestPortholeArea);
      expect
        .soft(
          w.unrendered,
          `${archetype.label} @ ${condition.name}: placements with no glazing drawn at them: ${w.unrendered.join(', ')}`,
        )
        .toHaveLength(0);

      /* --- R4 thrust --- */
      // Broadside to the drives, so the exhaust column crosses the frame rather
      // than pointing down the lens, and framed off the ship's own engine
      // socket so that every hull is photographed from the same relationship to
      // its plume rather than from the same world coordinate.
      if (subjects!.thruster) {
        await page.evaluate(
          (s) => window.__eval!.frame(s.target, s.direction, s.distance),
          subjects!.thruster,
        );
        await page.waitForTimeout(1200);
      }
      const region = await page.evaluate(
        (id) => window.__eval?.aftRegion(id, 96) ?? null,
        archetype.id,
      );
      expect
        .soft(region, `${archetype.label}: no drive exhaust region is on screen to measure`)
        .not.toBeNull();

      let idle: Luminance | null = null;
      let burning: Luminance | null = null;
      if (region) {
        idle = await page.evaluate((r) => window.__eval!.luminance(r), region);
        await page.getByRole('button', { name: /Test Burn/ }).click();
        // Test Burn releases itself after 2.6 s, so the sample has to land
        // inside that window.
        await page.waitForTimeout(900);
        burning = await page.evaluate((r) => window.__eval!.luminance(r), region);

        const rise = burning.mean - idle.mean;
        const ratio = idle.mean > 0 ? burning.mean / idle.mean : Infinity;
        const detail = `${archetype.label} @ ${condition.name}: aft luminance ${idle.mean.toFixed(2)} → ${burning.mean.toFixed(2)} (peak ${idle.max.toFixed(0)} → ${burning.max.toFixed(0)})`;

        if (condition.value >= 0.9) {
          // Past DERELICT_THRESHOLD the drives are cold by design — README §2,
          // and `isDerelict` in domain/condition.ts. Asserting a rise here
          // would be asserting the opposite of the specification, so the check
          // inverts rather than relaxes.
          expect
            .soft(rise, `${detail}: a derelict's drives must stay cold under Test Burn`)
            .toBeLessThan(DEAD_DRIVE_CEILING);
        } else {
          expect.soft(rise, `${detail}: rise of ${rise.toFixed(2)} is not material`).toBeGreaterThan(
            THRUST_ABSOLUTE,
          );
          expect
            .soft(ratio, `${detail}: only ${ratio.toFixed(2)}× brighter under throttle`)
            .toBeGreaterThan(THRUST_RELATIVE);
        }
        // Let the burn lapse so the next condition starts from idle.
        await page.waitForTimeout(2200);
      }

      /* --- R2 damage --- */
      const damage = await page.evaluate(() => window.__eval?.damagePrint() ?? null);
      prints[condition.name] = damage;

      await page.evaluate(
        (view) => window.__eval!.frameAbsolute(view.eye, view.target),
        { eye: HERO_EYE, target: HERO_TARGET },
      );
      await page.waitForTimeout(1200);
      // Sampled over the ship rather than over the whole canvas.
      //
      // WHY. The drydock's welding sparks respawn from `Math.random()` — see
      // `environments/Environments.tsx` — so the backdrop is genuinely
      // different from frame to frame and no seed governs it. A full-frame
      // fingerprint therefore measures the sparks as well as the hull, and
      // charges the difference to the wear system. The ship's own projected
      // bounds are recorded here and reused verbatim after the reload, so both
      // passes crop identically.
      regions[condition.name] = await page.evaluate(() => window.__eval!.shipRegion());
      signatures[condition.name] = await frozenSignature(page, regions[condition.name] ?? null);
      // The same measurement again, one settle later and without reloading
      // anything: the floor this scene's own frame-to-frame noise puts under
      // the reload comparison below.
      await page.waitForTimeout(1200);
      const repeat = await frozenSignature(page, regions[condition.name] ?? null);
      noise[condition.name] = difference(signatures[condition.name] as string, repeat);

      measurements.push({
        archetype: archetype.id,
        condition: condition.name,
        connectivity,
        windows,
        thrust: { region, idle, burning },
        damage,
        noiseFloor: noise[condition.name] ?? 0,
        signature: signatures[condition.name] as string,
      });

      writeArchetypeReport(archetype.id);

      /* --- Stills, at the two ends of the scale --- */
      if (condition.name === 'pristine' || condition.name === 'derelict') {
        await captureStills(page, archetype.id, condition.name, subjects!);
      }
    }

    /* --- R2: pristine and derelict must not render alike --- */
    const spread = difference(signatures.pristine as string, signatures.derelict as string);
    expect
      .soft(
        spread,
        `${archetype.label}: a derelict hulk renders ${(spread * 100).toFixed(1)}% differently from the parade ship`,
      )
      .toBeGreaterThan(DAMAGE_DIFFERENCE);
    const pristineMarks = prints.pristine?.marks ?? 0;
    const derelictMarks = prints.derelict?.marks ?? 0;
    expect
      .soft(
        derelictMarks,
        `${archetype.label}: a derelict carries ${derelictMarks} damage decals against the parade ship's ${pristineMarks}`,
      )
      .toBeGreaterThan(pristineMarks);

    /* --- R2: the same seed must land the same marks after a reload --- */
    await page.reload();
    await waitForViewport(page);
    await selectArchetype(page, archetype.label);
    for (const condition of CONDITIONS) {
      await setCondition(page, condition.value);
      await page.waitForTimeout(600);
      const again = await page.evaluate(() => window.__eval?.damagePrint() ?? null);
      expect
        .soft(
          again?.marks ?? -1,
          `${archetype.label} @ ${condition.name}: ${again?.marks} decals after reload, ${prints[condition.name]?.marks} before`,
        )
        .toBe(prints[condition.name]?.marks ?? -1);
      expect
        .soft(
          again?.digest ?? '',
          `${archetype.label} @ ${condition.name}: damage moved across a reload despite the same seed`,
        )
        .toBe(prints[condition.name]?.digest ?? '');

      // The identical camera and the identical crop as the first pass, so this
      // measures the ship and not the two poses the camera happened to be in.
      await page.evaluate(
        (view) => window.__eval!.frameAbsolute(view.eye, view.target),
        { eye: HERO_EYE, target: HERO_TARGET },
      );
      await page.waitForTimeout(1200);
      const signature = await frozenSignature(page, regions[condition.name] ?? null);
      const drift = difference(signatures[condition.name] as string, signature);
      expect
        .soft(
          drift,
          `${archetype.label} @ ${condition.name}: the viewport differs by ${(drift * 100).toFixed(1)}% across a reload, against a same-session noise floor of ${((noise[condition.name] ?? 0) * 100).toFixed(1)}%`,
        )
        .toBeLessThan(RELOAD_DIFFERENCE);
    }

    expect
      .soft(problems, `${archetype.label}: console errors and exceptions: ${problems.join(' | ')}`)
      .toHaveLength(0);
  });
}

/* ------------------------------------------------------------------ */
/* Stills for human review                                             */
/* ------------------------------------------------------------------ */

/**
 * The five stills a reviewer actually needs, per hull, at both ends of the wear
 * scale: the ship, a mount join, a run of portholes, the bridge, and the drive
 * under throttle. Framed off the same domain data the assertions use, so the
 * still and the number are looking at the same object.
 */
async function captureStills(
  page: Page,
  archetype: string,
  condition: string,
  subjects: Record<string, { target: Vec3T; direction: Vec3T; distance: number }>,
): Promise<void> {
  const canvas = page.locator('canvas');

  await page.evaluate(
    (view) => window.__eval!.frameAbsolute(view.eye, view.target),
    { eye: HERO_EYE, target: HERO_TARGET },
  );
  await page.waitForTimeout(1200);
  await canvas.screenshot({ path: `${SHOT_DIR}/eval-${archetype}-hero-${condition}.png` });

  for (const name of ['mount', 'windows', 'bridge'] as const) {
    const subject = subjects[name];
    if (!subject) continue;
    await page.evaluate(
      (s) => window.__eval!.frame(s.target, s.direction, s.distance),
      subject,
    );
    await page.waitForTimeout(1100);
    await canvas.screenshot({ path: `${SHOT_DIR}/eval-${archetype}-${name}-${condition}.png` });
  }

  const thruster = subjects.thruster;
  if (thruster) {
    await page.evaluate(
      (s) => window.__eval!.frame(s.target, s.direction, s.distance),
      thruster,
    );
    await page.getByRole('button', { name: /Test Burn/ }).click();
    await page.waitForTimeout(900);
    await canvas.screenshot({ path: `${SHOT_DIR}/eval-${archetype}-thruster-${condition}.png` });
    await page.waitForTimeout(2200);
  }
}
