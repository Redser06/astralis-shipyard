import { type JSX, useEffect, useMemo, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import {
  BoxGeometry,
  BufferAttribute,
  BufferGeometry,
  CatmullRomCurve3,
  CylinderGeometry,
  DynamicDrawUsage,
  Euler,
  Group,
  InstancedMesh,
  Matrix4,
  Object3D,
  Quaternion,
  SphereGeometry,
  TorusGeometry,
  TubeGeometry,
  Vector3,
} from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import type { ArchetypeId, Blueprint, MissionState, Vec3 } from '../../domain/types';
import { SHIP_PRESETS } from '../../domain/presets';
import { hullBounds, hullReach, hullVolumes } from '../../domain/hullForm';
import { useReducedMotion } from '../useReducedMotion';
import { DrydockLighting } from '../lighting/DrydockLighting';

export interface DrydockStationProps {
  intensity?: number;
  blueprint?: Blueprint;
  missionState?: MissionState | null;
  missionProgress?: number;
  dockingConnected?: boolean;
}

/* ------------------------------------------------------------------ */
/* Geometry merging utility (keeps direct-scene mesh count low)       */
/* ------------------------------------------------------------------ */

const UP_AXIS = new Vector3(0, 1, 0);
const UNIT_SCALE = new Vector3(1, 1, 1);

function makeTransformMatrix(
  pos: readonly [number, number, number],
  rot?: readonly [number, number, number],
): Matrix4 {
  const mat = new Matrix4();
  if (rot) {
    mat.makeRotationFromEuler(new Euler(rot[0], rot[1], rot[2]));
  }
  mat.setPosition(pos[0], pos[1], pos[2]);
  return mat;
}

class GeometryCollector {
  private items: BufferGeometry[] = [];

  add(geom: BufferGeometry, matrix?: Matrix4): void {
    if (matrix) geom.applyMatrix4(matrix);
    this.items.push(geom);
  }

  addBox(
    w: number,
    h: number,
    d: number,
    pos: readonly [number, number, number],
    rot?: readonly [number, number, number],
  ): void {
    const geom = new BoxGeometry(w, h, d);
    this.add(geom, makeTransformMatrix(pos, rot));
  }

  addCyl(
    radiusTop: number,
    radiusBottom: number,
    height: number,
    radialSegments: number,
    pos: readonly [number, number, number],
    rot?: readonly [number, number, number],
  ): void {
    const geom = new CylinderGeometry(radiusTop, radiusBottom, height, radialSegments, 1);
    this.add(geom, makeTransformMatrix(pos, rot));
  }

  addTorus(
    radius: number,
    tube: number,
    radialSegments: number,
    tubularSegments: number,
    pos: readonly [number, number, number],
    rot?: readonly [number, number, number],
  ): void {
    const geom = new TorusGeometry(radius, tube, radialSegments, tubularSegments);
    this.add(geom, makeTransformMatrix(pos, rot));
  }

  addSphere(
    radius: number,
    widthSegments: number,
    heightSegments: number,
    pos: readonly [number, number, number],
  ): void {
    const geom = new SphereGeometry(radius, widthSegments, heightSegments);
    this.add(geom, makeTransformMatrix(pos));
  }

  addStrut(
    a: readonly [number, number, number],
    b: readonly [number, number, number],
    radius: number,
    radialSegments = 6,
  ): void {
    const vA = new Vector3(a[0], a[1], a[2]);
    const vB = new Vector3(b[0], b[1], b[2]);
    const delta = new Vector3().subVectors(vB, vA);
    const len = delta.length();
    if (len < 1e-4) return;
    const mid = new Vector3().addVectors(vA, vB).multiplyScalar(0.5);
    const quat = new Quaternion().setFromUnitVectors(UP_AXIS, delta.normalize());
    const mat = new Matrix4().compose(mid, quat, UNIT_SCALE);
    const geom = new CylinderGeometry(radius, radius, len, radialSegments, 1);
    this.add(geom, mat);
  }

  build(): BufferGeometry {
    if (this.items.length === 0) {
      return new BufferGeometry();
    }
    const normalized = this.items.map((g) => {
      const work = g.index ? g.toNonIndexed() : g;
      if (work !== g) g.dispose();
      for (const attr of Object.keys(work.attributes)) {
        if (attr !== 'position' && attr !== 'normal' && attr !== 'uv') {
          work.deleteAttribute(attr);
        }
      }
      if (!work.getAttribute('uv')) {
        const count = work.getAttribute('position').count;
        work.setAttribute('uv', new BufferAttribute(new Float32Array(count * 2), 2));
      }
      if (!work.getAttribute('normal')) {
        work.computeVertexNormals();
      }
      return work;
    });
    const merged = mergeGeometries(normalized, false);
    for (const g of normalized) g.dispose();
    this.items = [];
    if (!merged) return new BufferGeometry();
    merged.computeBoundingBox();
    merged.computeBoundingSphere();
    return merged;
  }
}

/* ------------------------------------------------------------------ */
/* Dynamic hull docking measurement via hullForm.ts                   */
/* ------------------------------------------------------------------ */

interface FlankAnchor {
  x: number;
  y: number;
  z: number;
}

interface KeelAnchor {
  y: number;
  z: number;
}

interface UmbilicalAnchor {
  x: number;
  y: number;
  z: number;
}

interface HullDockingMeasurement {
  portAirlock: FlankAnchor;
  stbdAirlock: FlankAnchor;
  portClampFwd: FlankAnchor;
  stbdClampFwd: FlankAnchor;
  portClampAft: FlankAnchor;
  stbdClampAft: FlankAnchor;
  keelFwd: KeelAnchor;
  keelAft: KeelAnchor;
  umbPortFwd: UmbilicalAnchor;
  umbStbdFwd: UmbilicalAnchor;
  umbPortAft: UmbilicalAnchor;
  umbStbdAft: UmbilicalAnchor;
}

interface ArchetypeStationSpec {
  airlock: readonly [number, number]; // [y, z]
  clampFwd: readonly [number, number]; // [y, z]
  clampAft: readonly [number, number]; // [y, z]
  keelFwdZ: number;
  keelAftZ: number;
  umbFwdZ: number;
  umbAftZ: number;
  umbX: number;
}

const ARCHETYPE_STATIONS: Record<ArchetypeId, ArchetypeStationSpec> = {
  angular_stealth: {
    airlock: [0.35, 1.8],
    clampFwd: [0.0, 3.8],
    clampAft: [0.0, -4.4],
    keelFwdZ: 3.0,
    keelAftZ: -3.2,
    umbFwdZ: 2.8,
    umbAftZ: -2.4,
    umbX: 0.55,
  },
  industrial_expanse: {
    airlock: [0.35, 4.5],
    clampFwd: [0.35, 6.2],
    clampAft: [0.0, -6.1],
    keelFwdZ: 5.0,
    keelAftZ: -2.4,
    umbFwdZ: 5.5,
    umbAftZ: -1.5,
    umbX: 0.65,
  },
  brutalist_dreadnought: {
    airlock: [0.78, 1.5],
    clampFwd: [0.2, 4.2],
    clampAft: [0.2, -5.0],
    keelFwdZ: 4.0,
    keelAftZ: -4.2,
    umbFwdZ: 3.5,
    umbAftZ: -3.2,
    umbX: 0.8,
  },
  outrigger_science: {
    airlock: [0.0, -0.5],
    clampFwd: [0.0, 3.5],
    clampAft: [0.0, -4.5],
    keelFwdZ: 3.2,
    keelAftZ: -3.2,
    umbFwdZ: 3.0,
    umbAftZ: -2.0,
    umbX: 0.55,
  },
  aerodynamic_sleek: {
    airlock: [0.0, 2.0],
    clampFwd: [0.0, 3.8],
    clampAft: [-0.05, -4.2],
    keelFwdZ: 3.2,
    keelAftZ: -3.5,
    umbFwdZ: 2.8,
    umbAftZ: -2.6,
    umbX: 0.45,
  },
  starfleet_explorer: {
    airlock: [0.5, 3.0],
    clampFwd: [0.45, 5.2],
    clampAft: [0.0, -5.5],
    keelFwdZ: 3.5,
    keelAftZ: -3.8,
    umbFwdZ: 4.5,
    umbAftZ: -3.0,
    umbX: 0.7,
  },
  delta_strikefighter: {
    airlock: [0.0, 0.4],
    clampFwd: [0.0, 2.6],
    clampAft: [0.0, -3.2],
    keelFwdZ: 2.4,
    keelAftZ: -2.6,
    umbFwdZ: 2.0,
    umbAftZ: -2.2,
    umbX: 0.45,
  },
  deep_space_cruiser: {
    airlock: [0.0, 3.7],
    clampFwd: [0.0, 6.2],
    clampAft: [0.0, -5.2],
    keelFwdZ: 4.8,
    keelAftZ: -4.6,
    umbFwdZ: 4.8,
    umbAftZ: -3.8,
    umbX: 0.65,
  },
};

function clampNumber(v: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, v));
}

