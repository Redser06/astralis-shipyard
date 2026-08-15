import { defineConfig, devices } from '@playwright/test';

/**
 * Visual regression and behavioural checks.
 *
 * Determinism is enforced deliberately: a single worker, a fixed viewport, a
 * fixed device scale factor, and software rendering. A flaky visual suite gets
 * ignored within a week, which is worse than having none.
 */
export default defineConfig({
  testDir: './tests/visual',
  fullyParallel: false,
  workers: 1,
  forbidOnly: Boolean(process.env.CI),
  retries: 0,
  reporter: process.env.CI ? 'list' : [['list'], ['html', { open: 'never' }]],

  use: {
    baseURL: 'http://localhost:3000',
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
    command: 'npm run dev',
    url: 'http://localhost:3000',
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
  },
});
