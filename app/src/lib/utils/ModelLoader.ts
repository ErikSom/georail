import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { DRACOLoader } from 'three/addons/loaders/DRACOLoader.js';

/**
 * Centralized model loader configuration
 * This ensures all GLTFLoaders in the project share the same DRACOLoader instance
 */

let gltfLoader: GLTFLoader | null = null;
let dracoLoader: DRACOLoader | null = null;

/**
 * Get the decoder path for DRACOLoader
 * Uses the same path as MapViewer for consistency
 */
function getDracoDecoderPath(): string {
    // Check if running in development or production
    const isDev = import.meta.env.DEV;

    if (isDev) {
        // In development, use node_modules
        return '/node_modules/three/examples/jsm/libs/draco/';
    } else {
        // In production, use CDN
        return 'https://www.gstatic.com/draco/versioned/decoders/1.5.6/';
    }
}

/**
 * Get a configured GLTFLoader instance with DRACOLoader support
 * This loader is shared across the application for efficiency
 */
export function getGLTFLoader(): GLTFLoader {
    if (!gltfLoader) {
        gltfLoader = new GLTFLoader();

        // Configure DRACOLoader if not already configured
        if (!dracoLoader) {
            dracoLoader = new DRACOLoader();
            dracoLoader.setDecoderPath(getDracoDecoderPath());
        }

        gltfLoader.setDRACOLoader(dracoLoader);
    }

    return gltfLoader;
}

/**
 * Dispose of the shared loaders (call during cleanup if needed)
 */
export function disposeModelLoaders(): void {
    if (dracoLoader) {
        dracoLoader.dispose();
        dracoLoader = null;
    }
    gltfLoader = null;
}
