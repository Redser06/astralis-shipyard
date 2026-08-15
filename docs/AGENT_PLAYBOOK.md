# Agent Playbook — Review Method and Coding Standards

Written for the agent that built the Astralis Shipyard prototype, and for anyone briefing an agent on similar work. Part 1 is a play-by-play of how this review was conducted and why each step was ordered that way. Part 2 is the standards to apply, each tied to the specific thing in this codebase that motivates it. Part 3 is a drop-in charter.

---

# Part 1 — Play-by-play

## The root cause, stated up front

Almost every finding in [`CODE_REVIEW.md`](./CODE_REVIEW.md) traces to a single omission: **the prototype was never run and observed.**

The orbit button does nothing. The Test Burn does nothing. The hull renders black. The radiators clip through the Brutalist hull. Every one of these is visible within ten seconds of opening the app and clicking. None is subtle, and none requires expertise to notice — only that somebody looked.

The code was written, it compiled, and it was documented as complete. The step between "compiles" and "works" was skipped, and the documentation was written as though it had not been. Everything below is downstream of that.

---

## Step 1 — Orient before reading

```
git clone … && ls -la
find . -type f | sort
wc -l src/*
git log --oneline
```

Thirty seconds, and it reframes the whole task: 1,898 lines of source, 1,889 of them in one file, four commits. That tells me this is a single-session generated artefact, that there is no modular structure to evaluate, and that I will need to read the file end to end rather than navigate it.

**Principle:** shape first, content second. Knowing you are looking at one 1,900-line file changes the reading strategy before you have read a line.

## Step 2 — Read the stated intent before the code

I read `README.md`, `package.json`, `vite.config.js`, `firebase.json`, `index.html`, `main.jsx`, and `agent-handoff/AGENT_INSTRUCTIONS.md` — everything except the source.

This ordering is deliberate and it is the highest-leverage move in the whole review. Reading the claims first means that when I later read the implementation, **every claim is a hypothesis under test**. "Drag-and-drop 2D vector control points" became something I was actively looking for and did not find. Had I read the source first, I would have absorbed what the code does and read the README as a summary of it, which is exactly how this kind of drift goes unnoticed.

`index.html` alone yielded the Tailwind CDN finding before any application code was read.

**Principle:** read the promises first so the code can contradict them.

## Step 3 — Read the whole file, in order

I read all 1,889 lines in four sequential chunks. I did not grep for suspicious patterns and skim around them.

For a file this size that is the right trade. Grep finds what you already suspect; reading finds what you did not know to suspect. The dead `stats` field, the `radiatorGlowRef` overwrite inside a two-iteration loop, the fogged-out planet, and the name-mangling in `handleSelectArchitecture` were all incidental discoveries that no targeted search would have produced, because none of them is a known anti-pattern with a searchable signature.

While reading I kept a running hypothesis list rather than stopping to verify: stale closures in the `[]`-dependency effect, no disposal, no environment map, mouse-only input.

**Principle:** read linearly, note hypotheses, verify later in a batch. Stopping to chase each suspicion fragments the read and you lose the thread.

## Step 4 — Convert hypotheses into counts

Reading gives you suspicion. Counting gives you evidence.

```bash
grep -c 'castShadow\|shadowMap\|receiveShadow' src/App.jsx   # → 0
grep -c 'dispose' src/App.jsx                                 # → 1
grep -n 'stats' src/App.jsx                                   # → 4 hits, all definitions
grep -n 'unlockedTechs' src/App.jsx                           # → 7 hits, all in the R&D tab
for i in Rocket Shield … ; do echo "$i: $(grep -c "<$i " src/App.jsx)"; done
```

This is mechanical and fast, and it upgrades the language of the finding from "seems to leak" to "one `dispose()` call in 1,889 lines." The second is arguable only by someone willing to check, which is the point.

