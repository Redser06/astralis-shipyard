import { defineConfig } from 'vitest/config';
import { loadEnv, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';

/**
 * Serves POST /api/architect during `npm run dev`.
 *
 * The handler runs in the Vite dev server's Node context, so ANTHROPIC_API_KEY
 * stays on the server side. It is deliberately NOT passed through `define`,
 * which would inline it into the browser bundle.
 *
 * For production, wrap `server/architect.ts` in whatever function runtime you
 * deploy to — see README §7.
 */
function architectApi(): Plugin {
  // Crude in-process throttle so a stuck client cannot bill you in a loop.
  // Production needs a real, shared limiter.
  const recent: number[] = [];
  const WINDOW_MS = 60_000;
  const MAX_PER_WINDOW = 20;

  return {
    name: 'astralis-architect-api',
    configureServer(server) {
      server.middlewares.use('/api/architect', (req, res) => {
        void (async () => {
          if (req.method !== 'POST') {
            res.statusCode = 405;
            res.end(JSON.stringify({ error: 'Use POST' }));
            return;
          }

          const now = Date.now();
          while (recent.length && (recent[0] as number) < now - WINDOW_MS) recent.shift();
          if (recent.length >= MAX_PER_WINDOW) {
            res.statusCode = 429;
            res.setHeader('content-type', 'application/json');
            res.end(JSON.stringify({ error: 'Too many requests — slow down.' }));
            return;
          }
          recent.push(now);

          let raw = '';
          for await (const chunk of req) raw += chunk;

          try {
            const module = await server.ssrLoadModule('/server/architect.ts');
            const result = await module.handleArchitectRequest(JSON.parse(raw || '{}'));
            res.statusCode = result.status;
            res.setHeader('content-type', 'application/json');
            res.end(JSON.stringify(result.body));
          } catch (error) {
            res.statusCode = 500;
            res.setHeader('content-type', 'application/json');
            res.end(JSON.stringify({ error: (error as Error).message }));
          }
        })();
      });
    },
  };
}

export default defineConfig(({ mode }) => {
  // Reads .env / .env.local into the dev server's process only.
  const env = loadEnv(mode, process.cwd(), '');
  if (env.ANTHROPIC_API_KEY) process.env.ANTHROPIC_API_KEY = env.ANTHROPIC_API_KEY;
  if (env.ARCHITECT_MODEL) process.env.ARCHITECT_MODEL = env.ARCHITECT_MODEL;

  return {
    plugins: [react(), architectApi()], // Tailwind runs via PostCSS — see postcss.config.mjs
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
  };
});
