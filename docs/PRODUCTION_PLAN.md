# Astralis Shipyard — Production Readiness Plan

Companion to [`CODE_REVIEW.md`](./CODE_REVIEW.md) (what is wrong) and [`RENDER_PIPELINE.md`](./RENDER_PIPELINE.md) (how the 3D gets rebuilt). This document covers sequencing, the backend, and the engineering foundation.

---

## 1. The question to settle before Phase 0

The prototype is ambiguous about what it is, and the ambiguity has real cost — it determines whether the backend needs a server-authoritative economy, and that is the difference between a fortnight and a month of work.

| Reading | What it implies |
| :--- | :--- |
| **A. Creative tool** — a starship design studio. Ships are art; users make and share them. | No economy needed. R&D becomes a content-organising device or is cut. Backend is CRUD + gallery + export. Value is render quality and expressive range. |
| **B. Game system** — the design layer of a strategy/combat game. Ships have stats that compete. | Economy must be server-authoritative and cheat-resistant. Stats need balance work. Backend needs a ledger, validation, and anti-tamper. Much larger scope. |
| **C. Portfolio piece** — a showcase of technical and visual craft. | Optimise for the render and the shareable artefact. Backend is minimal (save, share link, export). |

**Recommendation: A, with the door open to B.** The prototype's actual strength is its design vocabulary and its visual ambition, not its game loop — the R&D economy has no consequence today (review §1.3) and nothing in the app rewards progression. Build the creative tool, keep the R&D structure as a *catalogue organiser* rather than a currency, and defer the economy until there is a game to attach it to.

The plan below assumes A. Where B would change something, it is flagged. **This is the one decision worth making before any code is written.**

---

## 2. Target architecture

```
┌──────────────────────────────────────────────────────────────┐
│ Client — React 19 + TypeScript + Vite 7                      │
│                                                              │
│  apps/web/src/                                               │
│    features/    designer · paradigms · sculptor · rnd · ai    │
│    engine/      scene · lighting · materials · geometry ·     │
│                 sockets · condition · effects · export        │
│    domain/      blueprint · stats · validation  (shared)      │
│    ui/          design system primitives                      │
│    lib/         api client · query hooks · store              │
└───────────────────────────┬──────────────────────────────────┘
                            │ typed client, generated from schema
┌───────────────────────────▼──────────────────────────────────┐
│ Supabase                                                     │
│   Postgres + RLS   Auth   Storage (.glb, thumbnails)          │
│   Edge Functions:  /ai/architect   /blueprints/:id/render     │
└──────────────────────────────────────────────────────────────┘
```

**Stack decisions**

| Concern | Choice | Rationale |
| :--- | :--- | :--- |
| Language | TypeScript, `strict: true` | The domain is full of string IDs cross-referencing lookup tables — exactly what a type system prevents you getting wrong. Discriminated unions for `SocketKind`, `ComponentCategory`, `RenderMode`. |
| Framework | React 19 + Vite 7 | Incremental from the current stack; no need for Next.js since this is a client-heavy single-view app with no SEO surface beyond a gallery. |
| 3D | React Three Fiber v9 + drei | Automatic disposal removes the leak class (review §2.1). See render doc §2. |
| Styling | Tailwind v4 **as a build step** | Keeps the existing visual language; removes the CDN (review §1.7). Tokenise the `space`/`neon` palette. |
| State | Zustand for editor state, TanStack Query v5 for server state | The prototype's 15 `useState` hooks are one blueprint reducer plus a few view flags. |
| Data | Supabase (Postgres, RLS, Auth, Storage) | The handoff doc already proposed it; Postgres RLS gives per-row auth without a bespoke API tier. |
| Hosting | Keep Firebase Hosting, or move to Vercel | Vercel buys per-PR preview deploys, which are worth a lot on a visual product. Either is fine; do not churn on this. |
| AI | Anthropic API (`claude-sonnet-5`, escalating to `claude-opus-5`) via an Edge Function | Server-side key. Tool-use for schema-valid output. See §5. |

