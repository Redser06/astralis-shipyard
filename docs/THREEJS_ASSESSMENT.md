# Does three.js itself get us further?

Assessment requested after the engine-hardening run: is the library we already
have enough for 3D modelling and ambient light, or do we need something else?

**Short answer: yes, it is enough, and we are using a fraction of it.** Nothing
new needs installing. The gap between what renders today and a convincing
starship is *surface detail density*, not missing library capability.

Everything below was verified against the installed tree, not from memory.

---

## 1. What is installed

| Package | Version |
| :--- | :--- |
| `three` | 0.185.1 |
| `@react-three/drei` | 10.7.8 |
| `@react-three/postprocessing` | 3.0.5 |
| `postprocessing` | 6.39.4 |
| `three-mesh-bvh` | 0.8.3 (transitively, via drei) |
| `n8ao` | 2.0.1 (transitively, via @react-three/postprocessing) |

## 2. What we actually use

**three addons:** `GLTFExporter`. That is the entire list. `DecalGeometry`,
`RoundedBoxGeometry`, `ConvexGeometry`, `LoftGeometry` and
`ParametricGeometry` all ship in the installed copy and are untouched.

**drei:** `Decal`, `Environment`, `Lightformer`, `OrbitControls`, `Stars`.

Verified present and unused — resolved through the type checker rather than by
grepping, because drei re-exports with `export * from './web'` and a naive grep
reports false absences:

> `Bvh`, `useBVH`, `Detailed`, `Instances`, `Merged`, `Edges`, `Sampler`,
> `useTexture`, `shaderMaterial`, `Outlines`, `Sparkles`, `SoftShadows`

**Post-processing chain:** `EffectComposer` → `Bloom` → `SMAA`.

Present in the installed wrapper and unused:

> `N8AO`, `SSAO`, `GodRays`, `DepthOfField`, `Vignette`, `Noise`,
> `ChromaticAberration`, `ToneMapping`, `Outline`

---

## 3. Ambient light, specifically

Current lighting inventory across `src/render`:

| Light | Count |
| :--- | :--- |
| `directionalLight` | 3 |
| `pointLight` | 2 |
| `spotLight` | 1 |
| `ambientLight` | 1 |

Plus image-based lighting from a `drei` `Environment` built out of
`Lightformer`s — no HDRI download, which is why the scene works offline.

The point and spot lights are new; before the R3/R4 work there were **zero** of
either, and the ship could not cast or receive local light at all.

### The one thing missing, and it is already paid for

`ambientLight` is a flat term added to every surface equally. It cannot darken a
crevice, because it has no idea a crevice exists. That is why the hulls still
read slightly "plastic" in recesses: truss interiors, the gap under a radiator
frame, the inside of an engine bell and the seam where a mount collar meets
plate all receive exactly as much ambient as an exposed panel.

**Ambient occlusion is the fix, and `N8AO` is already a direct dependency of a
package we already ship.** It is a screen-space effect that slots into the
existing composer between `Bloom` and `SMAA`:

```tsx
<EffectComposer enableNormalPass>
  <N8AO aoRadius={0.6} intensity={2} distanceFalloff={0.7} />
  <Bloom … />
  <SMAA />
</EffectComposer>
```

Two caveats worth knowing before wiring it:

- It needs `enableNormalPass` on the composer, which the current config
  explicitly disables. That costs a render pass.
- Under SwiftShader (how CI renders) an extra full-screen pass is not free. The
  visual suite already runs at four to five frames a second; budget for it and
  re-check the Playwright timeouts.

`SoftShadows` (drei) is the second cheap win — it replaces the hard `PCFSoft`
shadow edge with a percentage-closer-soft-shadow kernel, and is a drop-in
component.

---

## 4. 3D modelling

three gives us everything the current approach needs, and the current approach
is the constraint. The render layer is built from hand-placed primitives —
boxes, cylinders, capsules, lathes, tori. That is fine and it is legible, but it
means detail density is bounded by how many `<mesh>` elements someone typed.

What is available and would raise fidelity most, in order:

1. **`Instances` / `Merged`** — greebling. Rivet rows, panel fasteners, conduit
   clamps, antenna stubs. A hundred instanced greebles cost roughly one draw
   call; a hundred hand-placed meshes cost a hundred. This is the single biggest
   available step toward "looks built rather than assembled".
2. **`Edges` / `Outlines`** — panel lines and chamfer highlights, and a much
   better Holo Wireframe mode than the current whole-mesh wireframe.
3. **`RoundedBoxGeometry`** — every blocky component currently has perfectly
   sharp arrises. Real plate has a radius, and a radius is what catches a
   specular highlight. Cheap, and it changes the read of the whole ship.
4. **`Detailed` (LOD)** — not needed yet at ~200-390 draw calls, but it is the
   escape valve once greebling multiplies that.
5. **`shaderMaterial`** — declarative custom materials, which is the honest
   route to per-texel wear (see the warning below).

**Booleans are not the answer.** We considered CSG for real window openings and
damage holes and rejected it on evidence: `three-bvh-csg` is stale at 0.0.x,
an independent 1000-pair benchmark returned watertight output on only 22 of
1000 cases, and it peer-conflicts with the `three-mesh-bvh` drei already ships —
two competing monkeypatches on `Mesh.prototype.raycast`. Non-watertight output
would also silently corrupt `src/export/glb.ts`. Decals are cheaper, more
convincing, and already working.

---

## 5. Two compatibility warnings

**`postprocessing` is one three release from breaking.** It declares
`peerDependencies: three ">= 0.168.0 < 0.186.0"`. We are on **0.185.1**. The
next three minor bump strands the entire post chain — `Bloom`, `SMAA`, and any
`N8AO` we add. Pin `three` and watch `pmndrs/postprocessing` before upgrading.

**`docs/RENDER_PIPELINE.md` §6 is wrong about TSL, and I wrote it.** It proposes
TSL node materials for per-texel wear masks. TSL node materials require
`WebGPURenderer`; `pmndrs/postprocessing` is `WebGLRenderer`-only. Following
that plan silently means deleting `Bloom`, `SMAA` and any AO. Use
`three-custom-shader-material` — the one new runtime dependency worth adding —
which keeps the post chain. That is also the correct route for item 5 above.

---

## 6. Recommendation

Install nothing. In priority order:

1. Wire `N8AO` into the composer — the ambient-light gap, already paid for.
2. `RoundedBoxGeometry` on blocky fittings — largest visual return per line.
3. `Instances` for greebling — the real fidelity ceiling.
4. `Edges` for panel lines, and a better Holo mode.
5. `SoftShadows`.
6. Only if per-texel wear becomes a priority: add
   `three-custom-shader-material`, and correct `RENDER_PIPELINE.md` §6.