The import loop found four unused icons in one command. Grepping `touch|pointer` returned four hits that were all CSS `cursor-pointer` classes — a good example of why you read the hits rather than trusting the count.

**Principle:** a finding you can express as a number is a finding nobody has to take on faith.

## Step 5 — Build it

```
npm install && npm run build      # ✓ 1.10s, 712 kB, one chunk
```

Confirms the code is syntactically sound and gives a bundle number for the performance discussion. It also establishes an important boundary: **a clean build tells you nothing about whether the app works.** Every runtime defect in this review is present in a build that succeeds in 1.1 seconds without a warning that matters.

## Step 6 — Run it and look at it

This is the step the original agent skipped, and it produced the most important findings in the review.

```
npx vite preview --port 4319
```
then opened it in a real browser and took a screenshot.

The screenshot immediately showed the hull rendering as a near-black unreadable mass with two peach rectangles floating in front of it. I had *predicted* the black-metal problem from source — `metalness: 0.92` with no `envMap` — but predicting it and seeing it are different artefacts. The screenshot is what makes §3.1 of the review persuasive, and it is what will make the fix obviously worth prioritising.

**On a visual product, a review conducted without looking at the output is not a review.** No amount of source reading tells you the image is unreadable.

The console added a free finding: Tailwind's own warning that its CDN should not be used in production.

## Step 7 — Design a controlled experiment for the behavioural claim

The auto-rotate stale-closure bug is the kind of finding that gets waved away as theoretical. So I tested it as an experiment with a stated expected outcome:

1. Screenshot the scene.
2. Click the orbit toggle.
3. Wait 4 seconds — long enough that at `0.005 rad/frame × 60 fps` the camera would have swung through roughly 70°.
4. Screenshot again and compare.

**Result:** the button label changed to `ORBITING (1x)` and the speed slider appeared, and every scene element — warp ring, radiators, gantry column, grid intersections — sat at pixel-identical coordinates.

The comparison also produced a sharper diagnosis than the source read alone had. The welding sparks *were* moving and the hull *was* bobbing, which proves the render loop is alive and narrows the fault precisely to the state-reading branches. That distinction matters: "the animation is broken" and "the animation loop cannot see React state" lead to different fixes.

**Principle:** state the expected observation before you run the test. A test whose result you interpret afterwards is an anecdote.

## Step 8 — Test the second prediction

I had predicted from the source that protrusions positioned at hardcoded world coordinates would clip through hulls of different dimensions. So I switched to the Brutalist Dreadnought preset — the widest, longest hull — and screenshotted.

The radiator panels intersect the hull. The armour skirts pass through the citadel. The prediction was confirmed visually in one click, and the same screenshot independently evidenced the untextured-primitive and no-shadow findings.

**Principle:** when you have a geometric hypothesis, pick the input most likely to expose it. Do not test the default case and generalise.

## Step 9 — Cross-reference claims against verified behaviour

Only at this point — with runtime evidence in hand — did I build the README-claim-versus-reality table (review §6). Doing it earlier would have produced a list of things I suspected were untrue. Doing it last produced a list of things I had checked.

Nine claims, five of them materially wrong.

## Step 10 — Separate diagnosis from prescription

Three documents, deliberately:

- `CODE_REVIEW.md` — what is true now, with evidence and severity.
- `RENDER_PIPELINE.md` — the target 3D architecture.
- `PRODUCTION_PLAN.md` — sequencing, backend, foundation.

Mixing them is a common failure. A review that keeps breaking into solutions is hard to verify, and a plan interleaved with complaints is hard to execute. The review is *falsifiable* — anyone can check its claims. The plan is *arguable* — reasonable people can sequence differently. Those need different documents because they invite different kinds of scrutiny.

I also wrote a "what is worth keeping" section (review §7). A review that only lists faults gives no signal about what to preserve through a rewrite, and here the domain vocabulary and visual language are genuinely good and would be expensive to reinvent.

## Two process notes

