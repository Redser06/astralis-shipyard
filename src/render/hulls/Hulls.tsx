import { useMemo, type ReactElement, type ReactNode } from 'react';
import { Vector2 } from 'three';
import type { ArchetypeId, Vec3 } from '../../domain/types';
import { DEFAULT_HULL_PROFILE, sampleProfile, type ProfilePoint } from '../../domain/profile';
import { HULL_SOLIDS, axisRotation, hullBounds, hullVolumes, type Solid } from '../../domain/hullForm';
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

export function Hull({ archetype, material, profile }: { archetype: ArchetypeId } & HullProps) {
  const solids = HULL_SOLIDS[archetype];

  /**
   * Battle damage, one set per plate.
   *
   * A decal has to be projected onto a specific mesh, so the marks are placed
   * per solid, in that solid's own geometry frame, and rendered as its child.
   * Whether any of them appear at all is decided by `DamageProvider` in
   * `Ship` — this only says where they would go.
   */
  const damage = useMemo(() => {
    const bounds = hullBounds(hullVolumes(archetype, profile));
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
  }, [archetype, profile, solids]);

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
    </group>
  );
}
