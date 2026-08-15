# Astralis Shipyard — Prototype Code Review

**Reviewed:** 2026-08-15
**Commit:** `3e17203` (`feat: authentic non-aerodynamic space architecture…`)
**Scope:** Whole repository (9 tracked files, 1,898 LOC of source, all but 9 lines in one file)
**Method:** Static read of every line, `npm run build`, live run in Chrome at 1524×784 with screenshot and console capture.

---

## 0. Summary

The prototype is a genuinely impressive *demo velocity* artefact: a single-file React + Three.js app that boots, builds clean in 1.1s, and puts a manipulable 3D object on screen behind a dense, good-looking control surface. As a way to make a concept tangible in a day, it works.

It is not close to production, and the gap is wider than "needs a backend." Three findings matter more than the rest:

1. **Several headline features are inert.** Auto-rotate, Test Burn, the R&D tech gate, and ship stats are wired to UI but have no effect on the application. This is verified at runtime, not inferred.
2. **The renderer is missing the two things that make PBR look like anything** — image-based lighting and shadows — so metallic hulls render as near-black silhouettes. The prototype compensates by pushing light intensities to physically absurd values, which flattens the image further.
3. **The documentation describes a product that does not exist.** The README advertises drag-and-drop Bezier sculpting, per-weapon visual hardpoints, and a self-contained 3D export. None of the three is implemented as described.

Point 3 is the one worth dwelling on when training the agent that produced this. Bugs are normal in a prototype. Documentation that overstates what was built converts a useful prototype into a misleading one, and it is the defect that costs the most downstream.

---

## 1. Verified runtime defects

These were reproduced in a browser, not read off the source.

### 1.1 Auto-rotate does nothing — `src/App.jsx:316`, `:395`

The main scene `useEffect` declares `[]` dependencies but its `animate()` closure reads `autoRotate`, `rotationSpeed`, and `isTestBurning` from React state. Those bindings are captured at first render and never refresh.

```js
useEffect(() => {
  /* … */
  const animate = () => {
    if (autoRotate && !isDraggingRef.current) {     // ← always the first-render value: false
      cameraAngleRef.current.theta += 0.005 * rotationSpeed;
```

**Reproduced:** clicked the orbit button; the label changed to `ORBITING (1x)` and the speed slider appeared, but after 4 seconds every element of the scene — warp ring, radiators, gantry column, grid intersections — sat at pixel-identical coordinates. The render loop *is* running (hull bobbing and welding sparks animate, because those read `clock.getElapsedTime()` directly rather than state). Only the state-dependent branches are dead.

### 1.2 Test Burn is cosmetic — `src/App.jsx:404`, `:416`, `:663`, `:976`

`isTestBurning` is read in three places, and all three fail to observe it:

- exhaust particle velocity (`:404`) and radiator shimmer (`:416`) are inside the same stale closure as above;
- radiator `emissiveIntensity` (`:663`) is read during `rebuildShipMesh()`, but `isTestBurning` is absent from that effect's dependency array (`:978`), so no rebuild is triggered.

Pressing Test Burn changes the button label and plays a sound. Nothing in the 3D scene responds.

### 1.3 The R&D tech tree gates nothing — `src/App.jsx:267`, `:1744`

`unlockedTechs` is read in exactly seven places, all inside the R&D tab's own display logic. The component pickers in the Designer tab never consult it. Locked tier-4 hardware — `graviton_singularity`, `tachyon_disruptor`, `zero_point_core`, `chronium_cloak` — is freely selectable, and `SHIP_PRESETS` ships two presets that already use locked technology. The XP economy has no consequence.

### 1.4 Ship stats are dead data — `src/App.jsx:187`, `:201`, `:215`, `:229`

Every preset carries `stats: { speed, armor, firepower, stealth, warp }`. `grep` finds four occurrences, all of them the definitions. Nothing reads them; no stat bar is rendered anywhere in 1,889 lines of JSX. Swapping a 140 kN ion drive for a 780 kN fusion torch changes no number the user can see.

### 1.5 The Spline Sculptor neither drags nor Beziers — `src/App.jsx:1655`–`1686`

The README promises "Drag-and-drop 2D vector control points." The SVG circles have an `onMouseDown` handler that sets a selection ID and nothing else — no `mousemove`, no `mouseup`, no drag state. The points cannot be dragged.

The curve is also not a Bezier. The path is built from `L` (line-to) commands only:

```js
d={`M ${p0.x*0.6} ${p0.y*0.6} ` + splinePoints.slice(1).map(p => `L ${p.x*0.6} ${p.y*0.6}`).join(' ')}
```

It is a polyline. Only the per-point `y` sliders work, and only the `aerodynamic_sleek` archetype consumes `splinePoints` at all (`:824`) — for the other four archetypes the entire tab is a no-op with no UI indication.