function measureFlank(
  volumes: ReturnType<typeof hullVolumes>,
  side: -1 | 1,
  preferY: number,
  preferZ: number,
  bounds: { minZ: number; maxZ: number },
): FlankAnchor {
  const safeMinZ = bounds.minZ + 0.6;
  const safeMaxZ = bounds.maxZ - 0.6;
  const clampedZ = clampNumber(preferZ, safeMinZ, safeMaxZ);
  const midZ = (bounds.minZ + bounds.maxZ) * 0.5;
  const fromX = side === -1 ? 25 : -25;
  const dir: Vec3 = side === -1 ? [-1, 0, 0] : [1, 0, 0];

  const candidates: readonly [number, number][] = [
    [preferY, preferZ],
    [0, preferZ],
    [preferY, clampedZ],
    [0, clampedZ],
    [0, midZ],
  ];

  for (const [cy, cz] of candidates) {
    const reach = hullReach(volumes, [fromX, cy, cz], dir);
    if (reach !== null && Number.isFinite(reach)) {
      const hitX = side === -1 ? 25 - reach : -25 + reach;
      const absClamped = clampNumber(Math.abs(hitX), 0.45, 10.6);
      return { x: side * absClamped, y: cy, z: cz };
    }
  }

  return { x: side * 1.6, y: preferY, z: clampedZ };
}

function measureKeel(
  volumes: ReturnType<typeof hullVolumes>,
  preferZ: number,
  bounds: { minZ: number; maxZ: number },
): KeelAnchor {
  const clampedZ = clampNumber(preferZ, bounds.minZ + 0.6, bounds.maxZ - 0.6);
  const midZ = (bounds.minZ + bounds.maxZ) * 0.5;

  for (const cz of [preferZ, clampedZ, midZ]) {
    const reach = hullReach(volumes, [0, 25, cz], [0, -1, 0]);
    if (reach !== null && Number.isFinite(reach)) {
      const hitY = clampNumber(25 - reach, -5.2, 0.2);
      return { y: hitY, z: cz };
    }
  }

  return { y: -1.1, z: clampedZ };
}

function measureDorsalUmbilical(
  volumes: ReturnType<typeof hullVolumes>,
  side: -1 | 1,
  preferX: number,
  preferZ: number,
  bounds: { minZ: number; maxZ: number },
): UmbilicalAnchor {
  const clampedZ = clampNumber(preferZ, bounds.minZ + 0.6, bounds.maxZ - 0.6);
  const midZ = (bounds.minZ + bounds.maxZ) * 0.5;
  const xTries = [side * preferX, side * 0.35, 0];

  for (const cz of [preferZ, clampedZ, midZ]) {
    for (const cx of xTries) {
      const reach = hullReach(volumes, [cx, -25, cz], [0, 1, 0]);
      if (reach !== null && Number.isFinite(reach)) {
        const hitY = clampNumber(-25 + reach, 0.2, 4.4);
        return { x: cx, y: hitY, z: cz };
      }
    }
  }

  return { x: side * 0.45, y: 1.0, z: clampedZ };
}

function measureHullDocking(
  architecture: Blueprint['architecture'],
  hullProfile: Blueprint['hullProfile'],
): HullDockingMeasurement {
  const volumes = hullVolumes(architecture, hullProfile);
  const rawBounds = hullBounds(volumes);
  const bounds = {
    minZ: Number.isFinite(rawBounds.minZ) ? rawBounds.minZ : -7.5,
    maxZ: Number.isFinite(rawBounds.maxZ) ? rawBounds.maxZ : 8.0,
  };
  const spec = ARCHETYPE_STATIONS[architecture];

  return {
    portAirlock: measureFlank(volumes, -1, spec.airlock[0], spec.airlock[1], bounds),
    stbdAirlock: measureFlank(volumes, 1, spec.airlock[0], spec.airlock[1], bounds),
    portClampFwd: measureFlank(volumes, -1, spec.clampFwd[0], spec.clampFwd[1], bounds),
    stbdClampFwd: measureFlank(volumes, 1, spec.clampFwd[0], spec.clampFwd[1], bounds),
    portClampAft: measureFlank(volumes, -1, spec.clampAft[0], spec.clampAft[1], bounds),
    stbdClampAft: measureFlank(volumes, 1, spec.clampAft[0], spec.clampAft[1], bounds),
    keelFwd: measureKeel(volumes, spec.keelFwdZ, bounds),
    keelAft: measureKeel(volumes, spec.keelAftZ, bounds),
    umbPortFwd: measureDorsalUmbilical(volumes, -1, spec.umbX, spec.umbFwdZ, bounds),
    umbStbdFwd: measureDorsalUmbilical(volumes, 1, spec.umbX, spec.umbFwdZ, bounds),
    umbPortAft: measureDorsalUmbilical(volumes, -1, spec.umbX, spec.umbAftZ, bounds),
    umbStbdAft: measureDorsalUmbilical(volumes, 1, spec.umbX, spec.umbAftZ, bounds),
  };
}

/* ------------------------------------------------------------------ */
/* Spacedock structural builder (open cross-braced space-frame)       */
/* ------------------------------------------------------------------ */

const GANTRY_X_INNER = 12.4;
const GANTRY_X_MID = 13.2;
const GANTRY_X_OUTER = 14.0;
const DECK_Y = -8.2;

function addTrussBay(
  chords: GeometryCollector,
  bracing: GeometryCollector,
  p00: readonly [number, number, number],
  p10: readonly [number, number, number],
  p01: readonly [number, number, number],
  p11: readonly [number, number, number],
  q00: readonly [number, number, number],
  q10: readonly [number, number, number],
  q01: readonly [number, number, number],
  q11: readonly [number, number, number],
  chordRadius: number,
  braceRadius: number,
): void {
  // Perimeter struts at start and end planes + 4 longitudinal/vertical rails
  chords.addStrut(p00, p10, chordRadius);
  chords.addStrut(p10, p11, chordRadius);
  chords.addStrut(p11, p01, chordRadius);
  chords.addStrut(p01, p00, chordRadius);

  chords.addStrut(q00, q10, chordRadius);
  chords.addStrut(q10, q11, chordRadius);
  chords.addStrut(q11, q01, chordRadius);
  chords.addStrut(q01, q00, chordRadius);

  chords.addStrut(p00, q00, chordRadius);
  chords.addStrut(p10, q10, chordRadius);
  chords.addStrut(p01, q01, chordRadius);
  chords.addStrut(p11, q11, chordRadius);

  // Diagonal X/Warren bracing across all four faces
  bracing.addStrut(p00, q10, braceRadius);
  bracing.addStrut(p10, q00, braceRadius);
  bracing.addStrut(p01, q11, braceRadius);
  bracing.addStrut(p11, q01, braceRadius);
  bracing.addStrut(p00, q01, braceRadius);
  bracing.addStrut(p10, q11, braceRadius);
}

interface StaticDockGeometries {
  darkSteel: BufferGeometry;
  galvTruss: BufferGeometry;
  hazardAmber: BufferGeometry;
  cryoWhite: BufferGeometry;
  piping: BufferGeometry;
  consoleGlow: BufferGeometry;
  amberTrim: BufferGeometry;
}

