import { useMemo, type ReactNode } from 'react';
import { CatmullRomCurve3, Euler, Quaternion, Shape, Vector2, Vector3 } from 'three';
import {
  GREEBLE_STUD_HEIGHT,
  MATERIAL_HINTS,
  pipeRoute,
  resolveAnchor,
  type FittingDef,
  type Piece,
  type Recipe,
} from '../../domain/fittings';
import { surfaceForRecipe, type DamageOptions } from '../../domain/damage';
import type { Vec3 } from '../../domain/types';
import { mulberry32 } from '../../domain/rng';
import { EmissiveMaterial } from '../materials/HullMaterial';
import type { RenderMode } from '../materials/renderModes';
import { SurfaceDamage } from '../damage/Damage';

/**
 * The one piece of code that knows how to turn a component recipe into
 * geometry.
 *
 * Everything about *what* a component is — its shape family, its pieces, its
 * plumbing, how hard it weathers — is data in `domain/fittings.ts`. This file
 * is the interpreter, and it is deliberately the only place a new geometry
 * kind can appear. Adding a weapon touches two data tables and no code at all.
 *
 * Every geometry here is declared as JSX so React Three Fiber owns its
 * lifetime. The maths objects a couple of recipes need — a `Shape` for the
 * chamfered slab, a `CatmullRomCurve3` for a pipe run — are plain CPU objects,
 * not GPU resources, and are memoised on scalars.
 */

const asTuple = (v: Vec3): [number, number, number] => [v[0], v[1], v[2]];
const UP_AXIS = new Vector3(0, 1, 0);
const FLANGE_BOLTS = [0, 1, 2, 3, 4, 5, 6, 7] as const;

function tangentEuler(dir: Vector3): [number, number, number] {
  const unit = dir.clone().normalize();
  const q = new Quaternion().setFromUnitVectors(UP_AXIS, unit);
  const e = new Euler().setFromQuaternion(q);
  return [e.x, e.y, e.z];
}

/* --------------------------- Shared fittings --------------------------- */

/**
 * The visible base every mount gets: a bolt ring, perimeter hex lugs, and a
 * beveled collar sunk fractionally into the plate so no seam of daylight shows.
 */
export function MountFlange({
  radius,
  height = 0.09,
  color = '#2b3648',
}: {
  radius: number;
  height?: number;
  color?: string;
}) {
  const boltRadius = Math.max(0.016, Math.min(0.036, radius * 0.065));
  const boltOrbit = radius * 0.88;

  return (
    <group>
      {/* Main tapered mounting collar */}
      <mesh position={[0, height / 2 - 0.03, 0]} castShadow receiveShadow>
        <cylinderGeometry args={[radius * 0.82, radius, height, 14]} />
        <meshStandardMaterial color={color} roughness={0.55} metalness={0.85} />
      </mesh>
      {/* Secondary upper flange ring */}
      <mesh position={[0, height - 0.025, 0]} castShadow receiveShadow>
        <cylinderGeometry args={[radius * 0.72, radius * 0.84, 0.032, 14]} />
        <meshStandardMaterial color="#374151" roughness={0.48} metalness={0.88} />
      </mesh>
      {/* Base gasket torus seated cleanly into hull skin */}
      <mesh position={[0, 0, 0]} rotation={[Math.PI / 2, 0, 0]} castShadow>
        <torusGeometry args={[radius * 0.95, 0.028, 6, 16]} />
        <meshStandardMaterial color="#1e293b" roughness={0.5} metalness={0.9} />
      </mesh>
      {/* 8 machined hex perimeter flange bolts */}
      {FLANGE_BOLTS.map((i) => {
        const a = (i * Math.PI) / 4;
        return (
          <mesh
            key={`bolt-${i}`}
            position={[Math.cos(a) * boltOrbit, height - 0.02, Math.sin(a) * boltOrbit]}
            castShadow
          >
            <cylinderGeometry args={[boltRadius, boltRadius, 0.035, 6]} />
            <meshStandardMaterial color="#64748b" roughness={0.35} metalness={0.9} />
          </mesh>
        );
      })}
    </group>
  );
}