---

## 3. Data model

Improving on `agent-handoff/AGENT_INSTRUCTIONS.md` §3, which is a good start but has four gaps: no catalogue integrity, no versioning, no render seed, and a client-trusted XP balance.

```sql
-- ─── Catalogue (server-owned; replaces the bundled COMPONENT_DATABASE) ───────
create table component_categories (
  id          text primary key            -- 'sublight' | 'ftl' | 'weapons' | …
);

create table components (
  id            text primary key,
  category      text not null references component_categories(id),
  name          text not null,
  tier          int  not null check (tier between 1 and 4),
  socket_kind   text not null,            -- which socket it mounts to
  socket_size   text not null check (socket_size in ('S','M','L')),
  stats         jsonb not null default '{}',
  mesh_ref      text,                     -- Storage path to the .glb
  released      boolean not null default true
);

create table hull_archetypes (
  id       text primary key,
  name     text not null,
  tagline  text,
  sockets  jsonb not null                 -- Socket[] in hull-local space
);

-- ─── Blueprints ──────────────────────────────────────────────────────────────
create table blueprints (
  id             uuid primary key default gen_random_uuid(),
  owner_id       uuid not null references auth.users(id) on delete cascade,
  name           text not null check (char_length(name) between 1 and 80),
  ship_class     text not null,
  archetype_id   text not null references hull_archetypes(id),
  loadout        jsonb not null default '{}',   -- { sublight: 'ion_pulse', … }
  hull_profile   jsonb not null default '[]',   -- spline control points
  accent_color   text not null default '#38BDF8'
                   check (accent_color ~ '^#[0-9A-Fa-f]{6}$'),
  condition      real not null default 0.2 check (condition between 0 and 1),
  condition_overrides jsonb not null default '{}', -- per-channel, render doc §6.1
  render_seed    bigint not null,               -- determinism, render doc §6.7
  is_public      boolean not null default false,
  slug           text unique,                   -- public share URL
  forked_from    uuid references blueprints(id) on delete set null,
  thumbnail_path text,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  deleted_at     timestamptz                    -- soft delete
);

create index on blueprints (owner_id, updated_at desc);
create index on blueprints (is_public, updated_at desc) where deleted_at is null;

-- Version history: designers iterate and want to go back.
create table blueprint_versions (
  id            uuid primary key default gen_random_uuid(),
  blueprint_id  uuid not null references blueprints(id) on delete cascade,
  version       int  not null,
  snapshot      jsonb not null,
  created_at    timestamptz not null default now(),
  unique (blueprint_id, version)
);

-- ─── Research (only if the product goes the "game" route, §1) ────────────────
create table research_state (
  user_id     uuid primary key references auth.users(id) on delete cascade,
  xp_balance  int not null default 15000 check (xp_balance >= 0),
  updated_at  timestamptz not null default now()
);

-- Append-only ledger. The balance above is a materialised convenience;
-- this is the source of truth and it is what makes the economy auditable.
create table research_ledger (
  id           bigserial primary key,
  user_id      uuid not null references auth.users(id) on delete cascade,
  delta        int  not null,
  reason       text not null,
  component_id text references components(id),
  created_at   timestamptz not null default now()
);

create table unlocked_components (
  user_id      uuid not null references auth.users(id) on delete cascade,
  component_id text not null references components(id),
  unlocked_at  timestamptz not null default now(),
  primary key (user_id, component_id)
);
```

### 3.1 Row-level security

```sql
alter table blueprints enable row level security;

create policy "owner reads own"      on blueprints for select
  using (auth.uid() = owner_id and deleted_at is null);
create policy "anyone reads public"  on blueprints for select
  using (is_public and deleted_at is null);
create policy "owner inserts own"    on blueprints for insert
  with check (auth.uid() = owner_id);
create policy "owner updates own"    on blueprints for update
  using (auth.uid() = owner_id) with check (auth.uid() = owner_id);
create policy "owner deletes own"    on blueprints for delete
  using (auth.uid() = owner_id);
```