### 1.6 The HTML export does not export the ship — `src/App.jsx:1078`–`1155`

The generated file loads **three.js r128 from a CDN** (the app itself is on r160 — a 32-release drift with breaking changes in colour management), is therefore not self-contained or offline-capable as the README claims, and renders a hardcoded cone plus one box regardless of configuration. Architecture, material, FTL, protrusions, and spline are all discarded. It never handles resize, and it interpolates `currentShip.name` into both an HTML title and a JS string literal without escaping — and the AI Architect can set that name to arbitrary text.

### 1.7 Tailwind is loaded from the CDN — `index.html:8`

Console output on load, from Tailwind itself:

> cdn.tailwindcss.com should not be used in production.

This ships a runtime JIT compiler to every visitor, blocks first paint, precludes purging, and hard-fails under a strict CSP or offline. Combined with a render-blocking Google Fonts request and a 712 kB unsplit JS bundle (191 kB gzip), first paint is doing far more work than it needs to.

---

## 2. Resource management

### 2.1 Every rebuild leaks GPU memory — `src/App.jsx:630`–`633`

```js
const group = shipGroupRef.current;
while (group.children.length > 0) group.remove(group.children[0]);
```

`remove()` detaches from the scene graph; it does not free the GPU-side buffers. There is exactly **one** `dispose()` call in the entire 1,889-line file (`:467`, on the renderer). Every `rebuildShipMesh()` allocates six fresh materials plus 20–40 fresh geometries and abandons all of them.

This effect fires on `[currentShip, renderMode, splinePoints, protrusions]`. Dragging a spline slider fires it on every `input` event — a one-second drag leaks on the order of a thousand geometries and several hundred materials. `buildEnvironment()` (`:530`) has the same defect, and additionally strands `sparksRef`/`gantryRef` pointing at detached objects that the animation loop keeps writing to.

### 2.2 StrictMode double-mount orphans a render loop — `src/App.jsx:310`, `:390`, `:459`

`animationFrameId` is a single ref. Under React 18 StrictMode the effect runs, cleans up, and runs again; the second run overwrites the ref before the first loop's handle can be cancelled reliably, and cleanup calls `renderer.dispose()` without `forceContextLoss()` or removing the canvas from the DOM. In development this leaves an orphaned `requestAnimationFrame` loop rendering into a detached canvas for the life of the page, and burns one of the browser's ~16 WebGL contexts each time.

### 2.3 Only one radiator ever animates — `src/App.jsx:855`–`863`

```js
for (let side of [-2.4, 2.4]) {
  const rad = new THREE.Mesh(radiatorGeo, radiatorMat);
  radiatorGlowRef.current = rad;      // ← overwritten on the second iteration
```

The ref ends up holding only the starboard panel. The port panel never shimmers. The ref is also never cleared when radiators are toggled off, so it retains a detached mesh.

---

## 3. Why the render looks like a toy

This is the area the brief flags, so it gets specifics. Two screenshots, both at default settings, both in "Photoreal PBR" mode:

**SF-44 Phantom Knife (Angular Stealth):** the hull is an unreadable near-black mass. Two peach rectangles (radiators) and a pale lavender torus (warp ring) float in front of it. The exhaust is a diagonal cloud of blocky white squares travelling up-and-right, visually detached from the engines.

**BC-99 Leviathan Dreadnought (Brutalist):** a stack of flat grey boxes with hard, untextured faces. The radiator panels intersect and clip through the hull. The purple armour skirts pass through the citadel. Nothing casts a shadow onto anything.

The causes, in order of visual impact:

### 3.1 No image-based lighting — the single biggest defect

There is no environment map anywhere in the file (`grep envMap|PMREM` → zero hits). Every hull material runs `metalness` between 0.85 and 1.0.

A metal in a physically-based renderer has **no diffuse response**. Essentially all of its colour comes from what it reflects. Give it nothing to reflect and it is correctly rendered as black. The `chronium_cloak` material at `metalness: 1.0, roughness: 0.04` is a perfect mirror in an empty room — the renderer is behaving exactly as instructed, and the instruction is wrong.

Directional lights only produce a specular highlight where the reflection vector happens to align, which is why the hull reads as a silhouette with a couple of hot streaks.

**Fix:** a `PMREMGenerator`-processed HDRI (or a cheap procedural gradient / `RoomEnvironment`) assigned to `scene.environment`. This one change will do more for perceived quality than everything else in this section combined.

### 3.2 No shadows at all

`grep castShadow|receiveShadow|shadowMap` → zero hits. Shadows and ambient occlusion are the primary cues the eye uses to resolve contact, depth, and scale. Without them a ship reads as flat decals at an indeterminate size, which is precisely how the Brutalist screenshot reads.

