# Render Pipeline Specification

Target architecture for the Astralis Shipyard 3D viewport. This document covers **visual quality** and **ship variation**, the two areas called out in the brief. Sequencing and effort sit in [`PRODUCTION_PLAN.md`](./PRODUCTION_PLAN.md); the defects being corrected are evidenced in [`CODE_REVIEW.md`](./CODE_REVIEW.md).

---

## 1. Why the current render looks like a toy

Recapped from the review, because the fixes below map one-to-one onto these:

| Cause | Consequence on screen |
| :--- | :--- |
| No environment map, `metalness` 0.85–1.0 | Metal has no diffuse term. With nothing to reflect it renders black. Hulls are silhouettes. |
| No shadow map, no AO | No contact, no depth, no sense of scale. |
| Seven lights up to intensity 20 to compensate | Flattens what shading survives; blows out the rest. |
| Untextured primitives, no surface detail | Nothing for the eye to read as "built object". |
| Protrusions at hardcoded world coordinates | Radiators clip through the hull on 4 of 5 archetypes. |
| Untextured `PointsMaterial` | Exhaust is a cloud of opaque squares. |
| No bloom | Emissive surfaces read as light-coloured paint, never as emitting. |

The first row is the dominant one. **Fix IBL before anything else** — it is a day of work and it changes the image more than the rest of this document combined.

---

## 2. Target stack

| Layer | Choice | Why |
| :--- | :--- | :--- |
| Renderer | Three.js **r18x**, `WebGPURenderer` with WebGL2 fallback | TSL node materials are the clean path to the layered wear shader in §6. |
| React binding | `@react-three/fiber` v9 | Declarative scene graph; **automatic disposal on unmount**, which structurally eliminates the leak in review §2.1. |
| Helpers | `@react-three/drei` | `<Environment>`, `<OrbitControls>` (touch included), `<ContactShadows>`, `<Bvh>`, `<PerformanceMonitor>`, `<Gltf>`. |
| Post | `@react-three/postprocessing` (pmndrs) | Bloom, GTAO, SMAA/TAA, tone mapping in one managed pass chain. |
| Assets | glTF 2.0 + **KTX2/Basis** textures, Draco geometry | Compressed on GPU, not just on the wire. |
| Export | `GLTFExporter` → `.glb` | Replaces the broken hand-rolled HTML export. |

`@react-three/fiber` is not cosmetic here. Three of the review's structural defects — leaked geometry, StrictMode double-mount, orphaned animation loops — are categories of bug that R3F removes by construction rather than by discipline.

---

## 3. Lighting

### 3.1 Image-based lighting (the priority fix)

```ts
// Studio drydock: interior HDRI, bright, gives metal something to reflect
<Environment files="/hdri/drydock_2k.hdr" background={false} environmentIntensity={1.0} />

// Deep space: near-black IBL + one hard sun + strong planetary bounce.
// Do NOT use a black environment — metal goes black again.
<Environment preset={null} background={false}>
  <Lightformer intensity={4} position={[10, 5, 0]} scale={[10, 50, 1]} />   {/* sun card */}
  <Lightformer intensity={0.6} color="#2b6cb0" position={[0, -8, 0]}
               scale={[40, 40, 1]} rotation-x={Math.PI / 2} />              {/* planet bounce */}
</Environment>
```

Three environment sets, matched to the existing dock switcher: `drydock` (bright industrial interior), `nebula` (coloured, low-key), `asteroid` (hard sun, dark sky, strong rock bounce). Author each as a 2k HDR, ~1–2 MB, run through `PMREMGenerator` once at load.

**Rule:** every scene must have a non-black `scene.environment`. A deep-space scene with a genuinely black IBL will reproduce the current bug. Use a dim blue-grey ambient IBL plus lightformers; the eye reads it as space, the BRDF reads it as a reflectable world.

### 3.2 Analytical lights

Cut from seven to three, at physically sane intensities once IBL is carrying the base:

