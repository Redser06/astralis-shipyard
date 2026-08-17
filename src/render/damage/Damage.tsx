import { useMemo, type ReactNode } from 'react';
import { Decal } from '@react-three/drei';
import { Euler, Object3D, Vector3 } from 'three';
import {
  surfaceDamage,
  type DamageMark,
  type DamageOptions,
  type DamageSurface,
} from '../../domain/damage';
import type { Vec3, WearChannels } from '../../domain/types';
import { DamageContext, useDamageState } from './damageContext';
import { damageNormal, damageTexture } from './decalTextures';

/**
 * Battle damage, projected onto whatever it is a child of.
 *
 * DECALS, NOT CSG. Cutting real holes would mean boolean geometry, and the SDK
 * survey was decisive against it: three-bvh-csg is stale, returned watertight
 * output on 22 of 1000 test pairs, and peer-conflicts with the three-mesh-bvh
 * that drei already depends on. A decal projects a stamp onto the surface it
 * lands on and clips it to that surface, which is both what the marks need and
 * a dependency we already have — drei's `<Decal>` wraps three's DecalGeometry,
 * and being declarative it hands the geometry's lifetime to the reconciler.
 *
 * The trade is honest and worth stating: a decal cannot let you see *through*
 * the hull. A breach reads as a hole with the plating torn back around it —
 * which, on a ship whose interior is not modelled, is what you would want to
 * see anyway.
 *
 * WHERE THE MARKS COME FROM. `domain/damage.ts` places them, from the seven
 * wear channels and the blueprint seed. Nothing here decides *whether* a ship
 * is damaged; it only draws what the condition slider already implies.
 */

/* --------------------------- Orientation --------------------------- */

/**
 * The Euler a decal needs to face along a surface normal.
 *
 * Derived exactly the way drei derives it when it guesses a normal itself
 * (lookAt, then flip twice), rather than approximated — because we have the
 * real normal from the domain and drei's guess is "nearest vertex normal",
 * which on a box corner is a coin toss between three faces.
 *
 * The scratch object is module-scope and used synchronously inside a useMemo:
 * it never escapes, and allocating an Object3D per mark per render would be
 * the kind of churn this codebase was rebuilt to remove.
 */
const scratch = new Object3D();
const scratchTarget = new Vector3();

function decalOrientation(position: Vec3, normal: Vec3, roll: number): Euler {
  scratch.rotation.set(0, 0, 0);
  scratch.position.set(position[0], position[1], position[2]);
  scratchTarget.set(position[0] + normal[0], position[1] + normal[1], position[2] + normal[2]);
  scratch.lookAt(scratchTarget);
  scratch.rotateZ(Math.PI);
  scratch.rotateY(Math.PI);
  scratch.rotateZ(roll);
  return scratch.rotation.clone();
}

/* --------------------------- Rendering --------------------------- */

/**
 * How deep the projector box reaches into the surface. Generous, so a mark on
 * a curved flank wraps rather than being clipped off at the edges of the box.
 */
const PROJECTION_DEPTH = 2.2;

function Mark({ mark, offset }: { mark: DamageMark; offset?: Vec3 }) {
  const map = damageTexture(mark.kind);
  const normalMap = damageNormal(mark.kind);

  const position = useMemo<[number, number, number]>(
    () => [
      mark.position[0] + (offset?.[0] ?? 0),
      mark.position[1] + (offset?.[1] ?? 0),
      mark.position[2] + (offset?.[2] ?? 0),
    ],
    [mark.position, offset],
  );

  const rotation = useMemo(
    () => decalOrientation(position, mark.normal, mark.roll),
    [position, mark.normal, mark.roll],
  );

  if (!map) return null;

  return (
    <Decal
      position={position}
      rotation={rotation}
      scale={[mark.size, mark.size, mark.size * PROJECTION_DEPTH]}
      map={map}
      // depthTest stays on — drei defaults it off, which on a ship with parts
      // in front of plate would draw every mark through whatever occludes it.
      depthTest
      polygonOffsetFactor={-14}
    >
      <meshStandardMaterial
        map={map}
        normalMap={normalMap ?? undefined}
        transparent
        opacity={mark.opacity}
        // Transparent surfaces that write depth sort against each other badly,
        // and several marks routinely overlap on a hard-worked hull.
        depthWrite={false}
        polygonOffset
        polygonOffsetFactor={-14}
        roughness={mark.kind === 'scuff' ? 0.28 : 0.92}
        metalness={mark.kind === 'scuff' || mark.kind === 'patch' ? 0.75 : 0.1}
      />
    </Decal>
  );
}

/** Marks already placed. Used where the caller has memoised them itself. */
export function DamageDecals({ marks, offset }: { marks: readonly DamageMark[]; offset?: Vec3 }) {
  if (marks.length === 0) return null;
  return (
    <>
      {marks.map((mark, i) => (
        <Mark key={`${mark.kind}-${i}`} mark={mark} offset={offset} />
      ))}
    </>
  );
}

/**
 * Damage for one surface, drawn as a child of the mesh it belongs to.
 *
 * `surface` and `options` must be stable across renders (module constants or
 * memoised); they are the useMemo's dependencies, and rebuilding a DecalGeometry
 * every frame would be exactly the leak this codebase eliminated.
 */
export function SurfaceDamage({
  surface,
  tag,
  options,
  offset,
}: {
  surface: DamageSurface | null;
  /** Stable identity for this surface — its own deterministic stream. */
  tag: string;
  options?: DamageOptions;
  /** Added to every mark, where the mesh's geometry frame is not its centre. */
  offset?: Vec3;
}) {
  const state = useDamageState();

  const marks = useMemo(
    () =>
      state && surface ? surfaceDamage(surface, state.wear, state.seed, tag, options) : [],
    [state, surface, tag, options],
  );

  return <DamageDecals marks={marks} offset={offset} />;
}

/**
 * Switches damage on for a subtree.
 *
 * Absent — in Holo, X-Ray and Thermal modes — every `SurfaceDamage` below
 * renders nothing, because a soot stamp on a wireframe is noise.
 */
export function DamageProvider({
  wear,
  seed,
  enabled,
  children,
}: {
  wear: WearChannels;
  seed: number;
  enabled: boolean;
  children: ReactNode;
}) {
  const value = useMemo(() => (enabled ? { wear, seed } : null), [wear, seed, enabled]);
  return <DamageContext.Provider value={value}>{children}</DamageContext.Provider>;
}
