import { useMemo, type ReactElement } from 'react';
import { Vector2 } from 'three';
import type { ArchetypeId } from '../../domain/types';

/**
 * Hull geometry, one component per archetype.
 *
 * Each takes the material as an element and renders it inside every mesh, so
 * React Three Fiber creates and disposes one material instance per mesh. Meshes
 * both cast and receive shadows — the prototype had no shadow map at all, which
 * is a large part of why the ships read as flat toys.
 */
export interface HullProps {
  material: ReactElement;
}

/* ------------------------------------------------------------------ */

function AngularStealthHull({ material }: HullProps) {
  const chine = 0.42;
  return (
    <group>
      {/* Main faceted body */}
      <mesh castShadow receiveShadow>
        <boxGeometry args={[2.6, 1.0, 10.5]} />
        {material}
      </mesh>

      {/* Razor chines — angled plates down each flank */}
      {[-1, 1].map((side) => (
        <mesh
          key={`chine-${side}`}
          position={[side * 1.45, -0.1, 0]}
          rotation={[0, 0, side * chine]}
          castShadow
          receiveShadow
        >
          <boxGeometry args={[1.2, 0.36, 10.2]} />
          {material}
        </mesh>
      ))}

      {/* Faceted prow — four-sided cone gives hard radar-deflecting facets */}
      <mesh position={[0, 0, 7.4]} rotation={[Math.PI / 2, Math.PI / 4, 0]} castShadow receiveShadow>
        <coneGeometry args={[1.42, 5.2, 4]} />
        {material}
      </mesh>

      {/* Dorsal spine */}
      <mesh position={[0, 0.72, -0.6]} castShadow receiveShadow>
        <boxGeometry args={[1.1, 0.5, 6.4]} />
        {material}
      </mesh>

      {/* Canted tail fins */}
      {[-1, 1].map((side) => (
        <mesh
          key={`fin-${side}`}
          position={[side * 1.1, 0.9, -4.4]}
          rotation={[0, 0, side * 0.55]}
          castShadow
          receiveShadow
        >
          <boxGeometry args={[0.18, 1.9, 2.6]} />
          {material}
        </mesh>
      ))}
    </group>
  );
}

/* ------------------------------------------------------------------ */

function IndustrialExpanseHull({ material }: HullProps) {
  // Exposed zero-g truss work between the forward module and the engine block.
  const trussSegments = 7;
  const trussSpan = 8.4;

  return (
    <group>
      {/* Forward habitat / bridge module */}
      <mesh position={[0, 0.35, 5.4]} castShadow receiveShadow>
        <boxGeometry args={[3.4, 2.3, 4.2]} />
        {material}
      </mesh>

      {/* Spine */}
      <mesh position={[0, 0, -0.6]} castShadow receiveShadow>
        <boxGeometry args={[1.5, 1.5, 9.2]} />
        {material}
      </mesh>

      {/* Truss ribs — the visual signature of a ship built for vacuum only */}
      {Array.from({ length: trussSegments }, (_, i) => {
        const z = 3.4 - (i / (trussSegments - 1)) * trussSpan;
        return (
          <mesh key={`rib-${i}`} position={[0, 0, z]} rotation={[0, 0, Math.PI / 4]} castShadow>
            <torusGeometry args={[1.55, 0.09, 6, 4]} />
            {material}
          </mesh>
        );
      })}

      {/* Longerons tying the ribs together */}
      {[
        [1.5, 1.5],
        [-1.5, 1.5],
        [1.5, -1.5],
        [-1.5, -1.5],
      ].map(([x, y], i) => (
        <mesh key={`longeron-${i}`} position={[x!, y!, -0.6]} castShadow>
          <boxGeometry args={[0.16, 0.16, 9.0]} />
          {material}
        </mesh>
      ))}

      {/* Segmented cargo pods slung under the spine */}
      {[-2.4, 0, 2.4].map((z, i) => (
        <mesh key={`pod-${i}`} position={[0, -1.55, z]} castShadow receiveShadow>
          <boxGeometry args={[2.5, 1.3, 2.0]} />
          {material}
        </mesh>
      ))}

      {/* Outboard engine mounting pylons */}
      {[-1, 1].map((side) => (
        <mesh key={`pylon-${side}`} position={[side * 2.0, 0, -6.4]} castShadow receiveShadow>
          <boxGeometry args={[2.4, 0.6, 1.4]} />
          {material}
        </mesh>
      ))}
    </group>
  );
}

/* ------------------------------------------------------------------ */