- **Key** — `DirectionalLight`, the local star. Casts shadows. Intensity ~3, warm white.
- **Fill** — `DirectionalLight` opposite, ~0.4, cool. Reads as planetary albedo.
- **Rim** — `DirectionalLight` behind, ~2, accent-tinted, to separate hull from background.

Rebind the "LIGHTING" slider to `toneMappingExposure` in the range 0.6–1.6 rather than a raw multiplier on seven lights. That is what the user actually wants (image brightness), and it cannot destroy the lighting ratios.

### 3.3 Shadows

```ts
renderer.shadowMap.enabled = true
renderer.shadowMap.type = THREE.PCFSoftShadowMap    // safe default; evaluate VSM if
                                                    // acne on large flat plates persists
key.castShadow = true
key.shadow.mapSize.set(2048, 2048)
key.shadow.camera = /* tight ortho frustum fitted to the ship's bounding sphere */
```

Fit the shadow camera to the ship bounds each time the blueprint changes, not to the whole scene — a frustum sized for a 400-unit starfield wastes the entire depth range on nothing.

Add `<ContactShadows>` under the hull in drydock mode. Grounding contact shadows are disproportionately effective at making an object feel present, and they cost almost nothing.

### 3.4 Ambient occlusion

GTAO in the post chain (§7). This is what puts dark in the panel gaps, around greebles, and inside truss structures. Along with IBL it is the other half of "looks rendered rather than assembled".

---

## 4. Geometry: sockets, not coordinates

### 4.1 The socket system

The clipping bug in review §3.4 is not a positioning mistake to be re-tuned; it is the absence of an abstraction. Every hull must **declare its own attachment points**, and components must attach to sockets rather than to world coordinates.

```ts
type SocketKind =
  | 'engine' | 'ftl' | 'radiator' | 'turret'
  | 'sensor' | 'rcs' | 'fuel' | 'rigging' | 'greeble'

interface Socket {
  id: string
  kind: SocketKind
  position: Vector3
  normal: Vector3          // outward surface normal — the mount faces this way
  up: Vector3              // roll reference
  size: 'S' | 'M' | 'L'    // components declare what they fit
  mirror?: boolean         // auto-generate the port-side twin; never hand-place both
}

interface HullArchetype {
  id: string
  buildHull(params: HullParams): BufferGeometry
  sockets: Socket[]        // authored per archetype, in hull-local space
  bounds: Box3
}
```

Attachment then becomes: match `kind`, check `size` fits, align component `-Z` to `socket.normal`, position at `socket.position`, scale by hull scale. Clipping stops being a bug class and becomes structurally impossible for correctly-authored sockets.

This also fixes review §3.5 for free: give `weapons`, `sensors`, and `fuel` real meshes and mount them on `turret`/`sensor`/`fuel` sockets, and the three inert hardpoint categories start mattering. A railgun becomes a long thin barrel pair; a plasma lance a stubby emitter with a heat shroud; quantum torpedoes a boxy VLS cell block. That single change gives the Designer tab genuine consequence.

### 4.2 Hull surface quality

Primitives are acceptable as *proxies*; they are not acceptable as the final surface. In priority order:

1. **Bevel every hard edge.** A perfectly sharp 90° edge catches no highlight and reads as CGI. A 1–2 cm chamfer catches a specular line along its whole length. This alone lifts a box out of the uncanny valley.
2. **Panel lines.** Author as a normal + AO detail texture in a second UV channel, triplanar-projected so it works across procedurally-sized hulls. Panel lines are the single strongest "this is a manufactured object at scale" cue.
3. **Greebling.** Procedural instanced detail — vents, hatches, conduits, antennae, docking rings — scattered onto `greeble` sockets and along hull edges with a seeded RNG. Use `InstancedMesh` from a small kit of 15–25 pieces. This is how the genre gets its density.
4. **Insets and cutouts.** Recessed weapon bays and hangar mouths via CSG (`three-bvh-csg`) at build time, cached. Depth in the silhouette matters more than polygon count.
5. **Consistent scale reference.** Place human-scale details — hatches, ladders, running lights, windows — at a fixed real-world size. A 300 m cruiser only reads as 300 m if something on it is 2 m.