/**
 * A run of pipe between two points that are both on real geometry, outfitted
 * with swaged hex end glands and a central support collar.
 *
 * TubeGeometry along a Catmull-Rom, declared as JSX so the reconciler owns the
 * geometry's lifetime. The curve itself is a plain maths object, not a GPU
 * resource, and is memoised on scalars so the tube is not rebuilt every frame.
 */
export function Conduit({
  from,
  to,
  bow = 0.16,
  radius = 0.04,
  color = '#5b6b82',
  segments = 16,
}: {
  from: readonly [number, number, number];
  to: readonly [number, number, number];
  bow?: number;
  radius?: number;
  color?: string;
  segments?: number;
}) {
  const [ax, ay, az] = from;
  const [bx, by, bz] = to;

  const { curve, startRot, midPos, midRot, endRot } = useMemo(() => {
    const c = new CatmullRomCurve3(
      pipeRoute([ax, ay, az], [bx, by, bz], bow).map(
        (point) => new Vector3(point[0], point[1], point[2]),
      ),
    );
    const m = c.getPoint(0.5);
    return {
      curve: c,
      startRot: tangentEuler(c.getTangent(0)),
      midPos: [m.x, m.y, m.z] as [number, number, number],
      midRot: tangentEuler(c.getTangent(0.5)),
      endRot: tangentEuler(c.getTangent(1)),
    };
  }, [ax, ay, az, bx, by, bz, bow]);

  const glandR = radius * 1.48;
  const glandH = radius * 1.85;

  return (
    <group>
      <mesh castShadow>
        <tubeGeometry args={[curve, segments, radius, 8, false]} />
        <meshStandardMaterial color={color} roughness={0.48} metalness={0.82} />
      </mesh>
      <mesh position={[ax, ay, az]} rotation={startRot} castShadow>
        <cylinderGeometry args={[glandR, glandR, glandH, 6]} />
        <meshStandardMaterial color="#334155" roughness={0.4} metalness={0.88} />
      </mesh>
      <mesh position={midPos} rotation={midRot} castShadow>
        <cylinderGeometry args={[glandR * 0.92, glandR * 0.92, glandH * 1.15, 8]} />
        <meshStandardMaterial color="#1e293b" roughness={0.45} metalness={0.86} />
      </mesh>
      <mesh position={[bx, by, bz]} rotation={endRot} castShadow>
        <cylinderGeometry args={[glandR, glandR, glandH, 6]} />
        <meshStandardMaterial color="#334155" roughness={0.4} metalness={0.88} />
      </mesh>
    </group>
  );
}

/* --------------------------- Recipe geometry --------------------------- */

function PieceMaterial({
  piece,
  mode,
  dead,
}: {
  piece: Piece;
  mode: RenderMode;
  dead: boolean;
}) {
  if (piece.glow) {
    return (
      <EmissiveMaterial
        mode={mode}
        color={piece.glow.color}
        intensity={dead ? 0 : piece.glow.intensity}
      />
    );
  }
  const hint = MATERIAL_HINTS[piece.material];
  return (
    <meshStandardMaterial
      color={hint.color}
      roughness={hint.roughness}
      metalness={hint.metalness}
      envMapIntensity={1.15}
    />
  );
}

/** Studs and boxes scattered over a panel's outward faces, deterministically. */
function greebleStuds(
  size: Vec3,
  density: number,
  seed: number,
): Array<{ position: Vec3; size: Vec3 }> {
  const rng = mulberry32(seed >>> 0);
  const studs: Array<{ position: Vec3; size: Vec3 }> = [];
  const faces: Array<{ axis: 0 | 1 | 2; sign: 1 | -1 }> = [
    { axis: 1, sign: 1 },
    { axis: 0, sign: 1 },
    { axis: 0, sign: -1 },
  ];

  for (const face of faces) {
    const [u, v] = face.axis === 1 ? ([0, 2] as const) : ([2, 1] as const);
    const area = (size[u] as number) * (size[v] as number);
    const count = Math.max(1, Math.round(area * density));
    for (let i = 0; i < count; i++) {
      const position: number[] = [0, 0, 0];
      position[u] = (rng() - 0.5) * (size[u] as number) * 0.7;
      position[v] = (rng() - 0.5) * (size[v] as number) * 0.7;
      position[face.axis] = (face.sign * (size[face.axis] as number)) / 2;

      const box: number[] = [0, 0, 0];
      box[u] = 0.06 + rng() * ((size[u] as number) * 0.22);
      box[v] = 0.06 + rng() * ((size[v] as number) * 0.22);
      box[face.axis] = GREEBLE_STUD_HEIGHT * 2;

      studs.push({
        position: [position[0] as number, position[1] as number, position[2] as number],
        size: [box[0] as number, box[1] as number, box[2] as number],
      });
    }
  }
  return studs;
}