Two notes on the handoff doc's version:

- It used `for all using (auth.uid() = user_id)`. Postgres does default `with check` to the `using` expression, so it is not actually exploitable — but writing the policies out per-operation is clearer, and it is the only way to express "public rows are world-readable but only the owner may write."
- The catalogue tables are **read-only to clients** (`select` grant, no `insert`/`update` policy). Components must not be user-writable.

### 3.2 Server-authoritative unlocks

If the product goes route B, this is non-negotiable. Never let the client post an XP balance.

```sql
create function unlock_component(p_component_id text)
returns void language plpgsql security definer as $$
declare v_cost int; v_balance int;
begin
  select (stats->>'xp_cost')::int into v_cost
    from components where id = p_component_id and released;
  if v_cost is null then raise exception 'unknown component'; end if;

  select xp_balance into v_balance
    from research_state where user_id = auth.uid() for update;   -- row lock
  if v_balance < v_cost then raise exception 'insufficient xp'; end if;

  update research_state set xp_balance = xp_balance - v_cost,
                            updated_at = now()
    where user_id = auth.uid();
  insert into research_ledger (user_id, delta, reason, component_id)
    values (auth.uid(), -v_cost, 'unlock', p_component_id);
  insert into unlocked_components (user_id, component_id)
    values (auth.uid(), p_component_id) on conflict do nothing;
end $$;
```

`for update` takes a row lock so two concurrent unlock calls cannot both pass the balance check. The current client-side implementation (`setResearchPoints(p => p - 5000)`) is trivially forgeable from the console and is lost on refresh.

### 3.3 Blueprint validation

Loadout validity — does this component exist, is it unlocked, does it fit a socket this archetype has — must be enforced in **one** place that both client and server use. Define the rules in a shared `domain/` package as Zod schemas, run them client-side for instant feedback, and re-run them in a Postgres trigger or Edge Function on write. Client-side-only validation is a UX affordance, not a guarantee.

---

## 4. API surface

| Method | Route | Notes |
| :--- | :--- | :--- |
| `GET` | `/catalog` | Components + archetypes. Heavily cached, ETag'd. Moves ~40 kB of constants out of the bundle. |
| `GET` | `/blueprints` | Owner's list, paginated, `updated_at desc`. |
| `POST` | `/blueprints` | Validated on write. Server assigns `render_seed`. |
| `GET` | `/blueprints/:id` | RLS handles owner-vs-public. |
| `PUT` | `/blueprints/:id` | Snapshots the prior state into `blueprint_versions`. |
| `POST` | `/blueprints/:id/fork` | Copies with `forked_from` set. The gallery's core loop. |
| `DELETE` | `/blueprints/:id` | Soft delete. |
| `GET` | `/gallery` | Public blueprints, filterable by archetype and condition. |
| `POST` | `/blueprints/:id/render` | Queues a headless thumbnail + `.glb` bake to Storage. |
| `POST` | `/ai/architect` | Streaming; see §5. |
| `POST` | `/research/unlock` | RPC wrapper over §3.2. Route B only. |

**Autosave:** debounce local edits ~2 s, write optimistically through TanStack Query, reconcile on response. Design work must never be lost to a refresh — that is the single biggest functional gap today.

---

## 5. The AI Architect

Currently a `setTimeout` over four `String.includes` branches (review §6). Replacing it with a real model is straightforward and high-value, because natural-language ship design is genuinely a good fit for a tool-use call.

**Design**

- Runs in an Edge Function. **The API key never reaches the client** — the single most important rule here.
- Model: `claude-sonnet-5` for interactive turns, escalating to `claude-opus-5` for "surprise me" full-ship generation. Do not use a smaller model to save cost before measuring; output quality is the feature.
- **Tool use for structured output.** Define a `configure_ship` tool whose input schema *is* the blueprint schema — archetype, loadout, condition, accent colour, name, class. The model returns a validated object rather than prose to be regex-parsed. This is what makes the feature reliable.
- Stream the conversational reply; apply the tool call to the scene when it resolves.
- Pass the live catalogue as context so the model can only select components that exist, and re-validate its output server-side anyway (§3.3) — never trust model output as a write payload.
- Persist prompts and responses to an `ai_generations` table for cost attribution, rate limiting, and evaluation.