### 4.3 LOD and instancing

- Three LOD tiers per component; `<Detailed>` from drei.
- All greebles, RCS blocks, and running lights as `InstancedMesh`.
- Merge static hull pieces into one `BufferGeometry` per material at build time.
- Budget: **< 150 draw calls, < 500k triangles** for a fully-loaded capital ship.

---

## 5. Materials

Replace the six flat `MeshStandardMaterial`s with a small authored library, each a full PBR set (albedo / normal / ORM / optional emissive) at 2k, KTX2-compressed:

| Material | Character |
| :--- | :--- |
| `duranium` | Rolled structural steel, visible weld seams, mid roughness |
| `carbon_nanotube` | Woven anisotropic weave, dark, low roughness |
| `titanium_aerogel` | Brushed light alloy, directional roughness |
| `chronium_cloak` | Near-mirror metamaterial with a subtle iridescent clear-coat |

Use `MeshPhysicalMaterial` sparingly — `clearcoat` on parade finishes, `iridescence` on the metamaterial, `transmission` only on canopies (it is expensive and forces a separate render pass).

**Livery is a separate layer from the base material**: an accent-colour mask multiplied over albedo, so `accentColor` repaints stripes and panel blocks rather than tinting the whole hull.

---

## 6. Ship variation: the condition system

This is the "rugged vs. beautifully maintained" axis from the brief, specified as a first-class feature rather than a texture swap.

### 6.1 Model

A single art-directable scalar `condition ∈ [0, 1]` (0 = factory fresh, 1 = derelict hulk) drives seven independent sub-channels. Each preset sets the scalar; power users override channels individually.

| Channel | Physical story | Driven by |
| :--- | :--- | :--- |
| `abrasion` | Coating worn through to base metal on exposed edges | **Curvature mask** — convex edges wear first |
| `grime` | Particulate and outgassing residue collecting in crevices | **Cavity/AO mask** — inverse of curvature |
| `thermal` | Scorching, discolouration, annealing | **Emitter-proximity field** — distance to engine bells and weapon muzzles |
| `impact` | Micrometeorite pitting, small dents | Blue-noise point scatter, weighted to forward-facing surfaces |
| `oxidation` | Staining, salt-out from vented atmosphere | Triplanar fBm noise, biased along vent vectors |
| `repair` | Mismatched replacement plating, weld beads | **Panel-ID mask** — per-plate random selection |
| `structural` | Missing panels, hull breaches, exposed frame | Geometry-level, not shader |

### 6.2 Masks

Five of the seven are mask-driven, so the masks are the real work — and all are bakeable once per hull at build time:

- **Curvature.** Compute per-vertex from the dihedral angle of adjacent faces, store in a vertex colour channel. Cheap, no texture needed, survives procedural geometry.
- **Cavity/AO.** Bake with an ambient-occlusion pass over the assembled hull; store in vertex colours or a baked lightmap-style texture.
- **Emitter proximity.** Known analytically — engine and weapon socket positions are already in hull-local space. Evaluate `smoothstep` falloff per vertex at assembly time.
- **Panel-ID.** Assign each hull plate an integer ID at generation, write to a vertex attribute. `hash(panelId, seed) < repairAmount` selects that plate for replacement — a different albedo tint, higher roughness, and a weld-bead decal around its border.
- **Flow/streak direction.** In vacuum there is no gravity, so streaks must **not** run "down". They run along vent and thrust vectors. Getting this right is a genuine authenticity marker for the genre and costs nothing — pass a per-ship flow vector and project the streak noise along it.

The panel-ID channel deserves emphasis: **mismatched replacement plating is the highest-value single effect for the "rugged working ship" look.** It is what makes a hull read as *repaired* rather than merely dirty, and it is nearly free once panel IDs exist.

### 6.3 Shader composition

Layer over the base PBR result, in order, each gated by its channel amount:

