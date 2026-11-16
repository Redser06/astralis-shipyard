import {
  CanvasTexture,
  NoColorSpace,
  RepeatWrapping,
  SRGBColorSpace,
  Vector2,
} from 'three';
import type { MaterialId } from '../../domain/types';

export interface HullTextureSet {
  map: CanvasTexture;
  normalMap: CanvasTexture;
  roughnessMap: CanvasTexture;
  normalScale: Vector2;
}

const TEX_SIZE = 512;

function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function wrapCoord(v: number): number {
  const m = v % TEX_SIZE;
  return m < 0 ? m + TEX_SIZE : m;
}

function idx(x: number, y: number): number {
  return wrapCoord(y) * TEX_SIZE + wrapCoord(x);
}

function clampByte(n: number): number {
  return Math.max(0, Math.min(255, Math.round(n)));
}

function hash2D(ix: number, iy: number, seed: number): number {
  let h = (ix * 374761393 + iy * 668265263 + seed * 1442695041) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

interface PlateRect {
  x0: number;
  y0: number;
  w: number;
  h: number;
  shade: number;
  roughOffset: number;
  heightOffset: number;
  hasHatch: boolean;
  rivets: boolean;
}

function buildPlates(materialId: MaterialId): PlateRect[] {
  const seedMap: Record<MaterialId, number> = {
    duranium: 1013,
    carbon_nanotube: 2089,
    titanium_aerogel: 3061,
    chronium_cloak: 4099,
  };
  const rand = mulberry32(seedMap[materialId]);

  const rows =
    materialId === 'titanium_aerogel'
      ? 8
      : materialId === 'chronium_cloak'
        ? 4
        : 6;
  const rowH = Math.floor(TEX_SIZE / rows);
  const plates: PlateRect[] = [];

  for (let r = 0; r < rows; r++) {
    const y0 = r * rowH;
    const h = r === rows - 1 ? TEX_SIZE - y0 : rowH;
    const baseCols =
      materialId === 'titanium_aerogel'
        ? 6
        : materialId === 'chronium_cloak'
          ? 3
          : 4 + (r % 2);
    const stagger = Math.floor(((r % 2) * 0.5 + rand() * 0.18) * (TEX_SIZE / baseCols));
    let cursor = 0;

    for (let c = 0; c < baseCols; c++) {
      const remaining = TEX_SIZE - cursor;
      const avgW = Math.floor(TEX_SIZE / baseCols);
      const w =
        c === baseCols - 1
          ? remaining
          : Math.max(48, Math.min(remaining - 48, Math.floor(avgW * (0.78 + rand() * 0.44))));
      // High-key neutral albedo offsets (kept close to 1.0 so dark paints never blacken)
      const shade =
        materialId === 'chronium_cloak'
          ? 0.965 + rand() * 0.035
          : materialId === 'carbon_nanotube'
            ? 0.945 + rand() * 0.055
            : 0.935 + rand() * 0.065;
      const roughOffset = (rand() - 0.5) * (materialId === 'chronium_cloak' ? 0.08 : 0.14);
      const heightOffset = (rand() - 0.5) * 0.09;
      const hasHatch =
        materialId !== 'chronium_cloak' && rand() > 0.74 && w >= 72 && h >= 64;
      const rivets = materialId === 'duranium' || (materialId === 'titanium_aerogel' && rand() > 0.4);

      plates.push({
        x0: wrapCoord(cursor + stagger),
        y0,
        w,
        h,
        shade,
        roughOffset,
        heightOffset,
        hasHatch,
        rivets,
      });
      cursor += w;
    }
  }

  return plates;
}

function stampRivet(
  height: Float32Array,
  albedo: Float32Array,
  rough: Float32Array,
  cx: number,
  cy: number,
  radius: number,
): void {
  const rCeil = Math.ceil(radius) + 1;
  for (let dy = -rCeil; dy <= rCeil; dy++) {
    for (let dx = -rCeil; dx <= rCeil; dx++) {
      const dist = Math.hypot(dx, dy);
      if (dist > radius + 0.6) continue;
      const i = idx(cx + dx, cy + dy);
      if (dist <= radius * 0.65) {
        height[i] += 0.22 * (1 - dist / (radius + 0.01));
        albedo[i] = Math.min(1, albedo[i] + 0.02);
        rough[i] = Math.max(0.72, rough[i] - 0.06);
      } else {
        height[i] -= 0.1;
        albedo[i] = Math.max(0.84, albedo[i] - 0.04);
      }
    }
  }
}

function generateTextureData(materialId: MaterialId): {
  albedoCanvas: HTMLCanvasElement;
  normalCanvas: HTMLCanvasElement;
  roughCanvas: HTMLCanvasElement;
} {
  const len = TEX_SIZE * TEX_SIZE;
  const height = new Float32Array(len);
  const albedo = new Float32Array(len).fill(0.975);
  const rough = new Float32Array(len).fill(0.9);

  const plates = buildPlates(materialId);
  const seamWidth = materialId === 'chronium_cloak' ? 1 : 2;
  const seed = materialId.length * 97 + materialId.charCodeAt(0);

  // Fill plate interiors, seam grooves, and micro-bevel highlights
  for (const p of plates) {
    for (let dy = 0; dy < p.h; dy++) {
      const y = wrapCoord(p.y0 + dy);
      const distY = Math.min(dy, p.h - 1 - dy);
      for (let dx = 0; dx < p.w; dx++) {
        const x = wrapCoord(p.x0 + dx);
        const distX = Math.min(dx, p.w - 1 - dx);
        const edgeDist = Math.min(distX, distY);
        const i = y * TEX_SIZE + x;

        if (edgeDist < seamWidth) {
          // Crisp recessed panel seam groove
          height[i] = -0.58;
          albedo[i] = materialId === 'chronium_cloak' ? 0.87 : 0.82;
          rough[i] = 0.99;
        } else if (edgeDist < seamWidth + 2) {
          // Micro-chamfer highlight lip catching specular highlights along panel borders
          height[i] = 0.26 + p.heightOffset;
          albedo[i] = Math.min(1, p.shade + 0.025);
          rough[i] = Math.max(0.74, 0.82 + p.roughOffset * 0.5);
        } else {
          height[i] = 0.14 + p.heightOffset;
          albedo[i] = p.shade;
          rough[i] = Math.max(0.76, Math.min(0.99, 0.9 + p.roughOffset));
        }
      }
    }

    // Internal maintenance hatch / access panel on select plates
    if (p.hasHatch) {
      const hx0 = Math.floor(p.w * 0.24);
      const hy0 = Math.floor(p.h * 0.26);
      const hw = Math.floor(p.w * 0.52);
      const hh = Math.floor(p.h * 0.48);
      for (let dy = 0; dy < hh; dy++) {
        for (let dx = 0; dx < hw; dx++) {
          const edge = Math.min(dx, hw - 1 - dx, dy, hh - 1 - dy);
          if (edge <= 1) {
            const i = idx(p.x0 + hx0 + dx, p.y0 + hy0 + dy);
            height[i] = edge === 0 ? -0.34 : 0.28;
            albedo[i] = edge === 0 ? 0.85 : Math.min(1, p.shade + 0.02);
            rough[i] = edge === 0 ? 0.98 : 0.84;
          }
        }
      }
    }

    // Corner/perimeter micro-rivets on structural armor plates
    if (p.rivets && p.w >= 48 && p.h >= 40) {
      const inset = 7;
      const corners: ReadonlyArray<readonly [number, number]> = [
        [p.x0 + inset, p.y0 + inset],
        [p.x0 + p.w - 1 - inset, p.y0 + inset],
        [p.x0 + inset, p.y0 + p.h - 1 - inset],
        [p.x0 + p.w - 1 - inset, p.y0 + p.h - 1 - inset],
      ];
      for (const [rx, ry] of corners) {
        stampRivet(height, albedo, rough, rx, ry, 1.8);
      }
      if (p.w >= 110) {
        stampRivet(height, albedo, rough, p.x0 + Math.floor(p.w * 0.5), p.y0 + inset, 1.6);
        stampRivet(
          height,
          albedo,
          rough,
          p.x0 + Math.floor(p.w * 0.5),
          p.y0 + p.h - 1 - inset,
          1.6,
        );
      }
    }
  }

  // Material-specific surface micro-finish (brushed titanium streaks, carbon weave, stealth facet micro-grain)
  for (let y = 0; y < TEX_SIZE; y++) {
    const streak = (hash2D(0, y, seed + 17) - 0.5) * 0.032;
    for (let x = 0; x < TEX_SIZE; x++) {
      const i = y * TEX_SIZE + x;
      const micro = (hash2D(x >> 1, y >> 1, seed + 53) - 0.5) * 0.022;

      if (materialId === 'carbon_nanotube') {
        // Subtle diagonal composite weave micro-relief
        const diag = Math.sin((x + y) * 0.78) * Math.cos((x - y) * 0.78);
        height[i] += diag * 0.045 + micro * 0.5;
        rough[i] = Math.max(0.75, Math.min(0.99, rough[i] + diag * 0.025));
      } else if (materialId === 'chronium_cloak') {
        // Fine laminar directional lines
        const band = Math.sin((y * 2 * Math.PI) / 16) * 0.018;
        height[i] += band + micro * 0.25;
        albedo[i] = Math.max(0.86, Math.min(1, albedo[i] + band * 0.2));
      } else {
        // Brushed aerospace alloy grain
        height[i] += streak * 0.7 + micro;
        albedo[i] = Math.max(0.84, Math.min(1, albedo[i] + streak * 0.35 + micro * 0.25));
        rough[i] = Math.max(0.75, Math.min(0.99, rough[i] + micro * 0.6));
      }
    }
  }

  const albedoCanvas = document.createElement('canvas');
  albedoCanvas.width = TEX_SIZE;
  albedoCanvas.height = TEX_SIZE;
  const albedoCtx = albedoCanvas.getContext('2d')!;
  const albedoImg = albedoCtx.createImageData(TEX_SIZE, TEX_SIZE);

  const normalCanvas = document.createElement('canvas');
  normalCanvas.width = TEX_SIZE;
  normalCanvas.height = TEX_SIZE;
  const normalCtx = normalCanvas.getContext('2d')!;
  const normalImg = normalCtx.createImageData(TEX_SIZE, TEX_SIZE);

  const roughCanvas = document.createElement('canvas');
  roughCanvas.width = TEX_SIZE;
  roughCanvas.height = TEX_SIZE;
  const roughCtx = roughCanvas.getContext('2d')!;
  const roughImg = roughCtx.createImageData(TEX_SIZE, TEX_SIZE);

  const strength =
    materialId === 'duranium'
      ? 2.8
      : materialId === 'carbon_nanotube'
        ? 2.2
        : materialId === 'titanium_aerogel'
          ? 2.5
          : 1.7;

  for (let y = 0; y < TEX_SIZE; y++) {
    for (let x = 0; x < TEX_SIZE; x++) {
      const i = y * TEX_SIZE + x;
      const p4 = i * 4;

      // High-key slightly cool aerospace tint (#F5F8FC..#FFFFFF scaled)
      const lum = albedo[i];
      const rVal = clampByte(lum * 251);
      const gVal = clampByte(lum * 253);
      const bVal = clampByte(lum * 255);
      albedoImg.data[p4] = rVal;
      albedoImg.data[p4 + 1] = gVal;
      albedoImg.data[p4 + 2] = bVal;
      albedoImg.data[p4 + 3] = 255;

      // Seamless Sobel normal calculation across wrapped coordinates
      const tl = height[idx(x - 1, y - 1)];
      const t = height[idx(x, y - 1)];
      const tr = height[idx(x + 1, y - 1)];
      const l = height[idx(x - 1, y)];
      const r = height[idx(x + 1, y)];
      const bl = height[idx(x - 1, y + 1)];
      const b = height[idx(x, y + 1)];
      const br = height[idx(x + 1, y + 1)];

      const dX = tr + 2 * r + br - (tl + 2 * l + bl);
      const dY = bl + 2 * b + br - (tl + 2 * t + tr);
      const nx = -dX * strength;
      const ny = -dY * strength;
      const nz = 1.0;
      const invLen = 1 / Math.hypot(nx, ny, nz);

      normalImg.data[p4] = clampByte((nx * invLen * 0.5 + 0.5) * 255);
      normalImg.data[p4 + 1] = clampByte((ny * invLen * 0.5 + 0.5) * 255);
      normalImg.data[p4 + 2] = clampByte((nz * invLen * 0.5 + 0.5) * 255);
      normalImg.data[p4 + 3] = 255;

      const rg = clampByte(rough[i] * 255);
      roughImg.data[p4] = rg;
      roughImg.data[p4 + 1] = rg;
      roughImg.data[p4 + 2] = rg;
      roughImg.data[p4 + 3] = 255;
    }
  }

  albedoCtx.putImageData(albedoImg, 0, 0);
  normalCtx.putImageData(normalImg, 0, 0);
  roughCtx.putImageData(roughImg, 0, 0);

  return { albedoCanvas, normalCanvas, roughCanvas };
}

const cache = new Map<string, HullTextureSet>();

function configureTexture(
  canvas: HTMLCanvasElement,
  repeat: number,
  isColorMap: boolean,
): CanvasTexture {
  const tex = new CanvasTexture(canvas);
  tex.wrapS = RepeatWrapping;
  tex.wrapT = RepeatWrapping;
  tex.repeat.set(repeat, repeat);
  tex.colorSpace = isColorMap ? SRGBColorSpace : NoColorSpace;
  tex.anisotropy = 4;
  tex.needsUpdate = true;
  return tex;
}

/**
 * Returns module-cached procedural PBR hull plating textures (albedo panel detail,
 * Sobel tangent-space normal map, and roughness variation map). Returns `null` in
 * non-DOM SSR/test environments.
 */
export function getHullTextureSet(
  materialId: MaterialId,
  repeat = 2.5,
): HullTextureSet | null {
  if (typeof document === 'undefined') return null;

  const key = `${materialId}:${repeat}`;
  const hit = cache.get(key);
  if (hit) return hit;

  const { albedoCanvas, normalCanvas, roughCanvas } = generateTextureData(materialId);
  const scaleAmt =
    materialId === 'duranium'
      ? 0.55
      : materialId === 'titanium_aerogel'
        ? 0.5
        : materialId === 'carbon_nanotube'
          ? 0.45
          : 0.35;

  const set: HullTextureSet = {
    map: configureTexture(albedoCanvas, repeat, true),
    normalMap: configureTexture(normalCanvas, repeat, false),
    roughnessMap: configureTexture(roughCanvas, repeat, false),
    normalScale: new Vector2(scaleAmt, scaleAmt),
  };
  cache.set(key, set);
  return set;
}
