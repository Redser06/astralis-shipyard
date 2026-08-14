<div align="center">

# Astralis Shipyard

**An interactive 3D starship design studio — build, kit out, and weather your own spacecraft in the browser.**

React · Three.js · WebGL · Vite

</div>

---

> **Status: working prototype.** This is a single-session exploratory build, not a product. It runs and it demonstrates the concept, but it has no backend, several controls are inert, and the renderer is missing key features. §3 below lists exactly what works and what does not, and it is accurate — please keep it that way.

---

## 1. What this is

Astralis Shipyard is a visual design tool for fictional spacecraft. You pick a **structural archetype** — the fundamental architecture of the hull — then fit it with drives, FTL cores, weapons, sensors, and fuel containment, choose a hull composite, and watch the ship rebuild in a real-time 3D viewport.

The premise the design vocabulary is built around: **in vacuum there is no air resistance, so spacecraft should not look like aeroplanes.** Real deep-space vessels would be dominated by the constraints that actually bind in space — waste-heat rejection, structural load paths under thrust, radiation shielding, modularity — which is why the archetypes lean on exposed trusses, enormous radiator panels, faceted low-observability plating, and outrigger nacelle booms rather than swept wings. One archetype (`aerodynamic_sleek`) deliberately breaks the rule, for craft intended to make atmospheric reentry.

### Intended audience

Worldbuilders, tabletop and game designers, concept artists sketching silhouettes, and science-fiction writers who want a specific ship rather than a generic one.

### The product question that is still open

The prototype is ambiguous about whether it is a **creative tool** (ships are art, users make and share them), a **game system** (ships have competing stats and a progression economy), or a **portfolio piece**. This meaningfully changes the backend scope. See [`docs/PRODUCTION_PLAN.md` §1](docs/PRODUCTION_PLAN.md) — settling it is the first decision to make.

---

## 2. Concepts

### Hull archetypes

The primary design choice. Each archetype is a different structural philosophy and produces a fundamentally different silhouette.

| Archetype | Character |
| :--- | :--- |
| **Angular Stealth Frigate** | Faceted radar-deflecting plates, razor chines, recessed weapon sponsons |
| **Industrial Heavy Modular** | Exposed zero-g trusses, segmented cargo pods, outboard engine nacelles, huge radiators |
| **Brutalist Battlecruiser** | Armoured hammerhead prow, elevated citadel bridge, flanking armour skirts |
| **Outrigger Long-Range Science** | Twin boom spars, cross-struts, telemetry and communications arrays |
| **Aerodynamic Hybrid Cruiser** | Smooth lathed delta airframe — the one archetype built for atmosphere |

### Component hardpoints

Six swappable categories, each tiered 1–4 by technology level:

| Category | Tier 1 → Tier 4 |
| :--- | :--- |
| **Sublight drive** | Ion pulse → magnetoplasmadynamic torch → thermonuclear fusion torch |
| **FTL core** | None → hyperspace shunt → Alcubierre warp ring → graviton fold engine |
| **Weapons** | Gauss railguns → plasma lance → quantum torpedoes → tachyon disruptor |
| **Sensors** | Radar dome → coherent LADAR spine → tachyon spacetime scanner |
| **Fuel** | Cryogenic H₂ bulk tanks → D-He3 magnetic bottles → antimatter pods → zero-point micro-singularity |
| **Hull composite** | Duranium plating → carbon-nanotube weave → titanium-aerogel → chronium metamaterial |

Fuel is a genuine design axis rather than a stat bump: tier 1 tanks are bulky external volume, tier 4 is a micro-core. Miniaturisation is meant to buy back hull space.

### Space hardware

Toggleable protrusions that give the ships their non-aerodynamic character: glowing heat-radiator panels, sensor masts and high-gain dishes, RCS vernier thruster quads, and turret sponsons.

### Diagnostic render modes

Four viewport shading modes: **Photoreal PBR**, **Holo wireframe**, **X-Ray internal**, and **Thermal IR**.

---

## 3. What actually works

Written from observed behaviour, per the standard in [`docs/AGENT_PLAYBOOK.md`](docs/AGENT_PLAYBOOK.md) §A1. Verified by running the app, not by reading the source.

