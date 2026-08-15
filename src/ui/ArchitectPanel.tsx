import { useRef, useState } from 'react';
import { AlertTriangle, Cpu, Send, Sparkles } from 'lucide-react';
import type { Proposal } from '../domain/assistant';

/**
 * The AI Ship Architect console.
 *
 * Two honest states, always labelled:
 *   • "Model" — a language model chose the configuration, server-side.
 *   • "Rule-based" — no key configured or the call failed, so the deterministic
 *     design assistant chose it instead.
 *
 * The prototype claimed to be an AI while running four `String.includes`
 * branches. The badge on each reply exists so that can never be ambiguous again.
 */

export interface ArchitectEntry {
  id: number;
  prompt: string;
  proposal: Proposal | null;
  error?: string;
}

const EXAMPLES = [
  'A battered frontier salvage hauler that has seen better decades',
  'Fast stealth scout for deep reconnaissance',
  'Heavily armoured siege dreadnought, firepower over everything',
  'Long-range science vessel for a decade-long survey',
] as const;

export function ArchitectPanel({
  history,
  busy,
  onSubmit,
}: {
  history: ArchitectEntry[];
  busy: boolean;
  onSubmit: (prompt: string) => void;
}) {
  const [prompt, setPrompt] = useState('');
  const inputRef = useRef<HTMLTextAreaElement>(null);

  const submit = () => {
    const trimmed = prompt.trim();
    if (!trimmed || busy) return;
    onSubmit(trimmed);
    setPrompt('');
  };

  return (
    <section className="glass-panel rounded-xl p-4">
      <header className="mb-3 flex items-center justify-between gap-2">
        <h3 className="font-orbitron text-[11px] font-bold uppercase tracking-[0.14em] text-slate-400">
          Ship Architect
        </h3>
        <Sparkles className="h-3.5 w-3.5 text-neon-violet" aria-hidden />
      </header>

      <p className="mb-3 text-[11px] leading-snug text-slate-500">
        Describe the ship you want. Every reply says whether a model or the
        built-in rule engine chose the configuration.
      </p>

      {history.length === 0 && (
        <div className="mb-3 space-y-1.5">
          {EXAMPLES.map((example) => (
            <button
              key={example}
              type="button"
              onClick={() => {
                setPrompt(example);
                inputRef.current?.focus();
              }}
              className="w-full rounded-lg border border-slate-800 bg-slate-900/40 px-3 py-2 text-left text-[11px] leading-snug text-slate-400 transition-colors hover:border-slate-600 hover:text-slate-200"
            >
              {example}
            </button>
          ))}
        </div>
      )}

      <div className="mb-3 space-y-3" aria-live="polite">
        {history.map((entry) => (
          <article key={entry.id} className="space-y-2">
            <p className="rounded-lg bg-slate-800/60 px-3 py-2 text-[11px] text-slate-300">
              {entry.prompt}
            </p>

            {entry.error && (
              <p className="rounded-lg border border-neon-rose/30 bg-neon-rose/10 px-3 py-2 text-[11px] text-neon-rose">
                {entry.error}
              </p>
            )}

            {entry.proposal && (
              <div className="rounded-lg border border-slate-800 bg-slate-900/40 px-3 py-2.5">
                <div className="mb-2 flex items-center gap-2">
                  <span
                    className={`inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[10px] font-medium ${
                      entry.proposal.source === 'model'
                        ? 'bg-neon-violet/15 text-neon-violet'
                        : 'bg-slate-700/60 text-slate-300'
                    }`}
                  >
                    <Cpu className="h-2.5 w-2.5" aria-hidden />
                    {entry.proposal.source === 'model' ? 'Model' : 'Rule-based'}
                  </span>
                  <span className="truncate font-orbitron text-[11px] font-bold text-neon-cyan">
                    {entry.proposal.blueprint.name}
                  </span>
                </div>

                <p className="mb-2 text-[11px] leading-snug text-slate-400">
                  {entry.proposal.summary}
                </p>

                {entry.proposal.rationale.length > 0 && (
                  <dl className="space-y-1 border-t border-white/5 pt-2">
                    {entry.proposal.rationale.map((line, i) => (
                      <div key={i} className="grid grid-cols-[76px_1fr] gap-2">
                        <dt className="text-[10px] uppercase tracking-wide text-slate-600">
                          {line.category}
                        </dt>
                        <dd className="text-[11px] leading-snug text-slate-400">
                          <span className="text-slate-200">{line.choice}</span>
                          {line.because && ` — ${line.because}`}
                        </dd>
                      </div>
                    ))}
                  </dl>
                )}

                {entry.proposal.problems && entry.proposal.problems.length > 0 && (
                  <ul className="mt-2 space-y-1 border-t border-white/5 pt-2">
                    {entry.proposal.problems.map((problem, i) => (
                      <li
                        key={i}
                        className="flex items-start gap-1.5 text-[10px] leading-snug text-neon-amber"
                      >
                        <AlertTriangle className="mt-0.5 h-2.5 w-2.5 shrink-0" aria-hidden />
                        {problem}
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            )}
          </article>
        ))}
      </div>

      <div className="flex items-end gap-2">
        <label htmlFor="architect-prompt" className="sr-only">
          Describe the ship you want
        </label>
        <textarea
          id="architect-prompt"
          ref={inputRef}
          value={prompt}
          rows={2}
          maxLength={600}
          disabled={busy}
          onChange={(event) => setPrompt(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter' && !event.shiftKey) {
              event.preventDefault();
              submit();
            }
          }}
          placeholder="A fast stealth scout with long legs…"
          className="min-h-[3.25rem] flex-1 resize-none rounded-lg border border-slate-800 bg-slate-900/60 px-3 py-2 text-[11px] text-slate-200 placeholder:text-slate-600 disabled:opacity-50"
        />
        <button
          type="button"
          onClick={submit}
          disabled={busy || !prompt.trim()}
          aria-label="Send brief to the ship architect"
          className="shrink-0 rounded-lg bg-neon-violet/15 p-2.5 text-neon-violet ring-1 ring-neon-violet/30 transition-colors hover:bg-neon-violet/25 disabled:cursor-not-allowed disabled:opacity-40"
        >
          <Send className="h-3.5 w-3.5" aria-hidden />
        </button>
      </div>

      {busy && (
        <p className="mt-2 font-mono text-[10px] uppercase tracking-widest text-slate-600">
          Drafting…
        </p>
      )}
    </section>
  );
}
