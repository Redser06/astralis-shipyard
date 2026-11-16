import { memo, useEffect, useLayoutEffect, useMemo, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import {
  AdditiveBlending,
  BackSide,
  BufferAttribute,
  BufferGeometry,
  CanvasTexture,
  Color,
  DoubleSide,
  DynamicDrawUsage,
  Euler,
  IcosahedronGeometry,
  InstancedMesh,
  Matrix4,
  Mesh,
  NormalBlending,
  Quaternion,
  SRGBColorSpace,
  ShaderMaterial,
  Vector3,
} from 'three';
import type { MissionState } from '../../domain/types';
import { mulberry32 } from '../../domain/rng';
import type { EnvironmentId } from '../viewportOptions';
import { useReducedMotion } from '../useReducedMotion';

export interface SpaceBackdropProps {
  environment: EnvironmentId;
  intensity: number;
  missionState?: MissionState | null;
  missionProgress?: number;
}

interface AsteroidSeed {
  orbitRadius: number;
  orbitAngle: number;
  orbitSpeed: number;
  orbitInclination: number;
  yOffset: number;
  scaleX: number;
  scaleY: number;
  scaleZ: number;
  rotX: number;
  rotY: number;
  rotZ: number;
  spinX: number;
  spinY: number;
  spinZ: number;
  color: Color;
}

interface NebulaLayerSpec {
  id: string;
  position: [number, number, number];
  scale: [number, number, number];
  colorA: string;
  colorB: string;
  colorC: string;
  seedOffset: number;
  opacity: number;
  isDustLane?: boolean;
}

// Sun direction aligned with Viewport key directional light at [12, 16, 10]
const SUN_DIRECTION = new Vector3(12, 16, 10).normalize();

const MOON_POS: [number, number, number] = [-44, -2, -138];
const GAS_GIANT_POS: [number, number, number] = [-132, -82, -80];
const TERRESTRIAL_POS: [number, number, number] = [96, 18, 165];

// Placed across the orbital horizon while keeping the hero top-left corner ray (-0.92, 0.01, -0.38) dark for RC-3
const NEBULA_LAYERS: readonly NebulaLayerSpec[] = [
  {
    id: 'nebula-core-teal',
    position: [-56, -24, -158],
    scale: [175, 115, 1],
    colorA: '#1d4ed8',
    colorB: '#0d9488',
    colorC: '#38bdf8',
    seedOffset: 1.7,
    opacity: 0.78,
  },
  {
    id: 'nebula-ridge-violet',
    position: [-108, -72, -128],
    scale: [165, 105, 1],
    colorA: '#4c1d95',
    colorB: '#9333ea',
    colorC: '#f472b6',
    seedOffset: 4.3,
    opacity: 0.72,
  },
  {
    id: 'nebula-dust-filament',
    position: [-80, -48, -142],
    scale: [150, 78, 1],
    colorA: '#090714',
    colorB: '#1e1b4b',
    colorC: '#581c87',
    seedOffset: 7.9,
    opacity: 0.56,
    isDustLane: true,
  },
  {
    id: 'nebula-aft-amber',
    position: [98, 18, 128],
    scale: [195, 130, 1],
    colorA: '#1e3a8a',
    colorB: '#0e7490',
    colorC: '#f59e0b',
    seedOffset: 11.4,
    opacity: 0.68,
  },
  {
    id: 'nebula-starboard-veil',
    position: [130, -28, -58],
    scale: [175, 120, 1],
    colorA: '#312e81',
    colorB: '#0891b2',
    colorC: '#a855f7',
    seedOffset: 15.2,
    opacity: 0.66,
  },
  {
    id: 'nebula-deep-horizon',
    position: [-105, 22, 125],
    scale: [185, 125, 1],
    colorA: '#1e1b4b',
    colorB: '#6d28d9',
    colorC: '#ec4899',
    seedOffset: 19.6,
    opacity: 0.64,
  },
];

const _astMat4 = new Matrix4();
const _astPos = new Vector3();
const _astQuat = new Quaternion();
const _astEuler = new Euler();
const _astScale = new Vector3();

let cachedMoonAlbedo: CanvasTexture | null = null;
let cachedMoonBump: CanvasTexture | null = null;
let cachedGasGiantTex: CanvasTexture | null = null;
let cachedTerrestrialTex: CanvasTexture | null = null;

function hash2D(ix: number, iy: number): number {
  const n = Math.sin(ix * 127.1 + iy * 311.7) * 43758.5453123;
  return n - Math.floor(n);
}

function valueNoise2D(x: number, y: number): number {
  const ix = Math.floor(x);
  const iy = Math.floor(y);
  const fx = x - ix;
  const fy = y - iy;
  const ux = fx * fx * (3 - 2 * fx);
  const uy = fy * fy * (3 - 2 * fy);
  const a = hash2D(ix, iy);
  const b = hash2D(ix + 1, iy);
  const c = hash2D(ix, iy + 1);
  const d = hash2D(ix + 1, iy + 1);
  return a + (b - a) * ux + (c - a) * uy + (a - b - c + d) * ux * uy;
}

function fbm2D(x: number, y: number): number {
  let value = 0;
  let amp = 0.5;
  let freq = 1;
  for (let i = 0; i < 4; i++) {
    value += amp * valueNoise2D(x * freq, y * freq);
    freq *= 2.02;
    amp *= 0.5;
  }
  return value;
}

function getMoonTextures(): { albedo: CanvasTexture; bump: CanvasTexture } | null {
  if (cachedMoonAlbedo && cachedMoonBump) {
    return { albedo: cachedMoonAlbedo, bump: cachedMoonBump };
  }
  if (typeof document === 'undefined') return null;

  const w = 512;
  const h = 256;
  const albedoCanvas = document.createElement('canvas');
  albedoCanvas.width = w;
  albedoCanvas.height = h;
  const aCtx = albedoCanvas.getContext('2d');

  const bumpCanvas = document.createElement('canvas');
  bumpCanvas.width = w;
  bumpCanvas.height = h;
  const bCtx = bumpCanvas.getContext('2d');

  if (!aCtx || !bCtx) return null;

  const aImg = aCtx.createImageData(w, h);
  const bImg = bCtx.createImageData(w, h);

  // Base regolith highlands and dark basaltic mare basins
  for (let y = 0; y < h; y++) {
    const v = y / h;
    for (let x = 0; x < w; x++) {
      const u = x / w;
      const mareNoise = fbm2D(u * 4.2 + 1.3, v * 2.6 + 0.8);
      const detail = fbm2D(u * 26.0, v * 14.0);
      const mareMask = Math.max(0, Math.min(1, (mareNoise - 0.44) * 4.2));

      const highlandShade = 136 + detail * 54;
      const mareShade = 62 + detail * 28;
      const shade = Math.round(highlandShade * (1 - mareMask) + mareShade * mareMask);
      const bumpVal = Math.round(128 + (detail - 0.5) * 85 - mareMask * 22);

      const idx = (y * w + x) * 4;
      aImg.data[idx] = Math.min(255, shade + 2);
      aImg.data[idx + 1] = Math.min(255, shade + 1);
      aImg.data[idx + 2] = Math.max(0, shade - 4);
      aImg.data[idx + 3] = 255;

      const bClamped = Math.max(0, Math.min(255, bumpVal));
      bImg.data[idx] = bClamped;
      bImg.data[idx + 1] = bClamped;
      bImg.data[idx + 2] = bClamped;
      bImg.data[idx + 3] = 255;
    }
  }
  aCtx.putImageData(aImg, 0, 0);
  bCtx.putImageData(bImg, 0, 0);

  // Overlay 140 deterministic impact craters with bowls, terraced rims, and fresh bright ray ejecta
  const rng = mulberry32(7331);
  for (let i = 0; i < 140; i++) {
    const cx = rng() * w;
    const cy = (0.1 + rng() * 0.8) * h;
    const r = i < 14 ? 14 + rng() * 18 : 2.5 + rng() * 9.5;
    const isFreshRay = i < 5;

    if (isFreshRay) {
      aCtx.save();
      aCtx.strokeStyle = 'rgba(226, 232, 240, 0.22)';
      aCtx.lineWidth = 1.4;
      const rays = 10 + Math.floor(rng() * 8);
      for (let ray = 0; ray < rays; ray++) {
        const ang = (ray / rays) * Math.PI * 2 + rng() * 0.3;
        const len = r * (2.6 + rng() * 3.8);
        aCtx.beginPath();
        aCtx.moveTo(cx + Math.cos(ang) * r * 0.9, cy + Math.sin(ang) * r * 0.9);
        aCtx.lineTo(cx + Math.cos(ang) * len, cy + Math.sin(ang) * len);
        aCtx.stroke();
      }
      aCtx.restore();
    }

    // Albedo crater bowl + rim highlight
    const aGrad = aCtx.createRadialGradient(cx, cy, r * 0.1, cx, cy, r);
    aGrad.addColorStop(0, 'rgba(55, 58, 68, 0.55)');
    aGrad.addColorStop(0.72, 'rgba(78, 82, 92, 0.32)');
    aGrad.addColorStop(0.88, 'rgba(212, 216, 224, 0.42)');
    aGrad.addColorStop(1, 'rgba(130, 134, 142, 0)');
    aCtx.fillStyle = aGrad;
    aCtx.beginPath();
    aCtx.arc(cx, cy, r, 0, Math.PI * 2);
    aCtx.fill();

    // Bump crater relief
    const bGrad = bCtx.createRadialGradient(cx, cy, r * 0.1, cx, cy, r);
    bGrad.addColorStop(0, 'rgba(24, 24, 24, 0.78)');
    bGrad.addColorStop(0.68, 'rgba(65, 65, 65, 0.45)');
    bGrad.addColorStop(0.86, 'rgba(245, 245, 245, 0.72)');
    bGrad.addColorStop(1, 'rgba(128, 128, 128, 0)');
    bCtx.fillStyle = bGrad;
    bCtx.beginPath();
    bCtx.arc(cx, cy, r, 0, Math.PI * 2);
    bCtx.fill();
  }

  const albedo = new CanvasTexture(albedoCanvas);
  albedo.colorSpace = SRGBColorSpace;
  albedo.needsUpdate = true;

  const bump = new CanvasTexture(bumpCanvas);
  bump.needsUpdate = true;

  cachedMoonAlbedo = albedo;
  cachedMoonBump = bump;
  return { albedo, bump };
}

function getGasGiantTexture(): CanvasTexture | null {
  if (cachedGasGiantTex) return cachedGasGiantTex;
  if (typeof document === 'undefined') return null;

  const w = 512;
  const h = 256;
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d');
  if (!ctx) return null;

  const palette = [
    '#cbb799',
    '#9d7556',
    '#dfd1ba',
    '#7c5942',
    '#b69777',
    '#66778d',
    '#d6c3a5',
    '#8f6448',
  ];

  // Zonal atmospheric cloud bands
  for (let y = 0; y < h; y++) {
    const v = y / h;
    const bandWave = Math.sin(v * Math.PI * 16) * 0.5 + 0.5;
    const bandIdx = Math.floor((v * palette.length * 1.9 + bandWave * 0.6) % palette.length);
    ctx.fillStyle = palette[bandIdx];
    ctx.fillRect(0, y, w, 1);
  }

  // Turbulent zonal wind shear & storm anticyclones
  const rng = mulberry32(4421);
  for (let i = 0; i < 65; i++) {
    const sx = rng() * w;
    const sy = (0.14 + rng() * 0.72) * h;
    const rx = 18 + rng() * 52;
    const ry = 2.5 + rng() * 6.5;
    ctx.fillStyle = i % 5 === 0 ? 'rgba(186, 108, 72, 0.34)' : 'rgba(236, 224, 204, 0.2)';
    ctx.beginPath();
    ctx.ellipse(sx, sy, rx, ry, 0, 0, Math.PI * 2);
    ctx.fill();
  }

  const texture = new CanvasTexture(canvas);
  texture.colorSpace = SRGBColorSpace;
  texture.needsUpdate = true;
  cachedGasGiantTex = texture;
  return texture;
}

function getTerrestrialTexture(): CanvasTexture | null {
  if (cachedTerrestrialTex) return cachedTerrestrialTex;
  if (typeof document === 'undefined') return null;

  const w = 512;
  const h = 256;
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d');
  if (!ctx) return null;

  const img = ctx.createImageData(w, h);
  for (let y = 0; y < h; y++) {
    const v = y / h;
    const lat = Math.abs(v - 0.5) * 2;
    for (let x = 0; x < w; x++) {
      const u = x / w;
      const continent = fbm2D(u * 4.8 + 2.4, v * 3.1 + 1.1);
      const moisture = fbm2D(u * 9.2 + 5.7, v * 6.4 + 3.2);
      const clouds = fbm2D(u * 8.4 + 0.5, v * 5.2 + 4.1);

      let r = 14;
      let g = 48;
      let b = 88;

      if (lat > 0.84 - continent * 0.08) {
        // Polar ice caps
        r = 216;
        g = 228;
        b = 238;
      } else if (continent > 0.54) {
        const elev = (continent - 0.54) / 0.46;
        if (moisture > 0.52) {
          r = Math.round(52 + elev * 68);
          g = Math.round(88 + elev * 52);
          b = Math.round(48 + elev * 42);
        } else {
          r = Math.round(138 + elev * 50);
          g = Math.round(114 + elev * 44);
          b = Math.round(78 + elev * 38);
        }
      } else {
        const shelf = Math.max(0, (continent - 0.36) / 0.18);
        r = Math.round(12 + shelf * 18);
        g = Math.round(44 + shelf * 46);
        b = Math.round(84 + shelf * 44);
      }

      // Soft swirling cloud deck
      const cloudMask = Math.max(0, Math.min(0.75, (clouds - 0.52) * 2.4));
      r = Math.round(r * (1 - cloudMask) + 232 * cloudMask);
      g = Math.round(g * (1 - cloudMask) + 238 * cloudMask);
      b = Math.round(b * (1 - cloudMask) + 245 * cloudMask);

      const idx = (y * w + x) * 4;
      img.data[idx] = r;
      img.data[idx + 1] = g;
      img.data[idx + 2] = b;
      img.data[idx + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);

  const texture = new CanvasTexture(canvas);
  texture.colorSpace = SRGBColorSpace;
  texture.needsUpdate = true;
  cachedTerrestrialTex = texture;
  return texture;
}

function buildDisplacedRockGeometry(seed: number): BufferGeometry {
  const geo = new IcosahedronGeometry(1, 2);
  const pos = geo.getAttribute('position') as BufferAttribute;
  const rng = mulberry32(seed);

  const phaseA = rng() * Math.PI * 2;
  const phaseB = rng() * Math.PI * 2;
  const phaseC = rng() * Math.PI * 2;

  // Pick 3 random impact crater dimple axes per rock geometry
  const craters: Array<{ x: number; y: number; z: number; rad: number; depth: number }> = [];
  for (let c = 0; c < 3; c++) {
    const theta = rng() * Math.PI * 2;
    const z = rng() * 2 - 1;
    const rXY = Math.sqrt(Math.max(0, 1 - z * z));
    craters.push({
      x: rXY * Math.cos(theta),
      y: rXY * Math.sin(theta),
      z,
      rad: 0.34 + rng() * 0.25,
      depth: 0.16 + rng() * 0.14,
    });
  }

  for (let i = 0; i < pos.count; i++) {
    const vx = pos.getX(i);
    const vy = pos.getY(i);
    const vz = pos.getZ(i);
    const len = Math.hypot(vx, vy, vz) || 1;
    const nx = vx / len;
    const ny = vy / len;
    const nz = vz / len;

    // Multi-frequency rocky ridges + triaxial asymmetry
    const ridge1 = Math.sin(nx * 2.8 + ny * 2.1 + phaseA) * 0.17;
    const ridge2 = Math.cos(ny * 4.5 - nz * 3.7 + phaseB) * 0.11;
    const ridge3 = Math.sin(nz * 6.3 + nx * 5.2 + phaseC) * 0.06;
    let disp = 0.88 + ridge1 + ridge2 + ridge3;

    for (const cr of craters) {
      const dot = nx * cr.x + ny * cr.y + nz * cr.z;
      const dist = Math.acos(Math.max(-1, Math.min(1, dot)));
      if (dist < cr.rad) {
        const bowl = Math.cos((dist / cr.rad) * (Math.PI * 0.5));
        disp -= bowl * cr.depth;
      }
    }

    pos.setXYZ(i, nx * disp, ny * disp, nz * disp);
  }

  geo.computeVertexNormals();
  return geo;
}

function MultiSpectralStarfield({
  environment,
  reducedMotion,
}: {
  environment: EnvironmentId;
  reducedMotion: boolean;
}) {
  const starCount = 5200;

  const { geometry, material } = useMemo(() => {
    const rng = mulberry32(90125);
    const positions = new Float32Array(starCount * 3);
    const colors = new Float32Array(starCount * 3);
    const sizes = new Float32Array(starCount);
    const phases = new Float32Array(starCount);

    // Tilted Milky Way galactic plane basis aligned away from the dark top-left RC-3 sky corner
    const galNormal = new Vector3(0.55, 0.72, -0.42).normalize();
    const galU = new Vector3().crossVectors(galNormal, new Vector3(0, 1, 0)).normalize();
    const galV = new Vector3().crossVectors(galNormal, galU).normalize();

    const spectralO = new Color('#bae6fd'); // Blue-white O/B
    const spectralA = new Color('#f8fafc'); // Crisp white A/F
    const spectralG = new Color('#fef3c7'); // Solar pale yellow G
    const spectralK = new Color('#fdba74'); // Warm orange K/M
    const cTemp = new Color();

    for (let i = 0; i < starCount; i++) {
      const inBand = i < 1850;
      let dx: number;
      let dy: number;
      let dz: number;

      if (inBand) {
        const lon = rng() * Math.PI * 2;
        // Gaussian-like thin galactic ribbon dispersion
        const spread = (rng() + rng() + rng() - 1.5) * 0.16;
        const cosL = Math.cos(lon);
        const sinL = Math.sin(lon);
        dx = galU.x * cosL + galV.x * sinL + galNormal.x * spread;
        dy = galU.y * cosL + galV.y * sinL + galNormal.y * spread;
        dz = galU.z * cosL + galV.z * sinL + galNormal.z * spread;
      } else {
        const phi = rng() * Math.PI * 2;
        const cosTheta = rng() * 2 - 1;
        const sinTheta = Math.sqrt(Math.max(0, 1 - cosTheta * cosTheta));
        dx = sinTheta * Math.cos(phi);
        dy = sinTheta * Math.sin(phi);
        dz = cosTheta;
      }

      const len = Math.hypot(dx, dy, dz) || 1;
      dx /= len;
      dy /= len;
      dz /= len;

      // Keep stars cleanly between 150 and 285 units (well inside far=400)
      const radius = 152 + rng() * 130;
      positions[i * 3] = dx * radius;
      positions[i * 3 + 1] = dy * radius;
      positions[i * 3 + 2] = dz * radius;

      // Spectral class distribution + brightness capped <= 0.70 so stars never bloom-smear
      const specRoll = rng();
      if (specRoll < 0.1) cTemp.copy(spectralO);
      else if (specRoll < 0.36) cTemp.copy(spectralA);
      else if (specRoll < 0.65) cTemp.copy(spectralG);
      else cTemp.copy(spectralK);

      // Slightly dimmer stars in the hero camera's top-left sky corner ray (-0.92, 0.01, -0.38)
      const topLeftDot = dx * -0.92 + dy * 0.01 + dz * -0.38;
      const cornerAtten = topLeftDot > 0.88 ? 0.38 : 1.0;

      const mag = (inBand ? 0.28 + rng() * 0.38 : 0.34 + rng() * 0.36) * cornerAtten;
      colors[i * 3] = cTemp.r * mag;
      colors[i * 3 + 1] = cTemp.g * mag;
      colors[i * 3 + 2] = cTemp.b * mag;

      sizes[i] = inBand ? 1.1 + rng() * 1.45 : 1.2 + Math.pow(rng(), 2.2) * 2.4;
      phases[i] = rng() * Math.PI * 2;
    }

    const geo = new BufferGeometry();
    geo.setAttribute('position', new BufferAttribute(positions, 3));
    geo.setAttribute('aColor', new BufferAttribute(colors, 3));
    geo.setAttribute('aSize', new BufferAttribute(sizes, 1));
    geo.setAttribute('aPhase', new BufferAttribute(phases, 1));

    const mat = new ShaderMaterial({
      uniforms: {
        uTime: { value: 0 },
        uBoost: { value: 1.0 },
      },
      vertexShader: `
        attribute vec3 aColor;
        attribute float aSize;
        attribute float aPhase;
        varying vec3 vColor;
        varying float vTwinkle;
        uniform float uTime;

        void main() {
          vColor = aColor;
          vTwinkle = 0.86 + 0.14 * sin(uTime * 1.6 + aPhase);
          vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
          gl_PointSize = clamp(aSize * (290.0 / max(-mvPosition.z, 40.0)), 1.0, 4.2);
          gl_Position = projectionMatrix * mvPosition;
        }
      `,
      fragmentShader: `
        varying vec3 vColor;
        varying float vTwinkle;
        uniform float uBoost;

        void main() {
          vec2 uv = gl_PointCoord - vec2(0.5);
          float d2 = dot(uv, uv);
          if (d2 > 0.25) discard;
          float core = exp(-d2 * 18.0);
          gl_FragColor = vec4(vColor * vTwinkle * uBoost, core);
        }
      `,
      transparent: true,
      depthWrite: false,
      blending: AdditiveBlending,
      toneMapped: true,
    });

    return { geometry: geo, material: mat };
  }, []);

  useEffect(() => {
    material.uniforms.uBoost.value = environment === 'nebula' ? 1.06 : 0.96;
  }, [environment, material]);

  useEffect(() => {
    return () => {
      geometry.dispose();
      material.dispose();
    };
  }, [geometry, material]);

  useFrame(({ clock }) => {
    material.uniforms.uTime.value = reducedMotion ? 0 : clock.getElapsedTime();
  });

  return <points name="space-starfield" geometry={geometry} material={material} frustumCulled={false} />;
}

function CrateredMoon({ reducedMotion }: { reducedMotion: boolean }) {
  const moonRef = useRef<Mesh>(null);
  const textures = useMemo(() => getMoonTextures(), []);

  useFrame((_, delta) => {
    if (!moonRef.current || reducedMotion) return;
    moonRef.current.rotation.y += delta * 0.004;
  });

  return (
    <mesh ref={moonRef} name="backdrop-moon" position={MOON_POS} rotation={[0.14, -0.85, 0.06]}>
      <sphereGeometry args={[18.5, 48, 36]} />
      <meshStandardMaterial
        map={textures?.albedo}
        bumpMap={textures?.bump}
        bumpScale={0.55}
        color="#d4d8df"
        roughness={0.94}
        metalness={0.02}
      />
    </mesh>
  );
}

function RingedGasGiant({ reducedMotion }: { reducedMotion: boolean }) {
  const planetRef = useRef<Mesh>(null);
  const planetTex = useMemo(() => getGasGiantTexture(), []);

  const ringMaterial = useMemo(() => {
    return new ShaderMaterial({
      uniforms: {
        uSunDir: { value: SUN_DIRECTION.clone() },
        uPlanetRadius: { value: 18.0 },
        uInnerRadius: { value: 22.8 },
        uOuterRadius: { value: 41.0 },
      },
      vertexShader: `
        varying vec3 vLocalPos;
        varying vec3 vWorldPos;
        void main() {
          vLocalPos = position;
          vec4 wp = modelMatrix * vec4(position, 1.0);
          vWorldPos = wp.xyz;
          gl_Position = projectionMatrix * viewMatrix * wp;
        }
      `,
      fragmentShader: `
        varying vec3 vLocalPos;
        varying vec3 vWorldPos;
        uniform vec3 uSunDir;
        uniform float uPlanetRadius;
        uniform float uInnerRadius;
        uniform float uOuterRadius;

        void main() {
          float r = length(vLocalPos.xy);
          float t = clamp((r - uInnerRadius) / (uOuterRadius - uInnerRadius), 0.0, 1.0);

          // Fine concentric ringlet density modulation + Cassini and Encke divisions
          float ringlets = 0.72 + 0.28 * sin(t * 95.0) * cos(t * 37.0);
          float cassini = smoothstep(0.032, 0.055, abs(t - 0.61));
          float encke = smoothstep(0.012, 0.024, abs(t - 0.87));
          float edgeFade = smoothstep(0.0, 0.07, t) * (1.0 - smoothstep(0.92, 1.0, t));
          float innerCrepe = mix(0.28, 1.0, smoothstep(0.0, 0.22, t));
          float alpha = edgeFade * innerCrepe * cassini * encke * (0.48 + 0.34 * ringlets);

          vec3 colC = vec3(0.42, 0.39, 0.37);
          vec3 colB = vec3(0.76, 0.67, 0.56);
          vec3 colA = vec3(0.60, 0.57, 0.54);
          vec3 baseColor = t < 0.22 ? mix(colC, colB, t / 0.22) : mix(colB, colA, smoothstep(0.55, 0.72, t));
          baseColor *= 0.88 + 0.12 * sin(t * 60.0);

          // Analytical ray-sphere planetary shadow onto the ring plane
          vec3 planetCenter = vec3(${GAS_GIANT_POS[0].toFixed(1)}, ${GAS_GIANT_POS[1].toFixed(1)}, ${GAS_GIANT_POS[2].toFixed(1)});
          vec3 rel = vWorldPos - planetCenter;
          float b = dot(rel, uSunDir);
          float shadow = 1.0;
          if (b < 0.0) {
            float perp2 = dot(rel, rel) - b * b;
            float r2 = uPlanetRadius * uPlanetRadius;
            shadow = mix(0.06, 1.0, smoothstep(r2 * 0.92, r2 * 1.08, perp2));
          }

          gl_FragColor = vec4(baseColor * shadow * 0.72, alpha * 0.86);
        }
      `,
      transparent: true,
      depthWrite: false,
      side: DoubleSide,
      toneMapped: true,
    });
  }, []);

  useEffect(() => {
    return () => {
      ringMaterial.dispose();
    };
  }, [ringMaterial]);

  useFrame((_, delta) => {
    if (!planetRef.current || reducedMotion) return;
    planetRef.current.rotation.y += delta * 0.008;
  });

  return (
    <group name="backdrop-gas-giant" position={GAS_GIANT_POS} rotation={[0.42, 0.22, -0.3]}>
      <mesh ref={planetRef}>
        <sphereGeometry args={[18, 42, 32]} />
        <meshStandardMaterial
          map={planetTex ?? undefined}
          color="#ddd2c2"
          roughness={0.85}
          metalness={0.04}
        />
      </mesh>
      <mesh rotation={[-Math.PI / 2, 0, 0]} material={ringMaterial}>
        <ringGeometry args={[22.8, 41, 112, 1]} />
      </mesh>
    </group>
  );
}

function TerrestrialPlanet({ reducedMotion }: { reducedMotion: boolean }) {
  const worldRef = useRef<Mesh>(null);
  const planetTex = useMemo(() => getTerrestrialTexture(), []);

  const atmoMaterial = useMemo(() => {
    return new ShaderMaterial({
      uniforms: {
        uSunDir: { value: SUN_DIRECTION.clone() },
      },
      vertexShader: `
        varying vec3 vNormalW;
        varying vec3 vViewDir;
        void main() {
          vec4 wp = modelMatrix * vec4(position, 1.0);
          vNormalW = normalize(mat3(modelMatrix) * normal);
          vViewDir = normalize(cameraPosition - wp.xyz);
          gl_Position = projectionMatrix * viewMatrix * wp;
        }
      `,
      fragmentShader: `
        varying vec3 vNormalW;
        varying vec3 vViewDir;
        uniform vec3 uSunDir;
        void main() {
          float rim = pow(clamp(1.0 - abs(dot(vNormalW, vViewDir)), 0.0, 1.0), 3.4);
          float sunLit = smoothstep(-0.25, 0.55, dot(vNormalW, uSunDir));
          vec3 skyBlue = vec3(0.22, 0.58, 0.92);
          gl_FragColor = vec4(skyBlue * rim * (0.14 + 0.86 * sunLit) * 0.72, rim * 0.65);
        }
      `,
      transparent: true,
      depthWrite: false,
      side: BackSide,
      blending: AdditiveBlending,
      toneMapped: true,
    });
  }, []);

  useEffect(() => {
    return () => {
      atmoMaterial.dispose();
    };
  }, [atmoMaterial]);

  useFrame((_, delta) => {
    if (!worldRef.current || reducedMotion) return;
    worldRef.current.rotation.y += delta * 0.005;
  });

  return (
    <group name="backdrop-terrestrial" position={TERRESTRIAL_POS}>
      <mesh ref={worldRef} rotation={[0.18, 1.1, 0.05]}>
        <sphereGeometry args={[21, 40, 30]} />
        <meshStandardMaterial
          map={planetTex ?? undefined}
          color="#cbd5e1"
          roughness={0.78}
          metalness={0.05}
        />
      </mesh>
      <mesh material={atmoMaterial}>
        <sphereGeometry args={[21.7, 36, 26]} />
      </mesh>
    </group>
  );
}

function NebulaCloudLayer({
  spec,
  environment,
  intensity,
  reducedMotion,
}: {
  spec: NebulaLayerSpec;
  environment: EnvironmentId;
  intensity: number;
  reducedMotion: boolean;
}) {
  const meshRef = useRef<Mesh>(null);
  const envVisibility = environment === 'nebula' ? 1.0 : 0.24;
  const targetOpacity = spec.opacity * envVisibility * Math.min(1.3, intensity / 2.2);

  const material = useMemo(() => {
    return new ShaderMaterial({
      uniforms: {
        uColorA: { value: new Color(spec.colorA) },
        uColorB: { value: new Color(spec.colorB) },
        uColorC: { value: new Color(spec.colorC) },
        uSeed: { value: spec.seedOffset },
        uTime: { value: 0 },
        uOpacity: { value: 0.4 },
        uDustMode: { value: spec.isDustLane ? 1.0 : 0.0 },
      },
      vertexShader: `
        varying vec2 vUv;
        void main() {
          vUv = uv;
          gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        }
      `,
      fragmentShader: `
        varying vec2 vUv;
        uniform vec3 uColorA;
        uniform vec3 uColorB;
        uniform vec3 uColorC;
        uniform float uSeed;
        uniform float uTime;
        uniform float uOpacity;
        uniform float uDustMode;

        float hash(vec2 p) {
          return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453123);
        }

        float noise(vec2 p) {
          vec2 i = floor(p);
          vec2 f = fract(p);
          vec2 u = f * f * (3.0 - 2.0 * f);
          return mix(
            mix(hash(i + vec2(0.0, 0.0)), hash(i + vec2(1.0, 0.0)), u.x),
            mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), u.x),
            u.y
          );
        }

        float fbm(vec2 p) {
          float v = 0.0;
          float a = 0.5;
          mat2 rot = mat2(0.8, 0.6, -0.6, 0.8);
          for (int i = 0; i < 4; i++) {
            v += a * noise(p);
            p = rot * p * 2.04 + vec2(1.7, 9.2);
            a *= 0.5;
          }
          return v;
        }

        void main() {
          vec2 p = vUv * 2.0 - 1.0;
          float r2 = dot(p, p);
          float radialMask = exp(-r2 * 4.1) * smoothstep(1.0, 0.18, sqrt(r2));
          if (radialMask < 0.005) discard;

          vec2 q = p * 2.4 + vec2(uSeed, uTime * 0.012);
          float warp = fbm(q);
          float density = fbm(q + vec2(warp * 1.45, -warp * 1.1));
          float ridge = pow(clamp(1.0 - abs(density - 0.5) * 2.3, 0.0, 1.0), 1.8);

          vec3 col = mix(uColorA, uColorB, smoothstep(0.18, 0.72, density));
          col = mix(col, uColorC, ridge * 0.72);

          // Scale and clamp strictly below Bloom threshold (0.84) so emission glows smoothly without white clipping
          vec3 finalColor = min(col * 0.85, vec3(0.70));
          float alpha = radialMask * smoothstep(0.10, 0.76, density) * uOpacity;
          if (uDustMode > 0.5) {
            alpha *= 0.72;
          }
          gl_FragColor = vec4(finalColor, alpha);
        }
      `,
      transparent: true,
      depthWrite: false,
      side: DoubleSide,
      blending: spec.isDustLane ? NormalBlending : AdditiveBlending,
      toneMapped: true,
    });
  }, [spec.colorA, spec.colorB, spec.colorC, spec.seedOffset, spec.isDustLane]);

  useEffect(() => {
    material.uniforms.uOpacity.value = targetOpacity;
  }, [material, targetOpacity]);

  useEffect(() => {
    return () => {
      material.dispose();
    };
  }, [material]);

  useFrame(({ camera, clock }) => {
    if (!meshRef.current) return;
    meshRef.current.lookAt(camera.position);
    material.uniforms.uTime.value = reducedMotion ? 0 : clock.getElapsedTime();
  });

  return (
    <mesh
      ref={meshRef}
      name={spec.id}
      position={spec.position}
      scale={spec.scale}
      material={material}
      renderOrder={-10}
    >
      <planeGeometry args={[1, 1]} />
    </mesh>
  );
}

export function AsteroidField() {
  const reducedMotion = useReducedMotion();
  const batchRef0 = useRef<InstancedMesh>(null);
  const batchRef1 = useRef<InstancedMesh>(null);
  const batchRef2 = useRef<InstancedMesh>(null);

  const rockGeometries = useMemo(() => {
    return [
      buildDisplacedRockGeometry(101),
      buildDisplacedRockGeometry(202),
      buildDisplacedRockGeometry(303),
    ];
  }, []);

  useEffect(() => {
    return () => {
      for (const geo of rockGeometries) {
        geo.dispose();
      }
    };
  }, [rockGeometries]);

  const batches = useMemo<AsteroidSeed[][]>(() => {
    const rng = mulberry32(8421);
    const palette = ['#78716c', '#57534e', '#8b7355', '#64748b', '#94a3b8'];
    const result: AsteroidSeed[][] = [[], [], []];

    for (let i = 0; i < 84; i++) {
      // Keep minimum radius >= 21m so boulders stay safely clear of ship hull and drydock frame
      let orbitRadius = 21.5 + rng() * 48;
      const orbitAngle = (i / 84) * Math.PI * 2 + (rng() - 0.5) * 0.25;
      const yOffset = (rng() - 0.5) * 20;

      // Avoid crossing close in front of hero camera [21, 11, 26] or top-left RC-3 sky quadrant
      const approxX = Math.cos(orbitAngle) * orbitRadius;
      const approxZ = Math.sin(orbitAngle) * orbitRadius;
      const camDist = Math.hypot(approxX - 21, yOffset - 11, approxZ - 26);
      if (camDist < 14) {
        orbitRadius += 16;
      }

      const baseSize = 0.42 + Math.pow(rng(), 1.8) * 1.85;
      const seed: AsteroidSeed = {
        orbitRadius,
        orbitAngle,
        orbitSpeed: (0.012 + rng() * 0.022) * (rng() > 0.5 ? 1 : -1),
        orbitInclination: (rng() - 0.5) * 0.22,
        yOffset,
        scaleX: baseSize * (0.75 + rng() * 0.65),
        scaleY: baseSize * (0.58 + rng() * 0.55),
        scaleZ: baseSize * (0.72 + rng() * 0.65),
        rotX: rng() * Math.PI * 2,
        rotY: rng() * Math.PI * 2,
        rotZ: rng() * Math.PI * 2,
        spinX: (rng() - 0.5) * 0.14,
        spinY: (rng() - 0.5) * 0.18,
        spinZ: (rng() - 0.5) * 0.12,
        color: new Color(palette[Math.floor(rng() * palette.length)]),
      };
      result[i % 3].push(seed);
    }
    return result;
  }, []);

  // Sparse silicate micro-dust points drifting through the belt
  const dustGeo = useMemo(() => {
    const rng = mulberry32(5519);
    const count = 220;
    const pos = new Float32Array(count * 3);
    for (let i = 0; i < count; i++) {
      const r = 20 + rng() * 58;
      const th = rng() * Math.PI * 2;
      pos[i * 3] = Math.cos(th) * r;
      pos[i * 3 + 1] = (rng() - 0.5) * 26;
      pos[i * 3 + 2] = Math.sin(th) * r;
    }
    const geo = new BufferGeometry();
    geo.setAttribute('position', new BufferAttribute(pos, 3));
    return geo;
  }, []);

  useEffect(() => {
    return () => {
      dustGeo.dispose();
    };
  }, [dustGeo]);

  useLayoutEffect(() => {
    const meshes = [batchRef0.current, batchRef1.current, batchRef2.current];
    batches.forEach((list, bIdx) => {
      const mesh = meshes[bIdx];
      if (!mesh) return;
      mesh.instanceMatrix.setUsage(DynamicDrawUsage);
      list.forEach((a, i) => {
        const theta = a.orbitAngle;
        _astPos.set(
          Math.cos(theta) * a.orbitRadius,
          a.yOffset + Math.sin(theta) * a.orbitRadius * a.orbitInclination,
          Math.sin(theta) * a.orbitRadius,
        );
        _astEuler.set(a.rotX, a.rotY, a.rotZ);
        _astQuat.setFromEuler(_astEuler);
        _astScale.set(a.scaleX, a.scaleY, a.scaleZ);
        _astMat4.compose(_astPos, _astQuat, _astScale);
        mesh.setMatrixAt(i, _astMat4);
        mesh.setColorAt(i, a.color);
      });
      mesh.instanceMatrix.needsUpdate = true;
      if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
    });
  }, [batches]);

  useFrame(({ clock }) => {
    if (reducedMotion) return;
    const t = clock.getElapsedTime();
    const meshes = [batchRef0.current, batchRef1.current, batchRef2.current];
    for (let b = 0; b < 3; b++) {
      const mesh = meshes[b];
      if (!mesh) continue;
      const list = batches[b];
      for (let i = 0; i < list.length; i++) {
        const a = list[i];
        const theta = a.orbitAngle + t * a.orbitSpeed;
        _astPos.set(
          Math.cos(theta) * a.orbitRadius,
          a.yOffset + Math.sin(theta) * a.orbitRadius * a.orbitInclination,
          Math.sin(theta) * a.orbitRadius,
        );
        _astEuler.set(a.rotX + t * a.spinX, a.rotY + t * a.spinY, a.rotZ + t * a.spinZ);
        _astQuat.setFromEuler(_astEuler);
        _astScale.set(a.scaleX, a.scaleY, a.scaleZ);
        _astMat4.compose(_astPos, _astQuat, _astScale);
        mesh.setMatrixAt(i, _astMat4);
      }
      mesh.instanceMatrix.needsUpdate = true;
    }
  });

  const refs = [batchRef0, batchRef1, batchRef2];

  return (
    <group name="asteroid-belt">
      {batches.map((list, idx) => (
        <instancedMesh
          key={idx}
          ref={refs[idx]}
          args={[rockGeometries[idx], undefined, list.length]}
          frustumCulled={false}
        >
          <meshStandardMaterial color="#a8a29e" roughness={0.92} metalness={0.12} />
        </instancedMesh>
      ))}
      <points geometry={dustGeo}>
        <pointsMaterial
          size={0.16}
          color="#cbd5e1"
          transparent
          opacity={0.38}
          depthWrite={false}
          sizeAttenuation
        />
      </points>
    </group>
  );
}

export const SpaceBackdrop = memo(function SpaceBackdrop({
  environment,
  intensity,
  missionState: _missionState = null,
  missionProgress: _missionProgress = 0,
}: SpaceBackdropProps) {
  const reducedMotion = useReducedMotion();

  return (
    <>
      <MultiSpectralStarfield environment={environment} reducedMotion={reducedMotion} />
      <CrateredMoon reducedMotion={reducedMotion} />
      <RingedGasGiant reducedMotion={reducedMotion} />
      <TerrestrialPlanet reducedMotion={reducedMotion} />
      <group name="cosmic-nebula">
        {NEBULA_LAYERS.map((spec) => (
          <NebulaCloudLayer
            key={spec.id}
            spec={spec}
            environment={environment}
            intensity={intensity}
            reducedMotion={reducedMotion}
          />
        ))}
      </group>
    </>
  );
});