### ✅ Works

- Real-time procedural 3D ship generation across all five archetypes
- Orbit camera by mouse drag, zoom by wheel, five preset camera angles
- Archetype switching, and the four ship presets
- Sublight / FTL / weapon / sensor / fuel / material pickers (state changes correctly; see below for what is *rendered*)
- FTL choice visibly changes the model — Alcubierre fits a torus ring, graviton fits a wireframe singularity core
- Hull composite changes material colour, roughness, and metalness
- Three environments: orbital drydock with animated gantry and welding sparks, nebula, asteroid field
- Radiator / sensor-mast / RCS hardware toggles
- Lighting intensity slider
- Four render modes
- Web Audio synthesised UI sounds, with mute
- The R&D tab spends XP and marks technologies unlocked

### ⚠️ Stubbed — present but inert

| Control | Reality |
| :--- | :--- |
| **Auto-rotate toggle** | Label and speed slider respond; the camera does not move. Stale-closure bug. |
| **Test Burn** | Label changes and a sound plays; nothing in the 3D scene reacts. |
| **R&D unlocks** | XP is spent, but locked technology is freely selectable in the Designer regardless. |
| **Spline Sculptor** | Points cannot be dragged (only the sliders work), the curve is a polyline rather than a Bezier, and it affects only the `aerodynamic_sleek` archetype. |
| **Weapons / sensors / fuel** | Selection is stored and displayed but produces **no geometry change**. Turret sponsons are identical for every weapon. |
| **Ship stats** | `speed/armor/firepower/stealth/warp` exist on every preset and are never displayed or recalculated. |
| **AI Ship Architect** | Not a model. A `setTimeout` over four `String.includes` branches that swap in preset configurations. |
| **Export HTML** | Downloads a file, but it loads three.js from a CDN (so it is not self-contained) and renders a placeholder cone rather than your ship. |

### ❌ Absent

No backend, no accounts, no persistence — **a refresh destroys your design.** No touch support, so the viewport is unusable on tablets and phones. No tests, linting, TypeScript, or CI. No responsive layout below ~1280 px. No shadows, environment lighting, or post-processing in the renderer. No accessibility work.

---

## 4. Known issues

Full detail with file/line references in [`docs/CODE_REVIEW.md`](docs/CODE_REVIEW.md).

- **Metallic hulls render near-black.** Materials run `metalness` 0.85–1.0 with no environment map, and a metal with nothing to reflect is correctly black. This is the single largest visual defect and the cheapest to fix.
- **GPU memory leak on every rebuild.** Geometries and materials are detached but never disposed; dragging a slider leaks continuously.
- **Protrusions clip through hulls.** Radiators and engines sit at hardcoded world coordinates tuned for one archetype, so they intersect the Brutalist hull and float free of the Outrigger.
- **Tailwind is loaded from its CDN**, which Tailwind itself warns against in the console on every load.
- **712 kB single JS chunk**, no code splitting.

---

## 5. Running it

Requires Node 18+.

```bash
npm install
npm run dev        # http://localhost:3000
npm run build      # → dist/
npm run preview    # serve the production build
```

Deploy to a Firebase preview channel:

```bash
npx firebase-tools hosting:channel:deploy astralis-shipyard-preview
```

**Browser support:** needs WebGL2. There is no fallback screen — an unsupported browser gets a blank page. Desktop only; the viewport does not respond to touch.

---

## 6. Repository layout

```
astralis-shipyard/
├── index.html                 Tailwind CDN config, fonts, glass-panel CSS
├── vite.config.js
├── firebase.json              Hosting config (SPA rewrite → /index.html)
├── src/
│   ├── main.jsx               React root (9 lines)
│   └── App.jsx                The entire application (1,889 lines)
├── agent-handoff/
│   └── AGENT_INSTRUCTIONS.md  Original handoff: seams and proposed schema
└── docs/
    ├── CODE_REVIEW.md         Evidence-based review of the prototype
    ├── RENDER_PIPELINE.md     Target 3D architecture, quality and variation
    ├── PRODUCTION_PLAN.md     Phased plan, backend design, data model
    └── AGENT_PLAYBOOK.md      Review method and coding standards
```

