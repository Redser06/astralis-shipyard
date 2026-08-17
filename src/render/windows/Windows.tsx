import { useMemo } from 'react';
import { AdditiveBlending, DoubleSide, Matrix4, Quaternion, Vector3 } from 'three';
import type { ArchetypeId, Socket, Vec3, WearChannels } from '../../domain/types';
import type { HullVolume } from '../../domain/hullForm';
import {
  glazeWindows,
  placeWindows,
  type GlazedWindow,
  type GlazingState,
} from '../../domain/windows';
import type { RenderMode } from '../materials/renderModes';

/**
 * Windows, viewports and the flight deck.
 *
 * WHERE they go is not decided here — `domain/windows.ts` owns that, because
 * "no porthole within four metres of a cryogenic tank" is a rule that has to be
 * checkable by a unit test rather than by a screenshot. This file is the
 * interpreter, in the same relationship to that module as `parts/Fitting.tsx`
 * is to `domain/fittings.ts`.
 *
 * THE BLOOM PROBLEM, and the one thing to know before changing an intensity
 * here. Every other emissive in this codebase sets `toneMapped={false}` at an
 * intensity of 1.6–4.0. That is right for a running light — a 45 mm sphere that
 * should punch — because bypassing ACES lets it clip to white and the bloom
 * pass turns the clipped pixel into a star. Glazing is the opposite case: a
 * flight-deck band is two metres across, and two metres of clipped white with
 * `luminanceThreshold` at 0.72 is a smear that swallows the bridge, the tower
 * and everything behind them. So window glazing is the one emissive in the repo
 * that stays TONE MAPPED, and runs at an intensity ACES rolls off into the top
 * of the range rather than through it. Warm, bright, and still a window.
 *
 * Geometry is declared as JSX throughout, so the reconciler owns every buffer.
 */

interface WindowsProps {
  archetype: ArchetypeId;
  volumes: readonly HullVolume[];
  sockets: readonly Socket[];
  seed: number;
  wear: WearChannels;
  condition: number;
  mode: RenderMode;
}

/* --------------------------- Orientation --------------------------- */

/**
 * Glazing is authored in its own XY plane facing local +Z, which is how three's
 * `circleGeometry` and `planeGeometry` are already oriented — so a window needs
 * no rotation of its own once the group is on the right basis.
 *
 * The basis is built from the full (normal, up) pair rather than from the
 * shortest arc onto the normal, for the same reason `SocketMount` does it:
 * the shortest arc leaves roll to chance, and a bridge band whose roll is left
 * to chance comes out canted on one side of the ship and level on the other.
 */
function apertureQuaternion(normal: Vec3, up: Vec3): Quaternion {
  const forward = new Vector3(normal[0], normal[1], normal[2]).normalize();
  const vertical = new Vector3(up[0], up[1], up[2]);
  vertical.addScaledVector(forward, -vertical.dot(forward));
  if (vertical.lengthSq() < 1e-8) {
    // `up` is parallel to the normal and resolves no roll. Any stable
    // perpendicular will do, chosen deterministically.
    vertical.set(0, 1, 0).addScaledVector(forward, -forward.y);
    if (vertical.lengthSq() < 1e-8) vertical.set(1, 0, 0);
  }
  vertical.normalize();
  const right = new Vector3().crossVectors(vertical, forward);
  return new Quaternion().setFromRotationMatrix(
    new Matrix4().makeBasis(right, vertical, forward),
  );
}

/* --------------------------- Materials --------------------------- */

/** Interior light. Warm, because everything else on the ship is cold. */
const INTERIOR = '#ffd39b';
/** What a cold, unlit pane looks like: dark, smooth, faintly reflective. */
const DEAD_GLASS = '#070c14';

const FRAME = { color: '#39445a', roughness: 0.55, metalness: 0.85 } as const;
const REVEAL = { color: '#0b111c', roughness: 0.8, metalness: 0.4 } as const;