**Guardrails:** per-user rate limits and a monthly token cap; treat user prompt text as untrusted input (it reaches a model that emits a write payload — validation in §3.3 is the containment); log token usage per call.

**Evaluation:** build a small golden set of ~30 prompts with expected archetype/loadout outcomes and score changes against it. Without this, prompt edits are guesswork.

---

## 6. Engineering foundation

Everything in this section is absent today.

| Concern | Setup |
| :--- | :--- |
| **Types** | TypeScript `strict`, `noUncheckedIndexedAccess`. Generate DB types via `supabase gen types typescript`. |
| **Lint** | ESLint 9 flat config + `typescript-eslint` + **`eslint-plugin-react-hooks`**. `exhaustive-deps` as an **error**, not a warning — it catches review §1.1 and §1.2 automatically. Add `eslint-plugin-jsx-a11y`. |
| **Format** | Prettier, pre-commit via Husky + lint-staged. |
| **Unit tests** | Vitest. Priority targets: stats derivation, blueprint validation, socket matching, seeded PRNG determinism, condition-channel maths. These are pure functions and cheap to cover. |
| **Component tests** | React Testing Library for the panels. |
| **E2E** | Playwright: load → swap component → save → reload → design persists. |
| **Visual regression** | Playwright screenshots of the canvas at fixed seed, camera, and condition, compared per PR with a small pixel tolerance. **On a 3D product this is the highest-value test category there is** — it is the only thing that catches "the hull went black". |
| **Perf gates** | Bundle budget in CI (fail over 300 kB gzip initial). Lighthouse CI. A scripted frame-time check on a reference blueprint. |
| **CI** | GitHub Actions: typecheck → lint → unit → build → e2e → visual. Required for merge. |
| **Errors** | Sentry, with a React error boundary and a WebGL-unsupported fallback screen. |
| **Analytics** | Product events: blueprint created/saved/forked/exported, AI prompt sent, condition changed. |
| **Flags** | Simple env-driven flags so the condition system and AI can ship dark. |

---

## 7. Phased delivery

Effort assumes one experienced full-stack/graphics engineer. Parallelise §Phase 2 with Phase 1 if there are two.

### Phase 0 — Stop the bleeding (2 weeks)

Foundation and the P0 defects. No new features.

- TypeScript, ESLint (hooks rule as error), Prettier, Vitest, Playwright, GitHub Actions.
- Tailwind as a build step; delete the CDN script. Tokenise the palette.
- Split `App.jsx` into `features/`, `engine/`, `domain/`, `ui/`. Port the domain constants to typed modules unchanged — they are good (review §7).
- Fix: stale-closure animation (§1.1, §1.2), disposal (§2.1), StrictMode double-mount (§2.2), radiator ref (§2.3).
- **Pointer events** replacing mouse-only, so the viewport works on touch (§5).
- Error boundary + WebGL fallback.
- Untrack `.DS_Store`; upgrade React/Three/Vite.
- **Rewrite the README to describe what actually exists** (§6). Do this first, not last.

*Exit:* CI green, no leak under a 60-second slider-drag soak, viewport usable on an iPad, README accurate.

### Phase 1 — Make it look good (3 weeks)

Render doc §10 items 1–5. The highest-leverage phase in the plan.

- HDRI environment + PMREM for all three dock settings.
- Shadow map + contact shadows; cut to three lights; exposure-based brightness slider.
- Bloom + ACES/AgX tone mapping; GTAO; SMAA.
- Bevelled edges on all primitives.
- Migrate to React Three Fiber.
- Establish visual-regression baselines.

*Exit:* side-by-side screenshots against the current build. This phase must be judged by eye, not by ticket count.

### Phase 2 — Persistence (3 weeks)

