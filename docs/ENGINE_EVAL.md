# Engine eval

Four requirements were set for the 3D engine. This is how each is verified, and
what a future contributor must not break.

Run it:

```bash
PW_PORT=3105 npx playwright test tests/visual/engine-eval.spec.ts
```

One parameterised test per archetype, each at three conditions (pristine 0.05,
worn 0.55, derelict 0.95). Artifacts land in `/tmp/astralis-eval/`: a
`eval-<archetype>.json` of raw measurements, and screenshots of the hero view,
a mount join, the windows, the bridge and the thruster at each condition.

---

## R1 — Nothing disconnected

**Assertion.** The spec walks the ship's scene graph in-page, computes each
mesh's world-space `Box3`, and requires every solid mesh to intersect or abut at
least one other within a tolerance. Orphans are reported by name and world
position.

Points clouds, sprites, lights and decals are exempt **by rule, not by silently
skipping** — a decal floats by definition, and an exhaust particle is meant to
leave. The exempt count is reported alongside the solid count so a future change
cannot quietly move a real part into the exempt bucket.

**Current result: zero orphans**, on all five archetypes at all three
conditions, across 181–272 solid meshes each.

**Do not break.** Sockets resolve onto the real hull skin by ray cast
(`src/domain/hullForm.ts`, `resolveSockets`). Hand-typing a standoff back into
`src/render/sockets.ts` is what put engine bells two units aft of the last plate
in the first place. A socket position is *intent* — which structure, and which
way it faces — and the ray does the seating.

## R2 — Bolt-on components and damage

**Assertion.** Damage-mark counts must rise with condition, and the same seed
must reproduce the same marks and the same positions across a page reload
(compared by digest, not by eye).

`tests/visual/render.spec.ts` separately asserts that each of the three kinetic
weapons added to the registry renders distinct geometry — they exist only as
entries in `src/domain/components.ts` and `src/domain/fittings.ts`, and no
renderer knows their names. If a recipe kind silently drew nothing, two of them
would look identical and that test would fail.

**Do not break.** Damage placement is seeded off the blueprint. `deriveWear` in
`src/domain/condition.ts` draws one jitter per channel from a single stream in
source order, so **inserting a wear channel anywhere but the end silently
re-rolls every existing ship** and the determinism tests will not catch it.
Append only.

## R3 — Windows and exterior lighting

**Assertion.** Placement is a pure, seeded rule engine (`src/domain/windows.ts`)
and is unit-tested directly. The browser eval then checks the rendered result:

| Check | Current |
| :--- | :--- |
| Apertures within the fuel exclusion radius | **0 on every archetype** |
| Apertures violating engine or weapon exclusion | **0** |
| Oversize apertures near a weapon | **0** |
| Flight decks per ship | exactly 1 |
| Bridge area vs largest porthole | 0.38–1.25 vs 0.091 |

**No windows near fuel is absolute.** It is the one rule with no size-based
softening: beyond the weapon radius a port is allowed at reduced size, but a
fuel keep-out is a refusal. Treat a `fuelViolations` entry as a build failure.

Margin is thin on `industrial_expanse` — the closest aperture clears the fuel
boundary by **0.016 units**. Moving a fuel socket outboard on that archetype
without re-running this eval will breach it.

## R4 — Engine thrust

**Assertion.** Framebuffer luminance is sampled in the region aft of the engines
with Test Burn off and on, and must rise materially. Current: mean **53–62 idle
→ 139–192 burning**, roughly 3×.

**Do not break.** The per-tier `taper` values in `src/domain/plume.ts` are
load-bearing identity, not styling — the MPD is deliberately a broad column and
the fusion torch a spike, and `plume.test.ts` asserts exactly that ratio.
Tightening the taper to stop the column ending bluntly is the wrong fix and the
test will reject it. The dissipation comes from the `wake` shell in
`src/render/parts/Plume.tsx` instead: open-ended cones at uniform opacity do not
fade, they stop, so the wake adds a longer, fainter, converging shell rather
than taking shape away from the tiers.

---

## Determinism, and why the background stopped moving

The reload-determinism check compares two sessions of the same seed. It first
failed on two archetypes at 2.4% drift against a 2% threshold — and the damage
digests matched, so the *wear* was deterministic. The drift was the drydock
itself: welding sparks recycle with `Math.random()`, and against a dark derelict
hull they occupy a much larger share of the crop.

Decorative background motion — sparks, gantry sway, nebula drift, asteroid
rotation — now honours `prefers-reduced-motion`, exactly as the ship's idle bob
and derelict tumble already did. That is the accessibility behaviour and it is
what lets this eval measure the ship rather than the weather behind it. The eval
pins reduced motion before it measures.

**Do not** raise `RELOAD_DIFFERENCE` to make a failure go away. It measures
against a same-session noise floor that is reported alongside it; if drift
exceeds the floor, something genuinely moved.

## Known, open

- `PCFSoftShadowMap` is deprecated in three 0.185 and silently falls back to
  `PCFShadowMap`, so shadow edges are harder than `src/render/Viewport.tsx`
  asks for. `THREE.Clock` is deprecated in favour of `THREE.Timer`.
- No ambient occlusion. `N8AO` is already an installed, unused dependency —
  see `docs/THREEJS_ASSESSMENT.md`.
- Wear is still not per-texel; grime sits on plate rather than in crevices.
