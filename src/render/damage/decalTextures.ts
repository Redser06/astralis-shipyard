import { CanvasTexture, LinearFilter, SRGBColorSpace, type Texture } from 'three';
import { mulberry32 } from '../../domain/rng';
import type { DamageKind } from '../../domain/damage';

/**
 * The seven damage stamps, drawn procedurally.
 *
 * WHY CANVAS RATHER THAN IMAGE FILES. `index.html` loads no CDNs and the repo
 * ships no texture assets, so a PNG per mark would be a new class of thing to
 * fetch, cache, licence and keep in sync with the palette. A 128px canvas is a
 * few lines of arithmetic, is guaranteed to be there, and costs one upload.
 *
 * WHY MODULE-SCOPE SINGLETONS. This is the one place the codebase's "declare
 * GPU resources as JSX so the reconciler disposes them" rule does not apply,
 * so it is worth being precise about why. That rule exists because the
 * prototype allocated a *new* material on every render and leaked every one of
 * them. These are at most fourteen textures for the life of the page, created
 * on first use and shared by every decal on every ship; nothing here grows with
 * renders, re-renders or blueprint changes. Making them per-decal would be the
 * leak, not the fix.
 *
 * Drawing is seeded per kind, so a scorch mark looks the same on every run.
 */

const SIZE = 128;

const colourCache = new Map<DamageKind, Texture | null>();
const normalCache = new Map<DamageKind, Texture | null>();

type Ctx = CanvasRenderingContext2D;

function makeCanvas(): { canvas: HTMLCanvasElement; ctx: Ctx } | null {
  // Guard rather than assume: the render tree is lazy-loaded and only ever
  // mounts in a browser, but a null here degrades to "no decals" rather than
  // to a crash on some future server render.
  if (typeof document === 'undefined') return null;
  const canvas = document.createElement('canvas');
  canvas.width = SIZE;
  canvas.height = SIZE;
  const ctx = canvas.getContext('2d');
  return ctx ? { canvas, ctx } : null;
}

const toTexture = (canvas: HTMLCanvasElement, srgb: boolean): Texture => {
  const texture = new CanvasTexture(canvas);
  if (srgb) texture.colorSpace = SRGBColorSpace;
  texture.minFilter = LinearFilter;
  texture.magFilter = LinearFilter;
  texture.anisotropy = 4;
  return texture;
};

/* --------------------------- Drawing helpers --------------------------- */

/** Soft round blot, alpha falling to nothing at the rim. */
function blot(ctx: Ctx, x: number, y: number, r: number, rgb: string, alpha: number): void {
  const gradient = ctx.createRadialGradient(x, y, 0, x, y, r);
  gradient.addColorStop(0, `rgba(${rgb},${alpha})`);
  gradient.addColorStop(0.55, `rgba(${rgb},${alpha * 0.6})`);
  gradient.addColorStop(1, `rgba(${rgb},0)`);
  ctx.fillStyle = gradient;
  ctx.beginPath();
  ctx.arc(x, y, r, 0, Math.PI * 2);
  ctx.fill();
}

/** An irregular closed blob — nothing on a hit ship is a clean circle. */
function ragged(
  ctx: Ctx,
  x: number,
  y: number,
  r: number,
  jitter: number,
  rng: () => number,
  points = 11,
): void {
  ctx.beginPath();
  for (let i = 0; i <= points; i++) {
    const angle = (i / points) * Math.PI * 2;
    const radius = r * (1 - jitter / 2 + rng() * jitter);
    const px = x + Math.cos(angle) * radius;
    const py = y + Math.sin(angle) * radius;
    if (i === 0) ctx.moveTo(px, py);
    else ctx.lineTo(px, py);
  }
  ctx.closePath();
}

/* --------------------------- The seven stamps --------------------------- */