/**
 * Peak emissive intensity for glazing, tone mapped.
 *
 * Chosen against the composer rather than in isolation: at 1.25 through ACES a
 * pane lands just over Bloom's 0.72 luminance threshold, so it picks up a halo
 * without clipping. Raising it past ~1.8 puts the whole pane on the flat top of
 * the curve and the bloom starts eating the hull around it.
 */
const GLAZING_INTENSITY = 1.25;
/** The bridge is a lit room rather than a lit cabin, so it runs a shade hotter. */
const FLIGHT_DECK_INTENSITY = 1.5;

function GlazingMaterial({
  brightness,
  peak,
  mode,
}: {
  brightness: number;
  peak: number;
  mode: RenderMode;
}) {
  if (mode === 'wireframe') return <meshBasicMaterial color="#7dd3fc" wireframe />;

  if (mode === 'xray') {
    // Additive and transparent, so glazing reads as an aperture in the shell
    // rather than as an opaque plate suspended inside a see-through hull.
    return (
      <meshBasicMaterial
        color="#7dd3fc"
        transparent
        opacity={0.3 + brightness * 0.25}
        depthWrite={false}
        blending={AdditiveBlending}
        side={DoubleSide}
      />
    );
  }

  if (mode === 'thermal') {
    // A window is a hole in the insulation, so on an IR pass it is the warmest
    // thing on the hull that is not a drive.
    return (
      <meshStandardMaterial
        color="#05070c"
        emissive="#f97316"
        emissiveIntensity={0.5 + brightness * 1.6}
        roughness={1}
        metalness={0}
        side={DoubleSide}
      />
    );
  }

  return (
    <meshStandardMaterial
      color={DEAD_GLASS}
      emissive={INTERIOR}
      emissiveIntensity={peak * brightness}
      roughness={0.1}
      metalness={0.15}
      // Unlit glazing has to be doing something, or a dark ship's ports vanish.
      // A low-roughness, high-envMap surface catches the nebula and the drydock
      // and reads as glass rather than as a black disc.
      envMapIntensity={1.9}
      side={DoubleSide}
    />
  );
}

/* --------------------------- Portholes --------------------------- */

/**
 * Fracture lines across a cracked pane, and the shards left in a blown frame.
 *
 * Deliberately geometric rather than textured: three thin bars read as a
 * spidered port at every distance the camera can get to, and cost three boxes.
 */
function Fracture({ radius, blown }: { radius: number; blown: boolean }) {
  const bars = blown ? [0.4, 2.2] : [0.3, 1.35, 2.4];
  return (
    <group position={[0, 0, blown ? 0.004 : 0.026]}>
      {bars.map((angle, i) => (
        <mesh key={i} rotation={[0, 0, angle]}>
          <boxGeometry args={[radius * (blown ? 1.1 : 1.75), 0.016, 0.012]} />
          <meshStandardMaterial color="#94a3b8" roughness={0.3} metalness={0.6} />
        </mesh>
      ))}
    </group>
  );
}

/**
 * One port: individually framed, as on a warship, and periodic rather than
 * continuous — the hull between two of these is what carries the load.
 */
function Porthole({ window: port, mode }: { window: GlazedWindow; mode: RenderMode }) {
  const radius = port.extent[0];
  const state: GlazingState = port.state;

  return (
    <group>
      {/* Bezel: the ring the pane is bolted through. */}
      <mesh castShadow>
        <torusGeometry args={[radius * 1.02, radius * 0.17, 6, 14]} />
        <meshStandardMaterial {...FRAME} />
      </mesh>

      {/* Reveal: the dark cavity behind the glass. Set back, so a blown port is
          visibly a hole and not a black sticker. */}
      <mesh position={[0, 0, state === 'blown' ? -0.05 : -0.01]}>
        <circleGeometry args={[radius * 0.96, 16]} />
        <meshStandardMaterial {...REVEAL} side={DoubleSide} />
      </mesh>

      {state !== 'blown' && (
        <mesh position={[0, 0, 0.018]}>
          <circleGeometry args={[radius * 0.84, 16]} />
          <GlazingMaterial
            brightness={port.brightness}
            peak={GLAZING_INTENSITY}
            mode={mode}
          />
        </mesh>
      )}

      {(state === 'cracked' || state === 'blown') && (
        <Fracture radius={radius} blown={state === 'blown'} />
      )}
    </group>
  );
}