### 3.3 Lighting compensates in the wrong direction

Seven lights (`:473`–`:502`), several already above intensity 3.0, all multiplied by a user slider that reaches 4.5× — a peak spotlight intensity of 20.25, on top of `toneMappingExposure: 1.45`. Cranking untethered light to rescue an image that is dark because it has nothing to reflect flattens the remaining shading and blows out the few surfaces that do respond. The default is already `2.4×`.

### 3.4 Geometry is primitives at hardcoded world coordinates

Hulls are `BoxGeometry`/`CylinderGeometry`/`ConeGeometry` placed by literal numbers, with no panel lines, bevels, greebles, insets, or surface break-up. Real spacecraft read as detailed largely because of high-frequency surface detail; there is none here, and `flatShading` is off so even the facets do not catch light distinctly.

Worse, **protrusions are positioned in absolute coordinates independent of the hull** (`:855`–`:911`, `:918`–`:928`). Radiators are always at `(±2.4, 1.2, −1.8)`, engines always at `(±1.8, −0.1, −4.2)`. Those coordinates were tuned for the stealth frigate; on the 4.2-wide, 8.5-long Brutalist citadel they intersect the hull, and on the Outrigger science hull they float unattached. There is no socket or attachment-point concept, so every archetype × protrusion combination is a fresh opportunity for a clipping bug. This is visible in the screenshot.

### 3.5 Component selections have almost no visual consequence

Only `ftl` and `material` change the mesh. Weapons, sensors, and fuel — three of the six hardpoint categories, each with its own picker and its own tier-4 aspirational hardware — produce **no geometry change whatsoever**. The turret sponsons are identical whether you fit Twin Gauss Railguns or Quantum Singularity Torpedoes. The README's promise of "Gauss Railguns, Coherent Plasma Lances, Tachyon Beams" as visible hardpoints is unmet.

### 3.6 Particles are untextured squares

`PointsMaterial` at `size: 0.55` with no `map`, so each particle is an opaque screen-facing square. At close camera distances these are large, hard-edged, and obviously polygonal — clearly visible in both screenshots. Their motion is also a fixed world-space `−Z` translation applied inside the ship's local group, so they do not follow the engine bells and read as detached.

### 3.7 No post-processing

Emissive engine bells, warp rings, and glowing radiators are all rendered as flat bright colour. Without bloom, an emissive surface is just a light-coloured surface — it never reads as *emitting*. There is also no ambient occlusion, no anti-aliasing beyond MSAA, and no colour grading.

### 3.8 Dead scene content

`scene.fog = new THREE.FogExp2(0x060913, 0.012)` (`:325`) against a planet placed at z ≈ −190 (`:600`). `FogExp2` attenuation at that distance is `1 − e^(−(190×0.012)²) ≈ 0.995`. The planet is 99.5% fogged out — never visible — and the 65-radius, 36×36-segment sphere is submitted every frame regardless.

---

## 4. Architecture and engineering practice

| Area | Finding |
| :--- | :--- |
| **Structure** | 1,889 lines in one component. Sound engine, domain data, geometry builders, export logic, and five tab UIs share one module and one scope. No `src/` subdirectories at all. |
| **Types** | `@types/react` and `@types/react-dom` are installed as devDependencies but there is no TypeScript, no `tsconfig.json`, and no `.ts`/`.tsx` file. The types are inert. |
| **Tests** | None. No test runner, no test script. |
| **Lint/format** | No ESLint, no Prettier, no `eslint-plugin-react-hooks` — which would have caught §1.1 and §1.2 automatically via `exhaustive-deps`. |
| **CI** | No workflow of any kind. |
| **Error handling** | No error boundary. `new THREE.WebGLRenderer()` throws on unsupported hardware and the user gets a blank page. |
| **State** | 15 `useState` hooks in one component; no reducer, no context, no persistence. A refresh discards all work. |
| **Dead code** | `RotateCw`, `Eye`, `Radio`, `Sliders` imported and unused. `HULL_ARCHITECTURES[].icon` defined on all five entries, never read. `protrusions.outriggerTrusses` in state, never read. `protrusions.turretSponsons` consumed by the mesh builder but has no UI toggle. `SoundEngine.muted` never set — call sites check the separate `soundEnabled` state instead. |
| **Naming** | `handleSelectArchitecture` (`:981`) rebuilds the ship name as `prev.name.split(' ')[0] + ' ' + arch.name.split(' ')[0]`, producing "SF-44 Angular" and degrading further on each swap. |
| **Preset identity** | `currentShip.id` survives every edit, so a heavily modified ship still highlights its origin preset as active (`:1449`). |
| **Repo hygiene** | `.DS_Store` is tracked despite being listed in `.gitignore` (added to the ignore file after it was already committed). |
| **Dependencies** | React 18.3, Three r160, Vite 5 — all a generation behind as of this review. |

