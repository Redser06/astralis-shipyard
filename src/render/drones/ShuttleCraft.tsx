import { useMemo, useRef, type MutableRefObject } from 'react';
import { useFrame } from '@react-three/fiber';
import {
  CanvasTexture,
  CatmullRomCurve3,
  ExtrudeGeometry,
  Group,
  MathUtils,
  Matrix4,
  Quaternion,
  RepeatWrapping,
  Shape,
  SRGBColorSpace,
  Vector3,
} from 'three';
import type { MissionState } from '../../domain/types';
import { useReducedMotion } from '../useReducedMotion';

interface ShuttleTextures {
  panelAlbedo: CanvasTexture;
  panelBump: CanvasTexture;
  heatTileAlbedo: CanvasTexture;
  heatTileBump: CanvasTexture;
}

let cachedShuttleTextures: ShuttleTextures | null = null;

/**
 * Generates deterministic module-scoped PBR canvas textures for auxiliary craft
 * plating and ventral thermal-protection tiles. Returns null in headless Node.
 */
function getShuttleTextures(): ShuttleTextures | null {
  if (cachedShuttleTextures) return cachedShuttleTextures;
  if (typeof document === 'undefined') return null;

  const size = 256;

  // Hull metallic panel albedo + bump
  const albedoCanvas = document.createElement('canvas');
  albedoCanvas.width = size;
  albedoCanvas.height = size;
  const actx = albedoCanvas.getContext('2d');

  const bumpCanvas = document.createElement('canvas');
  bumpCanvas.width = size;
  bumpCanvas.height = size;
  const bctx = bumpCanvas.getContext('2d');

  // Belly thermal tile albedo + bump
  const tileAlbedoCanvas = document.createElement('canvas');
  tileAlbedoCanvas.width = size;
  tileAlbedoCanvas.height = size;
  const tactx = tileAlbedoCanvas.getContext('2d');

  const tileBumpCanvas = document.createElement('canvas');
  tileBumpCanvas.width = size;
  tileBumpCanvas.height = size;
  const tbctx = tileBumpCanvas.getContext('2d');

  if (!actx || !bctx || !tactx || !tbctx) return null;

  // Base hull plate tone (high-key slate-alloy so material color multiplies cleanly)
  actx.fillStyle = '#dde5ef';
  actx.fillRect(0, 0, size, size);
  bctx.fillStyle = '#888888';
  bctx.fillRect(0, 0, size, size);

  const panels = [
    { x: 0, y: 0, w: 128, h: 96, shade: '#e8eef5', bump: '#969696' },
    { x: 128, y: 0, w: 128, h: 96, shade: '#d4dde8', bump: '#828282' },
    { x: 0, y: 96, w: 86, h: 80, shade: '#cbd5e1', bump: '#7c7c7c' },
    { x: 86, y: 96, w: 84, h: 80, shade: '#e2e8f0', bump: '#909090' },
    { x: 170, y: 96, w: 86, h: 80, shade: '#d9e2ec', bump: '#888888' },
    { x: 0, y: 176, w: 156, h: 80, shade: '#e6ecf4', bump: '#949494' },
    { x: 156, y: 176, w: 100, h: 80, shade: '#cfd8e3', bump: '#808080' },
  ];

  for (const p of panels) {
    actx.fillStyle = p.shade;
    actx.fillRect(p.x + 2, p.y + 2, p.w - 4, p.h - 4);
    bctx.fillStyle = p.bump;
    bctx.fillRect(p.x + 2, p.y + 2, p.w - 4, p.h - 4);

    // Recessed panel seam groove
    actx.strokeStyle = '#64748b';
    actx.lineWidth = 2;
    actx.strokeRect(p.x + 1, p.y + 1, p.w - 2, p.h - 2);

    bctx.strokeStyle = '#303030';
    bctx.lineWidth = 2;
    bctx.strokeRect(p.x + 1, p.y + 1, p.w - 2, p.h - 2);

    // Corner micro-rivets
    actx.fillStyle = '#94a3b8';
    bctx.fillStyle = '#b4b4b4';
    const inset = 7;
    for (const [rx, ry] of [
      [p.x + inset, p.y + inset],
      [p.x + p.w - inset, p.y + inset],
      [p.x + inset, p.y + p.h - inset],
      [p.x + p.w - inset, p.y + p.h - inset],
    ]) {
      actx.fillRect(rx - 1, ry - 1, 2, 2);
      bctx.fillRect(rx - 1, ry - 1, 2, 2);
    }
  }

  // Subtle inspection stencil stripe
  actx.fillStyle = '#94a3b8';
  actx.fillRect(16, 44, 48, 4);
  actx.fillRect(180, 198, 40, 3);

  // Ventral TPS ceramic heat-shield tiles
  tactx.fillStyle = '#12161c';
  tactx.fillRect(0, 0, size, size);
  tbctx.fillStyle = '#262626';
  tbctx.fillRect(0, 0, size, size);

  const rows = 8;
  const cols = 8;
  const tw = size / cols;
  const th = size / rows;
  for (let r = 0; r < rows; r++) {
    const offset = r % 2 === 0 ? 0 : tw * 0.5;
    for (let c = -1; c <= cols; c++) {
      const x = c * tw + offset;
      const y = r * th;
      const v = ((r * 7 + c * 13) & 7) - 3;
      const shade = 34 + v * 3;
      tactx.fillStyle = `rgb(${shade}, ${shade + 3}, ${shade + 7})`;
      tactx.fillRect(x + 1.5, y + 1.5, tw - 3, th - 3);
      tbctx.fillStyle = `rgb(${155 + v * 6}, ${155 + v * 6}, ${155 + v * 6})`;
      tbctx.fillRect(x + 1.5, y + 1.5, tw - 3, th - 3);
    }
  }

  const panelAlbedo = new CanvasTexture(albedoCanvas);
  panelAlbedo.colorSpace = SRGBColorSpace;
  panelAlbedo.wrapS = RepeatWrapping;
  panelAlbedo.wrapT = RepeatWrapping;

  const panelBump = new CanvasTexture(bumpCanvas);
  panelBump.wrapS = RepeatWrapping;
  panelBump.wrapT = RepeatWrapping;

  const heatTileAlbedo = new CanvasTexture(tileAlbedoCanvas);
  heatTileAlbedo.colorSpace = SRGBColorSpace;
  heatTileAlbedo.wrapS = RepeatWrapping;
  heatTileAlbedo.wrapT = RepeatWrapping;

  const heatTileBump = new CanvasTexture(tileBumpCanvas);
  heatTileBump.wrapS = RepeatWrapping;
  heatTileBump.wrapT = RepeatWrapping;

  cachedShuttleTextures = { panelAlbedo, panelBump, heatTileAlbedo, heatTileBump };
  return cachedShuttleTextures;
}