/* --------------------------- Flight deck --------------------------- */

/** Clear frame between two panes. Wide enough to read as structure. */
const MULLION = 0.05;

/**
 * The bridge: a mullioned band, several times the area of any porthole.
 *
 * Segmented rather than one sheet for the reason a real ship's bridge is —
 * spanning that width in one pane means losing the frame that carries the deck
 * above it — and because the mullions are what stop a large emissive rectangle
 * reading as a lightbox.
 */
function FlightDeck({ window: deck, mode }: { window: GlazedWindow; mode: RenderMode }) {
  const [halfWidth, halfHeight] = deck.extent;
  const panes = Math.max(1, deck.panes);
  const paneWidth = (halfWidth * 2 - (panes - 1) * MULLION) / panes;

  return (
    <group>
      {/* Surround: the coaming the whole band is set into. */}
      <mesh castShadow receiveShadow position={[0, 0, -0.02]}>
        <boxGeometry args={[halfWidth * 2 + 0.16, halfHeight * 2 + 0.14, 0.09]} />
        <meshStandardMaterial {...FRAME} />
      </mesh>

      {/* Brow, hooding the glass. Every bridge that has to see forward past its
          own floodlights has one. */}
      <mesh castShadow position={[0, halfHeight + 0.13, 0.07]} rotation={[-0.5, 0, 0]}>
        <boxGeometry args={[halfWidth * 2 + 0.2, 0.05, 0.2]} />
        <meshStandardMaterial {...FRAME} />
      </mesh>

      {Array.from({ length: panes }, (_, i) => {
        const x = -halfWidth + paneWidth / 2 + i * (paneWidth + MULLION);
        return (
          <group key={i} position={[x, 0, 0]}>
            <mesh position={[0, 0, 0.026]}>
              <planeGeometry args={[paneWidth * 0.94, halfHeight * 1.84]} />
              <GlazingMaterial
                brightness={deck.state === 'lit' ? deck.brightness : 0}
                peak={FLIGHT_DECK_INTENSITY}
                mode={mode}
              />
            </mesh>
            {deck.state === 'blown' && (
              <Fracture radius={Math.min(paneWidth, halfHeight * 1.8) * 0.5} blown />
            )}
            {deck.state === 'cracked' && (
              <Fracture radius={Math.min(paneWidth, halfHeight * 1.8) * 0.4} blown={false} />
            )}
          </group>
        );
      })}
    </group>
  );
}

/* --------------------------- The set --------------------------- */

export function ShipWindows({
  archetype,
  volumes,
  sockets,
  seed,
  wear,
  condition,
  mode,
}: WindowsProps) {
  const placements = useMemo(
    () => placeWindows(archetype, volumes, sockets, seed),
    [archetype, volumes, sockets, seed],
  );

  const glazed = useMemo(
    () => glazeWindows(placements, wear, condition, seed),
    [placements, wear, condition, seed],
  );

  return (
    <group>
      {glazed.map((window) => (
        <group
          key={window.id}
          position={[window.position[0], window.position[1], window.position[2]]}
          quaternion={apertureQuaternion(window.normal, window.up)}
        >
          {window.class === 'flight_deck' ? (
            <FlightDeck window={window} mode={mode} />
          ) : (
            <Porthole window={window} mode={mode} />
          )}
        </group>
      ))}
    </group>
  );
}