/** Chamfered slab: a bevelled extrusion, not a box with the edges implied. */
function Slab({
  recipe,
  children,
}: {
  recipe: Extract<Recipe, { kind: 'slab' | 'greeble' }>;
  children?: ReactNode;
}) {
  const chamfer = Math.max(0.005, Math.min(recipe.chamfer, Math.min(...recipe.size) / 2.5));
  const depth = Math.max(recipe.size[2] - 2 * chamfer, 0.01);

  const shape = useMemo(() => {
    const halfX = Math.max(recipe.size[0] - 2 * chamfer, 0.01) / 2;
    const halfY = Math.max(recipe.size[1] - 2 * chamfer, 0.01) / 2;
    const outline = new Shape();
    outline.moveTo(-halfX, -halfY);
    outline.lineTo(halfX, -halfY);
    outline.lineTo(halfX, halfY);
    outline.lineTo(-halfX, halfY);
    outline.closePath();
    return outline;
  }, [recipe.size, chamfer]);

  // ExtrudeGeometry runs from z = 0 to z = depth (plus the bevel either end),
  // so the mesh is pulled back to put the solid's centre on the piece's origin.
  return (
    <mesh position={[0, 0, -depth / 2]} castShadow receiveShadow>
      <extrudeGeometry
        args={[
          shape,
          {
            depth,
            bevelEnabled: true,
            bevelThickness: chamfer,
            bevelSize: chamfer,
            bevelOffset: 0,
            bevelSegments: 1,
            curveSegments: 1,
            steps: 1,
          },
        ]}
      />
      {children}
    </mesh>
  );
}

