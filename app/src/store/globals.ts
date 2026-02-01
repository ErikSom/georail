import { signal } from "@preact/signals";
import { AudioListener, PerspectiveCamera } from "three";

/**
 * Global state for Three.js objects that need to be shared across systems
 */

// Audio listener for positional audio (typically attached to the camera)
export const audioListener = signal<AudioListener | null>(null);

// Main camera reference (optional, for future use)
export const mainCamera = signal<PerspectiveCamera | null>(null);

interface Configs {
    unitSystem: 'metric' | 'imperial';
    // Dwell time settings (in minutes)
    initialDwellTime: number;      // Dwell time at first stop (used in both regular and custom)
    minStopDwellTime: number;      // Minimum random dwell time at intermediate stops (custom only)
    maxStopDwellTime: number;      // Maximum random dwell time at intermediate stops (custom only)
}
export const configs = signal<Configs>({
    unitSystem: 'metric',
    initialDwellTime: 1,
    minStopDwellTime: 1,
    maxStopDwellTime: 6
});

