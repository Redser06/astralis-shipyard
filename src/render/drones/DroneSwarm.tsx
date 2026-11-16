import { useEffect, useMemo, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import {
  AdditiveBlending,
  BufferAttribute,
  BufferGeometry,
  CanvasTexture,
  Color,
  DoubleSide,
  ExtrudeGeometry,
  Group,
  Mesh,
  MeshBasicMaterial,
  PointLight,
  Points,
  Quaternion,
  SRGBColorSpace,
  Shape,
  Vector3,
} from 'three';
import type { Blueprint, MissionState, Vec3 } from '../../domain/types';
import { hullBounds, hullReach, hullVolumes, seatOnHull, type HullVolume } from '../../domain/hullForm';
import { SHIP_PRESETS } from '../../domain/presets';
import { mulberry32 } from '../../domain/rng';
import { useReducedMotion } from '../useReducedMotion';

export interface DroneSwarmProps {
  enabled?: boolean;
  isRepairing?: boolean;
  blueprint?: Blueprint;
  missionState?: MissionState | null;
}

interface DroneSpec {
  id: string;
  zFrac: number;
  probeDir: Vec3;
  probeRadius: number;
  orbitRadiusBoost: number;
  orbitFreq: number;
  phaseOffset: number;
  accentHex: string;
}

interface ResolvedWorkZone {
  contact: Vector3;
  normal: Vector3;
  hoverStation: Vector3;
  seamPoints: Vector3[];
  orbitCenterZ: number;
  orbitSemiX: number;
  orbitSemiY: number;
  orbitTilt: number;
}

interface SparkSeed {
  dirX: number;
  dirY: number;
  dirZ: number;
  speed: number;
  phase: number;
  life: number;
}

const DRONE_SPECS: readonly DroneSpec[] = [
  {
    id: 'port-bow',
    zFrac: 0.74,
    probeDir: [-0.9, 0.28, 0.34],
    probeRadius: 14,
    orbitRadiusBoost: 2.5,
    orbitFreq: 0.36,
    phaseOffset: 0.2,
    accentHex: '#f59e0b',
  },
  {
    id: 'stbd-bow',
    zFrac: 0.64,
    probeDir: [0.92, 0.2, 0.28],
    probeRadius: 14,
    orbitRadiusBoost: 2.6,
    orbitFreq: 0.33,
    phaseOffset: 1.45,
    accentHex: '#38bdf8',
  },
  {
    id: 'dorsal-mid',
    zFrac: 0.48,
    probeDir: [0.08, 0.99, 0.06],
    probeRadius: 13.5,
    orbitRadiusBoost: 2.8,
    orbitFreq: 0.29,
    phaseOffset: 2.7,
    accentHex: '#f59e0b',
  },
  {
    id: 'port-aft',
    zFrac: 0.24,
    probeDir: [-0.92, -0.24, -0.26],
    probeRadius: 14,
    orbitRadiusBoost: 2.5,
    orbitFreq: 0.35,
    phaseOffset: 4.1,
    accentHex: '#38bdf8',
  },
  {
    id: 'stbd-aft',
    zFrac: 0.32,
    probeDir: [0.9, 0.32, -0.28],
    probeRadius: 14,
    orbitRadiusBoost: 2.6,
    orbitFreq: 0.31,
    phaseOffset: 5.25,
    accentHex: '#f59e0b',
  },
];

const SPARK_COUNT = 24;
const HOVER_CLEARANCE = 2.05;
const UP_AXIS = new Vector3(0, 1, 0);
const FWD_AXIS = new Vector3(0, 0, 1);

const _scratchPos = new Vector3();
const _scratchLook = new Vector3();
const _scratchTarget = new Vector3();
const _scratchTip = new Vector3();
const _scratchDir = new Vector3();
const _scratchDelta = new Vector3();
const _scratchMid = new Vector3();
const _scratchQuat = new Quaternion();
const _scratchColor = new Color();

let cachedChassisGeo: ExtrudeGeometry | null = null;
let cachedChassisTexture: CanvasTexture | null = null;
let cachedSparkTexture: CanvasTexture | null = null;

function getDroneChassisGeometry(): ExtrudeGeometry {
  if (cachedChassisGeo) return cachedChassisGeo;
  const shape = new Shape();
  // Chamfered octagonal industrial hull profile (XZ extruded along Y then rotated so +Z is forward)
  shape.moveTo(-0.22, -0.34);
  shape.lineTo(0.22, -0.34);
  shape.lineTo(0.32, -0.18);
  shape.lineTo(0.32, 0.16);
  shape.lineTo(0.18, 0.36);
  shape.lineTo(-0.18, 0.36);
  shape.lineTo(-0.32, 0.16);
  shape.lineTo(-0.32, -0.18);
  shape.closePath();

  const geo = new ExtrudeGeometry(shape, {
    depth: 0.18,
    bevelEnabled: true,
    bevelThickness: 0.035,
    bevelSize: 0.03,
    bevelSegments: 2,
  });
  geo.center();
  geo.rotateX(Math.PI / 2);
  geo.computeVertexNormals();
  cachedChassisGeo = geo;
  return geo;
}

function getDroneHullTexture(): CanvasTexture | null {
  if (cachedChassisTexture) return cachedChassisTexture;
  if (typeof document === 'undefined') return null;
  const canvas = document.createElement('canvas');
  canvas.width = 256;
  canvas.height = 256;
  const ctx = canvas.getContext('2d');
  if (!ctx) return null;

  ctx.fillStyle = '#334155';
  ctx.fillRect(0, 0, 256, 256);

  // Panel seams and machined titanium plating contrast
  ctx.strokeStyle = '#1e293b';
  ctx.lineWidth = 3;
  for (let i = 0; i <= 256; i += 64) {
    ctx.beginPath();
    ctx.moveTo(i, 0);
    ctx.lineTo(i, 256);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(0, i);
    ctx.lineTo(256, i);
    ctx.stroke();
  }

  ctx.fillStyle = '#475569';
  ctx.fillRect(8, 8, 112, 48);
  ctx.fillRect(136, 72, 112, 52);
  ctx.fillRect(8, 136, 112, 48);

  // Industrial hazard stripe band
  ctx.save();
  ctx.beginPath();
  ctx.rect(0, 196, 256, 28);
  ctx.clip();
  ctx.fillStyle = '#d97706';
  ctx.fillRect(0, 196, 256, 28);
  ctx.fillStyle = '#1e293b';
  for (let x = -32; x < 288; x += 28) {
    ctx.beginPath();
    ctx.moveTo(x, 196);
    ctx.lineTo(x + 14, 196);
    ctx.lineTo(x + 2, 224);
    ctx.lineTo(x - 12, 224);
    ctx.closePath();
    ctx.fill();
  }
  ctx.restore();

  const texture = new CanvasTexture(canvas);
  texture.colorSpace = SRGBColorSpace;
  texture.needsUpdate = true;
  cachedChassisTexture = texture;
  return texture;
}

function getSparkSpriteTexture(): CanvasTexture | null {
  if (cachedSparkTexture) return cachedSparkTexture;
  if (typeof document === 'undefined') return null;
  const canvas = document.createElement('canvas');
  canvas.width = 64;
  canvas.height = 64;
  const ctx = canvas.getContext('2d');
  if (!ctx) return null;

  const grad = ctx.createRadialGradient(32, 32, 2, 32, 32, 30);
  grad.addColorStop(0, 'rgba(255, 251, 235, 1)');
  grad.addColorStop(0.35, 'rgba(253, 186, 116, 0.9)');
  grad.addColorStop(0.75, 'rgba(249, 115, 22, 0.35)');
  grad.addColorStop(1, 'rgba(249, 115, 22, 0)');
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, 64, 64);

  const texture = new CanvasTexture(canvas);
  texture.colorSpace = SRGBColorSpace;
  texture.needsUpdate = true;
  cachedSparkTexture = texture;
  return texture;
}

