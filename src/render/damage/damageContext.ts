import { createContext, useContext } from 'react';
import type { WearChannels } from '../../domain/types';

/**
 * How far the wear channels reach into the scene graph.
 *
 * The alternative was threading `wear` and `seed` through every part component
 * and every hull solid as props. That is a lot of plumbing for two values that
 * change only when the blueprint does, and it would have meant editing the
 * signature of every component another implementer is also working in. A
 * context read is also naturally live: there is no closure to go stale,
 * because the value is memoised in `Ship` and read during render.
 *
 * Split out of `Damage.tsx` so that file exports components and nothing else,
 * which is what keeps fast refresh working.
 */
export interface DamageState {
  wear: WearChannels;
  seed: number;
}

export const DamageContext = createContext<DamageState | null>(null);

/** Null when damage is switched off — in the non-photoreal render modes. */
export const useDamageState = (): DamageState | null => useContext(DamageContext);