function RecipeMesh({
  piece,
  anchors,
  damageTag,
  damage,
  mode,
  dead,
}: {
  piece: Piece;
  anchors?: Readonly<Record<string, Vec3>>;
  damageTag: string;
  damage?: DamageOptions;
  mode: RenderMode;
  dead: boolean;
}) {
  const recipe = piece.recipe;

  // Hooks before the switch, so every recipe kind takes the same path through
  // them — the rules-of-hooks constraint, and the reason this reads oddly.
  const lathePoints = useMemo(
    () =>
      recipe.kind === 'lathe'
        ? recipe.profile.map((point) => new Vector2(Math.max(point.r, 1e-3), point.y))
        : [],
    [recipe],
  );
  const studs = useMemo(
    () =>
      recipe.kind === 'greeble'
        ? greebleStuds(recipe.size, recipe.density, recipe.seed)
        : [],
    [recipe],
  );
  const surface = useMemo(() => surfaceForRecipe(recipe), [recipe]);

  const material = <PieceMaterial piece={piece} mode={mode} dead={dead} />;
  const marks = <SurfaceDamage surface={surface} tag={damageTag} options={damage} />;
  const at = asTuple(piece.at ?? [0, 0, 0]);
  const rotation = piece.rotation ? asTuple(piece.rotation) : undefined;

  switch (recipe.kind) {
    case 'lathe':
      return (
        <mesh position={at} rotation={rotation} castShadow receiveShadow>
          <latheGeometry args={[lathePoints, recipe.segments ?? 16]} />
          {material}
          {marks}
        </mesh>
      );

    case 'capsule':
      return (
        <mesh position={at} rotation={rotation} castShadow receiveShadow>
          <capsuleGeometry args={[recipe.radius, recipe.length, 6, 14]} />
          {material}
          {marks}
        </mesh>
      );

    case 'sphere':
      return (
        <mesh position={at} rotation={rotation} castShadow receiveShadow>
          <sphereGeometry
            args={[recipe.radius, 18, 12, 0, Math.PI * 2, 0, Math.PI * (recipe.cap ?? 1)]}
          />
          {material}
          {marks}
        </mesh>
      );

    case 'slab':
      return (
        <group position={at} rotation={rotation}>
          <Slab recipe={recipe}>
            {material}
            {/* The extrusion's own frame is offset half its depth from the
                piece centre, so the marks are shifted to match. */}
            <SurfaceDamage
              surface={surface}
              tag={damageTag}
              options={damage}
              offset={[0, 0, Math.max(recipe.size[2] - 2 * recipe.chamfer, 0.01) / 2]}
            />
          </Slab>
        </group>
      );

    case 'greeble':
      return (
        <group position={at} rotation={rotation}>
          <Slab recipe={recipe}>
            {material}
            <SurfaceDamage
              surface={surface}
              tag={damageTag}
              options={damage}
              offset={[0, 0, Math.max(recipe.size[2] - 2 * recipe.chamfer, 0.01) / 2]}
            />
          </Slab>
          {studs.map((stud, i) => (
            <mesh key={i} position={asTuple(stud.position)} castShadow receiveShadow>
              <boxGeometry args={[stud.size[0], stud.size[1], stud.size[2]]} />
              <PieceMaterial piece={piece} mode={mode} dead={dead} />
            </mesh>
          ))}
        </group>
      );

    case 'cylinder':
      return (
        <mesh position={at} rotation={rotation} castShadow receiveShadow>
          <cylinderGeometry
            args={[recipe.radiusTop, recipe.radiusBottom, recipe.height, recipe.sides ?? 12]}
          />
          {material}
          {marks}
        </mesh>
      );

    case 'torus':
      return (
        <mesh position={at} rotation={rotation} castShadow>
          <torusGeometry args={[recipe.radius, recipe.tube, 8, recipe.sides ?? 18]} />
          {material}
        </mesh>
      );

    case 'crystal':
      return (
        <mesh position={at} rotation={rotation} castShadow>
          {recipe.shape === 'octahedron' && (
            <octahedronGeometry args={[recipe.radius, recipe.detail ?? 0]} />
          )}
          {recipe.shape === 'icosahedron' && (
            <icosahedronGeometry args={[recipe.radius, recipe.detail ?? 0]} />
          )}
          {recipe.shape === 'tetrahedron' && (
            <tetrahedronGeometry args={[recipe.radius, recipe.detail ?? 0]} />
          )}
          {material}
        </mesh>
      );

    case 'pipe': {
      const from = resolveAnchor(recipe.from, anchors);
      const to = resolveAnchor(recipe.to, anchors);
      // A dangling anchor is caught by `fittingIssues` in a unit test; if one
      // ever reaches here, draw nothing rather than a pipe to the origin.
      if (!from || !to) return null;
      return (
        <Conduit
          from={asTuple(from)}
          to={asTuple(to)}
          bow={recipe.bow}
          radius={recipe.radius}
          color={MATERIAL_HINTS[piece.material].color}
        />
      );
    }
  }
}

/* --------------------------- The fitting --------------------------- */

/** How much damage a bolt-on component carries relative to hull plating. */
const PART_DAMAGE: Omit<DamageOptions, 'exposure'> = { density: 0.6, max: 3 };

/**
 * A registered component, assembled from its recipe list.
 *
 * The flange comes first and always: every mount reads as bolted through the
 * plate rather than as two solids happening to intersect.
 */
export function Fitting({
  def,
  mode,
  dead,
}: {
  def: FittingDef;
  mode: RenderMode;
  dead: boolean;
}) {
  const damage = useMemo<DamageOptions>(
    () => ({ ...PART_DAMAGE, exposure: def.exposure }),
    [def.exposure],
  );

  return (
    <group>
      <MountFlange radius={def.flange} />
      {def.pieces.map((piece, i) => (
        <RecipeMesh
          key={`${def.id}-${i}`}
          piece={piece}
          anchors={def.anchors}
          damageTag={`${def.id}:${i}`}
          damage={damage}
          mode={mode}
          dead={dead}
        />
      ))}
    </group>
  );
}