**I did not delegate.** The task was a full read of one file plus targeted verification. Farming that to subagents would have meant paying to re-derive context I already had, and the incidental findings in Step 3 depend on one reader holding the whole file at once. Delegation is for breadth — sweeping many files for a known pattern. This was depth.

**One misstep worth recording.** I initially cloned into the job's scratch directory, which happens to sit inside the user's home directory — itself a git repository. The first write was correctly refused by an isolation guard. Rather than work around the guard, I relocated the clone outside the home repository entirely and continued. The guard was right and my directory choice was wrong; the fix belonged at the cause, not at the symptom. That instinct — when a safety check fires, assume it is correct and fix the setup rather than route around it — is worth carrying.

---

# Part 2 — Coding standards

Each rule names the thing in this codebase that motivates it.

## A. Honesty

**A1. Never document a capability you have not observed working.**
Write documentation from demonstrated behaviour, not from intent. If you built it and did not run it, it is not done.
*Here:* README claims draggable Bezier control points; the drag handler does not exist. Claims a self-contained HTML export; it loads three.js from a CDN. Claims visible weapon hardpoints; weapon choice changes nothing.

**A2. A UI control that does nothing is worse than no control.**
A dead button does not merely fail to add value — it teaches the user that controls in this app may be fake, which discredits the ones that work.
*Here:* orbit toggle, Test Burn, the R&D unlock economy, and three of six hardpoint pickers are all inert. Four of the five tabs contain at least one dead control.

**A3. Handoff documents describe state, not aspiration.**
"Built full interactive 3D WebGL starship visualizer" set expectations that cost a downstream reader real time.
Write handoffs in three sections: **Works** (demonstrated), **Stubbed** (present, inert, deliberate), **Absent**. Anything you cannot place in Works goes in Stubbed or Absent.

**A4. Distinguish demo scaffolding from implementation, in the code.**
Name it `mockAiArchitect`, not `handleSendAiPrompt`. A `setTimeout` over four `String.includes` branches presented as an "AI Ship Architect" reads as a real integration to anyone who has not opened the function.

## B. React

**B1. `exhaustive-deps` is an error, not a warning.**
The single highest-value lint rule for this codebase. It catches B2 and B3 automatically and would have prevented the two most visible runtime bugs in the app.

**B2. An animation loop must never read React state from a closure.**
`useEffect(…, [])` captures first-render values forever. Route mutable values through a ref updated by a small effect, or read from a store with `getState()`.
*Here:* `animate()` reads `autoRotate`, `rotationSpeed`, and `isTestBurning` from a `[]`-dependency effect. All three are permanently `false`/`1.0`.

```js
// wrong — captured once
useEffect(() => {
  const animate = () => { if (autoRotate) { … } }
}, [])

// right — ref tracks state, loop reads the ref
const autoRotateRef = useRef(autoRotate)
useEffect(() => { autoRotateRef.current = autoRotate }, [autoRotate])
useEffect(() => {
  const animate = () => { if (autoRotateRef.current) { … } }
}, [])
```

**B3. Every value read inside an effect belongs in its dependency array.**
*Here:* `rebuildShipMesh()` reads `isTestBurning` to set radiator emissive intensity, but the effect lists only `[currentShip, renderMode, splinePoints, protrusions]`, so the value it reads is never the current one.

**B4. Assume StrictMode double-invocation.**
Effects must be idempotent and fully reversible. Store per-effect handles in effect-local variables, not shared refs, so cleanup cancels the right thing.
*Here:* a single `animationFrameId` ref is overwritten by the second mount, orphaning the first render loop.

**B5. One `useState` per independent concern; a reducer past five related ones.**
*Here:* 15 hooks in one component, of which ~8 are really one blueprint object.

**B6. Split any component past ~300 lines.**
*Here:* 1,889 lines containing an audio engine, a domain database, a geometry compiler, an export serialiser, and five tab UIs.

## C. Three.js and real-time graphics