### How `App.jsx` is organised

One file, read top to bottom:

| Lines | Contents |
| :--- | :--- |
| 33–94 | `SoundEngine` — Web Audio synthesiser for UI sounds |
| 96–133 | `HULL_ARCHITECTURES` — the five archetype definitions |
| 135–171 | `COMPONENT_DATABASE` — the full component catalogue |
| 173–231 | `SHIP_PRESETS` — four preconfigured ships |
| 233–314 | Component state and Three.js refs |
| 316–470 | Scene setup effect — renderer, camera, lights, controls, render loop |
| 472–527 | Lighting rig and camera helpers |
| 529–627 | `buildEnvironment` — starfield, drydock gantry, nebula, asteroids |
| 629–978 | `rebuildShipMesh` — the procedural ship compiler |
| 980–1155 | Event handlers, mock AI, HTML export |
| 1157–1889 | The UI — header, viewport overlays, five sidebar tabs |

---

## 7. How the renderer works today

A single `useEffect` builds a `WebGLRenderer` with ACES tone mapping into a mounted div, sets up seven lights, and starts a `requestAnimationFrame` loop.

`rebuildShipMesh()` is the core. It clears the ship group, selects a material set from the current render mode, branches on the archetype to build a primary hull out of Three.js primitives, then bolts on protrusions, engine nacelles, an FTL component, and an exhaust particle system. It re-runs whenever the ship, render mode, spline, or protrusion toggles change.

Camera control is hand-rolled spherical orbit — `theta`, `phi`, `radius` in a ref, updated by mouse drag and wheel.

**This is the part of the codebase most in need of replacement.** The target architecture — image-based lighting, shadows, a socket-based attachment system, PBR texture sets, post-processing, and the condition/wear system — is specified in [`docs/RENDER_PIPELINE.md`](docs/RENDER_PIPELINE.md).

---

## 8. Where this is going

Roughly four months of work to production, sequenced in [`docs/PRODUCTION_PLAN.md`](docs/PRODUCTION_PLAN.md):

| Phase | Focus |
| :--- | :--- |
| **0** | Foundation — TypeScript, lint, tests, CI, real Tailwind, fix the inert controls and the leak |
| **1** | Make it look good — HDRI lighting, shadows, bloom, migrate to React Three Fiber |
| **2** | Persistence — Supabase, auth, blueprint CRUD, autosave, version history |
| **3** | Make choices matter — socket system, real weapon/sensor meshes, a working stats engine |
| **4** | Variation — the condition system: pristine parade finish through to derelict hulk |
| **5** | Share it — `.glb` export, public gallery, forking, a real AI architect |
| **6** | Harden — accessibility, responsive layout, performance budget, security |

Phases 0 and 1 are about five weeks and produce something that looks and behaves like a real product.

### The condition system

The most distinctive planned feature. A single `condition` scalar drives seven independent wear channels — abrasion on convex edges, grime in cavities, thermal scoring near engine bells, micrometeorite pitting, oxidation staining, mismatched replacement plating, and structural damage — so the same blueprint can render as a mirror-finish **Fleet Commission** parade ship or a patched, asymmetric, jury-rigged **Frontier Salvage** hauler with the same bones. At the far end, a **Derelict Hulk** kills the running lights and the exhaust plume and tumbles slowly.

Every stochastic choice is driven by a seeded PRNG stored on the blueprint, so a saved ship renders identically every time. Full specification in [`docs/RENDER_PIPELINE.md` §6](docs/RENDER_PIPELINE.md).

---

## 9. Contributing

There is no CI yet, so please check by hand until Phase 0 lands:

1. `npm run build` succeeds.
2. **Run the app and click what you changed.** Most defects in this codebase would have been caught by opening it.
3. Anything allocated on the GPU is disposed.
4. New controls do something, or are visibly disabled.
5. §3 of this README still matches reality.

Standards are in [`docs/AGENT_PLAYBOOK.md`](docs/AGENT_PLAYBOOK.md). The short version:

> **Compiling is not working. Run it, look at it, click it — then write down only what you saw.**
