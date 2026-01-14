import { signal } from "@preact/signals";
import { AudioListener, PerspectiveCamera } from "three";

/**
 * Global state for Three.js objects that need to be shared across systems
 */

// Audio listener for positional audio (typically attached to the camera)
export const audioListener = signal<AudioListener | null>(null);

// Main camera reference (optional, for future use)
export const mainCamera = signal<PerspectiveCamera | null>(null);
