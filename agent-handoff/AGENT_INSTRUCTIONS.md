# 🤖 Downstream AI Agent Handoff: Astralis Shipyard

This document provides full architectural context, component seams, database schemas, and kickoff prompts for downstream AI models or engineers building out the persistent backend.

---

## 1. Work Completed & UI Architecture
- Built full React + Three.js interactive 3D WebGL starship visualizer in `src/App.jsx`.
- Created Bezier spline sculpting engine with real-time 3D lathe geometry updates.
- Built modular hardpoint swapper (Sublight & FTL engines, kinetic/energy ordnance, sensors, fuel miniaturization).
- Implemented R&D Tech Tree matrix with XP unlocking simulation.
- Implemented Conversational AI Architect drawer with heuristic prompt parser.
- Built standalone single-file `.html` 3D bundle generator.

---

## 2. Architectural Seams & API Integration Points

| Feature Area | Current Mock Location | Production Replacement |
| :--- | :--- | :--- |
| **Ship Configurations & Blueprints** | `src/App.jsx` (`currentShip` state) | `GET /api/ships/:id`, `POST /api/ships`, `PUT /api/ships/:id` |
| **Component Database** | `src/App.jsx` (`COMPONENT_DATABASE`) | `GET /api/components?tier=...&category=...` |
| **R&D Tech Tree & XP** | `src/App.jsx` (`unlockedTechs` state) | `GET /api/user/research-tree`, `POST /api/user/research/unlock` |
| **AI Ship Architect** | `src/App.jsx` (`handleSendAiPrompt`) | Streaming LLM endpoint `POST /api/ai/architect-generate` |
| **3D Asset Storage** | Procedural Three.js Geometries | Supabase Storage / AWS S3 for `.gltf` and `.glb` starship model exports |

---

## 3. Recommended PostgreSQL / Supabase Schema

```sql
-- Starship Designs Table
CREATE TABLE starships (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  ship_class TEXT NOT NULL,
  hull_spline_points JSONB NOT NULL DEFAULT '[]',
  sublight_id TEXT NOT NULL,
  ftl_id TEXT NOT NULL,
  weapon_id TEXT NOT NULL,
  sensor_id TEXT NOT NULL,
  fuel_id TEXT NOT NULL,
  material_id TEXT NOT NULL,
  accent_color TEXT NOT NULL DEFAULT '#38BDF8',
  stats JSONB NOT NULL DEFAULT '{}',
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- User Research & Tech Tree Progression
CREATE TABLE user_research (
  user_id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  xp_balance INT DEFAULT 15000,
  unlocked_tech_ids TEXT[] DEFAULT ARRAY['ion_pulse', 'hyper_shunt', 'gauss_cannons'],
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Enable Row Level Security (RLS)
ALTER TABLE starships ENABLE ROW LEVEL SECURITY;
ALTER TABLE user_research ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can manage own starships" 
ON starships FOR ALL USING (auth.uid() = user_id);

CREATE POLICY "Users can manage own research" 
ON user_research FOR ALL USING (auth.uid() = user_id);
```

---

## 4. Downstream Agent Kickoff Prompt

```text
You are the backend engineer for Astralis Shipyard (/Users/conorredmond/projects/Rapid-Prototypes/astralis-shipyard).
Your task is to implement the PostgreSQL schema defined in agent-handoff/AGENT_INSTRUCTIONS.md using Supabase, configure Row Level Security (RLS), and wire up the persistence layer in src/App.jsx with TanStack Query so that ship blueprints, R&D unlocks, and AI generation prompts are saved to the cloud.
```
