import { useCallback, useRef, useState } from 'react';
import {
  DEFAULT_HULL_PROFILE,
  PROFILE_LIMITS,
  toSvgPath,
  withPointAt,
  type ProfilePoint,
} from '../domain/profile';

/**
 * The Hull Sculptor.
 *
 * The prototype's "Spline Sculptor" could not be dragged and drew its curve with
 * SVG `L` commands — a polyline wearing a spline's name. This one is draggable
 * with pointer *or* keyboard, and renders the identical Catmull-Rom that the
 * lathe revolves, so the preview cannot disagree with the ship.
 */

const WIDTH = 320;
const HEIGHT = 150;
const CENTRE_Y = HEIGHT / 2;
const PAD = 14;

const zToX = (z: number): number =>
  PAD +
  ((z - PROFILE_LIMITS.minZ) / (PROFILE_LIMITS.maxZ - PROFILE_LIMITS.minZ)) * (WIDTH - PAD * 2);

const rToY = (r: number): number =>
  CENTRE_Y - (r / PROFILE_LIMITS.maxRadius) * (CENTRE_Y - PAD);

const xToZ = (x: number): number =>
  PROFILE_LIMITS.minZ +
  ((x - PAD) / (WIDTH - PAD * 2)) * (PROFILE_LIMITS.maxZ - PROFILE_LIMITS.minZ);

const yToR = (y: number): number =>
  ((CENTRE_Y - y) / (CENTRE_Y - PAD)) * PROFILE_LIMITS.maxRadius;

const project = (point: ProfilePoint) => ({ x: zToX(point.z), y: rToY(point.r) });
const projectMirrored = (point: ProfilePoint) => ({
  x: zToX(point.z),
  y: CENTRE_Y + (CENTRE_Y - rToY(point.r)),
});

export function HullSculptor({
  profile,
  onChange,
  disabled,
}: {
  profile: readonly ProfilePoint[];
  onChange: (next: ProfilePoint[]) => void;
  disabled: boolean;
}) {
  const svgRef = useRef<SVGSVGElement>(null);
  const [dragging, setDragging] = useState<number | null>(null);

  const pointFromEvent = useCallback((clientX: number, clientY: number): ProfilePoint => {
    const rect = svgRef.current?.getBoundingClientRect();
    if (!rect) return { r: 1, z: 0 };
    // The SVG scales to its container, so map through the viewBox.
    const x = ((clientX - rect.left) / rect.width) * WIDTH;
    const y = ((clientY - rect.top) / rect.height) * HEIGHT;
    return { r: yToR(y), z: xToZ(x) };
  }, []);

  const handlePointerMove = useCallback(
    (event: React.PointerEvent<SVGSVGElement>) => {
      if (dragging === null || disabled) return;
      event.preventDefault();
      onChange(withPointAt(profile, dragging, pointFromEvent(event.clientX, event.clientY)));
    },
    [dragging, disabled, onChange, profile, pointFromEvent],
  );

  const nudge = useCallback(
    (index: number, dz: number, dr: number) => {
      const point = profile[index];
      if (!point || disabled) return;
      onChange(withPointAt(profile, index, { r: point.r + dr, z: point.z + dz }));
    },
    [profile, onChange, disabled],
  );

  return (
    <div>
      <svg
        ref={svgRef}
        viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
        className={`w-full touch-none rounded-lg bg-slate-950/60 ring-1 ring-white/5 ${
          disabled ? 'opacity-40' : ''
        }`}
        role="group"
        aria-label="Hull cross-section editor"
        onPointerMove={handlePointerMove}
        onPointerUp={() => setDragging(null)}
        onPointerLeave={() => setDragging(null)}
      >
        {/* Axis of revolution */}
        <line
          x1={PAD}
          y1={CENTRE_Y}
          x2={WIDTH - PAD}
          y2={CENTRE_Y}
          stroke="rgb(148 163 184 / 0.25)"
          strokeDasharray="3 4"
        />

        {/* The revolved silhouette: the curve and its mirror */}
        <path d={toSvgPath(profile, project)} fill="none" stroke="#38bdf8" strokeWidth={2} />
        <path
          d={toSvgPath(profile, projectMirrored)}
          fill="none"
          stroke="#38bdf8"
          strokeWidth={2}
          opacity={0.45}
        />

        {/* Control handles — draggable with a pointer, nudgeable with a keyboard */}
        {profile.map((point, index) => {
          const { x, y } = project(point);
          return (
            <g key={index}>
              <line x1={x} y1={y} x2={x} y2={CENTRE_Y} stroke="rgb(56 189 248 / 0.2)" />
              <circle
                cx={x}
                cy={y}
                r={dragging === index ? 7 : 5}
                fill={dragging === index ? '#38bdf8' : '#0f172a'}
                stroke="#38bdf8"
                strokeWidth={2}
                className={disabled ? '' : 'cursor-grab'}
                tabIndex={disabled ? -1 : 0}
                role="slider"
                aria-label={`Station ${index + 1} radius`}
                aria-valuemin={PROFILE_LIMITS.minRadius}
                aria-valuemax={PROFILE_LIMITS.maxRadius}
                aria-valuenow={Number(point.r.toFixed(2))}
                onPointerDown={(event) => {
                  if (disabled) return;
                  event.currentTarget.setPointerCapture(event.pointerId);
                  setDragging(index);
                }}
                onKeyDown={(event) => {
                  const step = event.shiftKey ? 0.4 : 0.1;
                  const moves: Record<string, [number, number]> = {
                    ArrowUp: [0, step],
                    ArrowDown: [0, -step],
                    ArrowLeft: [-step * 4, 0],
                    ArrowRight: [step * 4, 0],
                  };
                  const move = moves[event.key];
                  if (!move) return;
                  event.preventDefault();
                  nudge(index, move[0], move[1]);
                }}
              />
            </g>
          );
        })}
      </svg>

      <div className="mt-2 flex items-center justify-between gap-2">
        <p className="text-[11px] leading-snug text-slate-500">
          Drag a station, or focus one and use the arrow keys.
        </p>
        <button
          type="button"
          onClick={() => onChange([...DEFAULT_HULL_PROFILE])}
          disabled={disabled}
          className="shrink-0 rounded-md bg-slate-800/60 px-2.5 py-1 text-[11px] text-slate-300 transition-colors hover:bg-slate-700/60 disabled:cursor-not-allowed disabled:opacity-50"
        >
          Reset
        </button>
      </div>
    </div>
  );
}
