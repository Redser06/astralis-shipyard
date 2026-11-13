import { useMemo, type ReactElement, type ReactNode } from 'react';
import { Vector2 } from 'three';
import type { ArchetypeId, Vec3 } from '../../domain/types';
import { DEFAULT_HULL_PROFILE, sampleProfile, type ProfilePoint } from '../../domain/profile';
import {
  HULL_SOLIDS,
  axisRotation,
  hullBounds,
  hullReach,
  hullVolumes,
  type Solid,
} from '../../domain/hullForm';
import { stationExposure, surfaceForSolid, type DamageOptions } from '../../domain/damage';
import { SurfaceDamage } from '../damage/Damage';

/**
 * Hull geometry, one mesh per declared solid.
 *
 * The shapes themselves live in `domain/hullForm.ts`, not here. That is the
 * point: the socket resolver ray-casts against those same solids, so hardware
 * is seated on the hull that actually renders rather than on a set of numbers
 * somebody typed out once and never reconciled. Five archetypes' worth of
 * radiators starting in vacuum is what the old arrangement cost.
 *
 * Each mesh takes the material as an element and renders it, so React Three
 * Fiber creates and disposes one material instance per mesh. Meshes both cast
 * and receive shadows — the prototype had no shadow map at all, which is a
 * large part of why the ships read as flat toys.
 */
export interface HullProps {
  material: ReactElement;
  /** Lathe cross-section — only the aerodynamic archetype revolves one. */
  profile?: readonly ProfilePoint[];
}

const asTuple = (v: Vec3): [number, number, number] => [v[0], v[1], v[2]];

/* ------------------------------------------------------------------ */

function LatheHull({
  material,
  profile,
  segments,
  damage,
}: HullProps & { segments: number; damage?: ReactNode }) {
  // The one archetype built to meet atmosphere. Its cross-section is revolved
  // from the Hull Sculptor's control points, sampled through the same
  // Catmull-Rom the 2D editor draws — so what you draw is what you get.
  const points = useMemo(
    () =>
      sampleProfile(profile ?? DEFAULT_HULL_PROFILE, 10).map(
        (point) => new Vector2(point.r, point.z),
      ),
    [profile],
  );

  // Rotation is derived from the declared axis, never hand-typed. A hand-typed
  // Rx(-90°) is what revolved this hull back-to-front: it maps the profile's +z
  // to world -Z, so the needle nose rendered at the stern, inside the engine
  // sockets, and the blunt tail became the bow.
  return (
    <mesh rotation={asTuple(axisRotation('z'))} castShadow receiveShadow>
      <latheGeometry args={[points, segments]} />
      {material}
      {damage}
    </mesh>
  );
}

function SolidMesh({
  solid,
  material,
  profile,
  damage,
}: { solid: Solid; damage?: ReactNode } & HullProps): ReactElement | null {
  switch (solid.kind) {
    case 'box':
      return (
        <mesh
          position={asTuple(solid.position)}
          rotation={solid.rotation ? asTuple(solid.rotation) : undefined}
          castShadow
          receiveShadow
        >
          <boxGeometry args={[solid.size[0], solid.size[1], solid.size[2]]} />
          {material}
          {damage}
        </mesh>
      );

    case 'sphere':
      return (
        <mesh position={asTuple(solid.position)} castShadow receiveShadow>
          <sphereGeometry args={[solid.radius, solid.segments?.[0] ?? 18, solid.segments?.[1] ?? 12]} />
          {material}
          {damage}
        </mesh>
      );

    case 'capsule':
      return (
        <mesh
          position={asTuple(solid.position)}
          rotation={asTuple(axisRotation(solid.axis))}
          castShadow
          receiveShadow
        >
          <capsuleGeometry
            args={[solid.radius, solid.length, solid.segments?.[0] ?? 4, solid.segments?.[1] ?? 12]}
          />
          {material}
          {damage}
        </mesh>
      );

    case 'frustum':
      // three's radiusTop is the +axis end, which is `radiusEnd` here.
      return (
        <mesh
          position={asTuple(solid.position)}
          rotation={asTuple(axisRotation(solid.axis, solid.twist))}
          castShadow
          receiveShadow
        >
          <cylinderGeometry
            args={[solid.radiusEnd, solid.radiusStart, solid.height, solid.sides]}
          />
          {material}
          {damage}
        </mesh>
      );

    case 'ring':
      return (
        <mesh
          position={asTuple(solid.position)}
          rotation={solid.rotation ? asTuple(solid.rotation) : undefined}
          castShadow
          receiveShadow
        >
          <torusGeometry
            args={[solid.radius, solid.tube, solid.radialSegments, solid.tubularSegments]}
          />
          {material}
        </mesh>
      );

    case 'lathe':
      return (
        <LatheHull
          material={material}
          profile={profile}
          segments={solid.segments}
          damage={damage}
        />
      );
  }
}