function resolveDroneZone(
  volumes: readonly HullVolume[],
  minZ: number,
  maxZ: number,
  spec: DroneSpec,
  index: number,
): ResolvedWorkZone {
  const z = minZ + (maxZ - minZ) * spec.zFrac;
  const dirLen = Math.hypot(spec.probeDir[0], spec.probeDir[1], spec.probeDir[2]) || 1;
  const nx = spec.probeDir[0] / dirLen;
  const ny = spec.probeDir[1] / dirLen;
  const nz = spec.probeDir[2] / dirLen;

  const probeOrigin: Vec3 = [nx * spec.probeRadius, ny * spec.probeRadius, z + nz * 1.4];
  const probeNormal: Vec3 = [nx, ny, nz];

  let seated = seatOnHull(volumes, probeOrigin, probeNormal, 0.15);
  if (!seated) {
    // Catamaran or slender hull fallback: sweep lateral offsets until a real surface point is hit
    const lateralOffsets = [2.8, -2.8, 5.2, -5.2, 0];
    for (const dx of lateralOffsets) {
      seated = seatOnHull(volumes, [probeOrigin[0] + dx, probeOrigin[1], z], probeNormal, 0.05);
      if (seated) break;
    }
  }

  let contact: Vector3;
  let normal: Vector3;

  if (seated) {
    contact = new Vector3(seated.position[0], seated.position[1], seated.position[2]);
    normal = new Vector3(seated.normal[0], seated.normal[1], seated.normal[2]).normalize();
  } else {
    const reach = hullReach(volumes, [0, 0, z], probeNormal) ?? 2.8;
    contact = new Vector3(nx * reach, ny * reach, z + nz * 0.5);
    normal = new Vector3(nx, ny, nz).normalize();
  }

  const hoverStation = contact.clone().addScaledVector(normal, HOVER_CLEARANCE);

  // Build an orthonormal tangent basis at the hull surface to trace a real curved weld seam
  const refUp = Math.abs(normal.z) < 0.85 ? FWD_AXIS : UP_AXIS;
  const tangentU = new Vector3().crossVectors(refUp, normal).normalize();
  const tangentV = new Vector3().crossVectors(normal, tangentU).normalize();

  const seamPoints: Vector3[] = [];
  for (let s = -2; s <= 2; s += 1) {
    const uOff = s * 0.28;
    const vOff = Math.sin(s * 0.8 + index) * 0.18;
    const cand: Vec3 = [
      contact.x + tangentU.x * uOff + tangentV.x * vOff + normal.x * 1.4,
      contact.y + tangentU.y * uOff + tangentV.y * vOff + normal.y * 1.4,
      contact.z + tangentU.z * uOff + tangentV.z * vOff + normal.z * 1.4,
    ];
    const seamHit = seatOnHull(volumes, cand, [normal.x, normal.y, normal.z], 0.1);
    if (seamHit) {
      seamPoints.push(new Vector3(seamHit.position[0], seamHit.position[1], seamHit.position[2]));
    } else {
      seamPoints.push(
        new Vector3(
          contact.x + tangentU.x * uOff,
          contact.y + tangentU.y * uOff,
          contact.z + tangentU.z * uOff,
        ),
      );
    }
  }

  const reachX = hullReach(volumes, [0, 0, z], [1, 0, 0]) ?? 3.2;
  const reachY = hullReach(volumes, [0, 0, z], [0, 1, 0]) ?? 2.4;

  return {
    contact,
    normal,
    hoverStation,
    seamPoints,
    orbitCenterZ: z,
    orbitSemiX: Math.max(reachX, 3.0) + spec.orbitRadiusBoost,
    orbitSemiY: Math.max(reachY, 2.5) + spec.orbitRadiusBoost * 0.85,
    orbitTilt: (index % 2 === 0 ? 1 : -1) * (0.18 + index * 0.06),
  };
}

