<div align="center">

# Astralis Shipyard

**An interactive 3D starship design studio — build, kit out, and weather your own spacecraft in the browser.**

React 19 · Three.js · React Three Fiber · TypeScript · Vite

</div>

---

> **Status: client rebuilt, no backend yet.** The renderer, the component system and
> the wear system are real and tested. There is still no persistence — a refresh
> destroys your design. §3 lists exactly what works and what does not, and it is
> accurate. Please keep it that way.

---

## 1. What this is

Astralis Shipyard is a visual design tool for fictional spacecraft. You pick a
**structural archetype** — the fundamental architecture of the hull — then fit it with
drives, FTL cores, weapons, sensors and fuel containment, choose a hull composite, set
how hard a life it has had, and watch the ship rebuild in a real-time 3D viewport.

The premise the design vocabulary is built around: **in vacuum there is no air
resistance, so spacecraft should not look like aeroplanes.** Real deep-space vessels
would be dominated by the constraints that actually bind in space — waste-heat
rejection, structural load paths under thrust, radiation shielding, modularity — which
is why the archetypes lean on exposed trusses, enormous radiator panels, faceted
low-observability plating and outrigger nacelle booms rather than swept wings. One
archetype (`aerodynamic_sleek`) deliberately breaks the rule, for craft intended to
make atmospheric reentry.

### Intended audience

Worldbuilders, tabletop and game designers, concept artists sketching silhouettes, and
science-fiction writers who want a specific ship rather than a generic one.

### The product question that is still open

The project is still ambiguous about whether it is a **creative tool** (ships are art,
users make and share them), a **game system** (ships have competing stats and a
progression economy), or a **portfolio piece**. This meaningfully changes the backend
scope. See [`docs/PRODUCTION_PLAN.md` §1](docs/PRODUCTION_PLAN.md) — settling it is
still the first decision to make.

---

## 2. Concepts

### Hull archetypes

The primary design choice. Each archetype is a different structural philosophy, a
different silhouette, and a different set of **sockets** where hardware mounts.

| Archetype | Character |
| :--- | :--- |
| **Angular Stealth Frigate** | Faceted radar-deflecting plates, razor chines, recessed weapon sponsons |
| **Industrial Heavy Modular** | Exposed zero-g trusses, segmented cargo pods, outboard engine nacelles, huge radiators |
| **Brutalist Battlecruiser** | Armoured hammerhead prow, elevated citadel bridge, flanking armour skirts |
| **Outrigger Long-Range Science** | Twin boom spars, cross-struts, habitat ring, telemetry arrays |
| **Aerodynamic Hybrid Cruiser** | Smooth lathed delta airframe — the one archetype built for atmosphere |

### Component hardpoints

Six swappable categories, each tiered 1–4 by technology level. **Every one of them
changes the geometry**, not just a label.

| Category | Tier 1 → Tier 4 |
| :--- | :--- |
| **Sublight drive** | Ion pulse → magnetoplasmadynamic torch → thermonuclear fusion torch |
| **FTL core** | None → hyperspace shunt → Alcubierre warp ring → graviton fold engine |
| **Weapons** | Gauss railguns → plasma lance → quantum torpedoes → tachyon disruptor |
| **Sensors** | Radar dome → coherent LADAR spine → tachyon spacetime scanner |
| **Fuel** | Cryogenic H₂ bulk tanks → D-He3 magnetic bottles → antimatter pods → zero-point micro-singularity |
| **Hull composite** | Duranium plating → carbon-nanotube weave → titanium-aerogel → chronium metamaterial |

Fuel is a genuine design axis rather than a stat bump: tier-1 tanks are bulky external
volume, tier-4 is a micro-core, and you can see the difference on the hull.

### The condition system

One `condition` scalar in [0, 1] drives **seven independent wear channels** — edge
abrasion, accumulated grime, thermal scoring, micrometeorite pitting, oxidation
staining, mismatched replacement plating, and structural damage. The same blueprint
renders as a mirror-finish **Fleet Commission** parade ship or a patched, rust-stained
**Frontier Salvage** hauler with the same bones.

