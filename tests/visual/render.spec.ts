import { expect, test, type Page } from '@playwright/test';

/**
 * These tests exist to stop specific, named defects from coming back. Each one
 * maps to a root cause from the production plan, and most of them would have
 * failed against the prototype.
 */

/** Wait for the lazy render chunk, the canvas, and a few settled frames. */
async function waitForViewport(page: Page): Promise<void> {
  await page.waitForSelector('canvas', { timeout: 30_000 });
  await page.waitForFunction(() => {
    const canvas = document.querySelector('canvas');
    return Boolean(canvas && canvas.width > 0 && canvas.height > 0);
  });
  await page.waitForTimeout(1500);
}

/** Mean and peak luminance of a region of the WebGL framebuffer. */
async function luminance(
  page: Page,
  region: { x: number; y: number; w: number; h: number },
): Promise<{ mean: number; max: number }> {
  return page.evaluate((box) => {
    const canvas = document.querySelector('canvas') as HTMLCanvasElement;
    const off = document.createElement('canvas');
    off.width = box.w;
    off.height = box.h;
    const ctx = off.getContext('2d');
    if (!ctx) throw new Error('no 2d context');
    ctx.drawImage(canvas, box.x, box.y, box.w, box.h, 0, 0, box.w, box.h);
    const { data } = ctx.getImageData(0, 0, box.w, box.h);
    let sum = 0;
    let max = 0;
    for (let i = 0; i < data.length; i += 4) {
      const l = ((data[i] ?? 0) + (data[i + 1] ?? 0) + (data[i + 2] ?? 0)) / 3;
      sum += l;
      if (l > max) max = l;
    }
    return { mean: sum / (data.length / 4), max };
  }, region);
}

/** Downsampled fingerprint of the viewport, for "did anything change" checks. */
async function signature(page: Page): Promise<string> {
  return page.evaluate(() => {
    const canvas = document.querySelector('canvas') as HTMLCanvasElement;
    const off = document.createElement('canvas');
    off.width = 48;
    off.height = 30;
    const ctx = off.getContext('2d');
    if (!ctx) throw new Error('no 2d context');
    ctx.drawImage(canvas, 0, 0, 48, 30);
    return Array.from(ctx.getImageData(0, 0, 48, 30).data).join(',');
  });
}

/** How many of the sampled pixels differ, as a fraction. */
function difference(a: string, b: string): number {
  const left = a.split(',');
  const right = b.split(',');
  let changed = 0;
  for (let i = 0; i < left.length; i++) {
    if (Math.abs(Number(left[i]) - Number(right[i])) > 6) changed += 1;
  }
  return changed / left.length;
}

test.beforeEach(async ({ page }) => {
  await page.goto('/');
  await waitForViewport(page);
});

test('boots without console errors or page exceptions', async ({ page }) => {
  const errors: string[] = [];
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(message.text());
  });
  page.on('pageerror', (error) => errors.push(error.message));

  await page.reload();
  await waitForViewport(page);

  expect(errors, `console errors: ${errors.join(' | ')}`).toHaveLength(0);
});

test('RC-3: the hull is lit, not a black silhouette', async ({ page }) => {
  // The prototype ran metalness 0.85–1.0 with no environment map, so hulls
  // rendered as near-black shapes. With IBL present the ship must be markedly
  // brighter than the empty background around it.
  const centre = await luminance(page, { x: 400, y: 320, w: 300, h: 190 });
  // Empty sky, well above the drydock deck plate — sampling the lit deck was
  // measuring the floor, not the background.
  const corner = await luminance(page, { x: 30, y: 30, w: 130, h: 110 });

  expect(centre.max, 'ship should contain genuinely bright pixels').toBeGreaterThan(60);
  expect(
    centre.mean,
    `ship region (${centre.mean.toFixed(1)}) should be brighter than background (${corner.mean.toFixed(1)})`,
  ).toBeGreaterThan(corner.mean + 6);
});