```
base albedo/roughness/metalness (authored PBR set)
  → oxidation      : hue-shift + roughness up, triplanar fBm
  → grime          : darken + roughness up, masked by cavity
  → thermal        : gradient ramp (straw → blue → grey) masked by emitter proximity
  → repair         : per-panel albedo/roughness override + weld-bead normal detail
  → abrasion       : lerp toward bare-metal (low roughness, metalness 1) masked by curvature
  → impact         : normal-map dents + micro-crater albedo speckle
  → livery         : accent-colour mask, applied last, itself faded by (1 − condition)
```

Implementation path:

- **Now (bridge):** `material.onBeforeCompile` injecting into `#include <map_fragment>` / `#include <roughnessmap_fragment>`. Works on the current renderer. Fragile, but shippable this sprint.
- **Target:** Three.js **TSL node materials**. The stack above is literally a chain of composable nodes; each channel becomes a testable unit and the whole thing gets a live editor almost for free.

### 6.4 Structural damage (geometry, not shader)

Above `condition ≈ 0.8`, wear stops being a surface property:

- **Panel removal** — hide selected plates, reveal a pre-authored substructure shell (frame, tanks, conduit) beneath. Cheaper and more convincing than boolean-cutting holes at runtime.
- **Hull breaches** — pre-authored damage meshes swapped in on `structural` sockets, with torn-edge geometry and interior AO.
- **Bent protrusions** — apply a small random rotation offset to radiators and antennae. Asymmetry reads instantly as damage.

### 6.5 Jury-rigging kit

Rugged ships are not just worn — they are *modified in the field*. A `RiggingKit` of add-on props, instanced onto `rigging` sockets, gated by condition and a seeded RNG:

strapped-on external fuel tank · cargo netting over cargo pods · exposed conduit runs and cable looms · patch plates with visible weld beads · salvage clamps · a mismatched antenna from a different ship class · improvised whip antennae · warning stencils and hand-painted registry numbers · debris shielding on the leading face

Two rules give most of the effect:

1. **Break symmetry.** Pristine ships are bilaterally symmetric; rugged ships must not be. Apply rigging to one side only, at least some of the time. Symmetry is the strongest visual cue for "factory".
2. **Fade the livery.** Crisp painted markings survive on a parade ship and are ghosts on a salvage hauler. Multiply livery opacity by `(1 − condition)` and let the panel-ID replacements interrupt the stripe.

### 6.6 Condition presets

Exposed in the UI as a slider with named stops:

| Preset | `condition` | Character |
| :--- | :--- | :--- |
| **Fleet Commission** | 0.00–0.10 | Mirror clear-coat, crisp livery and registry, ceramic-white radiators, all running lights lit, perfectly symmetric |
| **Active Service** | 0.20–0.35 | Honest scuffing at hatches and handholds, thermal bloom on the bells, panels still matched |
| **Long Patrol** | 0.45–0.60 | Heavy thruster scoring, faded decals, one or two replacement plates, first rigging piece |
| **Frontier Salvage** | 0.70–0.85 | Patchwork plating, weld beads, strapped-on tanks, cargo netting, exposed conduit, mismatched antenna, asymmetric |
| **Derelict Hulk** | 0.90–1.00 | Cold dark radiators, running lights out, hull breaches with exposed frame, no exhaust plume, slow uncommanded tumble |

Note that the extremes change **behaviour**, not only surface: the derelict kills the running lights, the radiator emissive, and the exhaust, and swaps orbit for a slow tumble. Condition should drive the scene's animation and lighting state machine, not just its textures. That is what will sell it.

### 6.7 Determinism

Every stochastic decision — panel replacement, greeble scatter, impact placement, rigging selection — draws from a seeded PRNG (`mulberry32`) keyed on `hash(blueprintId + seed)`. The seed is persisted on the blueprint.

This is a hard requirement, not a nicety: without it a saved ship renders differently on every load, shared links show different ships to different people, and visual regression testing is impossible. Expose the seed in the UI with a "reroll" button — users will treat it as a feature.

---

## 7. Post-processing

Pass order matters:

```
render → GTAO → Bloom (threshold ~1.0, on emissive only) → DoF (optional)
       → ToneMapping (ACES / AgX) → SMAA → output
```