function sampleSeamPoint(seamPoints: readonly Vector3[], u: number, out: Vector3): Vector3 {
  const count = seamPoints.length;
  if (count === 0) return out.set(0, 0, 0);
  if (count === 1) return out.copy(seamPoints[0]);
  const pingPong = 0.5 - 0.5 * Math.cos(u);
  const scaled = pingPong * (count - 1);
  const idx0 = Math.min(count - 2, Math.floor(scaled));
  const frac = scaled - idx0;
  return out.lerpVectors(seamPoints[idx0], seamPoints[idx0 + 1], frac);
}

interface DroneUnitProps {
  spec: DroneSpec;
  index: number;
  zone: ResolvedWorkZone;
  enabled: boolean;
  isRepairing: boolean;
  reducedMotion: boolean;
  seedBase: number;
}

function DroneUnit({
  spec,
  index,
  zone,
  enabled,
  isRepairing,
  reducedMotion,
  seedBase,
}: DroneUnitProps) {
  const chassisRef = useRef<Group>(null);
  const turretRef = useRef<Group>(null);
  const scanConeRef = useRef<Mesh>(null);
  const weldShoulderRef = useRef<Group>(null);
  const weldElbowRef = useRef<Group>(null);
  const torchTipRef = useRef<Group>(null);
  const auxArmRef = useRef<Group>(null);
  const strobeMatRef = useRef<MeshBasicMaterial>(null);
  const workLightRef = useRef<PointLight>(null);
  const weldArcRef = useRef<Mesh>(null);
  const weldCoreRef = useRef<Mesh>(null);
  const sparksRef = useRef<Points>(null);

  const chassisGeo = useMemo(() => getDroneChassisGeometry(), []);
  const hullTex = useMemo(() => getDroneHullTexture(), []);
  const sparkTex = useMemo(() => getSparkSpriteTexture(), []);

  const sparkSeeds = useMemo<SparkSeed[]>(() => {
    const rng = mulberry32((seedBase ^ ((index + 1) * 0x9e3779b1)) >>> 0);
    const n = zone.normal;
    const refUp = Math.abs(n.z) < 0.85 ? FWD_AXIS : UP_AXIS;
    const tU = new Vector3().crossVectors(refUp, n).normalize();
    const tV = new Vector3().crossVectors(n, tU).normalize();

    const seeds: SparkSeed[] = [];
    for (let i = 0; i < SPARK_COUNT; i++) {
      const spreadA = (rng() - 0.5) * 1.45;
      const spreadB = (rng() - 0.5) * 1.45;
      const outWeight = 0.65 + rng() * 0.75;
      const vx = n.x * outWeight + tU.x * spreadA + tV.x * spreadB;
      const vy = n.y * outWeight + tU.y * spreadA + tV.y * spreadB;
      const vz = n.z * outWeight + tU.z * spreadA + tV.z * spreadB;
      const len = Math.hypot(vx, vy, vz) || 1;
      seeds.push({
        dirX: vx / len,
        dirY: vy / len,
        dirZ: vz / len,
        speed: 1.4 + rng() * 2.2,
        phase: rng(),
        life: 0.35 + rng() * 0.35,
      });
    }
    return seeds;
  }, [index, seedBase, zone]);

  const sparkGeometry = useMemo(() => {
    const geo = new BufferGeometry();
    const positions = new Float32Array(SPARK_COUNT * 3);
    const colors = new Float32Array(SPARK_COUNT * 3);
    for (let i = 0; i < SPARK_COUNT; i++) {
      positions[i * 3] = zone.contact.x;
      positions[i * 3 + 1] = zone.contact.y;
      positions[i * 3 + 2] = zone.contact.z;
      colors[i * 3] = 1.0;
      colors[i * 3 + 1] = 0.78;
      colors[i * 3 + 2] = 0.35;
    }
    geo.setAttribute('position', new BufferAttribute(positions, 3));
    geo.setAttribute('color', new BufferAttribute(colors, 3));
    return geo;
  }, [zone]);

  useEffect(() => {
    return () => {
      sparkGeometry.dispose();
    };
  }, [sparkGeometry]);

  // Apply deterministic initial pose immediately on mount or mode switch so static / reduced-motion frames align cleanly
  useEffect(() => {
    const chassis = chassisRef.current;
    if (!chassis) return;
    if (Math.abs(zone.normal.y) > 0.85) {
      chassis.up.set(0, 0, 1);
    } else {
      chassis.up.set(0, 1, 0);
    }
    if (isRepairing) {
      chassis.position.copy(zone.hoverStation);
      _scratchLook.copy(zone.contact);
      chassis.lookAt(_scratchLook);
    } else {
      const theta = spec.phaseOffset;
      const ox = Math.cos(theta) * zone.orbitSemiX;
      const oy = Math.sin(theta) * zone.orbitSemiY;
      const oz = zone.orbitCenterZ + Math.sin(theta * 2) * zone.orbitTilt * 3.2;
      chassis.position.set(ox, oy, oz);
      _scratchLook.set(0, 0, zone.orbitCenterZ);
      chassis.lookAt(_scratchLook);
    }
  }, [isRepairing, spec.phaseOffset, zone]);

  useFrame(({ clock }) => {
    const chassis = chassisRef.current;
    if (!chassis || !enabled) return;

    const t = reducedMotion ? index * 1.4 : clock.getElapsedTime();

    if (isRepairing) {
      if (Math.abs(zone.normal.y) > 0.85) {
        chassis.up.set(0, 0, 1);
      } else {
        chassis.up.set(0, 1, 0);
      }
      // Micro-station-keeping around the hull-normal hover station
      const bobX = reducedMotion ? 0 : Math.sin(t * 1.35 + spec.phaseOffset) * 0.08;
      const bobY = reducedMotion ? 0 : Math.cos(t * 1.15 + spec.phaseOffset * 1.4) * 0.07;
      const bobZ = reducedMotion ? 0 : Math.sin(t * 0.95 + spec.phaseOffset * 0.7) * 0.08;

      _scratchPos.set(
        zone.hoverStation.x + bobX,
        zone.hoverStation.y + bobY,
        zone.hoverStation.z + bobZ,
      );
      chassis.position.copy(_scratchPos);

      // Live seam target locked onto hullVolumes
      sampleSeamPoint(zone.seamPoints, t * 1.1 + spec.phaseOffset, _scratchTarget);
      chassis.lookAt(_scratchTarget);

      // Articulate turret directly at the weld contact point
      if (turretRef.current) {
        turretRef.current.rotation.set(
          -0.08 + Math.sin(t * 2.1 + index) * 0.04,
          Math.sin(t * 1.4 + index) * 0.14,
          0,
        );
      }

      // Articulate welding shoulder & elbow to weave along the hull seam
      const weave = Math.sin(t * 2.4 + spec.phaseOffset);
      if (weldShoulderRef.current) {
        weldShoulderRef.current.rotation.set(0.08 + weave * 0.06, -0.14 + weave * 0.12, 0);
      }
      if (weldElbowRef.current) {
        weldElbowRef.current.rotation.set(-0.06 - weave * 0.05, 0.08, 0);
      }
      if (auxArmRef.current) {
        auxArmRef.current.rotation.set(0.22 + Math.cos(t * 1.5 + index) * 0.06, 0.2, 0);
      }
      if (scanConeRef.current) {
        scanConeRef.current.visible = false;
      }

      // Resolve exact world-space position of the articulated welding torch tip
      chassis.updateWorldMatrix(true, true);
      if (torchTipRef.current && weldArcRef.current && weldCoreRef.current) {
        torchTipRef.current.getWorldPosition(_scratchTip);
        _scratchDelta.subVectors(_scratchTarget, _scratchTip);
        const arcLen = _scratchDelta.length();

        if (arcLen > 0.05 && arcLen < 4.5) {
          _scratchDir.copy(_scratchDelta).divideScalar(arcLen);
          _scratchMid.addVectors(_scratchTip, _scratchTarget).multiplyScalar(0.5);
          _scratchQuat.setFromUnitVectors(UP_AXIS, _scratchDir);

          weldArcRef.current.position.copy(_scratchMid);
          weldArcRef.current.quaternion.copy(_scratchQuat);
          const pulse = reducedMotion ? 1.0 : 0.82 + 0.35 * Math.sin(t * 34 + index * 3.1);
          weldArcRef.current.scale.set(pulse, arcLen, pulse);
          weldArcRef.current.visible = true;

          weldCoreRef.current.position.copy(_scratchTarget);
          weldCoreRef.current.scale.setScalar(0.85 + 0.35 * pulse);
          weldCoreRef.current.visible = true;
        } else {
          weldArcRef.current.visible = false;
          weldCoreRef.current.visible = false;
        }
      }

      // Deterministic spark spray radiating outward from the live hull seam point
      if (sparksRef.current) {
        sparksRef.current.visible = true;
        const posAttr = sparkGeometry.getAttribute('position') as BufferAttribute;
        const colAttr = sparkGeometry.getAttribute('color') as BufferAttribute;
        const posArr = posAttr.array as Float32Array;
        const colArr = colAttr.array as Float32Array;

        for (let s = 0; s < SPARK_COUNT; s++) {
          const seed = sparkSeeds[s];
          const age = reducedMotion
            ? ((seed.phase + index * 0.17) % 1) * seed.life
            : ((t / seed.life + seed.phase) % 1) * seed.life;
          const dist = seed.speed * age;
          const fade = Math.max(0, 1 - age / seed.life);

          posArr[s * 3] = _scratchTarget.x + seed.dirX * dist;
          posArr[s * 3 + 1] = _scratchTarget.y + seed.dirY * dist;
          posArr[s * 3 + 2] = _scratchTarget.z + seed.dirZ * dist;

          colArr[s * 3] = 1.0 * fade;
          colArr[s * 3 + 1] = (0.45 + 0.48 * fade) * fade;
          colArr[s * 3 + 2] = 0.15 * fade * fade;
        }
        posAttr.needsUpdate = true;
        colAttr.needsUpdate = true;
      }

      // Subtle warm non-shadowed work illumination on surrounding hull plates (intensity <= 3, distance <= 8)
      if (workLightRef.current) {
        const flicker = reducedMotion ? 2.1 : 1.7 + 0.55 * Math.sin(t * 28 + index * 2.3);
        workLightRef.current.intensity = Math.min(2.6, flicker);
        _scratchColor.set('#fed7aa');
        workLightRef.current.color.copy(_scratchColor);
      }

      if (strobeMatRef.current) {
        const flash = reducedMotion ? 0.7 : Math.sin(t * 5.2 + index * 1.9) > 0.65 ? 0.95 : 0.25;
        strobeMatRef.current.color.set('#fbbf24').multiplyScalar(flash);
      }
    } else {
      // Smooth orbital lidar perimeter inspection circuit around the hull
      chassis.up.set(0, 1, 0);
      const theta = t * spec.orbitFreq + spec.phaseOffset;
      const cosT = Math.cos(theta);
      const sinT = Math.sin(theta);

      _scratchPos.set(
        cosT * zone.orbitSemiX,
        sinT * zone.orbitSemiY,
        zone.orbitCenterZ + Math.sin(theta * 2) * zone.orbitTilt * 3.2,
      );
      chassis.position.copy(_scratchPos);

      // Lead ahead slightly along orbital tangent, while tilting belly/sensors inward toward hull centerline
      const leadTheta = theta + 0.16;
      _scratchLook.set(
        Math.cos(leadTheta) * zone.orbitSemiX * 0.45,
        Math.sin(leadTheta) * zone.orbitSemiY * 0.45,
        zone.orbitCenterZ,
      );
      chassis.lookAt(_scratchLook);

      if (turretRef.current) {
        turretRef.current.rotation.set(-0.08, Math.sin(t * 1.4 + index) * 0.26, 0);
      }
      // Stow arms tightly into travel detent during perimeter sweep
      if (weldShoulderRef.current) {
        weldShoulderRef.current.rotation.set(-0.35, -0.35, 0);
      }
      if (weldElbowRef.current) {
        weldElbowRef.current.rotation.set(0.85, 0, 0);
      }
      if (auxArmRef.current) {
        auxArmRef.current.rotation.set(-0.32, 0.35, 0);
      }
      if (scanConeRef.current) {
        scanConeRef.current.visible = true;
      }
      if (weldArcRef.current) weldArcRef.current.visible = false;
      if (weldCoreRef.current) weldCoreRef.current.visible = false;
      if (sparksRef.current) sparksRef.current.visible = false;

      if (workLightRef.current) {
        workLightRef.current.intensity = 0.85;
        _scratchColor.set('#bae6fd');
        workLightRef.current.color.copy(_scratchColor);
      }

      if (strobeMatRef.current) {
        const flash = reducedMotion ? 0.65 : Math.sin(t * 3.8 + index * 1.7) > 0.72 ? 0.9 : 0.22;
        strobeMatRef.current.color.set('#38bdf8').multiplyScalar(flash);
      }
    }
  });

  if (!enabled) return null;

  return (
    <group name={`repair-drone-${spec.id}`}>
      {/* Moving drone chassis & articulated limbs */}
      <group ref={chassisRef}>
        {/* 1. Armored Chamfered Gyro Hull */}
        <mesh geometry={chassisGeo}>
          <meshStandardMaterial
            color="#cbd5e1"
            map={hullTex ?? undefined}
            metalness={0.78}
            roughness={0.34}
          />
        </mesh>

        {/* 2. Perimeter Industrial Roll-Cage Guard */}
        <mesh rotation={[Math.PI / 2, 0, 0]} scale={[1.05, 1.18, 0.75]}>
          <torusGeometry args={[0.37, 0.022, 8, 24]} />
          <meshStandardMaterial color={spec.accentHex} metalness={0.45} roughness={0.42} />
        </mesh>

        {/* 3-5. Stereo Lidar Optical Turret + Survey Cone */}
        <group ref={turretRef} position={[0, 0.13, 0.22]}>
          <mesh>
            <boxGeometry args={[0.24, 0.11, 0.18]} />
            <meshStandardMaterial color="#1e293b" metalness={0.7} roughness={0.35} />
          </mesh>
          <mesh position={[0, 0.01, 0.095]}>
            <boxGeometry args={[0.19, 0.055, 0.025]} />
            <meshStandardMaterial
              color="#0f172a"
              emissive="#38bdf8"
              emissiveIntensity={0.45}
              metalness={0.85}
              roughness={0.18}
              toneMapped
            />
          </mesh>
          {/* Non-shadowed subtle lidar survey cone (visible during patrol/inspection) */}
          <mesh
            ref={scanConeRef}
            position={[0, 0, 1.32]}
            rotation={[-Math.PI / 2, 0, 0]}
            visible={!isRepairing}
          >
            <coneGeometry args={[0.48, 2.4, 16, 1, true]} />
            <meshBasicMaterial
              color="#38bdf8"
              transparent
              opacity={0.07}
              side={DoubleSide}
              depthWrite={false}
              blending={AdditiveBlending}
            />
          </mesh>
        </group>

        {/* 6-8. Port Articulated Welding Arm (Shoulder -> Elbow -> Torch Nozzle) */}
        <group ref={weldShoulderRef} position={[-0.24, -0.06, 0.16]}>
          <mesh position={[0, 0, 0.17]} rotation={[Math.PI / 2, 0, 0]}>
            <cylinderGeometry args={[0.026, 0.032, 0.34, 8]} />
            <meshStandardMaterial color="#64748b" metalness={0.78} roughness={0.3} />
          </mesh>
          <group ref={weldElbowRef} position={[0, 0, 0.34]}>
            <mesh>
              <sphereGeometry args={[0.042, 10, 10]} />
              <meshStandardMaterial color="#d97706" metalness={0.6} roughness={0.38} />
            </mesh>
            <mesh position={[0, 0, 0.19]} rotation={[Math.PI / 2, 0, 0]}>
              <cylinderGeometry args={[0.018, 0.028, 0.36, 8]} />
              <meshStandardMaterial color="#94a3b8" metalness={0.82} roughness={0.28} />
            </mesh>
            <group ref={torchTipRef} position={[0, 0, 0.38]} />
          </group>
        </group>

        {/* 9. Starboard Stabilizer / Sensor Manipulator Arm */}
        <group ref={auxArmRef} position={[0.24, -0.06, 0.16]}>
          <mesh position={[0, 0, 0.22]} rotation={[Math.PI / 2, 0, 0]}>
            <cylinderGeometry args={[0.022, 0.028, 0.44, 8]} />
            <meshStandardMaterial color="#475569" metalness={0.78} roughness={0.32} />
          </mesh>
        </group>

        {/* 10-13. Quad Vectored Micro-Thruster Pods */}
        {[
          [-0.31, 0.09, -0.22, -0.22, -0.26],
          [0.31, 0.09, -0.22, -0.22, 0.26],
          [-0.31, -0.09, -0.22, 0.22, -0.26],
          [0.31, -0.09, -0.22, 0.22, 0.26],
        ].map(([px, py, pz, rx, rz], pIdx) => (
          <mesh key={pIdx} position={[px, py, pz]} rotation={[rx, 0, rz]}>
            <cylinderGeometry args={[0.044, 0.056, 0.14, 10]} />
            <meshStandardMaterial
              color="#334155"
              emissive="#60a5fa"
              emissiveIntensity={0.55}
              metalness={0.75}
              roughness={0.35}
              toneMapped
            />
          </mesh>
        ))}

        {/* 14. Pinpoint Anti-Collision Beacon (radius <= 0.03, toneMapped so zero bloom orb) */}
        <mesh position={[0, 0.21, -0.1]}>
          <sphereGeometry args={[0.026, 8, 8]} />
          <meshBasicMaterial ref={strobeMatRef} color={spec.accentHex} toneMapped />
        </mesh>

        {/* Lightweight Non-Shadowed Local Work Light (intensity <= 3, distance <= 8) */}
        <pointLight
          ref={workLightRef}
          position={[0, 0.04, 0.48]}
          color="#fed7aa"
          intensity={isRepairing ? 2.1 : 0.85}
          distance={6.5}
          decay={2}
          castShadow={false}
        />
      </group>

      {/* 15. Live Anchored Weld Arc Filament (world/ship-space coordinates spanning torchTip -> hullSeam) */}
      <mesh ref={weldArcRef} visible={false}>
        <cylinderGeometry args={[0.015, 0.015, 1, 6]} />
        <meshStandardMaterial
          color="#fef3c7"
          emissive="#fbbf24"
          emissiveIntensity={1.15}
          toneMapped
          transparent
          opacity={0.92}
        />
      </mesh>

      {/* 16. Pinpoint Hull Contact Weld Hotspot */}
      <mesh ref={weldCoreRef} visible={false}>
        <sphereGeometry args={[0.042, 8, 8]} />
        <meshStandardMaterial
          color="#fff7ed"
          emissive="#fb923c"
          emissiveIntensity={1.18}
          toneMapped
        />
      </mesh>

      {/* Localized Golden Contact Sparks */}
      <points ref={sparksRef} geometry={sparkGeometry} visible={false}>
        <pointsMaterial
          size={0.14}
          map={sparkTex ?? undefined}
          vertexColors
          transparent
          opacity={0.95}
          depthWrite={false}
          blending={AdditiveBlending}
          sizeAttenuation
        />
      </points>
    </group>
  );
}