- Supabase project, schema §3, RLS, migrations in-repo.
- Auth (magic link + OAuth). Anonymous sessions that upgrade on sign-in, so a first-time visitor can design before registering.
- Blueprint CRUD, autosave, version history.
- Catalogue served from the DB.
- TanStack Query + optimistic updates.

*Exit:* design survives a refresh; two browsers on one account stay consistent; an anonymous user's work migrates on sign-up.

### Phase 3 — Make the choices matter (3 weeks)

- Socket system (render doc §4.1).
- Real meshes for weapons, sensors, fuel — the three inert categories.
- Stats engine: derive `speed/armor/firepower/stealth/warp` from the fitted loadout in shared `domain/` code, and **display them** (review §1.4).
- Mass/power/heat budgets with over-budget warnings — turns the tool from a dress-up UI into a design tool with constraints.
- Working spline sculptor: real Bezier, draggable handles, applied to all archetypes.

*Exit:* every picker in the Designer tab changes something visible and something numeric.

### Phase 4 — Variation (3 weeks)

The differentiator; render doc §6 in full.

- Condition scalar + seven channels; curvature/cavity/emitter/panel-ID masks.
- Layered wear shader; five named condition presets.
- Structural damage above 0.8; jury-rig kit; symmetry breaking.
- Seeded determinism with a visible reroll.

*Exit:* the same blueprint at Fleet Commission and at Frontier Salvage reads as two different ships with the same bones — and reloading reproduces both exactly.

### Phase 5 — Share it (2 weeks)

- Real `.glb` export via `GLTFExporter`, replacing the broken HTML export (§1.6).
- Public gallery, share links, fork.
- Server-side thumbnail rendering.
- AI Architect on a real model (§5).

### Phase 6 — Harden (2 weeks)

- Accessibility pass to WCAG 2.2 AA: tablist semantics, `aria-pressed`, labelled sliders, focus management, keyboard camera controls, contrast audit.
- Responsive layout: collapsible sidebar, mobile-first control scheme, breakpoints.
- Performance budget enforcement (render doc §9).
- Security review: RLS coverage tests, rate limits, CSP, dependency audit.
- Observability, runbook, load test.

**Total: ~18 weeks / ~4 months** for one engineer. Phases 0 and 1 alone (5 weeks) produce something that looks and behaves like a real product, and are the right first commitment.

---

## 8. Risks

| Risk | Mitigation |
| :--- | :--- |
| Condition system (Phase 4) is the largest unknown; layered wear shaders are easy to sink a month into | Timebox a 3-day spike on one archetype and one channel (panel-ID replacement) before committing to the phase. It is also the highest-value channel, so the spike ships value either way. |
| WebGPU/TSL migration drags | Keep the `onBeforeCompile` bridge path (render doc §6.3) viable; do not block Phase 4 on the renderer swap. |
| Visual regression tests are flaky across GPUs | Pin CI to one runner image; use a generous pixel tolerance; treat failures as "look at this", not "block the merge", for the first month. |
| Scope creep into a game (route B) | Settle §1 up front and write the answer down. |
| AI costs run away | Rate limits and a monthly cap from day one; log tokens per call. |
| Asset production (HDRIs, PBR textures, greeble kit) is art work, not engineering | Budget it explicitly. Start with CC0 libraries (Poly Haven, ambientCG) to unblock Phase 1. |

---

## 9. Definition of done

A change is production-ready when:

1. Types check, lint passes (hooks rule included), unit and E2E tests pass.
2. Visual regression is reviewed — either unchanged, or the diff is deliberate and approved.
3. No new GPU resource is allocated without a matching disposal path.
4. Every interactive control has a keyboard path and an accessible name.
5. It works with a touch pointer.
6. Server-side validation exists for anything the client can write.
7. **The README and docs describe what the code actually does.** Nothing is documented as working until it is demonstrated working.

Rule 7 is listed last but is the one this codebase most needs; the reasoning is in [`AGENT_PLAYBOOK.md`](./AGENT_PLAYBOOK.md).