**C1. Everything you allocate on the GPU, you dispose.**
`scene.remove()` frees nothing. Geometries, materials, textures, and render targets each need explicit `dispose()`. Write the teardown in the same commit as the setup.
*Here:* one `dispose()` call in the file; a one-second slider drag leaks on the order of a thousand geometries.

```js
function disposeSubtree(obj) {
  obj.traverse(n => {
    n.geometry?.dispose()
    const mats = Array.isArray(n.material) ? n.material : n.material ? [n.material] : []
    for (const m of mats) {
      for (const v of Object.values(m)) v?.isTexture && v.dispose()
      m.dispose()
    }
  })
  obj.removeFromParent()
}
```

Better still: use React Three Fiber, which does this on unmount and removes the whole bug class.

**C2. Metal without an environment map renders black. Always set `scene.environment`.**
A metallic BRDF has no diffuse term; its colour comes from reflections. This is the most consequential graphics rule in this document.
*Here:* every hull runs `metalness` 0.85–1.0 with no environment map. The hull is a black silhouette and no amount of light fixes it.

**C3. If the image is too dark, diagnose before you brighten.**
Cranking light intensity to rescue a materially-wrong image flattens shading and blows out whatever was working.
*Here:* seven lights, peak effective intensity above 20, on top of 1.45 exposure — all compensating for C2.

**C4. Enable shadows, or accept that nothing has depth.**
Shadows and AO are the primary depth and contact cues. Fit the shadow camera to the subject, not the scene.
*Here:* zero shadow-related code.

**C5. Position attachments by declared sockets, never by literal world coordinates.**
Hardcoded offsets are correct for exactly one hull and silently wrong for every other.
*Here:* radiators fixed at `(±2.4, 1.2, −1.8)` across five archetypes of wildly different dimensions; they intersect the hull on the Brutalist and float free on the Outrigger.

**C6. Assigning a ref inside a loop keeps only the last iteration.**
*Here:* `radiatorGlowRef.current = rad` inside a two-sided loop; the port radiator never animates. Use an array.

**C7. Rebuild the minimum subtree.**
*Here:* any change to any of four dependencies tears down and reconstructs the entire ship.

**C8. Debounce continuous input into geometry rebuilds.**
*Here:* every `input` event on a spline slider triggers a full rebuild-plus-leak.

**C9. Emissive without bloom does not read as emitting; particles without a texture are squares.**
Both are visible in the screenshots.

**C10. Verify your scene actually renders what you added.**
*Here:* a 65-unit planet sits at a distance where `FogExp2` attenuates it 99.5%. It has never been visible and is submitted every frame.

## D. Architecture

**D1. Prototype data should be shaped like the API that will replace it.**
The prototype did this well — `COMPONENT_DATABASE` ports to a `components` table almost unchanged. Keep it.

**D2. Validation belongs in shared code, run on both sides.**
Client validation is UX; server validation is the guarantee.

**D3. Never let the client be the authority on an economy.**
*Here:* `setResearchPoints(p => p - 5000)` is forgeable from the console and lost on refresh. If XP matters, it lives in a transactional server-side RPC over an append-only ledger.

**D4. Do not install dependencies you are not using.**
*Here:* `@types/react` and `@types/react-dom` in a project with no TypeScript.

**D5. Delete dead code before committing.**
*Here:* four unused icon imports, an `icon` field on all five archetypes that nothing reads, `protrusions.outriggerTrusses` in state and never read, `turretSponsons` with no UI, `SoundEngine.muted` never set, and a `stats` object on every preset that no component displays.

## E. Correctness

**E1. String-munging identifiers produces garbage.**
*Here:* `prev.name.split(' ')[0] + ' ' + arch.name.split(' ')[0]` yields "SF-44 Angular", degrading with each swap. Keep a stable ID and a separate display name.

**E2. Derived identity must be invalidated when the source changes.**
*Here:* `currentShip.id` survives every edit, so a fully modified ship still highlights its origin preset as active.