function buildStaticDockGeometries(): StaticDockGeometries {
  const dark = new GeometryCollector();
  const galv = new GeometryCollector();
  const hazard = new GeometryCollector();
  const cryo = new GeometryCollector();
  const pipe = new GeometryCollector();
  const consoleGlow = new GeometryCollector();
  const amber = new GeometryCollector();

  const towerBays: readonly { z0: number; z1: number; yTop: number; strobeZ: number }[] = [
    { z0: -15.4, z1: -12.6, yTop: 9.5, strobeZ: -15.0 },
    { z0: -6.4, z1: -2.8, yTop: 9.5, strobeZ: -6.0 },
    { z0: 1.6, z1: 3.6, yTop: 9.5, strobeZ: 3.0 },
    // Forward stepped bay stays below y=7.2 so top-left RC-3 sky stays clear
    { z0: 8.4, z1: 11.4, yTop: 7.1, strobeZ: 11.0 },
  ];

  for (const side of [-1, 1] as const) {
    const xi = side * GANTRY_X_INNER;
    const xm = side * GANTRY_X_MID;
    const xo = side * GANTRY_X_OUTER;

    // 4 multi-tier vertical gantry truss towers
    for (const bay of towerBays) {
      const tiers = bay.yTop > 8 ? 5 : 4;
      const stepY = (bay.yTop - DECK_Y) / tiers;
      for (let t = 0; t < tiers; t++) {
        const y0 = DECK_Y + t * stepY;
        const y1 = DECK_Y + (t + 1) * stepY;
        addTrussBay(
          dark,
          galv,
          [xi, y0, bay.z0],
          [xo, y0, bay.z0],
          [xi, y0, bay.z1],
          [xo, y0, bay.z1],
          [xi, y1, bay.z0],
          [xo, y1, bay.z0],
          [xi, y1, bay.z1],
          [xo, y1, bay.z1],
          0.11,
          0.06,
        );
      }
      // Strobe cap pedestal at exact bay strobe Z
      dark.addBox(0.95, 0.16, 0.95, [xm, bay.yTop, bay.strobeZ]);
      hazard.addBox(1.02, 0.08, 1.02, [xm, bay.yTop - 0.12, bay.strobeZ]);
    }

    // Searchlight structural bracket plates matching DrydockLighting SEARCHLIGHT_SPECS
    const searchlightAnchors: readonly [number, number][] = [
      [-2.5, -13.0],
      [8.8, -3.0],
      [6.2, 9.0],
    ];
    for (const [sy, sz] of searchlightAnchors) {
      dark.addBox(0.65, 0.34, 0.55, [xm, sy - 0.12, sz]);
      galv.addStrut([xi, sy - 0.65, sz], [xm, sy - 0.15, sz], 0.055);
    }

    // Upper longitudinal crane rail box girders (-15.4 -> +3.6) + diagonal haunch down to fwd bay (+8.4)
    const railZSlices = [-15.4, -12.6, -9.5, -6.4, -2.8, 0.0, 1.6, 3.6];
    for (let i = 0; i < railZSlices.length - 1; i++) {
      const za = railZSlices[i];
      const zb = railZSlices[i + 1];
      addTrussBay(
        dark,
        galv,
        [xi, 8.75, za],
        [xo, 8.75, za],
        [xi, 8.75, zb],
        [xo, 8.75, zb],
        [xi, 9.48, za],
        [xo, 9.48, za],
        [xi, 9.48, zb],
        [xo, 9.48, zb],
        0.095,
        0.052,
      );
    }
    // Crane rail I-beam track running inboard at x = ±12.4, y = 9.42
    dark.addBox(0.24, 0.18, 19.6, [xi, 9.42, -5.8]);
    hazard.addBox(0.32, 0.35, 0.25, [xi, 9.65, 3.5]);
    hazard.addBox(0.32, 0.35, 0.25, [xi, 9.65, -15.3]);

    // Sloped forward haunch transition (z=3.6, y=9.5 -> z=8.4, y=7.1)
    addTrussBay(
      dark,
      galv,
      [xi, 8.75, 3.6],
      [xo, 8.75, 3.6],
      [xi, 6.45, 8.4],
      [xo, 6.45, 8.4],
      [xi, 9.48, 3.6],
      [xo, 9.48, 3.6],
      [xi, 7.1, 8.4],
      [xo, 7.1, 8.4],
      0.095,
      0.052,
    );

    // Mid-height longitudinal spine & boarding catwalk (z=-15.4..+11.4, y=-0.4..+0.6)
    const midSlices = [-15.4, -12.6, -6.4, -2.8, 1.6, 3.6, 8.4, 11.4];
    for (let i = 0; i < midSlices.length - 1; i++) {
      const za = midSlices[i];
      const zb = midSlices[i + 1];
      addTrussBay(
        dark,
        galv,
        [xi, -0.5, za],
        [xo, -0.5, za],
        [xi, -0.5, zb],
        [xo, -0.5, zb],
        [xi, 0.5, za],
        [xo, 0.5, za],
        [xi, 0.5, zb],
        [xo, 0.5, zb],
        0.08,
        0.045,
      );
    }

    // Inboard engineering catwalk grating + safety amber handrail (x = side*11.75)
    const catX = side * 11.7;
    galv.addBox(1.15, 0.08, 25.6, [catX, -5.8, -2.0]);
    hazard.addBox(0.05, 0.05, 25.6, [side * 11.18, -5.0, -2.0]);
    for (let pz = -14; pz <= 10; pz += 3) {
      hazard.addCyl(0.03, 0.03, 0.82, 6, [side * 11.18, -5.39, pz]);
    }

    // Upper fueling manifold header & vertical cryo feed pipes at x = ±12.05, y = 5.4
    pipe.addCyl(0.14, 0.14, 19.0, 10, [side * 12.05, 5.4, -3.0], [Math.PI / 2, 0, 0]);
    pipe.addCyl(0.08, 0.08, 19.0, 8, [side * 12.15, 5.1, -3.0], [Math.PI / 2, 0, 0]);
    dark.addBox(0.45, 0.25, 0.35, [side * 12.25, 5.4, -12.0]);
    dark.addBox(0.45, 0.25, 0.35, [side * 12.25, 5.4, -4.0]);
    dark.addBox(0.45, 0.25, 0.35, [side * 12.25, 5.4, 4.0]);

    // Cryo-propellant sphere tank farm (3 spheres outboard at x = ±16.4, z = -13.5, -9.8, -6.1)
    const tankZs = [-13.5, -9.8, -6.1];
    const tankX = side * 16.4;
    for (const tz of tankZs) {
      cryo.addSphere(1.45, 16, 12, [tankX, -1.2, tz]);
      // Polar collar rings & cage struts connecting back to main tower
      dark.addTorus(1.49, 0.06, 6, 18, [tankX, -1.2, tz], [Math.PI / 2, 0, 0]);
      galv.addStrut([xo, 0.5, tz], [tankX - side * 1.4, 0.1, tz], 0.07);
      galv.addStrut([xo, -3.2, tz], [tankX - side * 1.4, -2.5, tz], 0.07);
      galv.addStrut([tankX, -2.65, tz], [tankX, 0.25, tz], 0.06);
      // Manifold pipe feeding from top of cryo sphere into fueling header
      pipe.addStrut([tankX, 0.25, tz], [tankX, 3.8, tz], 0.09, 8);
      pipe.addStrut([tankX, 3.8, tz], [side * 12.05, 5.4, tz], 0.09, 8);
    }
    // Outboard longitudinal tank farm cradle rail
    dark.addBox(0.28, 0.28, 9.6, [tankX, -3.0, -9.8]);
    hazard.addBox(0.22, 0.12, 9.6, [tankX + side * 1.5, -1.2, -9.8]);

    // Lower gantry keel-spine trusses (y=-8.2 -> -6.8) extending back to z=-24.5
    const lowerZSlices = [-24.5, -20.0, -15.4, -12.6, -6.4, -2.8, 1.6, 3.6, 8.4, 11.4];
    for (let i = 0; i < lowerZSlices.length - 1; i++) {
      const za = lowerZSlices[i];
      const zb = lowerZSlices[i + 1];
      addTrussBay(
        dark,
        galv,
        [xi, DECK_Y, za],
        [xo, DECK_Y, za],
        [xi, DECK_Y, zb],
        [xo, DECK_Y, zb],
        [xi, DECK_Y + 1.35, za],
        [xo, DECK_Y + 1.35, za],
        [xi, DECK_Y + 1.35, zb],
        [xo, DECK_Y + 1.35, zb],
        0.105,
        0.055,
      );
    }

    // Approach corridor outrigger pylons supporting DrydockLighting CORRIDOR_BEACONS
    // Beacons sit at x = ±10.5, y = -4.5 and y = 3.0, z = 14, 19, 24, 29
    const beaconX = side * 10.5;
    dark.addStrut([xi, DECK_Y + 0.5, 11.2], [beaconX, -6.2, 13.8], 0.09);
    dark.addStrut([xi, -4.0, 11.2], [beaconX, -4.5, 13.8], 0.07);
    dark.addStrut([beaconX - side * 0.22, -6.2, 13.8], [beaconX - side * 0.22, -6.2, 29.2], 0.08);
    dark.addStrut([beaconX + side * 0.22, -6.2, 13.8], [beaconX + side * 0.22, -6.2, 29.2], 0.08);
    for (const bz of [14, 19, 24, 29]) {
      const zA = bz - 0.18;
      const zB = bz + 0.18;
      dark.addStrut([beaconX, -6.2, zA], [beaconX, 3.15, zA], 0.055);
      dark.addStrut([beaconX, -6.2, zB], [beaconX, 3.15, zB], 0.055);
      galv.addStrut([beaconX, -6.0, zA], [beaconX, -4.5, zB], 0.038);
      galv.addStrut([beaconX, -4.5, zB], [beaconX, -2.0, zA], 0.038);
      galv.addStrut([beaconX, -2.0, zA], [beaconX, 0.5, zB], 0.038);
      galv.addStrut([beaconX, 0.5, zB], [beaconX, 3.0, zA], 0.038);
      // Beacon ring support collars
      galv.addBox(0.28, 0.18, 0.44, [beaconX, -4.5, bz]);
      galv.addBox(0.28, 0.18, 0.44, [beaconX, 3.0, bz]);
    }
  }

  // Two open overhead portal arches ONLY over aft/mid-aft bay (z=-15 and z=-6, y=10.6..11.6)
  // so [12, 16, 10] key light illuminates the ship unobstructed (passes RC-3)
  for (const archZ of [-15.0, -6.0]) {
    const segs = 8;
    const xMin = -GANTRY_X_MID;
    const xMax = GANTRY_X_MID;
    for (let i = 0; i < segs; i++) {
      const t0 = i / segs;
      const t1 = (i + 1) / segs;
      const x0 = xMin + (xMax - xMin) * t0;
      const x1 = xMin + (xMax - xMin) * t1;
      const archLift0 = Math.sin(t0 * Math.PI) * 1.4;
      const archLift1 = Math.sin(t1 * Math.PI) * 1.4;
      const y0Bot = 9.5 + archLift0;
      const y1Bot = 9.5 + archLift1;
      const y0Top = y0Bot + 1.05;
      const y1Top = y1Bot + 1.05;
      addTrussBay(
        dark,
        galv,
        [x0, y0Bot, archZ - 0.55],
        [x0, y0Bot, archZ + 0.55],
        [x0, y0Top, archZ - 0.55],
        [x0, y0Top, archZ + 0.55],
        [x1, y1Bot, archZ - 0.55],
        [x1, y1Bot, archZ + 0.55],
        [x1, y1Top, archZ - 0.55],
        [x1, y1Top, archZ + 0.55],
        0.09,
        0.048,
      );
    }
  }

  // Lower slipway deck structural grid & central twin keel-clamp slide rails (y = -8.2)
  const deckCrossZs = [-24.0, -19.5, -15.0, -10.0, -5.0, 0.0, 5.0, 10.0];
  for (const dz of deckCrossZs) {
    dark.addStrut([-GANTRY_X_INNER, DECK_Y + 0.35, dz], [GANTRY_X_INNER, DECK_Y + 0.35, dz], 0.11);
    galv.addStrut([-GANTRY_X_INNER, DECK_Y + 0.9, dz - 0.4], [GANTRY_X_INNER, DECK_Y + 0.35, dz + 0.4], 0.055);
  }
  // Twin longitudinal keel-clamp slide tracks under ship centerline
  for (const kx of [-0.72, 0.72]) {
    dark.addBox(0.28, 0.36, 17.5, [kx, DECK_Y + 0.18, -0.5]);
    hazard.addBox(0.32, 0.08, 17.5, [kx, DECK_Y + 0.38, -0.5]);
  }
  // Recessed centerline guide dashes (soft tone-mapped cyan, clear of hero top-left)
  for (let gz = -7; gz <= 9; gz += 2.0) {
    consoleGlow.addBox(0.18, 0.04, 0.9, [0, DECK_Y + 0.25, gz]);
    amber.addBox(0.08, 0.04, 0.75, [-2.4, DECK_Y + 0.25, gz]);
    amber.addBox(0.08, 0.04, 0.75, [2.4, DECK_Y + 0.25, gz]);
  }

  // Aft Flanged Bulkhead Gate Ring at z = -17.2 (frames the aft shipyard hub cleanly)
  const gateSides = 8;
  const gateRadius = 13.8;
  for (let s = 0; s < gateSides; s++) {
    const a0 = (s / gateSides) * Math.PI * 2 + Math.PI / 8;
    const a1 = ((s + 1) / gateSides) * Math.PI * 2 + Math.PI / 8;
    const p0: readonly [number, number, number] = [Math.cos(a0) * gateRadius, Math.sin(a0) * gateRadius + 1.0, -17.2];
    const p1: readonly [number, number, number] = [Math.cos(a1) * gateRadius, Math.sin(a1) * gateRadius + 1.0, -17.2];
    const q0: readonly [number, number, number] = [Math.cos(a0) * (gateRadius - 1.1), Math.sin(a0) * (gateRadius - 1.1) + 1.0, -18.0];
    const q1: readonly [number, number, number] = [Math.cos(a1) * (gateRadius - 1.1), Math.sin(a1) * (gateRadius - 1.1) + 1.0, -18.0];
    dark.addStrut(p0, p1, 0.16, 8);
    dark.addStrut(q0, q1, 0.14, 8);
    galv.addStrut(p0, q0, 0.08);
    galv.addStrut(p0, q1, 0.06);
  }

  // Aft Pressurized Service Core & centrifuge hub spine (z = -18.5 .. -26.0, centered y = 2.2)
  cryo.addCyl(2.2, 2.5, 7.6, 16, [0, 2.2, -22.2], [Math.PI / 2, 0, 0]);
  dark.addTorus(2.58, 0.16, 8, 24, [0, 2.2, -19.2]);
  dark.addTorus(2.42, 0.16, 8, 24, [0, 2.2, -22.2]);
  dark.addTorus(2.58, 0.16, 8, 24, [0, 2.2, -25.2]);
  // Radial support struts anchoring service core to lower slipway & aft bulkhead ring
  galv.addStrut([-2.1, 0.4, -20.5], [-GANTRY_X_INNER, DECK_Y + 0.8, -19.5], 0.12);
  galv.addStrut([2.1, 0.4, -20.5], [GANTRY_X_INNER, DECK_Y + 0.8, -19.5], 0.12);
  galv.addStrut([0, -0.2, -22.2], [0, DECK_Y + 0.4, -22.2], 0.16);
  for (let w = 0; w < 6; w++) {
    const wa = (w / 6) * Math.PI * 2;
    consoleGlow.addBox(0.32, 0.16, 0.55, [Math.cos(wa) * 2.38, 2.2 + Math.sin(wa) * 2.38, -20.6]);
  }

  // Elevated Starboard Air Traffic / Berth Operations Control Bridge (x = +13.6, y = 9.3, z = -6.0)
  // Stays on starboard (+X) side, away from hero camera top-left RC-3 region
  dark.addBox(2.9, 1.55, 4.4, [13.5, 9.65, -5.8]);
  cryo.addBox(2.45, 0.55, 3.8, [13.4, 8.65, -5.8]);
  galv.addBox(3.15, 0.14, 4.65, [13.5, 10.48, -5.8]);
  // Slanted observation deck window glow facing inboard toward berth
  consoleGlow.addBox(0.14, 0.65, 3.6, [12.02, 9.75, -5.8]);
  consoleGlow.addBox(2.0, 0.48, 0.14, [13.4, 9.75, -3.56]);
  hazard.addBox(0.18, 0.12, 4.4, [12.02, 9.25, -5.8]);
  // Comms mast beside ATC radar pedestal
  galv.addCyl(0.06, 0.1, 1.6, 8, [14.3, 11.3, -7.2]);

  return {
    darkSteel: dark.build(),
    galvTruss: galv.build(),
    hazardAmber: hazard.build(),
    cryoWhite: cryo.build(),
    piping: pipe.build(),
    consoleGlow: consoleGlow.build(),
    amberTrim: amber.build(),
  };
}

