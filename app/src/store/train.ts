import { signal, computed, effect } from "@preact/signals";
import type { Train } from "../lib/train/Train";

// Train state signals
export const trainPower = signal(0); // -1 to 1
export const trainVelocityKmh = signal(0);
export const trainInstance = signal<Train | null>(null);
export const trainDebugMode = signal(false); // Enable debug visualization

// Update tick signal - increment this to trigger React components to update
export const updateTick = signal(0);

// Delta time in milliseconds for frame-based calculations
export const deltaTimeMs = signal(16); // Default to ~60fps

// Computed values
export const trainPowerPercent = computed(() => trainPower.value * 100);

// Internal state for delta time calculation
let lastUpdateTime = performance.now();

// Set up bidirectional sync when train instance is available
effect(() => {
    const train = trainInstance.value;
    if (!train) return;

    // Apply power changes to train
    train.setPower(trainPower.value);
});

/**
 * Call this from the game loop to update velocity and trigger React components
 */
export function updateTrainState() {
    const train = trainInstance.value;
    if (train) {
        trainVelocityKmh.value = train.getVelocityKmh();
    }

    // Calculate delta time
    const now = performance.now();
    const dt = now - lastUpdateTime;
    lastUpdateTime = now;
    deltaTimeMs.value = dt;

    // Increment tick to trigger React component updates
    updateTick.value++;
}

// Helper to reset train
export function resetTrain() {
    trainPower.value = 0;
    const train = trainInstance.value;
    if (train) {
        train.setPower(0);
    }
}