**E3. Never interpolate untrusted text into generated HTML or JS.**
*Here:* the export writes `currentShip.name` into an HTML title and a JS string literal unescaped — and the AI Architect can set that name arbitrarily.

**E4. Pin generated artefacts to the same library version you develop against.**
*Here:* the app runs three.js r160; its export loads r128 — 32 releases and a colour-management overhaul apart.

## F. Input and accessibility

**F1. Use Pointer Events, not mouse events.**
One API covering mouse, touch, and pen. Mouse-only handlers make a viewport inoperable on tablets.
*Here:* no touch or pointer handler exists; the 3D viewport cannot be used on any touch device.

**F2. Every interaction needs a keyboard path.**
*Here:* no keyboard route to orbit, zoom, or reset the camera; the canvas is not focusable and has no accessible name.

**F3. Use the semantics the pattern calls for.**
A tab bar is `role="tablist"` with `aria-selected`; a toggle carries `aria-pressed`; a slider needs a label.

**F4. No magic-number layout.**
*Here:* `bottom-4 right-96` positions the preset carousel against a hardcoded sidebar width, and clips the viewport hint text even at 1524 px.

**F5. Add breakpoints as you build, not afterwards.**
Retrofitting responsiveness onto a fixed two-column layout is a rewrite.

## G. Delivery hygiene

**G1. `.gitignore` before the first commit.** *Here:* `.DS_Store` is tracked despite being ignored — it was committed first.
**G2. No CDN dependencies in production.** *Here:* Tailwind's runtime JIT and three.js r128, both from CDNs.
**G3. Every app needs an error boundary and a capability fallback.** *Here:* unsupported WebGL yields a blank page.
**G4. Code-split past ~300 kB gzip.** *Here:* one 712 kB chunk.
**G5. Ship a favicon and meta tags.** *Here:* none; a guaranteed 404 on every load.

---

# Part 3 — Prototype agent charter

The point of this charter is not to make prototypes production-grade. Prototypes exist to answer a question fast and are *entitled* to cut corners. The charter is about **which corners, and declaring them.**

## Corners you may cut, freely and without apology

- No tests, no CI, no TypeScript
- Hardcoded data in place of an API
- One file, if it stays under roughly 1,000 lines
- No auth, no persistence
- Placeholder art and primitive geometry
- No responsive layout, if you state the target viewport
- Naive algorithms

## Corners you may never cut

1. **Run what you build, and look at it.** Open the app. Click every control you added. On anything visual, take a screenshot and actually examine it. This single rule would have caught the majority of this review.
2. **No dead controls.** If a control does not work, remove it, disable it, or label it. Never leave it looking functional.
3. **Documentation states demonstrated behaviour only.** Split every doc into Works / Stubbed / Absent.
4. **Free what you allocate in a render loop.** Leaks are not a production concern; they crash the demo.
5. **Never fake something the reader will believe is real.** Mock AI is fine. Mock AI named as though it were an integration is not.
6. **No secrets, no unescaped interpolation, no client-authoritative security** — even in a prototype, because prototypes get promoted.
7. **Prefer the library that removes a bug class** over hand-rolling. R3F over manual Three.js lifecycle; Pointer Events over mouse events.

## Pre-completion checklist

Before reporting any prototype as done:

- [ ] The app was run and every control was clicked
- [ ] A screenshot of each major state was taken and examined
- [ ] The browser console was read; warnings are noted or fixed
- [ ] Every control does something, or is visibly disabled
- [ ] The README's claims were checked one by one against observed behaviour
- [ ] Known gaps are listed explicitly as Stubbed or Absent
- [ ] No secrets, no unescaped user input in generated output
- [ ] Every GPU allocation has a disposal path
- [ ] It works with a touch pointer, or the doc says it does not

## The one-line version

> **Compiling is not working. Run it, look at it, click it — then write down only what you saw.**
