import { type ReactNode } from 'react';
import { Lock } from 'lucide-react';

/**
 * UI primitives.
 *
 * Every interactive element here is a real button/input with a label and a
 * visible focus state. The prototype rendered clickable <div>s with no focus
 * styling, no labels and no keyboard path.
 */

export function Panel({
  title,
  children,
  action,
}: {
  title: string;
  children: ReactNode;
  action?: ReactNode;
}) {
  return (
    <section className="glass-panel rounded-xl p-4">
      <header className="mb-3 flex items-center justify-between gap-2">
        <h3 className="font-orbitron text-[11px] font-bold uppercase tracking-[0.14em] text-slate-400">
          {title}
        </h3>
        {action}
      </header>
      {children}
    </section>
  );
}

export function Toggle({
  label,
  checked,
  onChange,
  hint,
}: {
  label: string;
  checked: boolean;
  onChange: (next: boolean) => void;
  hint?: string;
}) {
  return (
    <label className="flex cursor-pointer items-center justify-between gap-3 py-1.5">
      <span className="text-sm text-slate-300">
        {label}
        {hint && <span className="block text-[11px] text-slate-500">{hint}</span>}
      </span>
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        aria-label={label}
        onClick={() => onChange(!checked)}
        className={`relative h-5 w-9 shrink-0 rounded-full transition-colors ${
          checked ? 'bg-neon-cyan' : 'bg-slate-700'
        }`}
      >
        <span
          className={`absolute top-0.5 h-4 w-4 rounded-full bg-white transition-transform ${
            checked ? 'translate-x-4.5' : 'translate-x-0.5'
          }`}
        />
      </button>
    </label>
  );
}

export function Slider({
  label,
  value,
  min,
  max,
  step,
  onChange,
  format,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  onChange: (next: number) => void;
  format?: (value: number) => string;
}) {
  const id = `slider-${label.replace(/\s+/g, '-').toLowerCase()}`;
  return (
    <div className="py-1.5">
      <div className="mb-1.5 flex items-center justify-between">
        <label htmlFor={id} className="text-sm text-slate-300">
          {label}
        </label>
        <span className="font-mono text-xs tabular-nums text-neon-cyan">
          {format ? format(value) : value.toFixed(2)}
        </span>
      </div>
      <input
        id={id}
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(event) => onChange(Number(event.target.value))}
        className="h-1.5 w-full cursor-pointer appearance-none rounded-full bg-slate-700 accent-sky-400"
      />
    </div>
  );
}

export function Segmented<T extends string>({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: T;
  options: ReadonlyArray<{ id: T; label: string }>;
  onChange: (next: T) => void;
}) {
  return (
    <div role="group" aria-label={label} className="grid grid-cols-2 gap-1.5">
      {options.map((option) => {
        const active = option.id === value;
        return (
          <button
            key={option.id}
            type="button"
            aria-pressed={active}
            onClick={() => onChange(option.id)}
            className={`rounded-lg px-2.5 py-2 text-xs font-medium transition-colors ${
              active
                ? 'bg-neon-cyan/15 text-neon-cyan ring-1 ring-neon-cyan/40'
                : 'bg-slate-800/60 text-slate-400 hover:bg-slate-700/60 hover:text-slate-200'
            }`}
          >
            {option.label}
          </button>
        );
      })}
    </div>
  );
}

export interface OptionRowProps {
  name: string;
  detail: string;
  tier: number;
  selected: boolean;
  lockedReason: string | null;
  onSelect: () => void;
}

/**
 * A selectable catalogue entry that is *actually disabled* when locked, with
 * the reason attached. In the prototype, research state was written but never
 * read here, so locked technology stayed freely selectable.
 */
export function OptionRow({
  name,
  detail,
  tier,
  selected,
  lockedReason,
  onSelect,
}: OptionRowProps) {
  const locked = lockedReason !== null;
  return (
    <button
      type="button"
      onClick={onSelect}
      disabled={locked}
      aria-pressed={selected}
      title={lockedReason ?? detail}
      className={`w-full rounded-lg border px-3 py-2 text-left transition-colors ${
        selected
          ? 'border-neon-cyan/50 bg-neon-cyan/10'
          : locked
            ? 'cursor-not-allowed border-slate-800 bg-slate-900/40 opacity-55'
            : 'border-slate-800 bg-slate-900/40 hover:border-slate-600 hover:bg-slate-800/60'
      }`}
    >
      <div className="flex items-center justify-between gap-2">
        <span
          className={`text-sm font-medium ${selected ? 'text-neon-cyan' : 'text-slate-200'}`}
        >
          {name}
        </span>
        <span className="flex shrink-0 items-center gap-1.5">
          {locked && <Lock className="h-3 w-3 text-slate-500" aria-hidden />}
          <span className="font-mono text-[10px] text-slate-500">T{tier}</span>
        </span>
      </div>
      <p className="mt-0.5 text-[11px] leading-snug text-slate-500">
        {locked ? lockedReason : detail}
      </p>
    </button>
  );
}

const STAT_COLOR = (value: number): string => {
  if (value >= 75) return 'bg-neon-emerald';
  if (value >= 45) return 'bg-neon-cyan';
  if (value >= 25) return 'bg-neon-amber';
  return 'bg-neon-rose';
};

export function StatBar({ label, value }: { label: string; value: number }) {
  return (
    <div className="py-1">
      <div className="mb-1 flex items-center justify-between">
        <span className="text-[11px] uppercase tracking-wide text-slate-400">{label}</span>
        <span className="font-mono text-xs tabular-nums text-slate-200">{value}</span>
      </div>
      <div
        className="h-1.5 w-full overflow-hidden rounded-full bg-slate-800"
        role="meter"
        aria-valuenow={value}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-label={label}
      >
        <div
          className={`h-full rounded-full transition-[width] duration-300 ${STAT_COLOR(value)}`}
          style={{ width: `${value}%` }}
        />
      </div>
    </div>
  );
}
