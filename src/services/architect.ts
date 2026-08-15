import {
  proposeBlueprint,
  validateProposal,
  type Proposal,
  type RationaleLine,
} from '../domain/assistant';
import { LOCKABLE_TECHS, isUnlocked, type ResearchState } from '../domain/unlocks';
import type { Blueprint } from '../domain/types';

/**
 * Client side of the AI Ship Architect.
 *
 * Calls our own `/api/architect`, which holds the model key server-side. If the
 * endpoint is absent or unconfigured — a local checkout with no key, or a static
 * deploy — this falls back to the deterministic rule engine, so the feature
 * always does something real rather than pretending.
 *
 * Model output is never trusted: it goes through `validateProposal()`, which
 * rejects unknown ids and anything the player has not researched.
 */

const ENDPOINT = '/api/architect';
const TIMEOUT_MS = 30_000;

const trim = (value: unknown, max: number): string =>
  typeof value === 'string' ? value.trim().slice(0, max) : '';

function readRationale(raw: unknown): RationaleLine[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .slice(0, 8)
    .map((entry) => {
      const line = (entry ?? {}) as Record<string, unknown>;
      return {
        category: trim(line.category, 40),
        choice: trim(line.choice, 60),
        because: trim(line.because, 200),
      };
    })
    .filter((line) => line.category && line.because);
}

export async function requestProposal(
  prompt: string,
  base: Blueprint,
  research: ResearchState,
): Promise<Proposal> {
  const lockedTech = LOCKABLE_TECHS.filter((tech) => !isUnlocked(tech, research));

  const controller = new AbortController();
  const timeout = window.setTimeout(() => controller.abort(), TIMEOUT_MS);

  try {
    const response = await fetch(ENDPOINT, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ prompt, lockedTech }),
      signal: controller.signal,
    });

    if (!response.ok) {
      // 501 means "no key configured" — an expected, quiet fallback.
      if (response.status === 501 || response.status === 404) {
        return withFallbackNote(proposeBlueprint(prompt, base, research), null);
      }
      const body = (await response.json().catch(() => ({}))) as { error?: string };
      return withFallbackNote(
        proposeBlueprint(prompt, base, research),
        body.error ?? `Model request failed (${response.status}).`,
      );
    }

    const body = (await response.json()) as { proposal?: unknown };
    const raw = (body.proposal ?? {}) as Record<string, unknown>;
    const { blueprint, problems } = validateProposal(raw, base, research);

    const rationale = readRationale(raw.rationale);

    return {
      blueprint,
      rationale: rationale.length
        ? rationale
        : proposeBlueprint(prompt, base, research).rationale,
      detected: proposeBlueprint(prompt, base, research).detected,
      summary: trim(raw.summary, 300) || 'Configuration updated.',
      source: 'model',
      problems: problems.length ? problems : undefined,
    };
  } catch (error) {
    const aborted = error instanceof DOMException && error.name === 'AbortError';
    return withFallbackNote(
      proposeBlueprint(prompt, base, research),
      aborted ? 'The model took too long to respond.' : 'Could not reach the architect service.',
    );
  } finally {
    window.clearTimeout(timeout);
  }
}

function withFallbackNote(proposal: Proposal, problem: string | null): Proposal {
  return {
    ...proposal,
    problems: problem ? [problem] : undefined,
  };
}