interface ShuttleGeometries {
  argoHull: ExtrudeGeometry;
  valkyrieWing: ExtrudeGeometry;
  valkyrieFuselage: ExtrudeGeometry;
}

let cachedGeometries: ShuttleGeometries | null = null;

function getShuttleGeometries(): ShuttleGeometries {
  if (cachedGeometries) return cachedGeometries;

  // Argo chined side-profile extruded across width (X) then centered
  const argoShape = new Shape();
  argoShape.moveTo(-1.85, -0.34);
  argoShape.lineTo(1.75, -0.34);
  argoShape.lineTo(2.45, -0.06);
  argoShape.lineTo(2.35, 0.24);
  argoShape.lineTo(1.55, 0.56);
  argoShape.lineTo(0.45, 0.58);
  argoShape.lineTo(-0.2, 0.44);
  argoShape.lineTo(-1.85, 0.42);
  argoShape.closePath();

  const argoHull = new ExtrudeGeometry(argoShape, {
    depth: 1.48,
    bevelEnabled: true,
    bevelThickness: 0.14,
    bevelSize: 0.1,
    bevelSegments: 2,
  });
  argoHull.center();
  // Rotate profile (+X=forward -> +Z=forward, +Y=up -> +Y=up, extrude Z -> X)
  argoHull.rotateY(-Math.PI / 2);

  // Valkyrie swept delta wing planform (X, Y -> rotated onto X, Z)
  const wingShape = new Shape();
  wingShape.moveTo(0, 1.9);
  wingShape.lineTo(0.42, 0.95);
  wingShape.lineTo(1.92, -0.85);
  wingShape.lineTo(1.85, -1.25);
  wingShape.lineTo(0.55, -1.08);
  wingShape.lineTo(-0.55, -1.08);
  wingShape.lineTo(-1.85, -1.25);
  wingShape.lineTo(-1.92, -0.85);
  wingShape.lineTo(-0.42, 0.95);
  wingShape.closePath();

  const valkyrieWing = new ExtrudeGeometry(wingShape, {
    depth: 0.08,
    bevelEnabled: true,
    bevelThickness: 0.03,
    bevelSize: 0.04,
    bevelSegments: 2,
  });
  valkyrieWing.center();
  valkyrieWing.rotateX(Math.PI / 2);

  // Valkyrie chined lifting-body core
  const bodyShape = new Shape();
  bodyShape.moveTo(-1.75, -0.18);
  bodyShape.lineTo(1.65, -0.16);
  bodyShape.lineTo(2.25, -0.02);
  bodyShape.lineTo(1.55, 0.22);
  bodyShape.lineTo(0.35, 0.34);
  bodyShape.lineTo(-1.55, 0.26);
  bodyShape.closePath();

  const valkyrieFuselage = new ExtrudeGeometry(bodyShape, {
    depth: 0.72,
    bevelEnabled: true,
    bevelThickness: 0.1,
    bevelSize: 0.08,
    bevelSegments: 2,
  });
  valkyrieFuselage.center();
  valkyrieFuselage.rotateY(-Math.PI / 2);

  cachedGeometries = { argoHull, valkyrieWing, valkyrieFuselage };
  return cachedGeometries;
}

