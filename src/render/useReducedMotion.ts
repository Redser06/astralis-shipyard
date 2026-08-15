import { useEffect, useState } from 'react';

/**
 * Tracks `prefers-reduced-motion`.
 *
 * Used to suppress *decorative* motion only — the idle hover bob and the
 * derelict tumble. Functional motion the user explicitly asked for (auto-rotate,
 * the exhaust plume during a test burn) keeps running, because switching those
 * off would hide the very thing the control exists to show.
 *
 * It also makes the viewport reproducible frame-to-frame, which is what lets the
 * seed-determinism test compare two sessions honestly.
 */
export function useReducedMotion(): boolean {
  const [reduced, setReduced] = useState(false);

  useEffect(() => {
    if (typeof window === 'undefined' || !window.matchMedia) return;
    const query = window.matchMedia('(prefers-reduced-motion: reduce)');
    setReduced(query.matches);

    const onChange = (event: MediaQueryListEvent): void => setReduced(event.matches);
    query.addEventListener('change', onChange);
    return () => query.removeEventListener('change', onChange);
  }, []);

  return reduced;
}