const DRAW: Record<DamageKind, (ctx: Ctx, rng: () => number) => void> = {
  // Soiling that settles and stays: soft, dark, no hard edge anywhere.
  grime: (ctx, rng) => {
    for (let i = 0; i < 9; i++) {
      blot(
        ctx,
        SIZE / 2 + (rng() - 0.5) * 46,
        SIZE / 2 + (rng() - 0.5) * 46,
        18 + rng() * 30,
        '12,14,19',
        0.16 + rng() * 0.16,
      );
    }
  },

  // Bare metal where something has rubbed: bright, directional streaks.
  scuff: (ctx, rng) => {
    const angle = rng() * Math.PI;
    ctx.lineCap = 'round';
    for (let i = 0; i < 14; i++) {
      const length = 22 + rng() * 46;
      const x = SIZE / 2 + (rng() - 0.5) * 54;
      const y = SIZE / 2 + (rng() - 0.5) * 54;
      const wobble = angle + (rng() - 0.5) * 0.25;
      ctx.strokeStyle = `rgba(226,232,240,${0.12 + rng() * 0.3})`;
      ctx.lineWidth = 0.8 + rng() * 2.4;
      ctx.beginPath();
      ctx.moveTo(x - Math.cos(wobble) * length * 0.5, y - Math.sin(wobble) * length * 0.5);
      ctx.lineTo(x + Math.cos(wobble) * length * 0.5, y + Math.sin(wobble) * length * 0.5);
      ctx.stroke();
    }
  },

  // Soot: a dark core, a scorched brown ring, and spatter beyond it.
  scorch: (ctx, rng) => {
    blot(ctx, SIZE / 2, SIZE / 2, 60, '8,7,6', 0.85);
    blot(ctx, SIZE / 2, SIZE / 2, 34, '0,0,0', 0.9);
    ctx.globalCompositeOperation = 'source-over';
    for (let i = 0; i < 22; i++) {
      const angle = rng() * Math.PI * 2;
      const radius = 26 + rng() * 34;
      blot(
        ctx,
        SIZE / 2 + Math.cos(angle) * radius,
        SIZE / 2 + Math.sin(angle) * radius,
        3 + rng() * 9,
        '46,26,12',
        0.2 + rng() * 0.35,
      );
    }
  },

  // Rust bleeding downhill from a seam. Asymmetric on purpose: oxidation runs.
  stain: (ctx, rng) => {
    const gradient = ctx.createLinearGradient(0, 26, 0, SIZE);
    gradient.addColorStop(0, 'rgba(124,58,20,0.72)');
    gradient.addColorStop(0.45, 'rgba(146,72,26,0.42)');
    gradient.addColorStop(1, 'rgba(120,60,24,0)');
    ctx.fillStyle = gradient;
    ragged(ctx, SIZE / 2, SIZE / 2 + 6, 52, 0.5, rng, 13);
    ctx.fill();
    for (let i = 0; i < 7; i++) {
      const x = 26 + rng() * 76;
      ctx.strokeStyle = `rgba(107,49,17,${0.25 + rng() * 0.35})`;
      ctx.lineWidth = 1.5 + rng() * 4;
      ctx.beginPath();
      ctx.moveTo(x, 34 + rng() * 20);
      ctx.lineTo(x + (rng() - 0.5) * 8, 74 + rng() * 44);
      ctx.stroke();
    }
  },

  // A replacement plate nobody repainted: flat, riveted, the wrong grey.
  patch: (ctx, rng) => {
    const inset = 12;
    ctx.fillStyle = 'rgba(122,134,150,0.94)';
    ctx.fillRect(inset, inset + 6, SIZE - inset * 2, SIZE - inset * 2 - 12);
    ctx.strokeStyle = 'rgba(30,41,59,0.9)';
    ctx.lineWidth = 3;
    ctx.strokeRect(inset, inset + 6, SIZE - inset * 2, SIZE - inset * 2 - 12);
    // Weld bead down one edge.
    ctx.strokeStyle = 'rgba(148,163,184,0.55)';
    ctx.lineWidth = 2;
    ctx.beginPath();
    for (let y = inset + 8; y < SIZE - inset - 6; y += 7) {
      ctx.moveTo(inset + 3, y);
      ctx.lineTo(inset + 7, y + 4);
    }
    ctx.stroke();
    // Rivets.
    for (let i = 0; i < 14; i++) {
      const along = (i / 13) * (SIZE - inset * 2 - 16) + inset + 8;
      for (const y of [inset + 14, SIZE - inset - 8]) {
        ctx.fillStyle = `rgba(51,65,85,${0.75 + rng() * 0.2})`;
        ctx.beginPath();
        ctx.arc(along, y, 2.2, 0, Math.PI * 2);
        ctx.fill();
      }
    }
  },

  // Micrometeorite craters: small, punched, with a bright lip.
  pit: (ctx, rng) => {
    for (let i = 0; i < 5; i++) {
      const x = SIZE / 2 + (rng() - 0.5) * 58;
      const y = SIZE / 2 + (rng() - 0.5) * 58;
      const r = 6 + rng() * 13;
      ctx.fillStyle = 'rgba(203,213,225,0.5)';
      ragged(ctx, x, y, r * 1.35, 0.4, rng, 9);
      ctx.fill();
      ctx.fillStyle = 'rgba(5,7,11,0.94)';
      ragged(ctx, x, y, r, 0.35, rng, 9);
      ctx.fill();
    }
  },

  // A hole with the plating torn back around it.
  breach: (ctx, rng) => {
    blot(ctx, SIZE / 2, SIZE / 2, 62, '9,9,11', 0.6);
    // Torn petals of plate, bent outward around the rim.
    for (let i = 0; i < 9; i++) {
      const angle = (i / 9) * Math.PI * 2 + rng() * 0.3;
      const inner = 26 + rng() * 6;
      const outer = 40 + rng() * 20;
      ctx.fillStyle = `rgba(148,163,184,${0.45 + rng() * 0.35})`;
      ctx.beginPath();
      ctx.moveTo(SIZE / 2 + Math.cos(angle - 0.22) * inner, SIZE / 2 + Math.sin(angle - 0.22) * inner);
      ctx.lineTo(SIZE / 2 + Math.cos(angle) * outer, SIZE / 2 + Math.sin(angle) * outer);
      ctx.lineTo(SIZE / 2 + Math.cos(angle + 0.22) * inner, SIZE / 2 + Math.sin(angle + 0.22) * inner);
      ctx.closePath();
      ctx.fill();
    }
    // The hole itself. Nothing behind it but the inside of the ship.
    ctx.fillStyle = 'rgba(2,3,5,1)';
    ragged(ctx, SIZE / 2, SIZE / 2, 30, 0.45, rng, 13);
    ctx.fill();
  },
};