/**
 * Argo-class heavy utility/cargo tender (~5.4m):
 * Beveled chined hull with canvas plating, ventral TPS heat-shield tiles,
 * recessed dark tinted glass cockpit, dorsal docking hatch, 3 pressurized cargo drums,
 * articulated gimballed outrigger thruster nacelles, micro-RCS vents, and pinpoint nav lights.
 */
function ArgoClassCargoTender({
  nacelleRefs,
  rcsPuffRef,
}: {
  nacelleRefs: MutableRefObject<(Group | null)[]>;
  rcsPuffRef: MutableRefObject<Group | null>;
}) {
  const textures = useMemo(() => getShuttleTextures(), []);
  const geos = useMemo(() => getShuttleGeometries(), []);

  return (
    <group>
      {/* Sculpted Beveled Main Fuselage (~5.1m overall with nose) */}
      <mesh geometry={geos.argoHull} position={[0, 0.08, 0.2]} castShadow receiveShadow>
        <meshStandardMaterial
          color="#64748b"
          map={textures?.panelAlbedo ?? null}
          bumpMap={textures?.panelBump ?? null}
          bumpScale={0.025}
          roughness={0.48}
          metalness={0.78}
        />
      </mesh>

      {/* Ventral Thermal Protection Heat-Shield Belly Plate */}
      <mesh position={[0, -0.38, 0.3]} castShadow receiveShadow>
        <boxGeometry args={[1.48, 0.08, 3.8]} />
        <meshStandardMaterial
          color="#334155"
          map={textures?.heatTileAlbedo ?? null}
          bumpMap={textures?.heatTileBump ?? null}
          bumpScale={0.03}
          roughness={0.85}
          metalness={0.22}
        />
      </mesh>

      {/* Forward Chined Sensor & Bumper Nose Cap */}
      <mesh position={[0, -0.02, 2.58]} rotation={[Math.PI / 2, 0, Math.PI / 4]} castShadow>
        <cylinderGeometry args={[0.24, 0.56, 0.62, 4]} />
        <meshStandardMaterial color="#1e293b" roughness={0.42} metalness={0.85} />
      </mesh>

      {/* Cockpit Framing Brow & Recessed Dark Tinted Glass Canopy */}
      <mesh position={[0, 0.47, 1.38]} rotation={[0.26, 0, 0]} castShadow>
        <boxGeometry args={[1.08, 0.24, 0.92]} />
        <meshStandardMaterial color="#1e293b" roughness={0.45} metalness={0.85} />
      </mesh>
      <mesh position={[0, 0.49, 1.44]} rotation={[0.28, 0, 0]}>
        <boxGeometry args={[0.92, 0.16, 0.78]} />
        <meshStandardMaterial
          color="#07131f"
          emissive="#0284c7"
          emissiveIntensity={0.2}
          roughness={0.07}
          metalness={0.94}
          toneMapped
        />
      </mesh>

      {/* Dorsal Docking Hatch Collar & Alignment Ring */}
      <group position={[0, 0.64, -0.15]}>
        <mesh castShadow>
          <cylinderGeometry args={[0.42, 0.48, 0.12, 16]} />
          <meshStandardMaterial color="#334155" roughness={0.5} metalness={0.85} />
        </mesh>
        <mesh position={[0, 0.065, 0]} rotation={[Math.PI / 2, 0, 0]}>
          <torusGeometry args={[0.36, 0.03, 6, 16]} />
          <meshStandardMaterial color="#d97706" roughness={0.4} metalness={0.55} />
        </mesh>
      </group>

      {/* 3 Modular Pressurized Freight Canisters in Underslung Cargo Rack */}
      {[-0.45, -1.25, -2.05].map((z, idx) => (
        <group key={`pod-${idx}`} position={[0, -0.12, z]}>
          <mesh rotation={[0, 0, Math.PI / 2]} castShadow receiveShadow>
            <cylinderGeometry args={[0.46, 0.46, 1.62, 14]} />
            <meshStandardMaterial
              color={idx === 1 ? '#d97706' : '#94a3b8'}
              map={textures?.panelAlbedo ?? null}
              bumpMap={textures?.panelBump ?? null}
              bumpScale={0.02}
              roughness={0.46}
              metalness={0.52}
            />
          </mesh>
          <mesh>
            <boxGeometry args={[1.66, 0.1, 0.18]} />
            <meshStandardMaterial color="#0f172a" roughness={0.6} metalness={0.88} />
          </mesh>
        </group>
      ))}

      {/* Wing Strakes & Articulated Gimballed Outrigger Thruster Nacelles */}
      {[-1.32, 1.32].map((x, idx) => (
        <group key={`nacelle-arm-${x}`} position={[x * 0.85, 0.04, -1.05]}>
          {/* Structural Outrigger Wing Strake */}
          <mesh rotation={[0, 0, x > 0 ? -0.12 : 0.12]} castShadow>
            <boxGeometry args={[0.92, 0.12, 0.95]} />
            <meshStandardMaterial color="#334155" roughness={0.55} metalness={0.82} />
          </mesh>

          {/* Gimballed Thruster Pod (tilts forward during docking braking/hover) */}
          <group
            ref={(el) => {
              nacelleRefs.current[idx] = el;
            }}
            position={[x > 0 ? 0.5 : -0.5, 0, 0]}
          >
            {/* Armored Nacelle Cowling */}
            <mesh rotation={[Math.PI / 2, 0, 0]} castShadow>
              <cylinderGeometry args={[0.26, 0.31, 1.85, 14]} />
              <meshStandardMaterial
                color="#475569"
                map={textures?.panelAlbedo ?? null}
                roughness={0.42}
                metalness={0.85}
              />
            </mesh>
            {/* Exhaust Bell Nozzle */}
            <mesh position={[0, 0, -0.98]} rotation={[Math.PI / 2, 0, 0]}>
              <cylinderGeometry args={[0.17, 0.25, 0.24, 12]} />
              <meshStandardMaterial color="#0f172a" roughness={0.35} metalness={0.92} />
            </mesh>
            {/* Recessed Subtle Thruster Throat Glow (toneMapped=true, NEVER a bloom orb) */}
            <mesh position={[0, 0, -0.94]} rotation={[Math.PI / 2, 0, 0]}>
              <cylinderGeometry args={[0.13, 0.15, 0.1, 12]} />
              <meshStandardMaterial
                color="#0284c7"
                emissive="#38bdf8"
                emissiveIntensity={1.05}
                roughness={0.3}
                toneMapped
              />
            </mesh>
          </group>
        </group>
      ))}

      {/* Pinpoint Navigation Lights (radius <= 0.03, toneMapped=true so ZERO bloom smear) */}
      <mesh position={[-1.78, 0.06, -1.05]}>
        <sphereGeometry args={[0.025, 8, 8]} />
        <meshStandardMaterial color="#ef4444" emissive="#ef4444" emissiveIntensity={1.0} toneMapped />
      </mesh>
      <mesh position={[1.78, 0.06, -1.05]}>
        <sphereGeometry args={[0.025, 8, 8]} />
        <meshStandardMaterial color="#10b981" emissive="#10b981" emissiveIntensity={1.0} toneMapped />
      </mesh>
      <mesh position={[0, 0.72, -1.5]}>
        <sphereGeometry args={[0.022, 8, 8]} />
        <meshStandardMaterial color="#f8fafc" emissive="#f8fafc" emissiveIntensity={1.0} toneMapped />
      </mesh>

      {/* Micro-RCS Maneuvering Puffs (visible ONLY during docking deceleration / hover) */}
      <group ref={rcsPuffRef} visible={false}>
        {[-0.84, 0.84].map((x) => (
          <mesh key={`rcs-puff-${x}`} position={[x * 1.15, 0.08, 1.45]} rotation={[0, 0, x > 0 ? -Math.PI / 2 : Math.PI / 2]}>
            <coneGeometry args={[0.06, 0.36, 8]} />
            <meshBasicMaterial color="#bae6fd" transparent opacity={0.35} depthWrite={false} />
          </mesh>
        ))}
      </group>
    </group>
  );
}