- **Bloom** is what makes engine bells, warp rings, and hot radiators read as emitting. Use `EffectComposer` with a luminance threshold above 1.0 and let emissive materials exceed it — do not bloom the whole image.
- **GTAO** for contact darkening (§3.4).
- **AgX** tone mapping is worth evaluating against ACES; it handles saturated emissive colour — exactly the cyan/violet palette in use — with less hue-shift toward white.
- **DoF** only for the screenshot/beauty mode; it costs too much for interactive orbit.
- Gate the whole chain behind `<PerformanceMonitor>` so it degrades on weak GPUs rather than dropping frames.

---

## 8. Effects

### 8.1 Exhaust plume

Replace the 140-point `PointsMaterial` cloud with a two-part plume:

1. **Core** — a cone/cylinder mesh with an additive gradient shader, scaled by throttle, with a hot inner core and a cooler mantle. Cheap and reads correctly at all distances.
2. **Shock diamonds** — for high-thrust drives, a repeating brightness modulation along the plume axis. A strong authenticity detail for fusion torches.
3. **Particles** — GPU-simulated sprites (soft radial texture, additive blending, `sizeAttenuation`), emitted in the engine's **local** space so they follow the bells, with velocity along the local `-Z`, not a fixed world offset.

Drive intensity from actual drive stats — an ion pulse gets a thin steady cyan needle, a fusion torch a broad violent white-blue column. Right now every drive looks identical.

### 8.2 Diagnostic render modes

Keep all four modes; implement them as shader variants rather than material swaps:

- **PBR** — the full stack above.
- **Holo wireframe** — barycentric-coordinate wireframe shader (clean single-pixel lines, unlike `wireframe: true`), with a scanline sweep.
- **X-ray** — depth-peeled additive transmission with Fresnel rim, internal components visible.
- **Thermal IR** — currently arbitrary recolouring. Make it a real (if simplified) heat model: accumulate from emitter proximity, drive throttle, weapon heat stats, and material conductivity, then map through an ironbow ramp. This turns a gimmick into an actual design-feedback tool, which fits a CAD product.

---

## 9. Performance budget

| Metric | Target |
| :--- | :--- |
| Frame time | 16.6 ms at 1440p on integrated graphics (Iris Xe / M-series base) |
| Draw calls | < 150 |
| Triangles | < 500k |
| Texture memory | < 256 MB (KTX2 mandatory) |
| Blueprint → first frame | < 1.5 s |
| Component swap → visible | < 100 ms (rebuild only the affected subtree) |

Two structural rules:

- **Never rebuild the whole ship for a partial change.** The current `rebuildShipMesh()` tears down and reconstructs everything for any change to any of four dependencies. Swapping a sensor must touch the sensor subtree only.
- **Debounce continuous inputs.** Spline and condition sliders must not trigger a rebuild per `input` event. Throttle to animation frames and rebuild on commit.

---

## 10. Sequencing

Ordered by visual return per unit of effort:

| # | Change | Effort | Impact |
| :-- | :--- | :--- | :--- |
| 1 | `scene.environment` from an HDRI | ~1 day | **Transformative** — ends the black-hull problem |
| 2 | Shadows + contact shadows | ~1 day | Very high — gives depth and contact |
| 3 | Bloom + ACES/AgX | ~1 day | Very high — emissives finally emit |
| 4 | Bevel edges, cut lights to three, exposure slider | ~2 days | High |
| 5 | Migrate to R3F (kills the leak class) | ~3 days | High, structural |
| 6 | Socket system + real weapon/sensor/fuel meshes | ~1 week | High — makes the Designer tab mean something |
| 7 | PBR texture library + panel-line detail | ~1 week | High |
| 8 | Condition system §6 | ~2 weeks | **The differentiator** |
| 9 | Greebling + jury-rig kit | ~1 week | High |
| 10 | Plume rework, thermal model, LOD | ~1 week | Medium |

Items 1–3 are roughly three days and will do more for the perceived quality of the product than the following six weeks. Do them first, and re-screenshot before planning anything else.
