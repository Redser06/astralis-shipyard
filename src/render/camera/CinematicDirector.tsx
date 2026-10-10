import { useRef } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import { Vector3 } from 'three';
import { useReducedMotion } from '../useReducedMotion';

export type CinematicCut = 'gantry_dolly' | 'chase_cam' | 'turret_ots' | 'flyby_pass';

export interface CinematicDirectorProps {
  active: boolean;
  cut: CinematicCut;
}

/**
 * Dedicated cinema director camera sequencer.
 * Cleanly takes exclusive control of camera transformation during cinematic sequences,
 * preventing any oscillation/fighting with OrbitControls.
 */
export function CinematicDirector({ active, cut }: CinematicDirectorProps) {
  const { camera } = useThree();
  const reducedMotion = useReducedMotion();
  const currentLookAt = useRef(new Vector3(0, 0, 0));
  const targetCamPos = useRef(new Vector3());
  const targetLookAt = useRef(new Vector3());

  useFrame((state, delta) => {
    if (!active || reducedMotion) return;
    const t = state.clock.elapsedTime;

    switch (cut) {
      case 'gantry_dolly': {
        // Slow low-angle pan tracking along the hull plates under the searchlights
        const dollyProgress = (t * 0.12) % 1.0;
        const z = -14 + dollyProgress * 26;
        const x = -11 + Math.sin(t * 0.25) * 2;
        const y = -1.5 + Math.cos(t * 0.2) * 2.5;

        targetCamPos.current.set(x, y, z);
        targetLookAt.current.set(0, 0.5, z + 4);
        break;
      }

      case 'chase_cam': {
        // Spring-arm damped trailing camera behind engine bells with micro speed shake
        const shakeX = Math.sin(t * 22) * 0.04;
        const shakeY = Math.cos(t * 28) * 0.04;

        targetCamPos.current.set(shakeX, 2.2 + shakeY, -17.5);
        targetLookAt.current.set(0, 0.2, 8);
        break;
      }

      case 'turret_ots': {
        // Over-the-shoulder dorsal deck perspective tracking outward scan vectors
        const scanAngle = t * 0.6;
        targetCamPos.current.set(2.2, 3.4, 1.8);
        targetLookAt.current.set(
          Math.sin(scanAngle) * 24,
          2.0 + Math.sin(t * 1.2) * 4,
          Math.cos(scanAngle) * 24,
        );
        break;
      }

      case 'flyby_pass': {
        // Stationary deep-space camera framing orbital sweep
        targetCamPos.current.set(13.5, 4.5, 6.0);
        const shipZ = Math.sin(t * 0.4) * 12;
        targetLookAt.current.set(0, 0, shipZ);
        break;
      }
    }

    // Smooth spherical/linear camera interpolation
    const lerpFactor = 1 - Math.pow(0.005, delta);
    camera.position.lerp(targetCamPos.current, lerpFactor);
    currentLookAt.current.lerp(targetLookAt.current, lerpFactor);
    camera.lookAt(currentLookAt.current);
  });

  return null;
}