/* ------------------------------------------------------------------ */
/* Active spacedock sub-geometries (centrifuge, cranes, clamps, etc)  */
/* ------------------------------------------------------------------ */

function buildCentrifugeGeometries(): { frame: BufferGeometry; windows: BufferGeometry } {
  const frame = new GeometryCollector();
  const windows = new GeometryCollector();
  const ringR = 8.4;

  // Main dual-ring pressure rim
  frame.addTorus(ringR, 0.44, 10, 42, [0, 0, -0.35]);
  frame.addTorus(ringR, 0.44, 10, 42, [0, 0, 0.35]);
  // Inner bearing collar
  frame.addTorus(2.85, 0.24, 8, 24, [0, 0, 0]);

  const spokeCount = 6;
  for (let i = 0; i < spokeCount; i++) {
    const a = (i / spokeCount) * Math.PI * 2;
    const ca = Math.cos(a);
    const sa = Math.sin(a);
    // Twin spoke truss chords
    frame.addStrut([ca * 2.85, sa * 2.85, -0.3], [ca * (ringR - 0.3), sa * (ringR - 0.3), -0.3], 0.11, 6);
    frame.addStrut([ca * 2.85, sa * 2.85, 0.3], [ca * (ringR - 0.3), sa * (ringR - 0.3), 0.3], 0.11, 6);
    // Outward habitation pod around the ring
    const podA = a + Math.PI / spokeCount;
    const pc = Math.cos(podA);
    const ps = Math.sin(podA);
    frame.addBox(1.55, 1.15, 1.55, [pc * ringR, ps * ringR, 0], [0, 0, podA]);
    windows.addBox(0.32, 0.72, 1.62, [pc * (ringR - 0.48), ps * (ringR - 0.48), 0], [0, 0, podA]);
  }

  return { frame: frame.build(), windows: windows.build() };
}

function buildCraneGeometries(): { bridge: BufferGeometry; trolley: BufferGeometry } {
  const bridge = new GeometryCollector();
  const trolley = new GeometryCollector();
  const span = GANTRY_X_INNER * 2 - 0.15;

  // Open Warren double-girder bridge spanning x = -12.3 .. +12.3
  bridge.addBox(span, 0.16, 0.16, [0, 0.35, -0.42]);
  bridge.addBox(span, 0.16, 0.16, [0, 0.35, 0.42]);
  bridge.addBox(span, 0.16, 0.16, [0, -0.25, -0.42]);
  bridge.addBox(span, 0.16, 0.16, [0, -0.25, 0.42]);

  const bays = 10;
  for (let i = 0; i < bays; i++) {
    const x0 = -span * 0.5 + (i / bays) * span;
    const x1 = -span * 0.5 + ((i + 1) / bays) * span;
    bridge.addStrut([x0, -0.25, -0.42], [x1, 0.35, -0.42], 0.045);
    bridge.addStrut([x1, -0.25, -0.42], [x0, 0.35, -0.42], 0.045);
    bridge.addStrut([x0, -0.25, 0.42], [x1, 0.35, 0.42], 0.045);
    bridge.addStrut([x1, -0.25, 0.42], [x0, 0.35, 0.42], 0.045);
    bridge.addStrut([x0, 0.35, -0.42], [x0, 0.35, 0.42], 0.045);
  }
  // End bogie trucks riding the upper gantry crane rails
  bridge.addBox(0.55, 0.55, 1.85, [-span * 0.5, 0.08, 0]);
  bridge.addBox(0.55, 0.55, 1.85, [span * 0.5, 0.08, 0]);

  // Traversing trolley + downward articulated welding boom
  trolley.addBox(1.35, 0.42, 1.15, [0, 0.05, 0]);
  trolley.addCyl(0.24, 0.2, 0.85, 10, [0, -0.5, 0]);
  trolley.addStrut([0, -0.85, 0], [0.22, -2.05, 0.18], 0.09, 8);
  trolley.addStrut([0.22, -2.05, 0.18], [0, -3.15, 0], 0.065, 8);
  trolley.addCyl(0.08, 0.03, 0.35, 8, [0, -3.35, 0]);

  return { bridge: bridge.build(), trolley: trolley.build() };
}

