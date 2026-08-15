import {
  FTL_CORES,
  FUEL_SYSTEMS,
  MATERIALS,
  SENSORS,
  SUBLIGHT_DRIVES,
  WEAPONS,
} from '../src/domain/components';
import { HULL_ARCHITECTURES } from '../src/domain/architectures';

/**
 * Server-side handler for the AI Ship Architect.
 *
 * This runs on a server, never in the browser. The API key is read from the
 * environment and is never sent to, or reachable from, the client — the client
 * only ever POSTs a prompt to our own endpoint.
 *
 * The model is forced through a tool call whose schema enumerates the real
 * catalogue, so it cannot invent components. Its output is still treated as
 * untrusted: `validateProposal()` on the client rejects anything unknown or
 * unresearched before it touches the scene.
 */

const ANTHROPIC_URL = 'https://api.anthropic.com/v1/messages';
const ANTHROPIC_VERSION = '2023-06-01';
const DEFAULT_MODEL = 'claude-sonnet-5';

/** Hard caps. A runaway prompt should cost cents, not dollars. */
export const LIMITS = {
  maxPromptChars: 600,
  maxTokens: 1024,
} as const;

const ids = (list: readonly { id: string }[]): string[] => list.map((entry) => entry.id);

const describe = (list: readonly { id: string; name: string; tier: number }[]): string =>
  list.map((entry) => `  - ${entry.id} (T${entry.tier}): ${entry.name}`).join('\n');

const SYSTEM_PROMPT = `You are the ship architect for Astralis Shipyard, a starship design studio.

The design language is deliberately non-aerodynamic: in vacuum there is no air
resistance, so these ships are shaped by waste-heat rejection, structural load
paths, shielding and modularity — exposed trusses, huge radiators, faceted
plating, outrigger booms. Only aerodynamic_sleek is built for atmosphere.

Choose components that genuinely serve the user's brief. Explain each choice in
one short sentence, in plain language, referring to what the user asked for.

Architectures:
${HULL_ARCHITECTURES.map((a) => `  - ${a.id}: ${a.name} — ${a.tag}`).join('\n')}

Sublight drives:
${describe(SUBLIGHT_DRIVES)}

FTL cores:
${describe(FTL_CORES)}

Weapons:
${describe(WEAPONS)}

Sensors:
${describe(SENSORS)}

Fuel:
${describe(FUEL_SYSTEMS)}

Hull composites:
${describe(MATERIALS)}

condition is 0 (factory fresh, mirror finish) to 1 (derelict hulk, unpowered and
tumbling). Pick a value that matches the story the user is telling. If they say
nothing about the ship's history, use something between 0.05 and 0.3.

Some technology may be locked; the user's message says which. Never choose a
locked component.`;

const PROPOSE_SHIP_TOOL = {
  name: 'propose_ship',
  description: 'Propose a complete starship configuration for the user brief.',
  input_schema: {
    type: 'object' as const,
    properties: {
      name: { type: 'string', description: 'Ship name, e.g. "SF-44 Phantom Knife".' },
      class: { type: 'string', description: 'Short class description, e.g. "Stealth Frigate".' },
      architecture: { type: 'string', enum: ids(HULL_ARCHITECTURES) },
      sublight: { type: 'string', enum: ids(SUBLIGHT_DRIVES) },
      ftl: { type: 'string', enum: ids(FTL_CORES) },
      weapons: { type: 'string', enum: ids(WEAPONS) },
      sensors: { type: 'string', enum: ids(SENSORS) },
      fuel: { type: 'string', enum: ids(FUEL_SYSTEMS) },
      material: { type: 'string', enum: ids(MATERIALS) },
      accentColor: { type: 'string', description: 'Hex colour like #38BDF8.' },
      condition: { type: 'number', minimum: 0, maximum: 1 },
      summary: { type: 'string', description: 'One sentence on the overall design intent.' },
      rationale: {
        type: 'array',
        description: 'Why each major choice was made.',
        items: {
          type: 'object',
          properties: {
            category: { type: 'string' },
            choice: { type: 'string' },
            because: { type: 'string' },
          },
          required: ['category', 'choice', 'because'],
        },
      },
    },
    required: ['architecture', 'sublight', 'ftl', 'weapons', 'sensors', 'fuel', 'material', 'summary'],
  },
};

export interface ArchitectRequest {
  prompt: string;
  lockedTech?: string[];
}

export interface ArchitectHandlerResult {
  status: number;
  body: Record<string, unknown>;
}

export function isConfigured(): boolean {
  return Boolean(process.env.ANTHROPIC_API_KEY);
}

export async function handleArchitectRequest(
  request: ArchitectRequest,
): Promise<ArchitectHandlerResult> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    // 501 rather than 500: the client treats this as "fall back to the rule
    // engine", which is a normal state for a local checkout with no key.
    return { status: 501, body: { error: 'ANTHROPIC_API_KEY is not configured' } };
  }

  const prompt = String(request.prompt ?? '').slice(0, LIMITS.maxPromptChars).trim();
  if (!prompt) return { status: 400, body: { error: 'Prompt is empty' } };

  const locked = Array.isArray(request.lockedTech) ? request.lockedTech.slice(0, 32) : [];
  const userContent = locked.length
    ? `${prompt}\n\n[Locked technology you must not choose: ${locked.join(', ')}]`
    : prompt;

  let response: Response;
  try {
    response = await fetch(ANTHROPIC_URL, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': ANTHROPIC_VERSION,
      },
      body: JSON.stringify({
        model: process.env.ARCHITECT_MODEL || DEFAULT_MODEL,
        max_tokens: LIMITS.maxTokens,
        system: SYSTEM_PROMPT,
        tools: [PROPOSE_SHIP_TOOL],
        tool_choice: { type: 'tool', name: 'propose_ship' },
        messages: [{ role: 'user', content: userContent }],
      }),
    });
  } catch (error) {
    return {
      status: 502,
      body: { error: `Could not reach the model: ${(error as Error).message}` },
    };
  }

  if (!response.ok) {
    const detail = await response.text().catch(() => '');
    // Deliberately does not echo the upstream body wholesale — it can contain
    // request metadata we have no reason to hand to the browser.
    return {
      status: response.status === 429 ? 429 : 502,
      body: {
        error:
          response.status === 429
            ? 'Rate limited by the model provider. Try again shortly.'
            : `Model request failed (${response.status}).`,
        detail: detail.slice(0, 200),
      },
    };
  }

  const payload = (await response.json()) as {
    content?: { type: string; name?: string; input?: unknown }[];
  };
  const toolUse = payload.content?.find(
    (block) => block.type === 'tool_use' && block.name === 'propose_ship',
  );

  if (!toolUse?.input) {
    return { status: 502, body: { error: 'Model did not return a ship proposal' } };
  }

  return { status: 200, body: { proposal: toolUse.input } };
}
