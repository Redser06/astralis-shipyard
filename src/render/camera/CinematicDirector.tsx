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
        // Continuous sinusoidal ping-pong dolly tracking along hull — eliminates modulo snap
        const dollyPhase = Math.sin(t * 0.18);
        const z = dollyPhase * 11;
        const x = -10.5 + Math.cos(t * 0.22) * 1.5;
        const y = -1.2 + Math.sin(t * 0.3) * 1.8;

        targetCamPos.current.set(x, y, z);
        targetLookAt.current.set(0, 0.2, z * 0.7);
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
        // Over-the-shoulder starboard dorsal view looking ALONG forward firing cone
        targetCamPos.current.set(2.4, 2.2, 1.2);
        // Target vector points forward along ship axis with subtle simulated targeting drift
        const leadJitterX = Math.sin(t * 1.8) * 1.5;
        const leadJitterY = Math.cos(t * 2.2) * 0.8;
        targetLookAt.current.set(leadJitterX, 0.8 + leadJitterY, 28);
        break;
      }

      case 'flyby_pass': {
        // Sweeping diagonal orbital pass tracking the ship's center of mass
        const sweepAngle = t * 0.25;
        targetCamPos.current.set(
          Math.cos(sweepAngle) * 18,
          4.5 + Math.sin(t * 0.15) * 2,
          Math.sin(sweepAngle) * 18,
        );
        // Always lock focal center to the ship origin with subtle forward anticipation
        targetLookAt.current.set(0, 0.4, 0);
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
