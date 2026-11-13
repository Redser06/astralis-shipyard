import { useEffect, useRef, type RefObject } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import { MathUtils, PerspectiveCamera, Quaternion, Vector3, type Group } from 'three';
import type { MissionState, MissionTelemetry } from '../../domain/types';
import { useReducedMotion } from '../useReducedMotion';
import type { CinematicCut } from '../viewportOptions';

export type { CinematicCut };

export interface CinematicDirectorProps {
  active: boolean;
  cut: CinematicCut;
  shipRef?: RefObject<Group | null>;
  missionState?: MissionState | null;
  missionTelemetry?: MissionTelemetry | null;
  burning?: boolean;
}

const IDENTITY_QUAT = new Quaternion();

/**
 * Dedicated cinema director camera sequencer.
 *
 * Cleanly takes exclusive control of camera transformation during cinematic
 * sequences, preventing any oscillation/fighting with OrbitControls while
 * framing both the hero starship and the surrounding deep-space ether.
 */
export function CinematicDirector({
  active,
  cut,
  shipRef,
  missionState,
  missionTelemetry,
  burning = false,
}: CinematicDirectorProps) {
  const { camera } = useThree();
  const reducedMotion = useReducedMotion();

  const currentLookAt = useRef(new Vector3(0, 0, 0));
  const targetCamPos = useRef(new Vector3());
  const targetLookAt = useRef(new Vector3());
  const shipPos = useRef(new Vector3());
  const shipQuat = useRef(new Quaternion());
  const blendedQuat = useRef(new Quaternion());
  const scratchOffset = useRef(new Vector3());
  const scratchForward = useRef(new Vector3());
  const initializedRef = useRef(false);

  useEffect(() => {
    if (!active) {
      initializedRef.current = false;
    }
  }, [active]);

  useFrame((state, delta) => {
    if (!active || reducedMotion) return;
    const dt = Math.min(0.05, Math.max(0.001, delta));
    const t = state.clock.elapsedTime;

    const ship = shipRef?.current;
    if (ship) {
      shipPos.current.copy(ship.position);
      shipQuat.current.copy(ship.quaternion);
    } else {
      shipPos.current.set(0, 0, 0);
      shipQuat.current.copy(IDENTITY_QUAT);
    }

    if (!initializedRef.current) {
      currentLookAt.current.copy(shipPos.current);
      initializedRef.current = true;
    }

    const p = Math.min(1, Math.max(0, missionTelemetry?.progress ?? 0));
    const throttlePct = missionTelemetry?.throttlePct ?? (burning ? 85 : 0);

    switch (cut) {
      case 'gantry_dolly': {
        // Elevated diagonal berth dolly showcasing hull armor, gantry trusses, shuttles & Moon
        const phase = t * 0.2;
        const x = -15.2 + Math.cos(phase * 1.1) * 2.4;
        const y = 5.4 + Math.sin(t * 0.26) * 1.9;
        const z = 13.5 + Math.sin(phase * 0.85) * 10.5;

        targetCamPos.current.set(
          shipPos.current.x + x,
          shipPos.current.y + y,
          shipPos.current.z + z,
        );
        targetLookAt.current.set(
          shipPos.current.x + 1.2,
          shipPos.current.y + 0.4,
          shipPos.current.z - 1.5,
        );
        break;
      }

      case 'docking_umbilical': {
        // Scenic mooring angle highlighting connected docking tunnels, holding prongs, hoses & Moon
        const u = Math.sin(t * 0.2);
        targetCamPos.current.set(
          shipPos.current.x - 12.2 + u * 2.0,
          shipPos.current.y + 4.4 + Math.cos(t * 0.16) * 1.5,
          shipPos.current.z + 13.0 - u * 3.8,
        );
        targetLookAt.current.set(
          shipPos.current.x + 0.8,
          shipPos.current.y + 0.3,
          shipPos.current.z - 1.2,
        );
        break;
      }

      case 'chase_cam': {
        // Heroic 3/4 wide stern-quarter chase (distance ~24.5) framing plumes + forward vista
        blendedQuat.current.slerpQuaternions(IDENTITY_QUAT, shipQuat.current, 0.55);
        const tremor =
          missionState === 'warp' || throttlePct > 65
            ? Math.sin(t * 23.0) * 0.035
            : 0;
        scratchOffset.current
          .set(-9.2 + Math.sin(t * 0.23) * 3.0 + tremor, 5.8 + Math.cos(t * 0.19) * 1.4, -22.0)
          .applyQuaternion(blendedQuat.current);

        targetCamPos.current.copy(shipPos.current).add(scratchOffset.current);

        scratchForward.current.set(0.6, 0.35, 6.5).applyQuaternion(blendedQuat.current);
        targetLookAt.current.copy(shipPos.current).add(scratchForward.current);
        break;
      }

      case 'turret_ots': {
        // Elevated over-the-shoulder gunnery view clear of all 8 hull superstructures
        blendedQuat.current.slerpQuaternions(IDENTITY_QUAT, shipQuat.current, 0.72);
        scratchOffset.current
          .set(5.2 + Math.sin(t * 0.42) * 1.8, 4.8 + Math.cos(t * 0.35) * 0.6, -6.2)
          .applyQuaternion(blendedQuat.current);
        targetCamPos.current.copy(shipPos.current).add(scratchOffset.current);

        scratchForward.current
          .set(Math.sin(t * 1.1) * 2.2, 1.0 + Math.cos(t * 1.3) * 0.6, 22.0)
          .applyQuaternion(blendedQuat.current);
        targetLookAt.current.copy(shipPos.current).add(scratchForward.current);
        break;
      }

      case 'flyby_pass': {
        // Wide 3/4 orbital sweep (distance ~24-27) framing ship + planets/nebula/Moon
        const sweepAngle = t * 0.2 + 0.6;
        const radius = 24.5 + Math.sin(t * 0.13) * 2.5;
        targetCamPos.current.set(
          shipPos.current.x + Math.cos(sweepAngle) * radius,
          shipPos.current.y + 6.2 + Math.sin(t * 0.17) * 3.2,
          shipPos.current.z + Math.sin(sweepAngle) * radius,
        );
        targetLookAt.current.set(
          shipPos.current.x,
          shipPos.current.y + 0.2,
          shipPos.current.z,
        );
        break;
      }

      case 'orbital_horizon': {
        // Low-to-high 3/4 cosmic horizon sweep showcasing Moon, ringed giant, nebula & traffic
        const sweep = t * 0.13 - 0.75;
        targetCamPos.current.set(
          shipPos.current.x + Math.sin(sweep) * 23.0 - 3.5,
          shipPos.current.y + 3.2 + Math.sin(t * 0.18) * 3.6,
          shipPos.current.z + Math.cos(sweep) * 17.5 + 3.5,
        );
        targetLookAt.current.set(
          shipPos.current.x + Math.cos(sweep) * 2.2,
          shipPos.current.y + 0.7,
          shipPos.current.z + 1.5,
        );
        break;
      }
    }

    // Critically smoothed camera and look-at tracking
    const posAlpha = 1 - Math.exp(-3.4 * dt);
    const lookAlpha = 1 - Math.exp(-4.8 * dt);
    camera.position.lerp(targetCamPos.current, posAlpha);
    currentLookAt.current.lerp(targetLookAt.current, lookAlpha);
    camera.lookAt(currentLookAt.current);

    // Subtle dynamic FOV breath during warp and high-throttle burn
    if (camera instanceof PerspectiveCamera) {
      let targetFov = cut === 'orbital_horizon' || cut === 'flyby_pass' ? 47.5 : 45.0;
      if (missionState === 'warp') {
        const warpEnv = Math.sin(Math.min(1, p / 0.18) * Math.PI * 0.5) * (p > 0.85 ? (1 - p) / 0.15 : 1);
        targetFov = 45.0 + 11.0 * Math.max(0.25, warpEnv);
      } else if (throttlePct > 60 || burning) {
        targetFov = Math.max(targetFov, 49.5);
      }

      const nextFov = MathUtils.damp(camera.fov, targetFov, 2.8, dt);
      if (Math.abs(nextFov - camera.fov) > 0.005) {
        camera.fov = nextFov;
        camera.updateProjectionMatrix();
      }
    }
  });

  return null;
}
