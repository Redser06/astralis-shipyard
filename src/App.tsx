import { Suspense, lazy, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { Group } from 'three';
import {
  Boxes,
  Compass,
  Crosshair,
  Download,
  Flame,
  FlaskConical,
  Radio,
  Rocket,
  Shield,
  Sliders,
  Sparkles,
  Spline,
  Volume2,
  VolumeX,
  Wrench,
} from 'lucide-react';
import {
  createInitialMissionTelemetry,
  stepMission,
} from './domain/missionLoop';
import type { MissionTelemetry } from './domain/types';
import type { CinematicCut } from './render/camera/CinematicDirector';

import { HULL_ARCHITECTURES } from './domain/architectures';
import {
  FTL_CORES,
  FUEL_SYSTEMS,
  MATERIALS,
  SENSORS,
  SUBLIGHT_DRIVES,
  WEAPONS,
} from './domain/components';
import { CONDITION_PRESETS, conditionFor, deriveWear, presetFor } from './domain/condition';
import { DEFAULT_HULL_PROFILE, type ProfilePoint } from './domain/profile';
import { SHIP_PRESETS } from './domain/presets';
import { sfx } from './domain/sound';
import { STAT_LABELS, deriveOverall, deriveStats } from './domain/stats';
import type { ArchetypeId, Blueprint, ComponentCategory } from './domain/types';
import {
  INITIAL_RESEARCH,
  LOCKABLE_TECHS,
  blueprintBlockedReason,
  costOf,
  selectionBlockedReason,
  unlock,
  type ResearchState,
} from './domain/unlocks';
import { exportGlb, slugify } from './export/glb';
import {
  CAMERA_PRESETS,
  ENVIRONMENTS,
  RENDER_MODES,
  type CameraPreset,
  type EnvironmentId,
  type Protrusions,
  type RenderMode,
} from './render/viewportOptions';
import { OptionRow, Panel, Segmented, Slider, StatBar, Toggle } from './ui/primitives';
import { HullSculptor } from './ui/HullSculptor';
import { ArchitectPanel, type ArchitectEntry } from './ui/ArchitectPanel';
import { requestProposal } from './services/architect';

/**
 * The render stack — three, R3F, drei, postprocessing — is well over a megabyte
 * and none of it is needed to paint the shell. Loading it lazily keeps the UI
 * interactive while WebGL spins up, and splits it into its own cacheable chunk.
 */
const Viewport = lazy(() =>
  import('./render/Viewport').then((module) => ({ default: module.Viewport })),
);

function ViewportFallback() {
  return (
    <div className="flex h-full w-full items-center justify-center bg-space-950">
      <p className="font-mono text-xs uppercase tracking-[0.2em] text-slate-600">
        Initialising viewport…
      </p>
    </div>
  );
}

const ARCH_ICONS: Record<string, typeof Shield> = {
  Shield,
  Boxes,
  Crosshair,
  Radio,
  Rocket,
};

type Tab = 'designer' | 'hull' | 'condition' | 'research' | 'mission' | 'architect';

// `label` is the accessible name; `short` is what fits in a 384px rail.
const TABS: ReadonlyArray<{ id: Tab; label: string; short: string; Icon: typeof Shield }> = [
  { id: 'designer', label: 'Designer', short: 'Design', Icon: Sliders },
  { id: 'hull', label: 'Hull', short: 'Hull', Icon: Spline },
  { id: 'condition', label: 'Condition', short: 'Wear', Icon: Wrench },
  { id: 'research', label: 'R&D', short: 'R&D', Icon: FlaskConical },
  { id: 'mission', label: 'Mission', short: 'Sortie', Icon: Compass },
  { id: 'architect', label: 'Architect', short: 'AI', Icon: Sparkles },
];

export default function App() {
  const [blueprint, setBlueprint] = useState<Blueprint>(SHIP_PRESETS[0] as Blueprint);
  const [mode, setMode] = useState<RenderMode>('pbr');
  const [environment, setEnvironment] = useState<EnvironmentId>('drydock');
  const [cameraPreset, setCameraPreset] = useState<CameraPreset>('hero');
  const [protrusions, setProtrusions] = useState<Protrusions>({
    radiators: true,
    sensors: true,
    rcs: true,
  });
  const [burning, setBurning] = useState(false);
  const [autoRotate, setAutoRotate] = useState(false);
  const [rotationSpeed, setRotationSpeed] = useState(1);
  const [lightIntensity, setLightIntensity] = useState(2.4);
  const [soundEnabled, setSoundEnabled] = useState(true);
  const [research, setResearch] = useState<ResearchState>(INITIAL_RESEARCH);
  const [tab, setTab] = useState<Tab>('designer');
  const [notice, setNotice] = useState<string | null>(null);
  const [architectHistory, setArchitectHistory] = useState<ArchitectEntry[]>([]);
  const [architectBusy, setArchitectBusy] = useState(false);

  // Autonomous Mission Loop & Cinematic Camera state
  const [missionActive, setMissionActive] = useState(false);
  const [missionTelemetry, setMissionTelemetry] = useState<MissionTelemetry>(createInitialMissionTelemetry);
  const [missionTimeScale, setMissionTimeScale] = useState(1.0);
  const [cinematicCut, setCinematicCut] = useState<CinematicCut>('gantry_dolly');
  const [manualCameraControl, setManualCameraControl] = useState(false);

  // 8-second Procedural Time-Lapse Reconstruction Montage
  const [isAssembling, setIsAssembling] = useState(false);
  const [assemblyProgress, setAssemblyProgress] = useState<number | null>(null);

  const shipGroup = useRef<Group | null>(null);
  const burnTimer = useRef<number | null>(null);

  // Step autonomous mission loop
  useEffect(() => {
    if (!missionActive) return;

    let lastTime = performance.now();
    let animId: number;

    const loop = (now: number) => {
      const dt = Math.min(0.2, (now - lastTime) / 1000);
      lastTime = now;

      setMissionTelemetry((prev) => {
        const result = stepMission(prev, dt, { timeScale: missionTimeScale });
        setBlueprint((b) => ({ ...b, condition: result.telemetry.hullIntegrity }));

        if (!manualCameraControl) {
          switch (result.telemetry.state) {
            case 'docked':
            case 'repair':
              setEnvironment('drydock');
              setCinematicCut('gantry_dolly');
              break;
            case 'departing':
              setEnvironment('drydock');
              setCinematicCut('chase_cam');
              break;
            case 'warp':
              setEnvironment('nebula');
              setCinematicCut('chase_cam');
              break;
            case 'asteroid_field':
              setEnvironment('asteroid');
              setCinematicCut('flyby_pass');
              break;
            case 'planet_orbit':
              setEnvironment('nebula');
              setCinematicCut('flyby_pass');
              break;
            case 'combat':
              setEnvironment('asteroid');
              setCinematicCut('turret_ots');
              break;
            case 'return_transit':
              setEnvironment('nebula');
              setCinematicCut('chase_cam');
              break;
          }
        }

        if (result.telemetry.state === 'combat') {
          setBurning(true);
        } else if (result.telemetry.state !== 'warp') {
          setBurning(false);
        }

        return result.telemetry;
      });

      animId = requestAnimationFrame(loop);
    };

    animId = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(animId);
  }, [missionActive, missionTimeScale, manualCameraControl]);

  // 8-second procedural assembly reconstruction montage
  const handleTimeLapseReconstruction = useCallback(() => {
    if (isAssembling) return;
    setIsAssembling(true);
    sfx.play('warp');
    const startTime = performance.now();
    const duration = 8000;

    const tick = (now: number) => {
      const elapsed = now - startTime;
      const p = Math.min(1.0, elapsed / duration);
      setAssemblyProgress(p);

      if (p < 1.0) {
        requestAnimationFrame(tick);
      } else {
        setTimeout(() => {
          setIsAssembling(false);
          setAssemblyProgress(null);
        }, 500);
      }
    };

    requestAnimationFrame(tick);
  }, [isAssembling]);

  const handleToggleComponent = useCallback((socketId: string) => {
    setBlueprint((prev) => {
      const installed = prev.installedComponents ?? {};
      const currentVal = installed[socketId] ?? true;
      return {
        ...prev,
        installedComponents: {
          ...installed,
          [socketId]: !currentVal,
        },
      };
    });
  }, []);

  useEffect(() => sfx.setMuted(!soundEnabled), [soundEnabled]);

  // Clear the burn timer on unmount so a pending timeout cannot fire into a
  // dead component.
  useEffect(
    () => () => {
      if (burnTimer.current !== null) window.clearTimeout(burnTimer.current);
    },
    [],
  );

  const stats = useMemo(() => deriveStats(blueprint), [blueprint]);
  const overall = useMemo(() => deriveOverall(stats), [stats]);
  const wear = useMemo(
    () => deriveWear(blueprint.condition, blueprint.seed),
    [blueprint.condition, blueprint.seed],
  );
  const conditionPreset = useMemo(() => presetFor(blueprint.condition), [blueprint.condition]);

  // Stable identity matters: Ship calls this from an effect keyed on the
  // callback, so an inline arrow would re-fire it on every render.
  const handleShipReady = useCallback((group: Group) => {
    shipGroup.current = group;
  }, []);

  const setComponent = useCallback(
    (category: ComponentCategory, id: string) => {
      const reason = selectionBlockedReason(id, research);
      if (reason) {
        setNotice(reason);
        return;
      }
      sfx.play('click');
      setBlueprint((prev) => ({ ...prev, [category]: id }));
    },
    [research],
  );

  const setArchitecture = useCallback((architecture: ArchetypeId) => {
    sfx.play('warp');
    setBlueprint((prev) => ({ ...prev, architecture }));
  }, []);

  const handleTestBurn = useCallback(() => {
    sfx.play('burn');
    setBurning(true);
    if (burnTimer.current !== null) window.clearTimeout(burnTimer.current);
    burnTimer.current = window.setTimeout(() => setBurning(false), 2600);
  }, []);

  const handleUnlock = useCallback((tech: string) => {
    setResearch((prev) => {
      const result = unlock(prev, tech);
      if (!result.ok) {
        setNotice(result.reason);
        return prev;
      }
      sfx.play('warp');
      return result.state;
    });
  }, []);

  const setHullProfile = useCallback((hullProfile: ProfilePoint[]) => {
    setBlueprint((prev) => ({ ...prev, hullProfile }));
  }, []);

  const handleArchitect = useCallback(
    async (prompt: string) => {
      setArchitectBusy(true);
      const id = Date.now();
      setArchitectHistory((history) => [...history, { id, prompt, proposal: null }]);
      try {
        const proposal = await requestProposal(prompt, blueprint, research);
        setBlueprint(proposal.blueprint);
        setArchitectHistory((history) =>
          history.map((entry) => (entry.id === id ? { ...entry, proposal } : entry)),
        );
        sfx.play('warp');
      } catch (error) {
        const message = error instanceof Error ? error.message : 'The architect failed.';
        setArchitectHistory((history) =>
          history.map((entry) => (entry.id === id ? { ...entry, error: message } : entry)),
        );
      } finally {
        setArchitectBusy(false);
      }
    },
    [blueprint, research],
  );

  const handleExport = useCallback(async () => {
    if (!shipGroup.current) {
      setNotice('Viewport is still initialising');
      return;
    }
    sfx.play('click');
    try {
      await exportGlb(shipGroup.current, slugify(blueprint.name));
      setNotice(`Exported ${slugify(blueprint.name)}.glb`);
    } catch (error) {
      setNotice(error instanceof Error ? error.message : 'Export failed');
    }
  }, [blueprint.name]);

  // Auto-dismiss the notice.
  useEffect(() => {
    if (!notice) return;
    const id = window.setTimeout(() => setNotice(null), 3200);
    return () => window.clearTimeout(id);
  }, [notice]);

  return (
    <div className="flex h-screen w-screen flex-col overflow-hidden bg-space-950 text-slate-100">
      {/* --- Top bar --- */}
      <header className="no-select flex shrink-0 items-center justify-between gap-4 border-b border-white/5 px-4 py-2.5">
        <div className="flex min-w-0 items-center gap-3">
          <Rocket className="h-5 w-5 shrink-0 text-neon-cyan" aria-hidden />
          <div className="min-w-0">
            <h1 className="font-orbitron truncate text-sm font-bold tracking-wide">
              {blueprint.name}
            </h1>
            <p className="truncate text-[11px] text-slate-500">
              {blueprint.class} · {conditionPreset.name}
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <div className="hidden items-center gap-2 rounded-lg bg-slate-800/60 px-3 py-1.5 sm:flex">
            <span className="text-[10px] uppercase tracking-wider text-slate-500">Rating</span>
            <span className="font-orbitron text-sm font-bold tabular-nums text-neon-emerald">
              {overall}
            </span>
          </div>
          <button
            type="button"
            onClick={() => {
              setMissionActive((prev) => !prev);
              if (!missionActive) setTab('mission');
            }}
            className={`flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-medium ring-1 transition-colors ${
              missionActive
                ? 'bg-neon-rose/20 text-neon-rose ring-neon-rose/40 hover:bg-neon-rose/30'
                : 'bg-neon-cyan/15 text-neon-cyan ring-neon-cyan/30 hover:bg-neon-cyan/25'
            }`}
          >
            <Compass className="h-3.5 w-3.5" aria-hidden />
            <span className="hidden sm:inline">{missionActive ? 'Abort Sortie' : 'Mission Sortie'}</span>
          </button>
          <button
            type="button"
            onClick={handleTimeLapseReconstruction}
            disabled={isAssembling}
            className="flex items-center gap-1.5 rounded-lg bg-indigo-500/15 px-3 py-1.5 text-xs font-medium text-indigo-300 ring-1 ring-indigo-500/30 transition-colors hover:bg-indigo-500/25 disabled:opacity-50"
          >
            <Boxes className="h-3.5 w-3.5" aria-hidden />
            <span className="hidden sm:inline">Time-Lapse Build</span>
          </button>
          <button
            type="button"
            onClick={handleTestBurn}
            className="flex items-center gap-1.5 rounded-lg bg-neon-amber/15 px-3 py-1.5 text-xs font-medium text-neon-amber ring-1 ring-neon-amber/30 transition-colors hover:bg-neon-amber/25"
          >
            <Flame className="h-3.5 w-3.5" aria-hidden />
            <span className="hidden sm:inline">Test Burn</span>
          </button>
          <button
            type="button"
            onClick={() => void handleExport()}
            className="flex items-center gap-1.5 rounded-lg bg-slate-800/60 px-3 py-1.5 text-xs font-medium text-slate-300 transition-colors hover:bg-slate-700/60"
          >
            <Download className="h-3.5 w-3.5" aria-hidden />
            <span className="hidden sm:inline">Export .glb</span>
          </button>
          <button
            type="button"
            onClick={() => setSoundEnabled((value) => !value)}
            aria-label={soundEnabled ? 'Mute interface sounds' : 'Unmute interface sounds'}
            className="rounded-lg bg-slate-800/60 p-2 text-slate-400 transition-colors hover:text-slate-200"
          >
            {soundEnabled ? (
              <Volume2 className="h-3.5 w-3.5" aria-hidden />
            ) : (
              <VolumeX className="h-3.5 w-3.5" aria-hidden />
            )}
          </button>
        </div>
      </header>

      {/* --- Body --- */}
      <div className="flex min-h-0 flex-1 flex-col lg:flex-row">
        {/* Viewport */}
        <main className="relative min-h-0 flex-1">
          <Suspense fallback={<ViewportFallback />}>
            <Viewport
              blueprint={blueprint}
              mode={mode}
              environment={environment}
              protrusions={protrusions}
              burning={burning}
              autoRotate={autoRotate}
              rotationSpeed={rotationSpeed}
              lightIntensity={lightIntensity}
              cameraPreset={cameraPreset}
              onShipReady={handleShipReady}
              cinematicActive={isAssembling || (missionActive && !manualCameraControl)}
              cinematicCut={cinematicCut}
              assemblyProgress={assemblyProgress}
              isRepairing={missionActive && (missionTelemetry.state === 'repair' || missionTelemetry.state === 'docked')}
            />
          </Suspense>

          {/* Mission Sortie HUD Overlay */}
          {missionActive && (
            <div className="glass-panel pointer-events-none absolute left-4 top-4 max-w-sm rounded-xl p-3 border border-neon-cyan/30">
              <div className="flex items-center gap-2">
                <span className="relative flex h-2.5 w-2.5">
                  <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-neon-cyan opacity-75" />
                  <span className="relative inline-flex h-2.5 w-2.5 rounded-full bg-neon-cyan" />
                </span>
                <span className="font-orbitron text-xs font-bold uppercase tracking-wider text-neon-cyan">
                  SORTIE // {missionTelemetry.state.replace('_', ' ')}
                </span>
              </div>
              <p className="mt-1 text-[11px] text-slate-300">
                Waypoint: <span className="font-medium text-white">{missionTelemetry.currentWaypoint}</span>
              </p>
              <div className="mt-2 flex items-center gap-2">
                <span className="text-[10px] uppercase text-slate-400">Integrity:</span>
                <span
                  className={`font-mono text-xs font-bold ${
                    missionTelemetry.hullIntegrity < 0.6 ? 'text-neon-rose' : 'text-neon-emerald'
                  }`}
                >
                  {Math.round(missionTelemetry.hullIntegrity * 100)}%
                </span>
                <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-slate-800">
                  <div
                    className={`h-full rounded-full transition-all duration-200 ${
                      missionTelemetry.hullIntegrity < 0.4
                        ? 'bg-neon-rose'
                        : missionTelemetry.hullIntegrity < 0.6
                          ? 'bg-neon-amber'
                          : 'bg-neon-emerald'
                    }`}
                    style={{ width: `${Math.round(missionTelemetry.hullIntegrity * 100)}%` }}
                  />
                </div>
              </div>
              {missionTelemetry.activeThreats > 0 && (
                <div className="mt-1 flex items-center gap-1.5 text-[10px] font-bold text-neon-rose">
                  <span className="inline-block h-1.5 w-1.5 rounded-full bg-neon-rose animate-pulse" />
                  {missionTelemetry.activeThreats} HOSTILE INTERCEPTORS LOCKED (DEFENSES ENGAGED)
                </div>
              )}
            </div>
          )}

          {/* Time-Lapse Reconstruction Montage Overlay */}
          {isAssembling && assemblyProgress !== null && (
            <div className="glass-panel-glow absolute left-1/2 top-6 -translate-x-1/2 rounded-xl border border-neon-cyan/40 bg-space-950/90 px-6 py-3 text-center">
              <div className="font-orbitron text-xs font-bold uppercase tracking-[0.2em] text-neon-cyan">
                Procedural Assembly Reconstruction
              </div>
              <div className="mt-1 text-xs font-medium text-slate-200">
                {assemblyProgress < 0.25 && 'Phase 1: Holographic Keel & Longitudinal Spine Alignment'}
                {assemblyProgress >= 0.25 && assemblyProgress < 0.5 && 'Phase 2: Power Train & Drive Core Insertion'}
                {assemblyProgress >= 0.5 && assemblyProgress < 0.75 && 'Phase 3: Armor Plating & Hull Form Welding'}
                {assemblyProgress >= 0.75 && 'Phase 4: Component Outfitting & Reactor Ignition'}
              </div>
              <div className="mt-2 h-1.5 w-64 overflow-hidden rounded-full bg-slate-800">
                <div
                  className="h-full rounded-full bg-neon-cyan transition-all duration-100"
                  style={{ width: `${Math.round(assemblyProgress * 100)}%` }}
                />
              </div>
            </div>
          )}

          {/* Stats overlay — derived, not stored */}
          <div className="glass-panel pointer-events-none absolute bottom-4 left-4 w-52 rounded-xl p-3">
            <h2 className="font-orbitron mb-2 text-[10px] font-bold uppercase tracking-[0.14em] text-slate-400">
              Performance
            </h2>
            {STAT_LABELS.map(({ key, label }) => (
              <StatBar key={key} label={label} value={stats[key]} />
            ))}
          </div>

          {/* Camera presets */}
          <div className="absolute right-4 top-4 flex gap-1.5">
            {CAMERA_PRESETS.map((preset) => (
              <button
                key={preset.id}
                type="button"
                onClick={() => setCameraPreset(preset.id)}
                aria-pressed={cameraPreset === preset.id}
                className={`rounded-md px-2.5 py-1 text-[11px] font-medium backdrop-blur transition-colors ${
                  cameraPreset === preset.id
                    ? 'bg-neon-cyan/20 text-neon-cyan ring-1 ring-neon-cyan/40'
                    : 'bg-slate-900/60 text-slate-400 hover:text-slate-200'
                }`}
              >
                {preset.label}
              </button>
            ))}
          </div>

          {notice && (
            <div
              role="status"
              className="glass-panel-glow absolute bottom-4 left-1/2 -translate-x-1/2 rounded-lg px-4 py-2 text-xs text-slate-200"
            >
              {notice}
            </div>
          )}
        </main>

        {/* Sidebar */}
        <aside className="flex w-full shrink-0 flex-col border-t border-white/5 lg:w-96 lg:border-l lg:border-t-0">
          <nav className="no-select flex shrink-0 border-b border-white/5" aria-label="Panels">
            {TABS.map(({ id, label, short, Icon }) => (
              <button
                key={id}
                type="button"
                onClick={() => setTab(id)}
                aria-current={tab === id}
                aria-label={label}
                // Five tabs in a 384px rail: shrink and truncate rather than
                // overflowing the sidebar, which shifted the whole layout.
                className={`flex min-w-0 flex-1 items-center justify-center gap-1 px-1.5 py-2.5 text-[11px] font-medium transition-colors ${
                  tab === id
                    ? 'border-b-2 border-neon-cyan text-neon-cyan'
                    : 'border-b-2 border-transparent text-slate-500 hover:text-slate-300'
                }`}
              >
                <Icon className="h-3.5 w-3.5 shrink-0" aria-hidden />
                <span className="truncate">{short}</span>
              </button>
            ))}
          </nav>

          <div className="min-h-0 flex-1 space-y-3 overflow-y-auto p-3">
            {tab === 'designer' && (
              <DesignerTab
                blueprint={blueprint}
                research={research}
                onArchitecture={setArchitecture}
                onComponent={setComponent}
                onToggleComponent={handleToggleComponent}
                onPreset={(preset) => {
                  sfx.play('warp');
                  setBlueprint(preset);
                }}
              />
            )}

            {tab === 'condition' && (
              <ConditionTab
                blueprint={blueprint}
                wear={wear}
                onCondition={(condition) => setBlueprint((prev) => ({ ...prev, condition }))}
              />
            )}

            {tab === 'research' && (
              <ResearchTab research={research} onUnlock={handleUnlock} />
            )}

            {tab === 'mission' && (
              <MissionTab
                active={missionActive}
                telemetry={missionTelemetry}
                timeScale={missionTimeScale}
                cinematicCut={cinematicCut}
                manualCamera={manualCameraControl}
                onToggleActive={() => setMissionActive((p) => !p)}
                onTimeScale={setMissionTimeScale}
                onCinematicCut={setCinematicCut}
                onToggleManualCamera={setManualCameraControl}
              />
            )}

            {tab === 'hull' && (
              <Panel title="Hull Sculptor">
                {blueprint.architecture !== 'aerodynamic_sleek' && (
                  <div className="mb-3 rounded-lg border border-neon-amber/25 bg-neon-amber/10 px-3 py-2">
                    <p className="text-[11px] leading-snug text-neon-amber">
                      This cross-section is revolved by the Aerodynamic Hybrid Cruiser hull.
                      The other archetypes are welded plate and truss, not lathed.
                    </p>
                    <button
                      type="button"
                      onClick={() => setArchitecture('aerodynamic_sleek')}
                      className="mt-2 rounded-md bg-neon-amber/15 px-2.5 py-1 text-[11px] font-medium text-neon-amber ring-1 ring-neon-amber/30 transition-colors hover:bg-neon-amber/25"
                    >
                      Switch to that hull
                    </button>
                  </div>
                )}
                <HullSculptor
                  profile={blueprint.hullProfile ?? DEFAULT_HULL_PROFILE}
                  onChange={setHullProfile}
                  disabled={blueprint.architecture !== 'aerodynamic_sleek'}
                />
              </Panel>
            )}

            {tab === 'architect' && (
              <ArchitectPanel
                history={architectHistory}
                busy={architectBusy}
                onSubmit={(prompt) => void handleArchitect(prompt)}
              />
            )}

            {/* Viewport controls are always available */}
            <Panel title="Viewport">
              <Segmented
                label="Render mode"
                value={mode}
                options={RENDER_MODES}
                onChange={setMode}
              />
              <div className="mt-3">
                <Segmented
                  label="Environment"
                  value={environment}
                  options={ENVIRONMENTS}
                  onChange={setEnvironment}
                />
              </div>
              <div className="mt-2 border-t border-white/5 pt-2">
                <Toggle label="Auto-rotate" checked={autoRotate} onChange={setAutoRotate} />
                <Slider
                  label="Rotation speed"
                  value={rotationSpeed}
                  min={0.1}
                  max={4}
                  step={0.1}
                  onChange={setRotationSpeed}
                  format={(v) => `${v.toFixed(1)}×`}
                />
                <Slider
                  label="Light intensity"
                  value={lightIntensity}
                  min={0.2}
                  max={6}
                  step={0.1}
                  onChange={setLightIntensity}
                />
              </div>
              <div className="mt-2 border-t border-white/5 pt-2">
                <Toggle
                  label="Heat radiators"
                  checked={protrusions.radiators}
                  onChange={(radiators) => setProtrusions((p) => ({ ...p, radiators }))}
                />
                <Toggle
                  label="Sensor arrays"
                  checked={protrusions.sensors}
                  onChange={(sensors) => setProtrusions((p) => ({ ...p, sensors }))}
                />
                <Toggle
                  label="RCS thruster quads"
                  checked={protrusions.rcs}
                  onChange={(rcs) => setProtrusions((p) => ({ ...p, rcs }))}
                />
              </div>
            </Panel>
          </div>
        </aside>
      </div>
    </div>
  );
}

/* --------------------------- Designer --------------------------- */

function DesignerTab({
  blueprint,
  research,
  onArchitecture,
  onComponent,
  onToggleComponent,
  onPreset,
}: {
  blueprint: Blueprint;
  research: ResearchState;
  onArchitecture: (id: ArchetypeId) => void;
  onComponent: (category: ComponentCategory, id: string) => void;
  onToggleComponent?: (socketId: string) => void;
  onPreset: (preset: Blueprint) => void;
}) {
  const categories: ReadonlyArray<{
    category: ComponentCategory;
    title: string;
    entries: ReadonlyArray<{ id: string; name: string; tier: number; desc: string }>;
  }> = [
    { category: 'sublight', title: 'Sublight Drive', entries: SUBLIGHT_DRIVES },
    { category: 'ftl', title: 'FTL Core', entries: FTL_CORES },
    { category: 'weapons', title: 'Primary Armament', entries: WEAPONS },
    { category: 'sensors', title: 'Sensor Suite', entries: SENSORS },
    { category: 'fuel', title: 'Fuel Containment', entries: FUEL_SYSTEMS },
    { category: 'material', title: 'Hull Composite', entries: MATERIALS },
  ];

  return (
    <>
      <Panel title="Modular Hardpoint Sockets">
        <p className="mb-2 text-[11px] leading-snug text-slate-500">
          Hardware components retract flush with local y = 0 flange mounting faces when dismounted.
        </p>
        <div className="space-y-1">
          {[
            { id: 'weap-p', label: 'Port Turret / Missile Flange' },
            { id: 'weap-s', label: 'Starboard Turret / Missile Flange' },
            { id: 'sen', label: 'Forward Sensor Mast Flange' },
            { id: 'rad-p', label: 'Port Radiator Boom' },
            { id: 'rad-s', label: 'Starboard Radiator Boom' },
            { id: 'rcs-fore-p', label: 'Port Bow RCS Quad' },
            { id: 'rcs-fore-s', label: 'Starboard Bow RCS Quad' },
          ].map((hp) => {
            const installed = blueprint.installedComponents?.[hp.id] ?? true;
            return (
              <Toggle
                key={hp.id}
                label={hp.label}
                checked={installed}
                onChange={() => onToggleComponent?.(hp.id)}
              />
            );
          })}
        </div>
      </Panel>

      <Panel title="Presets">
        <div className="grid grid-cols-2 gap-1.5">
          {SHIP_PRESETS.map((preset) => {
            // Presets respect the research gate too, otherwise loading a
            // curated ship would smuggle in locked technology.
            const blocked = blueprintBlockedReason(preset, research);
            return (
              <button
                key={preset.id}
                type="button"
                onClick={() => onPreset(preset)}
                disabled={blocked !== null}
                title={blocked ?? preset.class}
                className={`rounded-lg px-2.5 py-2 text-left text-[11px] transition-colors ${
                  blocked
                    ? 'cursor-not-allowed bg-slate-900/40 text-slate-600'
                    : 'bg-slate-800/60 text-slate-300 hover:bg-slate-700/60'
                }`}
              >
                {preset.name}
                {blocked && <span className="mt-0.5 block text-[10px]">Locked tech</span>}
              </button>
            );
          })}
        </div>
      </Panel>

      <Panel title="Structural Archetype">
        <div className="space-y-1.5">
          {HULL_ARCHITECTURES.map((arch) => {
            const Icon = ARCH_ICONS[arch.icon] ?? Shield;
            const selected = blueprint.architecture === arch.id;
            return (
              <button
                key={arch.id}
                type="button"
                onClick={() => onArchitecture(arch.id)}
                aria-pressed={selected}
                className={`flex w-full items-start gap-2.5 rounded-lg border px-3 py-2 text-left transition-colors ${
                  selected
                    ? 'border-neon-cyan/50 bg-neon-cyan/10'
                    : 'border-slate-800 bg-slate-900/40 hover:border-slate-600'
                }`}
              >
                <Icon
                  className={`mt-0.5 h-4 w-4 shrink-0 ${
                    selected ? 'text-neon-cyan' : 'text-slate-500'
                  }`}
                  aria-hidden
                />
                <span className="min-w-0">
                  <span
                    className={`block text-sm font-medium ${
                      selected ? 'text-neon-cyan' : 'text-slate-200'
                    }`}
                  >
                    {arch.name}
                  </span>
                  <span className="block text-[11px] text-slate-500">{arch.tag}</span>
                </span>
              </button>
            );
          })}
        </div>
      </Panel>

      {categories.map(({ category, title, entries }) => (
        <Panel key={category} title={title}>
          <div className="space-y-1.5">
            {entries.map((entry) => (
              <OptionRow
                key={entry.id}
                name={entry.name}
                detail={entry.desc}
                tier={entry.tier}
                selected={blueprint[category] === entry.id}
                lockedReason={selectionBlockedReason(entry.id, research)}
                onSelect={() => onComponent(category, entry.id)}
              />
            ))}
          </div>
        </Panel>
      ))}
    </>
  );
}

/* --------------------------- Condition --------------------------- */

const WEAR_LABELS: ReadonlyArray<{ key: keyof ReturnType<typeof deriveWear>; label: string }> = [
  { key: 'abrasion', label: 'Edge abrasion' },
  { key: 'grime', label: 'Accumulated grime' },
  { key: 'thermal', label: 'Thermal scoring' },
  { key: 'impact', label: 'Micrometeorite pitting' },
  { key: 'oxidation', label: 'Oxidation staining' },
  { key: 'repair', label: 'Replacement plating' },
  { key: 'structural', label: 'Structural damage' },
];

function ConditionTab({
  blueprint,
  wear,
  onCondition,
}: {
  blueprint: Blueprint;
  wear: ReturnType<typeof deriveWear>;
  onCondition: (condition: number) => void;
}) {
  const active = presetFor(blueprint.condition);

  return (
    <>
      <Panel title="Service History">
        <div className="space-y-1.5">
          {CONDITION_PRESETS.map((preset) => {
            const selected = preset.id === active.id;
            return (
              <button
                key={preset.id}
                type="button"
                onClick={() => onCondition(conditionFor(preset))}
                aria-pressed={selected}
                className={`w-full rounded-lg border px-3 py-2 text-left transition-colors ${
                  selected
                    ? 'border-neon-cyan/50 bg-neon-cyan/10'
                    : 'border-slate-800 bg-slate-900/40 hover:border-slate-600'
                }`}
              >
                <span
                  className={`block text-sm font-medium ${
                    selected ? 'text-neon-cyan' : 'text-slate-200'
                  }`}
                >
                  {preset.name}
                </span>
                <span className="mt-0.5 block text-[11px] leading-snug text-slate-500">
                  {preset.blurb}
                </span>
              </button>
            );
          })}
        </div>

        <div className="mt-3 border-t border-white/5 pt-2">
          <Slider
            label="Condition"
            value={blueprint.condition}
            min={0}
            max={1}
            step={0.01}
            onChange={onCondition}
            format={(v) => `${Math.round(v * 100)}%`}
          />
        </div>
      </Panel>

      <Panel title="Wear Channels">
        <p className="mb-2 text-[11px] leading-snug text-slate-500">
          One scalar drives seven channels. Every value below is deterministic for this
          ship&apos;s seed — reload and it renders identically.
        </p>
        {WEAR_LABELS.map(({ key, label }) => (
          <StatBar key={key} label={label} value={Math.round(wear[key] * 100)} />
        ))}
        <p className="mt-2 font-mono text-[10px] text-slate-600">
          seed 0x{blueprint.seed.toString(16)}
        </p>
      </Panel>
    </>
  );
}

/* --------------------------- Research --------------------------- */

function ResearchTab({
  research,
  onUnlock,
}: {
  research: ResearchState;
  onUnlock: (tech: string) => void;
}) {
  const names: Record<string, string> = {
    graviton_singularity: 'Graviton Fold Engine',
    tachyon_disruptor: 'Tachyon Beam Disruptor',
    zero_point_core: 'Zero-Point Micro-Singularity',
  };

  return (
    <Panel
      title="Research & Development"
      action={
        <span className="font-orbitron text-xs font-bold tabular-nums text-neon-emerald">
          {research.points.toLocaleString()} XP
        </span>
      }
    >
      <p className="mb-3 text-[11px] leading-snug text-slate-500">
        Unlocked technology becomes selectable in the Designer. Until then it is disabled
        there, with the cost shown.
      </p>
      <div className="space-y-2">
        {LOCKABLE_TECHS.map((tech) => {
          const owned = research.unlocked[tech] === true;
          const cost = costOf(tech) ?? 0;
          const affordable = research.points >= cost;
          return (
            <div
              key={tech}
              className="rounded-lg border border-slate-800 bg-slate-900/40 px-3 py-2.5"
            >
              <div className="mb-1.5 flex items-center justify-between gap-2">
                <span className="text-sm font-medium text-slate-200">{names[tech] ?? tech}</span>
                <span className="font-mono text-[11px] tabular-nums text-slate-500">
                  {cost.toLocaleString()} XP
                </span>
              </div>
              {owned ? (
                <span className="inline-flex items-center gap-1.5 text-[11px] font-medium text-neon-emerald">
                  Researched — available in Designer
                </span>
              ) : (
                <button
                  type="button"
                  onClick={() => onUnlock(tech)}
                  disabled={!affordable}
                  // Several identical "Research" buttons on one panel is a real
                  // screen-reader problem, not just a test-selector one.
                  aria-label={`Research ${names[tech] ?? tech}`}
                  className={`w-full rounded-md px-3 py-1.5 text-xs font-medium transition-colors ${
                    affordable
                      ? 'bg-neon-cyan/15 text-neon-cyan ring-1 ring-neon-cyan/40 hover:bg-neon-cyan/25'
                      : 'cursor-not-allowed bg-slate-800/60 text-slate-600'
                  }`}
                >
                  {affordable
                    ? 'Research'
                    : `${(cost - research.points).toLocaleString()} XP short`}
                </button>
              )}
            </div>
          );
        })}
      </div>
    </Panel>
  );
}

/* --------------------------- Mission --------------------------- */

function MissionTab({
  active,
  telemetry,
  timeScale,
  cinematicCut,
  manualCamera,
  onToggleActive,
  onTimeScale,
  onCinematicCut,
  onToggleManualCamera,
}: {
  active: boolean;
  telemetry: MissionTelemetry;
  timeScale: number;
  cinematicCut: CinematicCut;
  manualCamera: boolean;
  onToggleActive: () => void;
  onTimeScale: (scale: number) => void;
  onCinematicCut: (cut: CinematicCut) => void;
  onToggleManualCamera: (manual: boolean) => void;
}) {
  const stateBadge: Record<string, string> = {
    docked: 'text-slate-400 border-slate-700 bg-slate-900/60',
    departing: 'text-neon-cyan border-neon-cyan/40 bg-neon-cyan/10',
    warp: 'text-purple-400 border-purple-500/40 bg-purple-950/30',
    asteroid_field: 'text-amber-400 border-amber-500/40 bg-amber-950/30',
    planet_orbit: 'text-sky-400 border-sky-500/40 bg-sky-950/30',
    combat: 'text-neon-rose border-neon-rose/50 bg-neon-rose/15 animate-pulse',
    return_transit: 'text-indigo-400 border-indigo-500/40 bg-indigo-950/30',
    repair: 'text-neon-amber border-neon-amber/50 bg-neon-amber/15',
  };

  return (
    <>
      <Panel
        title="Deep-Space Mission Loop"
        action={
          <button
            type="button"
            onClick={onToggleActive}
            className={`flex items-center gap-1.5 rounded-lg px-2.5 py-1 text-xs font-bold transition-all ${
              active
                ? 'bg-neon-rose/20 text-neon-rose ring-1 ring-neon-rose/40 hover:bg-neon-rose/30'
                : 'bg-neon-emerald/20 text-neon-emerald ring-1 ring-neon-emerald/40 hover:bg-neon-emerald/30'
            }`}
          >
            {active ? 'Abort Sortie' : 'Launch Sortie'}
          </button>
        }
      >
        <p className="mb-3 text-[11px] leading-snug text-slate-400">
          Autonomous zero-control sortie engine. The starship departs Starbase Gantry Bay 04,
          traverses deep space, engages hostiles with articulated turrets, survives combat
          above the 35% hard integrity floor, and returns to dock for full reconstruction.
        </p>

        <div className="space-y-2.5 rounded-lg border border-slate-800 bg-slate-900/50 p-3">
          <div className="flex items-center justify-between">
            <span className="text-[10px] uppercase tracking-wider text-slate-500">Mission State</span>
            <span
              className={`rounded border px-2 py-0.5 font-orbitron text-xs font-bold uppercase tracking-wider ${
                stateBadge[telemetry.state] ?? 'text-slate-300'
              }`}
            >
              {telemetry.state.replace('_', ' ')}
            </span>
          </div>

          <div>
            <div className="mb-1 flex items-center justify-between">
              <span className="text-[11px] text-slate-400">Target Waypoint</span>
              <span className="font-mono text-[10px] text-neon-cyan">{telemetry.currentWaypoint}</span>
            </div>
            <div className="h-1.5 w-full overflow-hidden rounded-full bg-slate-800">
              <div
                className="h-full rounded-full bg-neon-cyan transition-all duration-300"
                style={{ width: `${Math.round(telemetry.progress * 100)}%` }}
              />
            </div>
          </div>

          <div>
            <div className="mb-1 flex items-center justify-between">
              <span className="text-[11px] text-slate-400">Hull Integrity</span>
              <span
                className={`font-mono text-xs font-bold ${
                  telemetry.hullIntegrity < 0.6 ? 'text-neon-rose' : 'text-neon-emerald'
                }`}
              >
                {Math.round(telemetry.hullIntegrity * 100)}%
              </span>
            </div>
            <div className="h-2 w-full overflow-hidden rounded-full bg-slate-800">
              <div
                className={`h-full rounded-full transition-all duration-200 ${
                  telemetry.hullIntegrity < 0.4
                    ? 'bg-neon-rose'
                    : telemetry.hullIntegrity < 0.6
                      ? 'bg-neon-amber'
                      : 'bg-neon-emerald'
                }`}
                style={{ width: `${Math.round(telemetry.hullIntegrity * 100)}%` }}
              />
            </div>
            <div className="mt-1 flex justify-between text-[9px] text-slate-500">
              <span>0% Critical</span>
              <span className="text-neon-amber">35% Hard Floor</span>
              <span>100% Repaired</span>
            </div>
          </div>

          <div className="flex justify-between border-t border-slate-800 pt-2 text-[11px]">
            <span className="text-slate-500">Hostile Threats:</span>
            <span
              className={`font-mono font-bold ${
                telemetry.activeThreats > 0 ? 'text-neon-rose' : 'text-slate-400'
              }`}
            >
              {telemetry.activeThreats > 0 ? `${telemetry.activeThreats} Locked` : 'None'}
            </span>
          </div>

          <div className="flex justify-between text-[11px]">
            <span className="text-slate-500">Drone Swarm Sorties:</span>
            <span className="font-mono text-neon-cyan">{telemetry.droneSorties} cycles</span>
          </div>
        </div>

        <div className="mt-3">
          <Slider
            label="Simulation Speed"
            value={timeScale}
            min={0.5}
            max={4.0}
            step={0.5}
            onChange={onTimeScale}
            format={(v) => `${v.toFixed(1)}×`}
          />
        </div>
      </Panel>

      <Panel title="Cinematic Director Camera">
        <Toggle
          label="Manual Camera Override"
          hint="Disable automatic cinematic cuts and restore manual OrbitControls"
          checked={manualCamera}
          onChange={onToggleManualCamera}
        />
        {!manualCamera && (
          <div className="mt-2 space-y-1.5">
            <span className="block text-[11px] text-slate-500">Camera Preset Cut:</span>
            <div className="grid grid-cols-2 gap-1.5">
              {[
                { id: 'gantry_dolly', label: 'Gantry Dolly' },
                { id: 'chase_cam', label: 'Chase Cam' },
                { id: 'turret_ots', label: 'Turret OTS' },
                { id: 'flyby_pass', label: 'Flyby Pass' },
              ].map((c) => (
                <button
                  key={c.id}
                  type="button"
                  onClick={() => onCinematicCut(c.id as CinematicCut)}
                  className={`rounded px-2 py-1.5 text-[11px] font-medium transition-colors ${
                    cinematicCut === c.id
                      ? 'bg-neon-cyan/20 text-neon-cyan ring-1 ring-neon-cyan/40'
                      : 'bg-slate-800/60 text-slate-400 hover:text-slate-200'
                  }`}
                >
                  {c.label}
                </button>
              ))}
            </div>
          </div>
        )}
      </Panel>

      <Panel title="Mission & Combat Log">
        <div className="h-36 overflow-y-auto rounded-lg border border-slate-800 bg-space-950/80 p-2 font-mono text-[10px] leading-relaxed text-slate-400">
          {telemetry.combatLog.map((entry, idx) => (
            <div
              key={idx}
              className={`py-0.5 ${
                entry.includes('RED ALERT') || entry.includes('CRITICAL')
                  ? 'font-bold text-neon-rose'
                  : entry.includes('reconstructed') || entry.includes('complete')
                    ? 'text-neon-emerald'
                    : 'text-slate-400'
              }`}
            >
              {entry}
            </div>
          ))}
        </div>
      </Panel>
    </>
  );
}