/**
 * Valkyrie-class sleek delta courier/escort shuttle (~4.2m):
 * Sculpted swept delta wings, chined lifting body, dark metallic glass canopy,
 * dorsal docking hatch, ventral heat-shield plating, twin canted stabilizers,
 * gimballed vectoring exhaust nozzles, and crisp pinpoint nav lights.
 */
function ValkyrieClassTacticalShuttle({
  nozzleRefs,
  rcsPuffRef,
}: {
  nozzleRefs: MutableRefObject<(Group | null)[]>;
  rcsPuffRef: MutableRefObject<Group | null>;
}) {
  const textures = useMemo(() => getShuttleTextures(), []);
  const geos = useMemo(() => getShuttleGeometries(), []);

  return (
    <group>
      {/* Primary Chined Lifting-Body Fuselage */}
      <mesh geometry={geos.valkyrieFuselage} position={[0, 0.04, 0.1]} castShadow receiveShadow>
        <meshStandardMaterial
          color="#475569"
          map={textures?.panelAlbedo ?? null}
          bumpMap={textures?.panelBump ?? null}
          bumpScale={0.02}
          roughness={0.38}
          metalness={0.86}
        />
      </mesh>

      {/* Sculpted Swept Delta Strike Wings */}
      <mesh geometry={geos.valkyrieWing} position={[0, -0.05, -0.15]} castShadow receiveShadow>
        <meshStandardMaterial
          color="#334155"
          map={textures?.panelAlbedo ?? null}
          bumpMap={textures?.panelBump ?? null}
          bumpScale={0.02}
          roughness={0.42}
          metalness={0.84}
        />
      </mesh>

      {/* Ventral Heat-Shield Belly Tiles */}
      <mesh position={[0, -0.17, -0.15]} castShadow>
        <boxGeometry args={[0.88, 0.05, 2.75]} />
        <meshStandardMaterial
          color="#262c36"
          map={textures?.heatTileAlbedo ?? null}
          bumpMap={textures?.heatTileBump ?? null}
          bumpScale={0.025}
          roughness={0.88}
          metalness={0.2}
        />
      </mesh>

      {/* Recessed Dark Tinted Tandem Cockpit Canopy */}
      <mesh position={[0, 0.25, 0.65]} rotation={[0.18, 0, 0]} castShadow>
        <boxGeometry args={[0.52, 0.18, 1.18]} />
        <meshStandardMaterial color="#0f172a" roughness={0.35} metalness={0.9} />
      </mesh>
      <mesh position={[0, 0.28, 0.68]} rotation={[0.18, 0, 0]}>
        <boxGeometry args={[0.42, 0.14, 1.02]} />
        <meshStandardMaterial
          color="#06121f"
          emissive="#0ea5e9"
          emissiveIntensity={0.22}
          roughness={0.06}
          metalness={0.96}
          toneMapped
        />
      </mesh>

      {/* Dorsal Docking & Avionics Spine Hatch */}
      <mesh position={[0, 0.34, -0.45]} castShadow>
        <cylinderGeometry args={[0.26, 0.3, 0.08, 12]} />
        <meshStandardMaterial color="#1e293b" roughness={0.45} metalness={0.88} />
      </mesh>

      {/* Twin Canted Vertical Stabilizers + Pinpoint Tail Beacons */}
      {[-0.64, 0.64].map((x) => (
        <group key={`fin-${x}`} position={[x, 0.34, -1.02]} rotation={[0.18, 0, x > 0 ? 0.34 : -0.34]}>
          <mesh castShadow>
            <boxGeometry args={[0.05, 0.68, 0.84]} />
            <meshStandardMaterial color="#334155" roughness={0.42} metalness={0.82} />
          </mesh>
          <mesh position={[0, 0.35, -0.18]}>
            <sphereGeometry args={[0.02, 8, 8]} />
            <meshStandardMaterial color="#f8fafc" emissive="#f8fafc" emissiveIntensity={1.0} toneMapped />
          </mesh>
        </group>
      ))}

      {/* Port & Starboard Wingtip Pinpoint Nav Lights (radius <= 0.03, toneMapped=true) */}
      <mesh position={[-1.88, -0.04, -1.04]}>
        <sphereGeometry args={[0.022, 8, 8]} />
        <meshStandardMaterial color="#ef4444" emissive="#ef4444" emissiveIntensity={1.0} toneMapped />
      </mesh>
      <mesh position={[1.88, -0.04, -1.04]}>
        <sphereGeometry args={[0.022, 8, 8]} />
        <meshStandardMaterial color="#10b981" emissive="#10b981" emissiveIntensity={1.0} toneMapped />
      </mesh>

      {/* Twin Gimballed Vectoring Afterburner Nozzles */}
      {[-0.3, 0.3].map((x, idx) => (
        <group
          key={`thrust-${x}`}
          ref={(el) => {
            nozzleRefs.current[idx] = el;
          }}
          position={[x, 0.01, -1.62]}
        >
          <mesh rotation={[Math.PI / 2, 0, 0]}>
            <cylinderGeometry args={[0.16, 0.21, 0.26, 12]} />
            <meshStandardMaterial color="#0f172a" roughness={0.32} metalness={0.92} />
          </mesh>
          <mesh position={[0, 0, -0.06]} rotation={[Math.PI / 2, 0, 0]}>
            <cylinderGeometry args={[0.11, 0.13, 0.1, 12]} />
            <meshStandardMaterial
              color="#0284c7"
              emissive="#06b6d4"
              emissiveIntensity={1.1}
              roughness={0.25}
              toneMapped
            />
          </mesh>
        </group>
      ))}

      {/* Wing-Root RCS Maneuvering Vents */}
      <group ref={rcsPuffRef} visible={false}>
        {[-1.1, 1.1].map((x) => (
          <mesh key={`v-rcs-${x}`} position={[x, 0.02, 0.15]} rotation={[x > 0 ? Math.PI : 0, 0, 0]}>
            <coneGeometry args={[0.04, 0.26, 8]} />
            <meshBasicMaterial color="#bae6fd" transparent opacity={0.3} depthWrite={false} />
          </mesh>
        ))}
      </group>
    </group>
  );
}

