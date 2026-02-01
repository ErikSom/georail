import { signal } from "@preact/signals";
import { AudioListener, PerspectiveCamera } from "three";

/**
 * Global state for Three.js objects that need to be shared across systems
 */

const searchParams = new URLSearchParams(typeof window !== 'undefined' ? window.location.search : '');

// Audio listener for positional audio (typically attached to the camera)
export const audioListener = signal<AudioListener | null>(null);

// Main camera reference (optional, for future use)
export const mainCamera = signal<PerspectiveCamera | null>(null);

// Global time scale - multiply all delta times by this value
// 1.0 = normal speed, 2.0 = double speed, 0.5 = half speed
export const timeScale = signal(searchParams.get('timeScale') ? parseFloat(searchParams.get('timeScale')!) : 1.0);

console.log(`Time scale set to ${timeScale.value}`);

// Scaled delta time in seconds - updated by World.ts each frame
// Use this for any time-based calculations that should respect timeScale
export const scaledDeltaTime = signal(0);

interface Configs {
    unitSystem: 'metric' | 'imperial';
    // Dwell time settings (in minutes)
    initialDwellTime: number;      // Dwell time at first stop (used in both regular and custom)
    minStopDwellTime: number;      // Minimum random dwell time at intermediate stops (custom only)
    maxStopDwellTime: number;      // Maximum random dwell time at intermediate stops (custom only)
    // Station stop detection - zone is centered on station, length = train length + this leniency
    stationStopLeniencyM: number;  // Extra meters added to train length for stop zone (default: 15m)
}
export const configs = signal<Configs>({
    unitSystem: 'metric',
    initialDwellTime: 1,
    minStopDwellTime: 1,
    maxStopDwellTime: 6,
    stationStopLeniencyM: 15,
});

