import { defineConfig, devices } from '@playwright/test';

/**
 * Visual regression and behavioural checks.
 *
 * Determinism is enforced deliberately: a single worker, a fixed viewport, a
 * fixed device scale factor, and software rendering. A flaky visual suite gets
 * ignored within a week, which is worse than having none.
 */

/**
 * Which port the suite drives, overridable with `PW_PORT`.
 *
 * The default stays 3000, so CI and a bare `npm run test:visual` behave exactly
 * as before. The override exists because `vite.config.ts` pins `server.port` to
 * 3000 *without* `strictPort`: a dev server already holding 3000 does not make
 * Vite fail, it makes Vite quietly serve on 3001. Playwright would then find
 * something alive on 3000, honour `reuseExistingServer`, and run the entire
 * suite against somebody else's checkout. That failure presents as a pile of
 * render bugs, which is the most expensive possible way to be wrong.
 *
 * So the port is threaded through all three places that must agree: the
 * `baseURL` the specs navigate against, the `url` Playwright polls, and the dev
 * server's own flags. `--strictPort` goes with it so a busy port is a loud
 * failure rather than a silent reassignment.
 */
const PORT = Number(process.env.PW_PORT ?? 3000);
const ORIGIN = `http://localhost:${PORT}`;

export default defineConfig({
  testDir: './tests/visual',
  fullyParallel: false,
  workers: 1,
  forbidOnly: Boolean(process.env.CI),
  retries: 0,

  /**
   * Per-test budget, raised from Playwright's 30 s default.
   *
   * Not a workaround for a slow test — a correction to a budget that never
   * matched this suite. Every spec here drives a real WebGL2 scene through
   * SwiftShader, which renders ~200–390 draw calls at four to five frames a
   * second on a developer machine. Playwright's actionability checks wait for
   * an element's box to be stable across consecutive frames, so at 4 fps a
   * single click costs seconds before the assertion even runs.
   *
   * The margin was already thin — the slowest passing spec sat at 17 s of 30 —
   * and 'renders deterministically across reloads' does strictly more work than
   * any other: two full page reloads, each re-instantiating the render stack,
   * plus two panel interactions. It timed out at 30.5 s, and it does so at
   * commit 9fbb250 too, before any of the four subsystems landed, so this is
   * the budget being wrong rather than a regression in the scene.
   *
   * 90 s keeps every spec comfortable while still failing loudly on a genuine
   * hang. It is not a per-test override, because the next spec to grow a step
   * would hit exactly the same wall.
   */
  timeout: 90_000,
  reporter: process.env.CI ? 'list' : [['list'], ['html', { open: 'never' }]],

  use: {
    baseURL: ORIGIN,
    trace: 'retain-on-failure',
    launchOptions: {
      // Headless Chromium has no GPU; SwiftShader gives a deterministic
      // software WebGL2 implementation, which is what makes the screenshots
      // comparable from run to run and machine to machine.
      args: [
        '--use-gl=angle',
        '--use-angle=swiftshader',
        '--enable-unsafe-swiftshader',
        '--disable-lcd-text',
      ],
    },
  },

  expect: {
    toHaveScreenshot: {
      maxDiffPixelRatio: 0.02,
      animations: 'disabled',
    },
  },

  projects: [
    {
      name: 'chromium',
      use: {
        ...devices['Desktop Chrome'],
        viewport: { width: 1440, height: 900 },
        deviceScaleFactor: 1,
      },
    },
  ],

  webServer: {
    command: `npm run dev -- --port ${PORT} --strictPort`,
    url: ORIGIN,
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
  },
});