Replacement plating deliberately **peaks mid-life and falls away again**: a working ship
gets patched, an abandoned one stops being maintained. At the far end a **Derelict
Hulk** loses its running lights, its exhaust plume and its FTL glow, and tumbles slowly.

Wear also degrades performance, so the slider is not purely cosmetic.

Every stochastic choice draws from a seeded PRNG stored on the blueprint, so a given
ship renders identically every time. That determinism is covered by tests.

### Diagnostic render modes

Four viewport shading modes: **Photoreal PBR**, **Holo wireframe**, **X-Ray internal**
and **Thermal IR**.

---

## 3. What actually works

Written from observed behaviour, per [`docs/AGENT_PLAYBOOK.md`](docs/AGENT_PLAYBOOK.md)
§A1 — verified by running the app and by an automated suite, not by reading the source.

### ✅ Works

- Real-time procedural 3D ship generation across all five archetypes
- **Image-based lighting**, shadow mapping, bloom and SMAA — hulls read as metal
- **Socket-based mounting**: hardware belongs to the hull it is bolted to, so nothing
  clips through the Brutalist hull or floats free of the Outrigger booms
- **All six component pickers change the mesh**, differentiated by tier
- **Derived stats** (`speed / armour / firepower / stealth / warp`) computed from the
  fitted components and displayed live
- **Research gating** that actually gates — locked technology is disabled in the
  Designer with the cost shown, and presets containing locked tech are disabled too
- The condition system, end to end, including the derelict state
- Orbit camera by mouse **and touch**, five camera presets
- Three environments: orbital drydock with gantry and welding sparks, ion nebula,
  asteroid belt
- Auto-rotate, rotation speed, light intensity, and the radiator / sensor / RCS toggles
- Test Burn visibly lengthens the plume and brightens the radiators
- **Real `.glb` export** via `GLTFExporter`
- Web Audio synthesised UI sounds, with mute
- Keyboard-operable controls with visible focus, WebGL2 capability check with a fallback

### ⚠️ Partial

| Area | Reality |
| :--- | :--- |
| **Wear rendering** | Driven through PBR parameters and colour (roughness up, metalness down, soot and rust tinting) — **not** yet per-texel masks. Curvature, cavity-AO and panel-ID masking from `docs/RENDER_PIPELINE.md` §6 is still to come, so wear reads as uniform weathering rather than dirt in the crevices. |
| **`.glb` export** | Implemented and downloads, but has **not** been opened in Blender to confirm fidelity. |
| **Responsive layout** | Stacks below `lg`, but is not tuned for phones. |

### ❌ Absent

No backend, no accounts, no persistence — **a refresh destroys your design.** No GTAO,
no instancing or LOD, no texture compression. No public gallery, forking or sharing.

### Removed, deliberately

- **AI Ship Architect** — was not a model. It was a `setTimeout` over four
  `String.includes` branches that swapped in preset configurations. Presenting that as
  AI was the least honest thing in the codebase, so it is gone until it is real
  (`docs/PRODUCTION_PLAN.md` §5).
- **Spline Sculptor** — its points could not be dragged, its "Bezier" curve emitted only
  polyline `L` commands, and it affected exactly one archetype. Removed rather than left
  as a third inert control.

---

## 4. Running it

Requires Node 20.19+ or 22+.

```bash
npm install
npm run dev            # http://localhost:3000
npm run build          # typecheck + production build → dist/
npm run preview        # serve the production build
```

Gates:

```bash
npm run typecheck      # tsc --noEmit, strict
npm run lint           # ESLint, exhaustive-deps as error
npm test               # Vitest — 43 domain unit tests
npm run test:visual    # Playwright — 11 behavioural/render tests
```

**Browser support:** needs WebGL2, and says so on an unsupported browser instead of
rendering a blank page. Works with touch.

---

## 5. Repository layout