interface AirlockAnchor {
  y: number;
  z: number;
  scale: number;
}

/**
 * Aligned port/starboard airlock coordinates matching DrydockStation extendable
 * gantry tunnels. Side X coordinate is computed dynamically via `hullReach` so
 * collars seat flush even if `aerodynamic_sleek` profile is sculpted.
 */
const AIRLOCK_ANCHORS: Record<ArchetypeId, AirlockAnchor> = {
  angular_stealth: { y: 0.35, z: 1.8, scale: 0.72 },
  industrial_expanse: { y: 0.35, z: 4.5, scale: 1.0 },
  brutalist_dreadnought: { y: 0.78, z: 1.5, scale: 1.05 },
  outrigger_science: { y: 0.0, z: -0.5, scale: 0.75 },
  aerodynamic_sleek: { y: 0.0, z: 2.0, scale: 0.74 },
  starfleet_explorer: { y: 0.5, z: 3.0, scale: 0.92 },
  delta_strikefighter: { y: 0.0, z: 0.4, scale: 0.72 },
  deep_space_cruiser: { y: 0.0, z: 3.7, scale: 0.96 },
};

const RADIAL_8 = [0, 1, 2, 3, 4, 5, 6, 7] as const;
const RADIAL_6 = [0, 1, 2, 3, 4, 5] as const;
const RADIAL_4 = [0, 1, 2, 3] as const;

function AirlockCollar({
  position,
  side,
  scale,
  material,
}: {
  position: [number, number, number];
  side: -1 | 1;
  scale: number;
  material: ReactElement;
}) {
  return (
    <group
      position={position}
      rotation={[0, 0, -side * (Math.PI / 2)]}
      scale={[scale, scale, scale]}
    >
      {/* Heavy armored octagonal docking coaming skirt embedded into hull plate */}
      <mesh position={[0, 0.01, 0]} castShadow receiveShadow>
        <cylinderGeometry args={[0.42, 0.48, 0.1, 8]} />
        {material}
      </mesh>
      {/* Outer beveled pressure flange collar */}
      <mesh position={[0, 0.06, 0]} castShadow receiveShadow>
        <cylinderGeometry args={[0.37, 0.41, 0.05, 16]} />
        {material}
      </mesh>
      {/* Recessed armored pressure bulkhead hatch */}
      <mesh position={[0, 0.075, 0]} castShadow receiveShadow>
        <cylinderGeometry args={[0.29, 0.29, 0.04, 16]} />
        <meshStandardMaterial color="#1e293b" roughness={0.55} metalness={0.75} />
      </mesh>
      {/* Central manual dogging wheel / lock hub */}
      <mesh position={[0, 0.095, 0]} castShadow>
        <cylinderGeometry args={[0.09, 0.11, 0.03, 6]} />
        <meshStandardMaterial color="#334155" roughness={0.4} metalness={0.85} />
      </mesh>
      {/* 4 perimeter mechanical clamping lugs */}
      {RADIAL_4.map((k) => {
        const a = (k * Math.PI) / 2 + Math.PI / 4;
        return (
          <mesh
            key={`lug-${k}`}
            position={[Math.cos(a) * 0.34, 0.08, Math.sin(a) * 0.34]}
            rotation={[0, -a, 0]}
            castShadow
          >
            <boxGeometry args={[0.08, 0.05, 0.06]} />
            {material}
          </mesh>
        );
      })}
      {/* Tiny docking alignment beacons (<= 0.025 radius, tone-mapped) */}
      {[-1, 1].map((s) => (
        <mesh key={`align-${s}`} position={[0, 0.085, s * 0.36]}>
          <sphereGeometry args={[0.022, 8, 8]} />
          <meshStandardMaterial
            color={s > 0 ? '#38bdf8' : '#f59e0b'}
            emissive={s > 0 ? '#38bdf8' : '#f59e0b'}
            emissiveIntensity={1.6}
          />
        </mesh>
      ))}
    </group>
  );
}

