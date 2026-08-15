import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()], // Tailwind runs via PostCSS — see postcss.config.mjs
  server: { port: 3000 },
  build: {
    // The prototype shipped one 712 kB chunk. The render stack is now split out
    // by lazy-importing src/render/Viewport from App.tsx, which keeps three,
    // R3F, drei and postprocessing out of the initial chunk *and* off the
    // critical path — better than chunk configuration alone, because the shell
    // becomes interactive without waiting for WebGL.
    chunkSizeWarningLimit: 1600,
  },
  test: {
    globals: true,
    environment: 'jsdom',
    setupFiles: ['./tests/setup.ts'],
    include: ['src/**/*.test.ts', 'src/**/*.test.tsx'],
  },
});