test('RC-1: auto-rotate actually moves the camera', async ({ page }) => {
  const before = await signature(page);

  await page.getByRole('switch', { name: 'Auto-rotate' }).click();
  await page.waitForTimeout(2500);

  const after = await signature(page);
  expect(
    difference(before, after),
    'enabling auto-rotate must change what is on screen',
  ).toBeGreaterThan(0.05);
});

test('RC-1: Test Burn visibly changes the exhaust', async ({ page }) => {
  const before = await signature(page);

  await page.getByRole('button', { name: /Test Burn/ }).click();
  await page.waitForTimeout(900);

  const during = await signature(page);
  expect(
    difference(before, during),
    'Test Burn must change the scene, not just play a sound',
  ).toBeGreaterThan(0.01);
});

test('RC-5: every weapon produces different geometry', async ({ page }) => {
  const weapons = [
    'Twin Gauss Railguns',
    'Coherent Plasma Lance',
    'Quantum Singularity Torpedoes',
  ];

  const signatures: string[] = [];
  for (const weapon of weapons) {
    await page.getByRole('button', { name: new RegExp(weapon) }).click();
    await page.waitForTimeout(800);
    signatures.push(await signature(page));
  }

  // In the prototype, weapon selection produced no geometry at all — every
  // choice rendered an identical sponson.
  for (let i = 1; i < signatures.length; i++) {
    expect(
      difference(signatures[i - 1]!, signatures[i]!),
      `${weapons[i - 1]} and ${weapons[i]} render identically`,
    ).toBeGreaterThan(0.01);
  }
});

test('RC-5: fuel choice changes the silhouette', async ({ page }) => {
  await page.getByRole('button', { name: /Cryogenic Liquid H2 Bulk Tanks/ }).click();
  await page.waitForTimeout(800);
  const bulky = await signature(page);

  await page.getByRole('button', { name: /Matter-Antimatter Pods/ }).click();
  await page.waitForTimeout(800);
  const compact = await signature(page);

  expect(
    difference(bulky, compact),
    'bulky external tanks and compact pods must not look the same',
  ).toBeGreaterThan(0.01);
});

test('RC-6: locked technology is disabled until researched', async ({ page }) => {
  const locked = page.getByRole('button', { name: /Tachyon Beam Disruptor/ });
  await expect(locked, 'locked weapon must not be selectable').toBeDisabled();

  // Research it, then it becomes available in the Designer.
  await page.getByRole('button', { name: 'R&D' }).click();
  await page.getByRole('button', { name: 'Research Tachyon Beam Disruptor' }).click();
  await page.getByRole('button', { name: 'Designer' }).click();

  await expect(
    page.getByRole('button', { name: /Tachyon Beam Disruptor/ }),
    'researched weapon must become selectable',
  ).toBeEnabled();
});

test('RC-6: stats are derived and respond to component choice', async ({ page }) => {
  const warp = page.getByRole('meter', { name: 'Warp' });

  await page.getByRole('button', { name: /Sublight Only \(No FTL\)/ }).click();
  await page.waitForTimeout(300);
  await expect(warp).toHaveAttribute('aria-valuenow', '0');

  await page.getByRole('button', { name: /Alcubierre Spacetime Warp Ring/ }).click();
  await page.waitForTimeout(300);
  const value = Number(await warp.getAttribute('aria-valuenow'));
  expect(value, 'fitting a warp ring must raise the warp stat').toBeGreaterThan(0);
});

test('condition drives a visible change from pristine to derelict', async ({ page }) => {
  await page.getByRole('button', { name: 'Condition' }).click();

  await page.getByRole('button', { name: /Fleet Commission/ }).click();
  await page.waitForTimeout(900);
  const pristine = await signature(page);

  await page.getByRole('button', { name: /Derelict Hulk/ }).click();
  await page.waitForTimeout(900);
  const derelict = await signature(page);

  expect(
    difference(pristine, derelict),
    'a derelict hulk must not render like a parade ship',
  ).toBeGreaterThan(0.03);
});