function BrutalistDreadnoughtHull({ material }: HullProps) {
  return (
    <group>
      {/* Hammerhead armoured prow — the widest point on any archetype */}
      <mesh position={[0, 0, 6.2]} castShadow receiveShadow>
        <boxGeometry args={[6.6, 2.0, 4.0]} />
        {material}
      </mesh>
      <mesh position={[0, 0, 8.4]} rotation={[Math.PI / 2, 0, 0]} castShadow receiveShadow>
        <cylinderGeometry args={[1.4, 2.6, 2.2, 6]} />
        {material}
      </mesh>

      {/* Main citadel body */}
      <mesh position={[0, 0, -0.5]} castShadow receiveShadow>
        <boxGeometry args={[4.6, 2.4, 12.0]} />
        {material}
      </mesh>

      {/* Elevated command tower */}
      <mesh position={[0, 2.0, -1.2]} castShadow receiveShadow>
        <boxGeometry args={[2.2, 1.7, 3.4]} />
        {material}
      </mesh>
      <mesh position={[0, 3.0, -1.2]} castShadow receiveShadow>
        <boxGeometry args={[1.4, 0.6, 2.2]} />
        {material}
      </mesh>

      {/* Flanking armour skirts */}
      {[-1, 1].map((side) => (
        <mesh
          key={`skirt-${side}`}
          position={[side * 2.75, -0.5, -1.0]}
          rotation={[0, 0, side * 0.18]}
          castShadow
          receiveShadow
        >
          <boxGeometry args={[1.1, 1.7, 10.0]} />
          {material}
        </mesh>
      ))}

      {/* Spinal mass-driver trench */}
      <mesh position={[0, 1.3, 2.4]} castShadow receiveShadow>
        <boxGeometry args={[0.9, 0.45, 8.0]} />
        {material}
      </mesh>

      {/* Aft engine block */}
      <mesh position={[0, 0, -7.4]} castShadow receiveShadow>
        <boxGeometry args={[5.2, 2.2, 2.6]} />
        {material}
      </mesh>
    </group>
  );
}

/* ------------------------------------------------------------------ */

function OutriggerScienceHull({ material }: HullProps) {
  return (
    <group>
      {/* Slim central fuselage */}
      <mesh position={[0, 0, 0]} rotation={[Math.PI / 2, 0, 0]} castShadow receiveShadow>
        <capsuleGeometry args={[0.95, 8.0, 4, 12]} />
        {material}
      </mesh>

      {/* Forward instrument bulb */}
      <mesh position={[0, 0, 5.4]} castShadow receiveShadow>
        <sphereGeometry args={[1.15, 20, 14]} />
        {material}
      </mesh>

      {/* Twin outrigger booms */}
      {[-1, 1].map((side) => (
        <mesh
          key={`boom-${side}`}
          position={[side * 4.3, 0, -1.4]}
          rotation={[Math.PI / 2, 0, 0]}
          castShadow
          receiveShadow
        >
          <capsuleGeometry args={[0.52, 7.4, 4, 10]} />
          {material}
        </mesh>
      ))}

      {/* Cross struts tying the booms to the fuselage */}
      {[2.6, -0.4, -3.4].map((z, i) =>
        [-1, 1].map((side) => (
          <mesh
            key={`strut-${i}-${side}`}
            position={[side * 2.15, 0, z]}
            rotation={[0, 0, Math.PI / 2]}
            castShadow
          >
            <cylinderGeometry args={[0.16, 0.16, 4.3, 8]} />
            {material}
          </mesh>
        )),
      )}

      {/* Habitat ring amidships */}
      <mesh position={[0, 0, -1.0]} rotation={[Math.PI / 2, 0, 0]} castShadow receiveShadow>
        <torusGeometry args={[1.85, 0.34, 10, 28]} />
        {material}
      </mesh>
    </group>
  );
}

/* ------------------------------------------------------------------ */

function AerodynamicSleekHull({ material }: HullProps) {
  // The one archetype built to meet atmosphere. A lathed profile rather than
  // welded plates, with a swept delta planform.
  const profile = useMemo(
    () =>
      (
        [
          [0.02, 8.0],
          [0.55, 6.2],
          [1.05, 3.6],
          [1.35, 0.8],
          [1.42, -2.0],
          [1.25, -4.6],
          [0.92, -6.4],
          [0.72, -7.4],
        ] as const
      ).map(([r, z]) => new Vector2(r, z)),
    [],
  );

  return (
    <group>
      <mesh rotation={[-Math.PI / 2, 0, 0]} castShadow receiveShadow>
        <latheGeometry args={[profile, 40]} />
        {material}
      </mesh>

      {/* Swept delta wings */}
      {[-1, 1].map((side) => (
        <mesh
          key={`wing-${side}`}
          position={[side * 2.1, -0.15, -2.2]}
          rotation={[0, side * -0.32, side * 0.08]}
          castShadow
          receiveShadow
        >
          <boxGeometry args={[3.4, 0.16, 3.8]} />
          {material}
        </mesh>
      ))}

      {/* Vertical stabiliser */}
      <mesh position={[0, 1.15, -5.2]} castShadow receiveShadow>
        <boxGeometry args={[0.14, 1.9, 2.4]} />
        {material}
      </mesh>

      {/* Canopy blister */}
      <mesh position={[0, 0.78, 3.4]} castShadow receiveShadow>
        <sphereGeometry args={[0.62, 18, 12]} />
        {material}
      </mesh>
    </group>
  );
}

/* ------------------------------------------------------------------ */

const HULLS: Record<ArchetypeId, (props: HullProps) => ReactElement> = {
  angular_stealth: AngularStealthHull,
  industrial_expanse: IndustrialExpanseHull,
  brutalist_dreadnought: BrutalistDreadnoughtHull,
  outrigger_science: OutriggerScienceHull,
  aerodynamic_sleek: AerodynamicSleekHull,
};

export function Hull({ archetype, material }: { archetype: ArchetypeId } & HullProps) {
  const Component = HULLS[archetype];
  return <Component material={material} />;
}