function buildProngGeometries(): {
  armUnit: BufferGeometry;
  upperJaw: BufferGeometry;
  lowerJaw: BufferGeometry;
} {
  // Unit-length (1.0 in X from -0.5 to +0.5) telescoping truss boom
  const arm = new GeometryCollector();
  for (const y of [-0.14, 0.14]) {
    for (const z of [-0.16, 0.16]) {
      arm.addBox(1.0, 0.055, 0.055, [0, y, z]);
    }
  }
  arm.addBox(1.0, 0.12, 0.12, [0, 0, 0]);
  arm.addStrut([-0.45, -0.14, 0.16], [0, 0.14, 0.16], 0.035);
  arm.addStrut([0, 0.14, 0.16], [0.45, -0.14, 0.16], 0.035);
  arm.addStrut([-0.45, -0.14, -0.16], [0, 0.14, -0.16], 0.035);
  arm.addStrut([0, 0.14, -0.16], [0.45, -0.14, -0.16], 0.035);

  // Articulated upper jaw pivoted at [0, 0, 0], reaching forward (+X = +0.26) onto hull skin
  // When wristGroup is at [wristX, y, z] and jaw pivot is at [-0.26, +0.24, 0], pad front face sits at x=0!
  const up = new GeometryCollector();
  up.addCyl(0.11, 0.11, 0.42, 8, [0, 0, 0], [Math.PI / 2, 0, 0]);
  up.addBox(0.28, 0.14, 0.34, [0.12, -0.06, 0], [0, 0, -0.25]);
  // Hydraulic gripper pad seating flush at local x = +0.26 (center 0.22 + half-width 0.04)
  up.addBox(0.08, 0.24, 0.42, [0.22, -0.14, 0]);

  const lo = new GeometryCollector();
  lo.addCyl(0.11, 0.11, 0.42, 8, [0, 0, 0], [Math.PI / 2, 0, 0]);
  lo.addBox(0.28, 0.14, 0.34, [0.12, 0.06, 0], [0, 0, 0.25]);
  lo.addBox(0.08, 0.24, 0.42, [0.22, 0.14, 0]);

  return { armUnit: arm.build(), upperJaw: up.build(), lowerJaw: lo.build() };
}

function buildKeelClampGeometries(): {
  stemUnit: BufferGeometry;
  cradleBase: BufferGeometry;
  chock: BufferGeometry;
} {
  // Unit height (1.0 along Y from -0.5 to +0.5) telescoping keel scissor pedestal
  const stem = new GeometryCollector();
  stem.addCyl(0.2, 0.24, 1.0, 10, [0, 0, 0]);
  stem.addStrut([-0.38, -0.5, 0], [0.38, 0.5, 0], 0.045);
  stem.addStrut([0.38, -0.5, 0], [-0.38, 0.5, 0], 0.045);

  const cradle = new GeometryCollector();
  cradle.addBox(0.95, 0.22, 0.85, [0, -0.14, 0]);
  cradle.addBox(0.65, 0.1, 0.65, [0, -0.02, 0]);

  // Hinged side chock gripping keel from ±X
  const chock = new GeometryCollector();
  chock.addBox(0.18, 0.32, 0.72, [0, 0.12, 0], [0, 0, 0.22]);

  return {
    stemUnit: stem.build(),
    cradleBase: cradle.build(),
    chock: chock.build(),
  };
}

function buildDockingTunnelGeometries(): {
  vestibule: BufferGeometry;
  bellowsUnit: BufferGeometry;
  bellowsSlits: BufferGeometry;
  collarSteel: BufferGeometry;
  collarHazard: BufferGeometry;
} {
  // Authored in canonical gantry-at-negative-X frame:
  // Vestibule anchors cleanly into gantry column at x = -13.2..-11.35; bellows expands rightward along +X
  const vest = new GeometryCollector();
  vest.addCyl(1.05, 1.15, 1.35, 14, [-12.05, 0, 0], [0, 0, Math.PI / 2]);
  vest.addBox(1.85, 2.2, 2.1, [-12.6, 0, 0]);
  vest.addStrut([-13.2, -1.6, -0.9], [-12.2, -0.9, -0.9], 0.08);
  vest.addStrut([-13.2, -1.6, 0.9], [-12.2, -0.9, 0.9], 0.08);
  vest.addStrut([-13.2, 1.6, -0.9], [-12.2, 0.9, -0.9], 0.08);
  vest.addStrut([-13.2, 1.6, 0.9], [-12.2, 0.9, 0.9], 0.08);
  vest.addTorus(1.02, 0.1, 8, 20, [-11.38, 0, 0], [0, Math.PI / 2, 0]);

  // Unit-length (1.0 in X from -0.5 to +0.5) ribbed accordion tunnel + overhead truss bridge
  const bellows = new GeometryCollector();
  const slits = new GeometryCollector();
  bellows.addCyl(0.68, 0.68, 1.0, 14, [0, 0, 0], [0, 0, Math.PI / 2]);
  const ribs = 11;
  for (let i = 0; i < ribs; i++) {
    const rx = -0.45 + (i / (ribs - 1)) * 0.9;
    bellows.addTorus(0.71, 0.042, 6, 18, [rx, 0, 0], [0, Math.PI / 2, 0]);
  }
  // Overhead structural bridge chords & lit crew gangway slit windows
  bellows.addBox(1.0, 0.08, 0.95, [0, 0.88, 0]);
  bellows.addBox(1.0, 0.06, 0.85, [0, -0.78, 0]);
  slits.addBox(0.86, 0.12, 1.4, [0, 0.15, 0]);

  // Unscaled ship-facing circular airlock collar (back at x = -0.30, mating seal face at x = 0)
  const collarSteel = new GeometryCollector();
  const collarHazard = new GeometryCollector();
  collarSteel.addCyl(0.88, 0.84, 0.3, 18, [-0.15, 0, 0], [0, 0, Math.PI / 2]);
  collarSteel.addTorus(0.88, 0.09, 8, 24, [-0.04, 0, 0], [0, Math.PI / 2, 0]);
  collarHazard.addTorus(0.79, 0.045, 6, 20, [-0.01, 0, 0], [0, Math.PI / 2, 0]);
  for (let d = 0; d < 6; d++) {
    const da = (d / 6) * Math.PI * 2;
    collarHazard.addBox(0.18, 0.12, 0.12, [-0.12, Math.cos(da) * 0.9, Math.sin(da) * 0.9]);
  }

  return {
    vestibule: vest.build(),
    bellowsUnit: bellows.build(),
    bellowsSlits: slits.build(),
    collarSteel: collarSteel.build(),
    collarHazard: collarHazard.build(),
  };
}

interface UmbilicalBuildResult {
  hoseGeo: BufferGeometry;
  couplerGeo: BufferGeometry;
  reelGeo: BufferGeometry;
}

const UMB_REEL_X = 12.05;
const UMB_REEL_Y = 5.4;

function buildCatenaryUmbilical(
  side: -1 | 1,
  target: UmbilicalAnchor,
  zBias: number,
): UmbilicalBuildResult {
  const reelX = side * UMB_REEL_X;
  const endX = target.x - reelX;
  const endY = target.y - UMB_REEL_Y;

  const pts = [
    new Vector3(0, -0.25, 0),
    new Vector3(endX * 0.16, endY * 0.35 - 1.35, 0.12 * zBias),
    new Vector3(endX * 0.4, endY * 0.6 - 1.45, 0.2 * zBias),
    new Vector3(endX * 0.68, endY * 0.72 - 0.35, 0.12 * zBias),
    new Vector3(endX * 0.9, endY + 0.55, 0),
    new Vector3(endX, endY, 0),
  ];
  const curve = new CatmullRomCurve3(pts);
  const hoseGeo = new TubeGeometry(curve, 28, 0.085, 8, false);

  // Merge strain-relief hose bands + ship-side quick-disconnect coupling nozzle
  const coupler = new GeometryCollector();
  for (const t of [0.18, 0.42, 0.66, 0.88]) {
    const p = curve.getPointAt(t);
    coupler.addSphere(0.115, 8, 6, [p.x, p.y, p.z]);
  }
  // Nozzle shroud seated cleanly at local [endX, endY, 0] on dorsal hull skin
  coupler.addCyl(0.14, 0.21, 0.26, 10, [endX, endY + 0.11, 0]);
  coupler.addTorus(0.22, 0.035, 6, 14, [endX, endY + 0.02, 0], [Math.PI / 2, 0, 0]);

  const reel = new GeometryCollector();
  reel.addCyl(0.36, 0.36, 0.52, 12, [0, 0, 0], [Math.PI / 2, 0, 0]);
  reel.addTorus(0.42, 0.05, 6, 14, [0, 0, -0.24]);
  reel.addTorus(0.42, 0.05, 6, 14, [0, 0, 0.24]);

  return {
    hoseGeo,
    couplerGeo: coupler.build(),
    reelGeo: reel.build(),
  };
}