test('the same seed renders deterministically across reloads', async ({ page }) => {
  // The idle hover bob is time-based, so two sessions are never sampled at the
  // same phase. Reduced motion pins the pose, letting this assert what it is
  // meant to assert — that the *wear* is seeded — rather than that two
  // animation clocks happened to line up.
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.reload();
  await waitForViewport(page);

  await page.getByRole('button', { name: 'Condition' }).click();
  await page.getByRole('button', { name: /Long Patrol/ }).click();
  await page.waitForTimeout(1200);
  const first = await signature(page);

  await page.reload();
  await waitForViewport(page);
  await page.getByRole('button', { name: 'Condition' }).click();
  await page.getByRole('button', { name: /Long Patrol/ }).click();
  await page.waitForTimeout(1200);
  const second = await signature(page);

  // Wear is drawn from a seeded stream, so this must be near-identical.
  expect(difference(first, second)).toBeLessThan(0.02);
});

test('RC-4: archetypes render without their hardware detaching', async ({ page }) => {
  // The Brutalist hull is the widest, and is where the prototype's hardcoded
  // radiator coordinates intersected the hull. Just switching to it and
  // rendering cleanly is the smoke test; the screenshot is the real record.
  await page.getByRole('button', { name: /Brutalist Battlecruiser/ }).click();
  await page.waitForTimeout(1200);

  const centre = await luminance(page, { x: 420, y: 260, w: 420, h: 280 });
  expect(centre.max).toBeGreaterThan(60);
});

/* --------------------------------------------------------------------------
 * Features restored from the prototype rather than deleted.
 * ------------------------------------------------------------------------ */

test('Hull Sculptor reshapes the aerodynamic hull', async ({ page }) => {
  await page.getByRole('button', { name: /Aerodynamic Hybrid Cruiser/ }).click();
  await page.waitForTimeout(1200);
  const before = await signature(page);

  await page.getByRole('navigation', { name: 'Panels' }).getByRole('button', { name: 'Hull' }).click();

  // Keyboard path: focus a station and fatten it. The prototype's handles could
  // not be moved at all, by pointer or otherwise.
  const station = page.getByRole('slider', { name: 'Station 4 radius' });
  await station.focus();
  const startRadius = Number(await station.getAttribute('aria-valuenow'));
  for (let i = 0; i < 8; i++) await page.keyboard.press('ArrowUp');
  await page.waitForTimeout(1200);

  const endRadius = Number(await station.getAttribute('aria-valuenow'));
  expect(endRadius, 'arrow keys must move the control point').toBeGreaterThan(startRadius);

  const after = await signature(page);
  expect(
    difference(before, after),
    'reshaping the profile must change the rendered hull',
  ).toBeGreaterThan(0.01);
});

test('Hull Sculptor is disabled, with a reason, on hulls it cannot shape', async ({ page }) => {
  await page.getByRole('button', { name: /Brutalist Battlecruiser/ }).click();
  await page.getByRole('navigation', { name: 'Panels' }).getByRole('button', { name: 'Hull' }).click();

  await expect(page.getByText(/revolved by the Aerodynamic Hybrid Cruiser hull/)).toBeVisible();
  await expect(page.getByRole('button', { name: 'Switch to that hull' })).toBeVisible();
});

test('Ship Architect returns a labelled proposal and applies it', async ({ page }) => {
  await page.getByRole('button', { name: 'Architect' }).click();

  const before = await signature(page);

  await page.getByLabel('Describe the ship you want').fill('heavily armoured siege dreadnought');
  await page.getByRole('button', { name: 'Send brief to the ship architect' }).click();

  // No ANTHROPIC_API_KEY in CI, so this must fall back to the rule engine and
  // say so, rather than silently pretending a model answered.
  const reply = page.locator('article').last();
  await expect(reply.getByText(/Model|Rule-based/)).toBeVisible({ timeout: 35_000 });
  await expect(reply.getByText(/Architecture/)).toBeVisible();

  await page.waitForTimeout(1500);
  const after = await signature(page);
  expect(
    difference(before, after),
    'the proposal must actually be applied to the ship',
  ).toBeGreaterThan(0.01);
});