/* --------------------------- Height → normal --------------------------- */

/**
 * Marks that are physically *deep* get a normal map as well as colour, so a
 * crater catches the light from its own rim instead of reading as a sticker.
 * Only the three that dent the plate: everything else is a surface stain.
 */
const HEIGHT: Partial<Record<DamageKind, (ctx: Ctx, rng: () => number) => void>> = {
  pit: (ctx, rng) => {
    ctx.fillStyle = '#808080';
    ctx.fillRect(0, 0, SIZE, SIZE);
    for (let i = 0; i < 5; i++) {
      const x = SIZE / 2 + (rng() - 0.5) * 58;
      const y = SIZE / 2 + (rng() - 0.5) * 58;
      const r = 6 + rng() * 13;
      const gradient = ctx.createRadialGradient(x, y, 0, x, y, r * 1.4);
      gradient.addColorStop(0, '#101010');
      gradient.addColorStop(0.72, '#606060');
      gradient.addColorStop(0.85, '#c8c8c8');
      gradient.addColorStop(1, '#808080');
      ctx.fillStyle = gradient;
      ctx.beginPath();
      ctx.arc(x, y, r * 1.4, 0, Math.PI * 2);
      ctx.fill();
    }
  },
  breach: (ctx) => {
    ctx.fillStyle = '#808080';
    ctx.fillRect(0, 0, SIZE, SIZE);
    const gradient = ctx.createRadialGradient(SIZE / 2, SIZE / 2, 10, SIZE / 2, SIZE / 2, 56);
    gradient.addColorStop(0, '#000000');
    gradient.addColorStop(0.6, '#505050');
    gradient.addColorStop(0.82, '#d0d0d0');
    gradient.addColorStop(1, '#808080');
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, SIZE, SIZE);
  },
  patch: (ctx) => {
    // A plate laid over the skin stands slightly proud, so it catches an edge.
    ctx.fillStyle = '#808080';
    ctx.fillRect(0, 0, SIZE, SIZE);
    ctx.fillStyle = '#a8a8a8';
    ctx.fillRect(12, 18, SIZE - 24, SIZE - 36);
    ctx.strokeStyle = '#d8d8d8';
    ctx.lineWidth = 4;
    ctx.strokeRect(12, 18, SIZE - 24, SIZE - 36);
  },
};

/** Sobel over a greyscale height field. */
function heightToNormal(ctx: Ctx): void {
  const source = ctx.getImageData(0, 0, SIZE, SIZE);
  const out = ctx.createImageData(SIZE, SIZE);
  const at = (x: number, y: number): number => {
    const cx = Math.max(0, Math.min(SIZE - 1, x));
    const cy = Math.max(0, Math.min(SIZE - 1, y));
    return (source.data[(cy * SIZE + cx) * 4] as number) / 255;
  };
  const strength = 2.4;
  for (let y = 0; y < SIZE; y++) {
    for (let x = 0; x < SIZE; x++) {
      const dx = (at(x + 1, y) - at(x - 1, y)) * strength;
      const dy = (at(x, y + 1) - at(x, y - 1)) * strength;
      const length = Math.hypot(dx, dy, 1);
      const index = (y * SIZE + x) * 4;
      out.data[index] = Math.round(((-dx / length) * 0.5 + 0.5) * 255);
      out.data[index + 1] = Math.round(((-dy / length) * 0.5 + 0.5) * 255);
      out.data[index + 2] = Math.round((1 / length) * 0.5 * 255 + 127);
      out.data[index + 3] = 255;
    }
  }
  ctx.putImageData(out, 0, 0);
}

/* --------------------------- Public API --------------------------- */

/** The colour-and-alpha stamp for a mark. Null where no canvas is available. */
export function damageTexture(kind: DamageKind): Texture | null {
  const cached = colourCache.get(kind);
  if (cached !== undefined) return cached;

  const surface = makeCanvas();
  if (!surface) {
    colourCache.set(kind, null);
    return null;
  }
  DRAW[kind](surface.ctx, mulberry32(0xd4 + kind.length * 977));
  const texture = toTexture(surface.canvas, true);
  colourCache.set(kind, texture);
  return texture;
}

/** The matching normal map, for the three kinds that actually deform plate. */
export function damageNormal(kind: DamageKind): Texture | null {
  const cached = normalCache.get(kind);
  if (cached !== undefined) return cached;

  const draw = HEIGHT[kind];
  const surface = draw ? makeCanvas() : null;
  if (!surface || !draw) {
    normalCache.set(kind, null);
    return null;
  }
  draw(surface.ctx, mulberry32(0x9e + kind.length * 131));
  heightToNormal(surface.ctx);
  const texture = toTexture(surface.canvas, false);
  normalCache.set(kind, texture);
  return texture;
}