```
astralis-shipyard/
├── index.html                 App shell (no CDNs)
├── vite.config.ts
├── postcss.config.mjs         Tailwind v4 via PostCSS — see the note below
├── playwright.config.ts
├── eslint.config.js
├── firebase.json
├── .github/workflows/ci.yml
├── src/
│   ├── main.tsx
│   ├── App.tsx                Shell, state and UI panels
│   ├── index.css              Tailwind theme, self-hosted fonts
│   ├── domain/                Pure logic — never imports three
│   │   ├── types.ts           Blueprint, Socket, Archetype, wear
│   │   ├── architectures.ts   The five archetypes + stat modifiers
│   │   ├── components.ts      The component catalogue
│   │   ├── presets.ts
│   │   ├── stats.ts           Derived stats  (+ stats.test.ts)
│   │   ├── unlocks.ts         Research gating  (+ unlocks.test.ts)
│   │   ├── condition.ts       The wear system  (+ condition.test.ts)
│   │   ├── rng.ts             Seeded PRNG  (+ rng.test.ts)
│   │   └── sound.ts
│   ├── render/
│   │   ├── Viewport.tsx       Canvas, camera, controls, post-processing
│   │   ├── Ship.tsx           Blueprint → scene graph
│   │   ├── sockets.ts         Attachment points per archetype
│   │   ├── viewportOptions.ts Three-free option tables
│   │   ├── hulls/             One component per archetype
│   │   ├── parts/             Radiators, engines, turrets, sensors, fuel, FTL
│   │   ├── environments/      IBL rigs + drydock / nebula / asteroids
│   │   └── materials/
│   ├── ui/primitives.tsx
│   └── export/glb.ts
├── tests/visual/render.spec.ts
└── docs/
    ├── CODE_REVIEW.md         Evidence-based review of the prototype
    ├── RENDER_PIPELINE.md     Target 3D architecture
    ├── PRODUCTION_PLAN.md     Phased plan, backend design, data model
    └── AGENT_PLAYBOOK.md      Review method and coding standards
```

`src/domain` never importing `three` is a load-bearing constraint: it is what lets
stats, gating and wear determinism be unit-tested without a GPU.

---

## 6. Two things worth knowing before you change the build

**Tailwind runs through PostCSS, not `@tailwindcss/vite`.** As of `tailwindcss@4.3.3`,
the Vite plugin under Vite 8 emits the theme and the layer scaffolding but **no
utilities at all** — verified by producing `.flex` from the standalone Tailwind CLI and
not from the Vite plugin, with the same stylesheet. The symptom is brutal and silent:
the entire layout collapses to unstyled document flow. If you switch back, check that
`dist/assets/*.css` actually contains `display:flex`.

**The render stack is lazy-loaded.** `src/render/Viewport` is behind `React.lazy`, which
keeps three, R3F, drei and postprocessing (~785 kB) out of the initial chunk. Anything
the shell imports at module scope must stay free of `three`, which is why
`src/render/viewportOptions.ts` exists.

---

## 7. Where this is going

[`docs/PRODUCTION_PLAN.md`](docs/PRODUCTION_PLAN.md) has the full sequence. What remains:

| Phase | Focus |
| :--- | :--- |
| **2** | Persistence — Supabase, auth, blueprint CRUD, autosave, version history |
| **4b** | Per-texel wear masks (curvature, cavity AO, panel ID) via TSL node materials |
| **5** | Share it — public gallery, forking, and a real AI architect |
| **6** | Harden — GTAO, instancing, LOD, texture compression, phone layouts |

---

## 8. Contributing

CI gates typecheck, lint, unit tests, build and the browser suite on every PR. Beyond
that:

1. **Run the app and click what you changed.** Most defects in this codebase's history
   would have been caught by opening it.
2. New controls do something, or are visibly disabled with a reason.
3. Anything that claims to be a model, is one.
4. §3 of this README still matches reality.

Standards are in [`docs/AGENT_PLAYBOOK.md`](docs/AGENT_PLAYBOOK.md). The short version:

> **Compiling is not working. Run it, look at it, click it — then write down only what
> you saw.**