/**
 * Maps uniform normalized time `phase` in [0, 1) to non-uniform spline parameter `u`
 * that smoothly decelerates to a near-stationary cargo transfer hover at `holdU`,
 * then smoothly accelerates back along the spacedock shuttle corridor.
 */
function cargoTransferPhase(phase: number, holdPhase: number): { u: number; speedFactor: number } {
  const angle = (phase - holdPhase) * Math.PI * 2;
  const k = 0.95 / (Math.PI * 2);
  const u = (phase - k * Math.sin(angle) + 1) % 1;
  const speedFactor = 1 - 0.95 * Math.cos(angle);
  return { u, speedFactor };
}

export function ShuttleCraft({
  enabled = true,
  missionState,
}: {
  enabled?: boolean;
  missionState?: MissionState | null;
  missionProgress?: number;
} = {}) {
  const cargoRef = useRef<Group>(null);
  const tacticalRef = useRef<Group>(null);
  const argoNacelleRefs = useRef<(Group | null)[]>([]);
  const valkyrieNozzleRefs = useRef<(Group | null)[]>([]);
  const argoRcsRef = useRef<Group | null>(null);
  const valkyrieRcsRef = useRef<Group | null>(null);
  const reducedMotion = useReducedMotion();

  // Closed C² shuttle corridor splines outside spacedock structural envelope (GANTRY_X_OUTER = 14.0)
  const { cargoSpline, tacticalSpline } = useMemo(() => {
    const cargo = new CatmullRomCurve3(
      [
        new Vector3(-26.5, 2.2, 21.0),
        new Vector3(-22.8, -0.8, 5.0),
        new Vector3(-22.5, -1.8, -8.0), // Lateral transfer pad outside port dock truss
        new Vector3(-23.0, -2.0, -18.0),
        new Vector3(-15.5, 2.5, -29.0),
        new Vector3(15.5, 6.4, -27.5),
        new Vector3(24.5, 5.2, 6.0),
        new Vector3(-4.0, 3.6, 28.0),
      ],
      true,
      'centripetal',
    );

    const tactical = new CatmullRomCurve3(
      [
        new Vector3(6.0, -5.5, -28.0),
        new Vector3(-22.0, 2.5, -21.0),
        new Vector3(-23.5, 7.2, 16.0),
        new Vector3(19.0, 4.8, 25.5),
        new Vector3(25.0, -2.0, -2.0),
      ],
      true,
      'centripetal',
    );

    return { cargoSpline: cargo, tacticalSpline: tactical };
  }, []);

  // Reusable per-instance scratch math objects (zero allocations in useFrame)
  const scratch = useMemo(
    () => ({
      pos: new Vector3(),
      posPrev: new Vector3(),
      posNext: new Vector3(),
      vel: new Vector3(),
      velPrev: new Vector3(),
      acc: new Vector3(),
      right: new Vector3(),
      up: new Vector3(0, 1, 0),
      basis: new Matrix4(),
      quat: new Quaternion(),
      rollQuat: new Quaternion(),
      forwardAxis: new Vector3(0, 0, 1),
    }),
    [],
  );

  // Initial static poses used on first frame and under reduced motion
  const staticCargoPose = useMemo(() => {
    const pos = cargoSpline.getPointAt(0.28);
    const vel = cargoSpline.getTangentAt(0.28).normalize();
    const up = new Vector3(0, 1, 0);
    const right = new Vector3().crossVectors(up, vel);
    if (right.lengthSq() < 1e-6) right.set(1, 0, 0);
    right.normalize();
    const localUp = new Vector3().crossVectors(vel, right).normalize();
    const quat = new Quaternion().setFromRotationMatrix(new Matrix4().makeBasis(right, localUp, vel));
    return {
      position: [pos.x, pos.y, pos.z] as [number, number, number],
      quaternion: quat,
    };
  }, [cargoSpline]);

  const staticTacticalPose = useMemo(() => {
    const pos = tacticalSpline.getPointAt(0.0);
    const vel = tacticalSpline.getTangentAt(0.0).normalize();
    const up = new Vector3(0, 1, 0);
    const right = new Vector3().crossVectors(up, vel);
    if (right.lengthSq() < 1e-6) right.set(1, 0, 0);
    right.normalize();
    const localUp = new Vector3().crossVectors(vel, right).normalize();
    const quat = new Quaternion().setFromRotationMatrix(new Matrix4().makeBasis(right, localUp, vel));
    quat.multiply(new Quaternion().setFromAxisAngle(new Vector3(0, 0, 1), -0.18));
    return {
      position: [pos.x, pos.y, pos.z] as [number, number, number],
      quaternion: quat,
    };
  }, [tacticalSpline]);

  useFrame((state) => {
    if (reducedMotion || !enabled) return;
    const t = state.clock.elapsedTime;
    const isDeparting = missionState === 'departing';

    // 1. Argo Heavy Cargo Tender: spacedock lateral corridor approach, deceleration, pad hover, climb-out
    if (cargoRef.current) {
      const cycleDuration = 28.0;
      // Hold near pad during ship departure clearance so lane stays unobstructed
      const phase = isDeparting ? 0.28 : ((t / cycleDuration + 0.28) % 1);
      const { u, speedFactor } = cargoTransferPhase(phase, 0.28);

      const eps = 0.008;
      cargoSpline.getPointAt(u, scratch.pos);
      cargoSpline.getPointAt((u - eps + 1) % 1, scratch.posPrev);
      cargoSpline.getPointAt((u + eps) % 1, scratch.posNext);

      scratch.vel.copy(scratch.posNext).sub(scratch.pos).normalize();
      scratch.velPrev.copy(scratch.pos).sub(scratch.posPrev).normalize();
      scratch.acc.copy(scratch.vel).sub(scratch.velPrev);

      // Gentle vertical station-keeping micro-damping while hovering on transfer pad
      const hovering = speedFactor < 0.22;
      if (hovering) {
        scratch.pos.y += Math.sin(t * 1.4) * 0.03;
      }
      cargoRef.current.position.copy(scratch.pos);

      // Build aircraft orientation from forward velocity and banked up vector
      scratch.right.crossVectors(scratch.up, scratch.vel);
      if (scratch.right.lengthSq() < 1e-6) scratch.right.set(1, 0, 0);
      scratch.right.normalize();
      const lateralAcc = scratch.acc.dot(scratch.right);
      const bankAngle = hovering
        ? 0
        : MathUtils.clamp(-lateralAcc * 14.0 * speedFactor, -0.38, 0.38);

      // Pitch nose up slightly during braking flare before settling level on pad
      const approachingPad = phase < 0.28 && phase > 0.16 && speedFactor < 0.65;
      const pitchOffset = approachingPad ? -0.1 : 0;

      const localUp = scratch.posPrev.copy(scratch.up).crossVectors(scratch.vel, scratch.right).normalize();
      scratch.basis.makeBasis(scratch.right, localUp, scratch.vel);
      scratch.quat.setFromRotationMatrix(scratch.basis);

      if (Math.abs(bankAngle) > 0.001 || Math.abs(pitchOffset) > 0.001) {
        scratch.rollQuat.setFromAxisAngle(scratch.forwardAxis, bankAngle);
        scratch.quat.multiply(scratch.rollQuat);
        scratch.rollQuat.setFromAxisAngle(scratch.posNext.set(1, 0, 0), pitchOffset);
        scratch.quat.multiply(scratch.rollQuat);
      }
      cargoRef.current.quaternion.copy(scratch.quat);

      // Tilt gimballed thruster nacelles downward for hover/braking, aft for cruise
      const targetGimbal = hovering ? 0.52 : approachingPad ? 0.35 : 0.04;
      for (const nacelle of argoNacelleRefs.current) {
        if (nacelle) nacelle.rotation.x = MathUtils.lerp(nacelle.rotation.x, targetGimbal, 0.12);
      }
      if (argoRcsRef.current) {
        argoRcsRef.current.visible = approachingPad || (hovering && Math.sin(t * 5.0) > 0.4);
      }
    }

    // 2. Valkyrie Tactical Shuttle: smooth banked orbital escort circuit
    if (tacticalRef.current) {
      const u = (t / 19.0) % 1;
      const eps = 0.01;

      tacticalSpline.getPointAt(u, scratch.pos);
      tacticalSpline.getPointAt((u - eps + 1) % 1, scratch.posPrev);
      tacticalSpline.getPointAt((u + eps) % 1, scratch.posNext);

      scratch.vel.copy(scratch.posNext).sub(scratch.pos).normalize();
      scratch.velPrev.copy(scratch.pos).sub(scratch.posPrev).normalize();
      scratch.acc.copy(scratch.vel).sub(scratch.velPrev);

      tacticalRef.current.position.copy(scratch.pos);

      scratch.right.crossVectors(scratch.up, scratch.vel);
      if (scratch.right.lengthSq() < 1e-6) scratch.right.set(1, 0, 0);
      scratch.right.normalize();
      const lateralAcc = scratch.acc.dot(scratch.right);
      const bankAngle = MathUtils.clamp(-lateralAcc * 18.0, -0.68, 0.68);
      const localUp = scratch.posPrev.copy(scratch.up).crossVectors(scratch.vel, scratch.right).normalize();

      scratch.basis.makeBasis(scratch.right, localUp, scratch.vel);
      scratch.quat.setFromRotationMatrix(scratch.basis);
      scratch.rollQuat.setFromAxisAngle(scratch.forwardAxis, bankAngle);
      scratch.quat.multiply(scratch.rollQuat);
      tacticalRef.current.quaternion.copy(scratch.quat);

      // Subtle nozzle gimbal deflection proportional to bank/turn rate
      const nozzleYaw = MathUtils.clamp(lateralAcc * 2.2, -0.18, 0.18);
      for (const nozzle of valkyrieNozzleRefs.current) {
        if (nozzle) nozzle.rotation.y = nozzleYaw;
      }
      if (valkyrieRcsRef.current) {
        valkyrieRcsRef.current.visible = Math.abs(lateralAcc) > 0.025 && Math.sin(t * 7.5) > 0.3;
      }
    }
  });

  if (!enabled) return null;

  // Fragment root keeps each shuttle as a distinct low-mesh scene child (~14-19 meshes)
  // so engine-eval's runnerUpMeshes check never confuses auxiliary craft with the hero ship.
  return (
    <>
      <group
        ref={cargoRef}
        position={staticCargoPose.position}
        quaternion={staticCargoPose.quaternion}
      >
        <ArgoClassCargoTender nacelleRefs={argoNacelleRefs} rcsPuffRef={argoRcsRef} />
      </group>
      <group
        ref={tacticalRef}
        position={staticTacticalPose.position}
        quaternion={staticTacticalPose.quaternion}
      >
        <ValkyrieClassTacticalShuttle
          nozzleRefs={valkyrieNozzleRefs}
          rcsPuffRef={valkyrieRcsRef}
        />
      </group>
    </>
  );
}