export function Hull({ archetype, material, profile }: { archetype: ArchetypeId } & HullProps) {
  const solids = HULL_SOLIDS[archetype];

  const volumes = useMemo(() => hullVolumes(archetype, profile), [archetype, profile]);

  /**
   * Battle damage, one set per plate.
   *
   * A decal has to be projected onto a specific mesh, so the marks are placed
   * per solid, in that solid's own geometry frame, and rendered as its child.
   * Whether any of them appear at all is decided by `DamageProvider` in
   * `Ship` — this only says where they would go.
   */
  const damage = useMemo(() => {
    const bounds = hullBounds(volumes);
    return solids.map((solid, i) => {
      const surface = surfaceForSolid(solid, profile ?? DEFAULT_HULL_PROFILE);
      if (!surface) return null;
      // The lathe is a single mesh spanning the whole ship, so it takes the
      // exposure of its midpoint rather than of a station it does not have.
      const z = solid.kind === 'lathe' ? (bounds.minZ + bounds.maxZ) / 2 : solid.position[2];
      const options: DamageOptions = {
        exposure: stationExposure(z, bounds.minZ, bounds.maxZ),
        max: 8,
      };
      return { surface, options, tag: `hull:${archetype}:${i}` };
    });
  }, [archetype, profile, solids, volumes]);

  const airlocks = useMemo(() => {
    const anchor = AIRLOCK_ANCHORS[archetype];
    const sides: ReadonlyArray<-1 | 1> = [-1, 1];
    return sides
      .map((side) => {
        const reach = hullReach(volumes, [0, anchor.y, anchor.z], [side, 0, 0]);
        if (reach == null) return null;
        return {
          side,
          scale: anchor.scale,
          position: [side * (reach - 0.025), anchor.y, anchor.z] as [number, number, number],
        };
      })
      .filter((entry): entry is NonNullable<typeof entry> => entry !== null);
  }, [archetype, volumes]);

  return (
    <group>
      {solids.map((solid, i) => {
        const marks = damage[i];
        return (
          <SolidMesh
            key={`${solid.kind}-${i}`}
            solid={solid}
            material={material}
            profile={profile}
            damage={
              marks ? (
                <SurfaceDamage surface={marks.surface} tag={marks.tag} options={marks.options} />
              ) : null
            }
          />
        );
      })}

      {/* Recessed port & starboard airlock docking collars */}
      {airlocks.map((lock) => (
        <AirlockCollar
          key={`airlock-${lock.side}`}
          position={lock.position}
          side={lock.side}
          scale={lock.scale}
          material={material}
        />
      ))}

      {/* Layered armor strakes, structural ribs & archetype engineering detail */}
      {archetype === 'angular_stealth' && (
        <group>
          {/* Stepped stealth dorsal spine armor shingles */}
          {[-3.0, -1.5, 0.0, 1.5].map((z, idx) => (
            <mesh key={`stealth-rib-${idx}`} position={[0, 0.96, z]} castShadow receiveShadow>
              <boxGeometry args={[1.16, 0.14, 1.08]} />
              {material}
            </mesh>
          ))}
          {/* Ventral armored keel strake */}
          <mesh position={[0, -0.52, -0.4]} castShadow receiveShadow>
            <boxGeometry args={[0.92, 0.14, 7.6]} />
            {material}
          </mesh>
          {/* Recessed flank intake cowls & serrated chaff/sensor blisters */}
          {[-1, 1].map((side) => (
            <group key={`stealth-cheek-${side}`}>
              <mesh position={[side * 1.24, 0.12, 3.05]} castShadow receiveShadow>
                <boxGeometry args={[0.24, 0.34, 1.4]} />
                {material}
              </mesh>
              <mesh position={[side * 1.32, 0.12, 3.05]}>
                <boxGeometry args={[0.1, 0.2, 1.05]} />
                <meshStandardMaterial color="#0f172a" roughness={0.65} metalness={0.6} />
              </mesh>
              {/* Tail fin root actuator fairing */}
              <mesh
                position={[side * 1.08, 0.48, -4.4]}
                rotation={[Math.PI / 2, 0, 0]}
                castShadow
                receiveShadow
              >
                <cylinderGeometry args={[0.18, 0.22, 1.8, 8]} />
                {material}
              </mesh>
            </group>
          ))}
        </group>
      )}

      {archetype === 'industrial_expanse' && (
        <group>
          {/* Bridge armored sun-visor brow & flank telemetry louver blisters */}
          <mesh position={[0, 1.46, 5.9]} castShadow receiveShadow>
            <boxGeometry args={[3.54, 0.24, 3.25]} />
            {material}
          </mesh>
          {[-1, 1].map((side) => (
            <group key={`ind-bridge-${side}`}>
              <mesh position={[side * 1.72, 0.72, 5.6]} castShadow receiveShadow>
                <boxGeometry args={[0.18, 0.56, 1.6]} />
                {material}
              </mesh>
              <mesh position={[side * 1.79, 0.72, 5.6]}>
                <boxGeometry args={[0.06, 0.38, 1.25]} />
                <meshStandardMaterial color="#1e293b" roughness={0.6} metalness={0.7} />
              </mesh>
            </group>
          ))}
          {/* Diagonal X-gusset truss ties uniting spine to outboard longerons */}
          {[1.8, -0.6, -3.0].map((z, idx) => (
            <group key={`ind-gusset-${idx}`} position={[0, 0, z]}>
              {[-1, 1].map((diag) => (
                <mesh key={`d-${diag}`} rotation={[0, 0, diag * (Math.PI / 4)]} castShadow>
                  <boxGeometry args={[4.2, 0.1, 0.12]} />
                  {material}
                </mesh>
              ))}
            </group>
          ))}
          {/* Structural tie-down cradles wrapping slung cargo pods */}
          {[-2.4, 0, 2.4].map((z, idx) => (
            <mesh key={`pod-strap-${idx}`} position={[0, -1.55, z]} castShadow receiveShadow>
              <boxGeometry args={[2.58, 1.36, 0.24]} />
              {material}
            </mesh>
          ))}
        </group>
      )}

      {archetype === 'brutalist_dreadnought' && (
        <group>
          {/* Transverse structural buttress ribs wrapping citadel */}
          {[-4.6, -2.6, -0.6, 1.4, 3.4].map((z, idx) => (
            <mesh key={`dread-rib-${idx}`} position={[0, 0, z]} castShadow receiveShadow>
              <boxGeometry args={[4.78, 2.54, 0.32]} />
              {material}
            </mesh>
          ))}
          {/* Hammerhead prow ERA reactive armor blocks & reinforced ramming brow */}
          {[-1, 1].map((side) => (
            <group key={`dread-era-${side}`}>
              <mesh position={[side * 2.15, 0.98, 6.2]} castShadow receiveShadow>
                <boxGeometry args={[1.9, 0.22, 3.3]} />
                {material}
              </mesh>
              {/* Command tower sensor rangefinder sponsons */}
              <mesh position={[side * 1.18, 2.35, -1.2]} castShadow receiveShadow>
                <boxGeometry args={[0.42, 0.45, 2.4]} />
                {material}
              </mesh>
              {/* Flanking skirt recessed heat-exchanger louvers */}
              {[-3.6, -1.2, 1.2].map((lz, li) => (
                <group key={`louver-${li}`} position={[side * 2.86, -0.25, lz]}>
                  <mesh castShadow receiveShadow>
                    <boxGeometry args={[0.24, 0.72, 1.4]} />
                    {material}
                  </mesh>
                  <mesh position={[side * 0.08, 0, 0]}>
                    <boxGeometry args={[0.1, 0.52, 1.1]} />
                    <meshStandardMaterial color="#0f172a" roughness={0.65} metalness={0.7} />
                  </mesh>
                </group>
              ))}
            </group>
          ))}
          <mesh position={[0, 0.18, 8.2]} castShadow receiveShadow>
            <boxGeometry args={[3.2, 0.85, 0.28]} />
            {material}
          </mesh>
          {/* Spinal mass-driver barrel yoke ribs */}
          {[0.6, 2.2, 3.8, 5.2].map((z, idx) => (
            <mesh key={`trench-yoke-${idx}`} position={[0, 1.48, z]} castShadow>
              <boxGeometry args={[1.04, 0.24, 0.28]} />
              {material}
            </mesh>
          ))}
        </group>
      )}

      {archetype === 'outrigger_science' && (
        <group>
          {/* Cross-strut junction clamps on central capsule and outrigger booms */}
          {[2.6, -0.4, -3.4].map((z, idx) => (
            <group key={`sci-clamp-${idx}`} position={[0, 0, z]}>
              {[-1, 1].map((side) => (
                <group key={`s-${side}`}>
                  <mesh position={[side * 1.02, 0, 0]} castShadow receiveShadow>
                    <boxGeometry args={[0.36, 0.54, 0.54]} />
                    {material}
                  </mesh>
                  <mesh position={[side * 3.78, 0, 0]} castShadow receiveShadow>
                    <boxGeometry args={[0.36, 0.46, 0.46]} />
                    {material}
                  </mesh>
                </group>
              ))}
            </group>
          ))}
          {/* Centrifuge habitat ring radial structural spoke trusses & module cuffs */}
          <group position={[0, 0, -1.0]}>
            {RADIAL_6.map((k) => {
              const a = (k * Math.PI) / 3;
              return (
                <group key={`hab-spoke-${k}`} rotation={[0, 0, a]}>
                  <mesh position={[1.32, 0, 0]} castShadow>
                    <boxGeometry args={[0.96, 0.12, 0.18]} />
                    {material}
                  </mesh>
                  <mesh position={[1.85, 0, 0]} castShadow>
                    <boxGeometry args={[0.42, 0.26, 0.78]} />
                    {material}
                  </mesh>
                </group>
              );
            })}
          </group>
          {/* Forward instrument bulb equatorial telemetry collar & forward aperture shroud */}
          <mesh position={[0, 0, 5.4]} castShadow>
            <torusGeometry args={[1.14, 0.08, 8, 24]} />
            {material}
          </mesh>
          <mesh position={[0, 0, 6.52]} rotation={[Math.PI / 2, 0, 0]} castShadow>
            <cylinderGeometry args={[0.38, 0.48, 0.16, 16]} />
            {material}
          </mesh>
        </group>
      )}

      {archetype === 'aerodynamic_sleek' && (
        <group>
          {/* Wing-root leading-edge strakes (LERX) & control-surface actuator blisters */}
          {[-1, 1].map((side) => (
            <group key={`aero-wing-${side}`}>
              <mesh
                position={[side * 1.18, -0.12, -1.8]}
                rotation={[0, side * -0.25, side * 0.06]}
                castShadow
                receiveShadow
              >
                <boxGeometry args={[0.56, 0.24, 3.1]} />
                {material}
              </mesh>
              <mesh
                position={[side * 2.2, -0.05, -2.55]}
                rotation={[Math.PI / 2, 0, 0]}
                castShadow
              >
                <capsuleGeometry args={[0.11, 1.05, 4, 8]} />
                {material}
              </mesh>
              {/* Wingtip missile rail / aerodynamic flow fences */}
              <mesh position={[side * 3.65, -0.04, -3.05]} castShadow>
                <boxGeometry args={[0.12, 0.34, 2.05]} />
                {material}
              </mesh>
            </group>
          ))}
          {/* Vertical stabilizer dorsal spine fillet & rudder actuator fairing */}
          <mesh position={[0, 0.44, -4.85]} castShadow receiveShadow>
            <boxGeometry args={[0.34, 0.48, 2.75]} />
            {material}
          </mesh>
        </group>
      )}

      {archetype === 'starfleet_explorer' && (
        <group>
          {/* Saucer bridge deck collar & perimeter impulse cowl housings */}
          <mesh position={[0, 1.08, 4.0]} castShadow receiveShadow>
            <cylinderGeometry args={[2.15, 2.55, 0.24, 24]} />
            {material}
          </mesh>
          {[-1, 1].map((side) => (
            <mesh
              key={`impulse-cowl-${side}`}
              position={[side * 2.55, 0.62, 0.05]}
              castShadow
              receiveShadow
            >
              <boxGeometry args={[1.35, 0.38, 0.56]} />
              {material}
            </mesh>
          ))}
          {/* Neck structural ribs */}
          {[-0.2, -0.6, -1.0].map((y, idx) => (
            <mesh key={`neck-rib-${idx}`} position={[0, y, 1.2]} castShadow>
              <boxGeometry args={[1.0, 0.14, 2.7]} />
              {material}
            </mesh>
          ))}

          {/* Twin outrigger warp nacelles: Bussard collectors, field-coil ribs, and warp grilles */}
          {[-1, 1].map((side) => (
            <group key={`nacelle-${side}`}>
              {/* Pylon root & nacelle cradle reinforcement cuffs */}
              <mesh
                position={[side * 1.55, -0.82, -3.4]}
                rotation={[0, 0, side * 0.35]}
                castShadow
              >
                <boxGeometry args={[0.68, 0.44, 1.55]} />
                {material}
              </mesh>
              <mesh
                position={[side * 3.85, 0.15, -3.4]}
                rotation={[0, 0, side * 0.35]}
                castShadow
              >
                <boxGeometry args={[0.65, 0.42, 1.55]} />
                {material}
              </mesh>

              {/* Forward Bussard collector assembly aligned along +Z */}
              <group position={[side * 4.2, 0.6, 1.2]} rotation={[Math.PI / 2, 0, 0]}>
                <mesh position={[0, 0.04, 0]}>
                  <sphereGeometry args={[0.71, 20, 12, 0, Math.PI * 2, 0, Math.PI * 0.52]} />
                  <meshStandardMaterial
                    color="#ff4422"
                    emissive="#ff3b20"
                    emissiveIntensity={2.6}
                    roughness={0.2}
                    metalness={0.1}
                  />
                </mesh>
                {/* Machined titanium stator cowling collar */}
                <mesh rotation={[Math.PI / 2, 0, 0]} castShadow>
                  <torusGeometry args={[0.69, 0.08, 10, 20]} />
                  {material}
                </mesh>
                {/* Central ramscoop intake hub & 8 radial stator blades proud of collector dome */}
                <mesh position={[0, 0.66, 0]} castShadow>
                  <cylinderGeometry args={[0.1, 0.19, 0.28, 12]} />
                  {material}
                </mesh>
                {RADIAL_8.map((k) => {
                  const a = (k * Math.PI) / 4;
                  return (
                    <mesh
                      key={`b-vane-${k}`}
                      position={[Math.cos(a) * 0.41, 0.58, Math.sin(a) * 0.41]}
                      rotation={[0, -a, -0.32]}
                      castShadow
                    >
                      <boxGeometry args={[0.54, 0.12, 0.05]} />
                      {material}
                    </mesh>
                  );
                })}
              </group>

              {/* Nacelle segmented external warp field-coil ribs & grilles */}
              <group position={[side * 4.2, 0.6, -3.4]}>
                {[-3.0, -2.0, -1.0, 0.0, 1.0, 2.0, 3.0].map((nz, ni) => (
                  <mesh key={`coil-rib-${ni}`} position={[0, 0, nz]} castShadow>
                    <torusGeometry args={[0.66, 0.055, 8, 18]} />
                    {material}
                  </mesh>
                ))}
                {/* Inboard & outboard recessed cyan warp grilles */}
                <mesh position={[-side * 0.64, 0, 0]}>
                  <boxGeometry args={[0.06, 0.36, 7.2]} />
                  <meshStandardMaterial
                    color="#06b6d4"
                    emissive="#06b6d4"
                    emissiveIntensity={2.2}
                    roughness={0.12}
                  />
                </mesh>
                <mesh position={[side * 0.64, 0, 0]}>
                  <boxGeometry args={[0.05, 0.22, 6.2]} />
                  <meshStandardMaterial
                    color="#06b6d4"
                    emissive="#06b6d4"
                    emissiveIntensity={1.9}
                    roughness={0.12}
                  />
                </mesh>
                {/* Aft nacelle venturi end-cap */}
                <mesh position={[0, 0, -4.42]} rotation={[Math.PI / 2, 0, 0]} castShadow>
                  <cylinderGeometry args={[0.62, 0.38, 0.55, 16]} />
                  {material}
                </mesh>
              </group>
            </group>
          ))}

          {/* Navigational deflector dish assembly facing +Z cleanly */}
          <group position={[0, -0.9, 2.2]}>
            <mesh>
              <circleGeometry args={[1.08, 24]} />
              <meshStandardMaterial
                color="#f59e0b"
                emissive="#f59e0b"
                emissiveIntensity={2.3}
                roughness={0.2}
              />
            </mesh>
            <mesh castShadow>
              <torusGeometry args={[1.14, 0.08, 10, 24]} />
              {material}
            </mesh>
            {RADIAL_8.map((k) => {
              const a = (k * Math.PI) / 4;
              return (
                <mesh
                  key={`def-vane-${k}`}
                  position={[Math.cos(a) * 0.6, Math.sin(a) * 0.6, 0.04]}
                  rotation={[0, 0, a]}
                  castShadow
                >
                  <boxGeometry args={[0.92, 0.05, 0.08]} />
                  {material}
                </mesh>
              );
            })}
            <mesh position={[0, 0, 0.2]} rotation={[Math.PI / 2, 0, 0]} castShadow>
              <cylinderGeometry args={[0.09, 0.24, 0.52, 12]} />
              {material}
            </mesh>
          </group>
        </group>
      )}

      {archetype === 'delta_strikefighter' && (
        <group>
          {/* Twin armored turbine air-intake cowls flanking the main wedge */}
          {[-1, 1].map((side) => (
            <group key={`delta-detail-${side}`}>
              <mesh position={[side * 1.52, 0.0, 0.95]} castShadow receiveShadow>
                <boxGeometry args={[0.95, 0.76, 1.8]} />
                {material}
              </mesh>
              <mesh position={[side * 1.52, 0.0, 1.84]}>
                <boxGeometry args={[0.72, 0.52, 0.06]} />
                <meshStandardMaterial color="#0f172a" roughness={0.65} metalness={0.75} />
              </mesh>
              {/* Upper & lower S-foil wing-root hydraulic actuator hinges */}
              {[-1, 1].map((vy) => (
                <group key={`sfoil-hinge-${vy}`}>
                  <mesh
                    position={[side * 1.85, vy * 0.38, -2.0]}
                    rotation={[Math.PI / 2, 0, 0]}
                    castShadow
                  >
                    <cylinderGeometry args={[0.26, 0.26, 2.2, 12]} />
                    {material}
                  </mesh>
                  {/* Wingtip cannon cooling jacket & flash suppressor collar */}
                  <mesh
                    position={[side * 4.8, vy * 0.9, -0.5]}
                    rotation={[Math.PI / 2, 0, 0]}
                    castShadow
                  >
                    <cylinderGeometry args={[0.17, 0.17, 0.85, 8]} />
                    {material}
                  </mesh>
                </group>
              ))}
              {/* Aft ion thruster nozzle shrouds & glowing exhaust stator cores */}
              <group position={[side * 1.2, 0, -5.0]}>
                <mesh rotation={[Math.PI / 2, 0, 0]} castShadow>
                  <cylinderGeometry args={[0.48, 0.54, 0.24, 16]} />
                  {material}
                </mesh>
                <mesh position={[0, 0, -0.11]} rotation={[Math.PI, 0, 0]}>
                  <circleGeometry args={[0.42, 16]} />
                  <meshStandardMaterial
                    color="#38bdf8"
                    emissive="#38bdf8"
                    emissiveIntensity={2.8}
                    roughness={0.2}
                  />
                </mesh>
                <mesh position={[0, 0, -0.06]} castShadow>
                  <boxGeometry args={[0.84, 0.06, 0.1]} />
                  {material}
                </mesh>
                <mesh position={[0, 0, -0.06]} castShadow>
                  <boxGeometry args={[0.06, 0.84, 0.1]} />
                  {material}
                </mesh>
              </group>
            </group>
          ))}
          {/* Dorsal spine radiator louver fairing */}
          <mesh position={[0, 1.03, -0.8]} castShadow>
            <boxGeometry args={[0.88, 0.12, 2.4]} />
            {material}
          </mesh>
        </group>
      )}

      {archetype === 'deep_space_cruiser' && (
        <group>
          {/* Fusion drive magnetic containment shroud arms & coil ring */}
          <group position={[0, 0, -7.4]}>
            <mesh position={[0, 0, -0.02]} rotation={[Math.PI, 0, 0]}>
              <ringGeometry args={[1.2, 2.68, 24]} />
              <meshStandardMaterial
                color="#6366f1"
                emissive="#818cf8"
                emissiveIntensity={2.6}
                roughness={0.2}
              />
            </mesh>
            {RADIAL_8.map((k) => {
              const a = (k * Math.PI) / 4;
              return (
                <mesh
                  key={`mag-arm-${k}`}
                  position={[Math.cos(a) * 2.55, Math.sin(a) * 2.55, 0.8]}
                  rotation={[0, 0, a]}
                  castShadow
                >
                  <boxGeometry args={[0.46, 0.22, 1.95]} />
                  {material}
                </mesh>
              );
            })}
            <mesh position={[0, 0, 0.1]} rotation={[Math.PI / 2, 0, 0]} castShadow>
              <cylinderGeometry args={[0.45, 0.22, 0.9, 12]} />
              {material}
            </mesh>
          </group>

          {/* Habitation centrifuge drum radial spokes & circumferential structural bands */}
          <group position={[0, 0, 1.0]}>
            {[-1.2, 0, 1.2].map((dz, idx) => (
              <mesh key={`drum-band-${idx}`} position={[0, 0, dz]} castShadow>
                <torusGeometry args={[2.72, 0.08, 8, 24]} />
                {material}
              </mesh>
            ))}
            {[-1.45, 1.45].map((fz, fi) =>
              RADIAL_6.map((k) => {
                const a = (k * Math.PI) / 3;
                return (
                  <mesh
                    key={`drum-spoke-${fi}-${k}`}
                    position={[Math.cos(a) * 2.25, Math.sin(a) * 2.25, fz]}
                    rotation={[0, 0, a]}
                    castShadow
                  >
                    <boxGeometry args={[0.88, 0.16, 0.22]} />
                    {material}
                  </mesh>
                );
              }),
            )}
          </group>

          {/* Radiator wing structural truss booms uniting wings to fuselage */}
          {[-1, 1].map((side) =>
            [-1, 1].map((vy) => (
              <mesh
                key={`rad-truss-${side}-${vy}`}
                position={[side * 2.22, vy * 1.1, -1.6]}
                castShadow
              >
                <boxGeometry args={[0.86, 0.28, 3.6]} />
                {material}
              </mesh>
            )),
          )}

          {/* Spinal magnetic railgun trench glow & accelerator yoke gates */}
          <mesh position={[0, 1.5, 6.8]}>
            <boxGeometry args={[0.2, 0.05, 4.4]} />
            <meshStandardMaterial
              color="#06b6d4"
              emissive="#22d3ee"
              emissiveIntensity={2.3}
            />
          </mesh>
          {[4.9, 5.7, 6.5, 7.3, 8.1, 8.8].map((z, idx) => (
            <mesh key={`rail-gate-${idx}`} position={[0, 1.58, z]} castShadow>
              <boxGeometry args={[1.04, 0.34, 0.22]} />
              {material}
            </mesh>
          ))}
        </group>
      )}
    </group>
  );
}