export function DroneSwarm({
  enabled = true,
  isRepairing = false,
  blueprint,
  missionState = null,
}: DroneSwarmProps) {
  const reducedMotion = useReducedMotion();
  const activeBlueprint = blueprint ?? SHIP_PRESETS[0];
  const shipDocked =
    missionState == null || missionState === 'docked' || missionState === 'repair';
  const effectiveRepair = isRepairing && shipDocked;

  const { zones, seedBase } = useMemo(() => {
    const volumes = hullVolumes(activeBlueprint.architecture, activeBlueprint.hullProfile);
    const bounds = hullBounds(volumes);
    const resolved = DRONE_SPECS.map((spec, idx) =>
      resolveDroneZone(volumes, bounds.minZ, bounds.maxZ, spec, idx),
    );
    return {
      zones: resolved,
      seedBase: activeBlueprint.seed || 42,
    };
  }, [activeBlueprint.architecture, activeBlueprint.hullProfile, activeBlueprint.seed]);

  if (!enabled) return null;

  return (
    <>
      {DRONE_SPECS.map((spec, index) => (
        <DroneUnit
          key={spec.id}
          spec={spec}
          index={index}
          zone={zones[index]}
          enabled={enabled}
          isRepairing={effectiveRepair}
          reducedMotion={reducedMotion}
          seedBase={seedBase}
        />
      ))}
    </>
  );
}
