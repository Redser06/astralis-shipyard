/**
 * Tailwind is wired through PostCSS rather than @tailwindcss/vite.
 *
 * As of tailwindcss 4.3.3 the Vite plugin emits its theme and layers but no
 * utilities at all under Vite 8 (verified: the standalone Tailwind CLI produces
 * `.flex`, the Vite plugin does not, with the same stylesheet and @source).
 * The PostCSS integration does not depend on Vite's module graph and works.
 */
export default {
  plugins: {
    '@tailwindcss/postcss': {},
  },
};