/* ------------------------------------------------------------------ */
/* Coordinated docking engagement curve                               */
/* ------------------------------------------------------------------ */

function smoothstep01(t: number): number {
  const c = clampNumber(t, 0, 1);
  return c * c * (3 - 2 * c);
}

function targetEngagement(
  missionState: MissionState | null | undefined,
  missionProgress: number,
  dockingConnected = true,
): number {
  if (!dockingConnected) {
    return 0.0;
  }
  if (!missionState || missionState === 'docked' || missionState === 'repair') {
    return 1.0;
  }
  if (missionState === 'departing') {
    return smoothstep01((0.32 - missionProgress) / 0.32);
  }
  if (missionState === 'return_transit') {
    return smoothstep01((missionProgress - 0.72) / 0.28);
  }
  return 0.0;
}

/* ------------------------------------------------------------------ */
/* Main Spacedock Component                                           */
/* ------------------------------------------------------------------ */

const SPARK_COUNT = 24;

export function DrydockStation({
  intensity = 1,
  blueprint,
  missionState = null,
  missionProgress = 0,
  dockingConnected = true,
}: DrydockStationProps): JSX.Element {
  const reducedMotion = useReducedMotion();
  const activeBlueprint = blueprint ?? SHIP_PRESETS[0];

  // Static spacedock structure geometries (built once)
  const dockGeo = useMemo(() => buildStaticDockGeometries(), []);
  const centGeo = useMemo(() => buildCentrifugeGeometries(), []);
  const craneGeo = useMemo(() => buildCraneGeometries(), []);
  const prongGeo = useMemo(() => buildProngGeometries(), []);
  const keelGeo = useMemo(() => buildKeelClampGeometries(), []);
  const tunnelGeo = useMemo(() => buildDockingTunnelGeometries(), []);

  useEffect(() => {
    return () => {
      Object.values(dockGeo).forEach((g) => g.dispose());
      centGeo.frame.dispose();
      centGeo.windows.dispose();
      craneGeo.bridge.dispose();
      craneGeo.trolley.dispose();
      prongGeo.armUnit.dispose();
      prongGeo.upperJaw.dispose();
      prongGeo.lowerJaw.dispose();
      keelGeo.stemUnit.dispose();
      keelGeo.cradleBase.dispose();
      keelGeo.chock.dispose();
      tunnelGeo.vestibule.dispose();
      tunnelGeo.bellowsUnit.dispose();
      tunnelGeo.bellowsSlits.dispose();
      tunnelGeo.collarSteel.dispose();
      tunnelGeo.collarHazard.dispose();
    };
  }, [dockGeo, centGeo, craneGeo, prongGeo, keelGeo, tunnelGeo]);

  // Dynamic hull measurements keyed ONLY on architecture & hullProfile
  // (avoids 10Hz rebuilds when blueprint.condition updates during missions)
  const measurement = useMemo(
    () => measureHullDocking(activeBlueprint.architecture, activeBlueprint.hullProfile),
    [activeBlueprint.architecture, activeBlueprint.hullProfile],
  );

  const umbBuilt = useMemo(
    () => ({
      portFwd: buildCatenaryUmbilical(-1, measurement.umbPortFwd, 0.8),
      stbdFwd: buildCatenaryUmbilical(1, measurement.umbStbdFwd, -0.8),
      portAft: buildCatenaryUmbilical(-1, measurement.umbPortAft, -0.7),
      stbdAft: buildCatenaryUmbilical(1, measurement.umbStbdAft, 0.7),
    }),
    [measurement],
  );

  useEffect(() => {
    return () => {
      for (const u of Object.values(umbBuilt)) {
        u.hoseGeo.dispose();
        u.couplerGeo.dispose();
        u.reelGeo.dispose();
      }
    };
  }, [umbBuilt]);

  // Kinematic refs
  const engagedRef = useRef<number>(
    targetEngagement(missionState, missionProgress, dockingConnected),
  );
  const centrifugeRef = useRef<Group>(null);
  const radarRef = useRef<Group>(null);
  const craneFwdRef = useRef<Group>(null);
  const craneFwdTrolleyRef = useRef<Group>(null);
  const craneAftRef = useRef<Group>(null);
  const craneAftTrolleyRef = useRef<Group>(null);
  const sparksRef = useRef<InstancedMesh>(null);
  const sparkDummy = useMemo(() => new Object3D(), []);

  // 4 lateral holding prong refs: [arm, wrist, upperJaw, lowerJaw]
  const prongRefs = useRef<
    Array<{
      arm: Group | null;
      wrist: Group | null;
      upperJaw: Group | null;
      lowerJaw: Group | null;
    }>
  >([
    { arm: null, wrist: null, upperJaw: null, lowerJaw: null },
    { arm: null, wrist: null, upperJaw: null, lowerJaw: null },
    { arm: null, wrist: null, upperJaw: null, lowerJaw: null },
    { arm: null, wrist: null, upperJaw: null, lowerJaw: null },
  ]);

  // 2 keel clamp refs: [stem, head, leftChock, rightChock]
  const keelRefs = useRef<
    Array<{
      stem: Group | null;
      head: Group | null;
      leftChock: Group | null;
      rightChock: Group | null;
    }>
  >([
    { stem: null, head: null, leftChock: null, rightChock: null },
    { stem: null, head: null, leftChock: null, rightChock: null },
  ]);

  // 2 docking tunnel refs: [bellows, collar]
  const tunnelRefs = useRef<
    Array<{
      bellows: Group | null;
      collar: Group | null;
    }>
  >([
    { bellows: null, collar: null },
    { bellows: null, collar: null },
  ]);

  // 4 catenary umbilical hose pivot refs
  const umbRefs = useRef<Array<Group | null>>([null, null, null, null]);

  const prongSpecs = useMemo(
    () => [
      { id: 'prong-port-fwd', side: -1 as const, anchor: measurement.portClampFwd },
      { id: 'prong-stbd-fwd', side: 1 as const, anchor: measurement.stbdClampFwd },
      { id: 'prong-port-aft', side: -1 as const, anchor: measurement.portClampAft },
      { id: 'prong-stbd-aft', side: 1 as const, anchor: measurement.stbdClampAft },
    ],
    [measurement],
  );

  const keelSpecs = useMemo(
    () => [
      { id: 'keel-fwd', anchor: measurement.keelFwd },
      { id: 'keel-aft', anchor: measurement.keelAft },
    ],
    [measurement],
  );

  const tunnelSpecs = useMemo(
    () => [
      { id: 'tunnel-port', side: -1 as const, anchor: measurement.portAirlock },
      { id: 'tunnel-stbd', side: 1 as const, anchor: measurement.stbdAirlock },
    ],
    [measurement],
  );

  const umbSpecs = useMemo(
    () => [
      { id: 'umb-port-fwd', side: -1 as const, anchor: measurement.umbPortFwd, built: umbBuilt.portFwd },
      { id: 'umb-stbd-fwd', side: 1 as const, anchor: measurement.umbStbdFwd, built: umbBuilt.stbdFwd },
      { id: 'umb-port-aft', side: -1 as const, anchor: measurement.umbPortAft, built: umbBuilt.portAft },
      { id: 'umb-stbd-aft', side: 1 as const, anchor: measurement.umbStbdAft, built: umbBuilt.stbdAft },
    ],
    [measurement, umbBuilt],
  );

  // Helper that applies exact mechanical poses for a given engagement scalar (0..1)
  const applyEngagementPoses = useMemo(
    () => (eng: number, elapsedTime: number, animateSparks: boolean) => {
      // Split kinematic timing slightly: jaws release/clamp slightly ahead of translation
      const slideT = smoothstep01(eng);
      const jawOpen = 1 - smoothstep01((eng - 0.55) / 0.45);
      const openAngle = jawOpen * 0.55;

      // 1. Articulated Lateral Holding Prongs
      prongSpecs.forEach((spec, idx) => {
        const refs = prongRefs.current[idx];
        if (!refs) return;
        const anchorX = spec.side * 12.6;
        const absEngaged = Math.abs(spec.anchor.x);
        const absRetracted = clampNumber(Math.max(absEngaged + 1.8, 11.75), 4.0, 11.88);
        const wristX = spec.side * (absRetracted + (absEngaged - absRetracted) * slideT);

        if (refs.wrist) {
          refs.wrist.position.set(wristX, spec.anchor.y, spec.anchor.z);
        }
        if (refs.upperJaw) {
          refs.upperJaw.rotation.z = openAngle;
        }
        if (refs.lowerJaw) {
          refs.lowerJaw.rotation.z = -openAngle;
        }
        if (refs.arm) {
          // Arm connects gantry anchorX to jaw hinge point inside wrist
          const hingeWorldX = wristX + spec.side * 0.26;
          const span = Math.max(0.45, Math.abs(anchorX - hingeWorldX));
          refs.arm.position.set((anchorX + hingeWorldX) * 0.5, spec.anchor.y, spec.anchor.z);
          refs.arm.scale.set(span, 1, 1);
        }
      });

      // 2. Ventral Magnetic Keel Clamps
      keelSpecs.forEach((spec, idx) => {
        const refs = keelRefs.current[idx];
        if (!refs) return;
        const baseY = DECK_Y + 0.3;
        const retractedY = Math.min(spec.anchor.y - 1.5, -7.25);
        const headY = retractedY + (spec.anchor.y - retractedY) * slideT;

        if (refs.head) {
          refs.head.position.set(0, headY, spec.anchor.z);
        }
        if (refs.leftChock) {
          refs.leftChock.position.x = -0.34 - jawOpen * 0.24;
          refs.leftChock.rotation.z = jawOpen * 0.35;
        }
        if (refs.rightChock) {
          refs.rightChock.position.x = 0.34 + jawOpen * 0.24;
          refs.rightChock.rotation.z = -jawOpen * 0.35;
        }
        if (refs.stem) {
          const topY = headY - 0.14;
          const h = Math.max(0.35, topY - baseY);
          refs.stem.position.set(0, (baseY + topY) * 0.5, spec.anchor.z);
          refs.stem.scale.set(1, h, 1);
        }
      });

      // 3. Extendable Pressurized Docking Tunnels
      tunnelSpecs.forEach((spec, idx) => {
        const refs = tunnelRefs.current[idx];
        if (!refs) return;
        const engagedDist = Math.abs(spec.anchor.x);
        const retractedDist = 10.98;
        const tipLocalX = -(retractedDist + (engagedDist - retractedDist) * slideT);
        const bellowsStart = -11.38;
        const collarBack = tipLocalX - 0.28;
        const bellowsLen = Math.max(0.08, collarBack - bellowsStart);

        if (refs.bellows) {
          refs.bellows.position.set(bellowsStart + bellowsLen * 0.5, 0, 0);
          refs.bellows.scale.set(bellowsLen, 1, 1);
        }
        if (refs.collar) {
          refs.collar.position.set(tipLocalX, 0, 0);
        }
      });

      // 4. Catenary Cryo/Power Umbilical Hoses
      umbSpecs.forEach((spec, idx) => {
        const g = umbRefs.current[idx];
        if (!g) return;
        const detachT = 1 - slideT;
        g.rotation.z = spec.side * (-detachT * 0.58);
        const s = 1 - 0.68 * detachT;
        g.scale.setScalar(s);
      });

      // 5. Overhead Crane Bridges & Welding Sparks (smooth rail travel during undocking)
      const craneSlide = smoothstep01((slideT - 0.1) / 0.6);
      const workFwdZ = 0.85 + (animateSparks ? Math.sin(elapsedTime * 0.16) * 1.95 : 0);
      const workAftZ = -7.6 + (animateSparks ? Math.cos(elapsedTime * 0.14) * 2.1 : 0);
      const workFwdX = animateSparks ? Math.sin(elapsedTime * 0.34) * 2.8 : 2.1;
      const workAftX = animateSparks ? Math.cos(elapsedTime * 0.28) * 3.1 : -2.6;

      const fwdZ = -11.0 + (workFwdZ - -11.0) * craneSlide;
      const aftZ = -14.2 + (workAftZ - -14.2) * craneSlide;
      const fwdX = 4.2 + (workFwdX - 4.2) * craneSlide;
      const aftX = -4.2 + (workAftX - -4.2) * craneSlide;

      if (craneFwdRef.current) craneFwdRef.current.position.set(0, 9.48, fwdZ);
      if (craneFwdTrolleyRef.current) craneFwdTrolleyRef.current.position.set(fwdX, 0, 0);
      if (craneAftRef.current) craneAftRef.current.position.set(0, 9.48, aftZ);
      if (craneAftTrolleyRef.current) craneAftTrolleyRef.current.position.set(aftX, 0, 0);

      if (sparksRef.current) {
        const showSparks = animateSparks && eng > 0.85;
        sparksRef.current.visible = showSparks;
        if (showSparks) {
          const tipX = fwdX;
          const tipY = 9.48 - 3.38;
          const tipZ = fwdZ;
          for (let i = 0; i < SPARK_COUNT; i++) {
            const life = (elapsedTime * 2.4 + i * 0.19) % 1;
            const spreadA = i * 2.39996;
            const vx = Math.cos(spreadA) * (0.4 + (i % 5) * 0.14);
            const vz = Math.sin(spreadA) * (0.4 + (i % 3) * 0.16);
            const vy = 0.25 - life * 1.45;
            const px = tipX + vx * life;
            const py = tipY + vy * life;
            const pz = tipZ + vz * life;
            const sc = (1 - life) * 0.9;
            sparkDummy.position.set(px, py, pz);
            sparkDummy.rotation.set(spreadA, life * 4, 0);
            sparkDummy.scale.set(sc, sc * 2.1, sc);
            sparkDummy.updateMatrix();
            sparksRef.current.setMatrixAt(i, sparkDummy.matrix);
          }
          sparksRef.current.instanceMatrix.needsUpdate = true;
        }
      }
    },
    [prongSpecs, keelSpecs, tunnelSpecs, umbSpecs, sparkDummy],
  );

  // Set deterministic initial/reducedMotion poses and configure spark buffer usage
  useEffect(() => {
    if (sparksRef.current) {
      sparksRef.current.instanceMatrix.setUsage(DynamicDrawUsage);
    }
    const target = targetEngagement(missionState, missionProgress, dockingConnected);
    if (reducedMotion) {
      engagedRef.current = target;
      if (centrifugeRef.current) centrifugeRef.current.rotation.z = 0.35;
      if (radarRef.current) radarRef.current.rotation.y = 0.65;
      applyEngagementPoses(target, 0, false);
    } else {
      applyEngagementPoses(engagedRef.current, 0, false);
    }
  }, [reducedMotion, missionState, missionProgress, dockingConnected, applyEngagementPoses]);

  useFrame((state, delta) => {
    const dt = Math.min(delta, 0.1);
    const target = targetEngagement(missionState, missionProgress, dockingConnected);

    if (reducedMotion) {
      if (engagedRef.current !== target) {
        engagedRef.current = target;
        applyEngagementPoses(target, 0, false);
      }
      return;
    }

    // Smooth hydraulic convergence toward target docking state
    const blend = 1 - Math.exp(-5.5 * dt);
    engagedRef.current += (target - engagedRef.current) * blend;
    if (Math.abs(target - engagedRef.current) < 0.001) {
      engagedRef.current = target;
    }

    if (centrifugeRef.current) {
      centrifugeRef.current.rotation.z += dt * 0.12;
    }
    if (radarRef.current) {
      radarRef.current.rotation.y += dt * 0.65;
    }

    applyEngagementPoses(engagedRef.current, state.clock.elapsedTime, true);
  });

  return (
    <>
      <DrydockLighting
        intensity={intensity}
        missionState={missionState}
        missionProgress={missionProgress}
      />

      {/* Group 1: Static Spacedock Cross-Braced Architecture (7 merged meshes) */}
      <group name="drydock-structure">
        <mesh geometry={dockGeo.darkSteel} castShadow={false} receiveShadow>
          <meshStandardMaterial color="#1e293b" metalness={0.78} roughness={0.42} />
        </mesh>
        <mesh geometry={dockGeo.galvTruss} castShadow={false} receiveShadow>
          <meshStandardMaterial color="#475569" metalness={0.72} roughness={0.36} />
        </mesh>
        <mesh geometry={dockGeo.hazardAmber} castShadow={false}>
          <meshStandardMaterial color="#d97706" metalness={0.35} roughness={0.55} />
        </mesh>
        <mesh geometry={dockGeo.cryoWhite} castShadow={false} receiveShadow>
          <meshStandardMaterial color="#cbd5e1" metalness={0.3} roughness={0.38} />
        </mesh>
        <mesh geometry={dockGeo.piping} castShadow={false}>
          <meshStandardMaterial color="#94a3b8" metalness={0.85} roughness={0.25} />
        </mesh>
        <mesh geometry={dockGeo.consoleGlow} castShadow={false}>
          <meshStandardMaterial
            color="#38bdf8"
            emissive="#0284c7"
            emissiveIntensity={0.9}
            roughness={0.2}
            toneMapped
          />
        </mesh>
        <mesh geometry={dockGeo.amberTrim} castShadow={false}>
          <meshStandardMaterial
            color="#f59e0b"
            emissive="#d97706"
            emissiveIntensity={0.85}
            roughness={0.25}
            toneMapped
          />
        </mesh>
      </group>

      {/* Group 2: Active Spacedock Machinery (8 meshes) */}
      <group name="drydock-active-ops">
        {/* Rotating Structural Centrifuge Habitation Ring */}
        <group ref={centrifugeRef} position={[0, 2.2, -22.2]}>
          <mesh geometry={centGeo.frame} castShadow={false}>
            <meshStandardMaterial color="#334155" metalness={0.75} roughness={0.38} />
          </mesh>
          <mesh geometry={centGeo.windows} castShadow={false}>
            <meshStandardMaterial
              color="#fef08a"
              emissive="#f59e0b"
              emissiveIntensity={0.95}
              roughness={0.2}
              toneMapped
            />
          </mesh>
        </group>

        {/* Forward Overhead Rail Welding Crane */}
        <group ref={craneFwdRef} position={[0, 9.48, 1.15]}>
          <mesh geometry={craneGeo.bridge} castShadow={false}>
            <meshStandardMaterial color="#b45309" metalness={0.6} roughness={0.44} />
          </mesh>
          <group ref={craneFwdTrolleyRef} position={[2.1, 0, 0]}>
            <mesh geometry={craneGeo.trolley} castShadow={false}>
              <meshStandardMaterial color="#334155" metalness={0.8} roughness={0.35} />
            </mesh>
          </group>
        </group>

        {/* Aft Overhead Rail Welding Crane */}
        <group ref={craneAftRef} position={[0, 9.48, -7.6]}>
          <mesh geometry={craneGeo.bridge} castShadow={false}>
            <meshStandardMaterial color="#b45309" metalness={0.6} roughness={0.44} />
          </mesh>
          <group ref={craneAftTrolleyRef} position={[-2.6, 0, 0]}>
            <mesh geometry={craneGeo.trolley} castShadow={false}>
              <meshStandardMaterial color="#334155" metalness={0.8} roughness={0.35} />
            </mesh>
          </group>
        </group>

        {/* Rotating ATC Radar Dish on Starboard Control Bridge */}
        <group ref={radarRef} position={[13.2, 11.0, -5.0]}>
          <mesh castShadow={false}>
            <cylinderGeometry args={[0.14, 0.2, 0.7, 8]} />
            <meshStandardMaterial color="#334155" metalness={0.8} roughness={0.4} />
          </mesh>
          <mesh position={[0, 0.45, 0.08]} rotation={[0.45, 0, 0]} castShadow={false}>
            <cylinderGeometry args={[0.85, 0.2, 0.28, 14]} />
            <meshStandardMaterial color="#94a3b8" metalness={0.75} roughness={0.3} />
          </mesh>
        </group>

        {/* Welding Micro-Sparks (live docked/repair only) */}
        <instancedMesh
          ref={sparksRef}
          args={[undefined, undefined, SPARK_COUNT]}
          visible={false}
          frustumCulled={false}
        >
          <boxGeometry args={[0.04, 0.08, 0.04]} />
          <meshStandardMaterial
            color="#fef3c7"
            emissive="#fbbf24"
            emissiveIntensity={1.65}
            toneMapped
          />
        </instancedMesh>
      </group>

      {/* Group 3: Hull-Measured Articulated Holding Prongs & Keel Clamps (20 meshes) */}
      <group name="drydock-holding-clamps">
        {prongSpecs.map((spec, idx) => (
          <group key={spec.id}>
            {/* Gantry trunnion collar bolted onto main tower column */}
            <mesh position={[spec.side * 12.6, spec.anchor.y, spec.anchor.z]} castShadow={false}>
              <boxGeometry args={[0.75, 0.68, 0.72]} />
              <meshStandardMaterial color="#334155" metalness={0.78} roughness={0.4} />
            </mesh>

            {/* Telescoping hydraulic lattice boom */}
            <group
              ref={(el) => {
                prongRefs.current[idx].arm = el;
              }}
            >
              <mesh geometry={prongGeo.armUnit} castShadow={false}>
                <meshStandardMaterial color="#475569" metalness={0.76} roughness={0.38} />
              </mesh>
            </group>

            {/* Unscaled jaw wrist assembly oriented +X toward hull skin */}
            <group
              ref={(el) => {
                prongRefs.current[idx].wrist = el;
              }}
              rotation={[0, spec.side === -1 ? 0 : Math.PI, 0]}
            >
              <group
                ref={(el) => {
                  prongRefs.current[idx].upperJaw = el;
                }}
                position={[-0.26, 0.24, 0]}
              >
                <mesh geometry={prongGeo.upperJaw} castShadow={false}>
                  <meshStandardMaterial color="#d97706" metalness={0.45} roughness={0.48} />
                </mesh>
              </group>
              <group
                ref={(el) => {
                  prongRefs.current[idx].lowerJaw = el;
                }}
                position={[-0.26, -0.24, 0]}
              >
                <mesh geometry={prongGeo.lowerJaw} castShadow={false}>
                  <meshStandardMaterial color="#d97706" metalness={0.45} roughness={0.48} />
                </mesh>
              </group>
            </group>
          </group>
        ))}

        {/* 2 Ventral Magnetic Keel Clamps */}
        {keelSpecs.map((spec, idx) => (
          <group key={spec.id}>
            <group
              ref={(el) => {
                keelRefs.current[idx].stem = el;
              }}
            >
              <mesh geometry={keelGeo.stemUnit} castShadow={false}>
                <meshStandardMaterial color="#475569" metalness={0.78} roughness={0.38} />
              </mesh>
            </group>

            <group
              ref={(el) => {
                keelRefs.current[idx].head = el;
              }}
            >
              <mesh geometry={keelGeo.cradleBase} castShadow={false}>
                <meshStandardMaterial color="#1e293b" metalness={0.8} roughness={0.4} />
              </mesh>
              <group
                ref={(el) => {
                  keelRefs.current[idx].leftChock = el;
                }}
                position={[-0.34, 0, 0]}
              >
                <mesh geometry={keelGeo.chock} castShadow={false}>
                  <meshStandardMaterial color="#d97706" metalness={0.45} roughness={0.5} />
                </mesh>
              </group>
              <group
                ref={(el) => {
                  keelRefs.current[idx].rightChock = el;
                }}
                position={[0.34, 0, 0]}
                rotation={[0, Math.PI, 0]}
              >
                <mesh geometry={keelGeo.chock} castShadow={false}>
                  <meshStandardMaterial color="#d97706" metalness={0.45} roughness={0.5} />
                </mesh>
              </group>
            </group>
          </group>
        ))}
      </group>

      {/* Group 4: Extendable Pressurized Docking Tunnels & Catenary Umbilicals (14 meshes) */}
      <group name="drydock-tunnels-umbilicals">
        {tunnelSpecs.map((spec, idx) => (
          <group
            key={spec.id}
            position={[0, spec.anchor.y, spec.anchor.z]}
            rotation={[0, spec.side === -1 ? 0 : Math.PI, 0]}
          >
            {/* Armored vestibule airlock tower hub */}
            <mesh geometry={tunnelGeo.vestibule} castShadow={false}>
              <meshStandardMaterial color="#334155" metalness={0.72} roughness={0.4} />
            </mesh>

            {/* Extendable ribbed accordion bellows & overhead truss bridge */}
            <group
              ref={(el) => {
                tunnelRefs.current[idx].bellows = el;
              }}
            >
              <mesh geometry={tunnelGeo.bellowsUnit} castShadow={false}>
                <meshStandardMaterial color="#94a3b8" metalness={0.48} roughness={0.48} />
              </mesh>
              <mesh geometry={tunnelGeo.bellowsSlits} castShadow={false}>
                <meshStandardMaterial
                  color="#7dd3fc"
                  emissive="#0284c7"
                  emissiveIntensity={0.85}
                  roughness={0.2}
                  toneMapped
                />
              </mesh>
            </group>

            {/* Unscaled circular armored airlock collar + hazard dogs seating flush onto ship */}
            <group
              ref={(el) => {
                tunnelRefs.current[idx].collar = el;
              }}
            >
              <mesh geometry={tunnelGeo.collarSteel} castShadow={false}>
                <meshStandardMaterial color="#1e293b" metalness={0.82} roughness={0.35} />
              </mesh>
              <mesh geometry={tunnelGeo.collarHazard} castShadow={false}>
                <meshStandardMaterial color="#eab308" metalness={0.35} roughness={0.5} />
              </mesh>
            </group>
          </group>
        ))}

        {/* 4 CatmullRomCurve3 + TubeGeometry Catenary Cryo/Power Umbilical Hoses */}
        {umbSpecs.map((spec, idx) => (
          <group
            key={spec.id}
            position={[spec.side * UMB_REEL_X, UMB_REEL_Y, spec.anchor.z]}
          >
            <mesh geometry={spec.built.reelGeo} castShadow={false}>
              <meshStandardMaterial color="#334155" metalness={0.8} roughness={0.38} />
            </mesh>
            <group
              ref={(el) => {
                umbRefs.current[idx] = el;
              }}
            >
              <mesh geometry={spec.built.hoseGeo} castShadow={false}>
                <meshStandardMaterial color="#cbd5e1" metalness={0.35} roughness={0.55} />
              </mesh>
              <mesh geometry={spec.built.couplerGeo} castShadow={false}>
                <meshStandardMaterial color="#d97706" metalness={0.55} roughness={0.42} />
              </mesh>
            </group>
          </group>
        ))}
      </group>
    </>
  );
}