---

## 5. Accessibility, responsiveness, security

- **Input:** `grep touch|pointer` finds four hits, all of them CSS `cursor-pointer` classes. There is not a single touch or pointer event handler. The camera is driven by `mousedown`/`mousemove`/`wheel` only, so **the entire 3D viewport is inoperable on any touch device**.
- **Keyboard:** no keyboard path to orbit, zoom, or reset the camera. The canvas is not focusable and has no accessible name.
- **Semantics:** the tab bar is five `<button>`s with no `role="tablist"`/`aria-selected`; toggle buttons lack `aria-pressed`; range inputs lack labels; `user-select: none` is applied globally to `<body>`.
- **Layout:** `w-screen h-screen` with a fixed `w-96` sidebar and a magic-number `bottom-4 right-96` preset carousel. Even at 1524 px the viewport hint text is clipped by the carousel — visible in both screenshots. There are no breakpoints; below ~1280 px the header tabs collide with the controls.
- **Audio:** `AudioContext` is never `resume()`d, so on browsers that start it suspended the sound engine is silent until an unrelated gesture happens to unlock it. Contexts are never closed.
- **Meta:** no favicon (guaranteed 404), no description, no Open Graph tags, no manifest.

---

## 6. Documentation accuracy

Cross-checking `README.md` against the implementation:

| README claim | Reality |
| :--- | :--- |
| "Drag-and-drop 2D vector control points" | Points cannot be dragged (§1.5) |
| "continuous Bezier curves" | Polyline; no Bezier anywhere in the file |
| "Gauss Railguns, Plasma Lances, Tachyon Beams" as hardpoints | Weapon choice has zero geometric effect (§3.5) |
| "Fuel Miniaturization" affecting the ship | Fuel choice has zero geometric or numeric effect |
| "self-contained, standalone `.html` viewer" | Loads three.js from a CDN; not self-contained (§1.6) |
| "customizable lighting, engine exhaust particles" | Accurate |
| "360° Orbital Viewport … auto-rotation" | Orbit-by-drag works; auto-rotation does not (§1.1) |
| "R&D Tech Tree with XP spending and unlocks" | Spends XP; unlocks gate nothing (§1.3) |
| "AI Starship Architect" | A `setTimeout` over four `String.includes` branches; no model involved |

`agent-handoff/AGENT_INSTRUCTIONS.md` is more accurate about *structure* — its seam table and proposed Postgres schema are genuinely reusable — but it opens with "Built full React + Three.js interactive 3D WebGL starship visualizer" and lists the Bezier engine and standalone bundle generator as completed work.

---

## 7. What is worth keeping

A rewrite plan should not discard the following, which are the prototype's real output:

- **The domain model.** `COMPONENT_DATABASE`, `HULL_ARCHITECTURES`, and `SHIP_PRESETS` are a coherent, well-named, internally consistent design vocabulary with sensible tiering. This is the expensive part to invent and it is good.
- **The visual language.** The glass-panel HUD, Orbitron/JetBrains Mono pairing, and the cyan/indigo/amber/rose accent system are a legible, appropriate identity. Keep it; reimplement it on a real Tailwind build.
- **The information architecture.** Five tabs — Foundry, Paradigms, Spline, R&D, AI — is the right decomposition of the problem.
- **The handoff document's seam table.** The mapping from mock location to intended endpoint is exactly the right artefact to have written, and §2 of it survives review largely intact.
- **The four diagnostic render modes.** PBR / wireframe / x-ray / thermal is a genuinely good idea for a CAD-adjacent tool and is worth building properly as a shader-level feature.

---

## 8. Severity ranking

**P0 — blocks any production claim**
1. No persistence of any kind; refresh destroys all work
2. GPU memory leak on every mesh rebuild (§2.1)
3. Auto-rotate and Test Burn are inert (§1.1, §1.2)
4. Viewport unusable on touch devices (§5)
5. Tailwind CDN in production (§1.7)

**P1 — blocks a quality claim**
6. No IBL; metallic hulls render black (§3.1)
7. No shadows (§3.2)
8. Protrusions clip through hulls on 4 of 5 archetypes (§3.4)
9. README materially overstates the product (§6)
10. Weapons/sensors/fuel have no visual or numeric effect (§1.4, §3.5)

**P2 — engineering foundation**
11. 1,889-line single file; no tests, lint, types, or CI (§4)
12. HTML export is broken and unescaped (§1.6)
13. R&D economy has no consequence (§1.3)
14. Accessibility and responsive layout (§5)

Remediation is sequenced in [`PRODUCTION_PLAN.md`](./PRODUCTION_PLAN.md); the renderer rebuild is specified in [`RENDER_PIPELINE.md`](./RENDER_PIPELINE.md).
