import { signal, computed, effect } from "@preact/signals";
import type { Train } from "../lib/train/Train";

// Train state signals
export const trainPower = signal(0); // -1 to 1 — dial value: positive = accelerate, negative = brake
export const trainDirection = signal<1 | -1>(1); // 1 = forward, -1 = backward
export const trainVelocityKmh = signal(0);
export const trainMaxSpeedKmh = signal(120); // Max speed from train config, default 120
export const trainTractiveEffort = signal(0); // 0 to 1 (normalized)
export const trainBraking = signal(false); // True when dial opposes gear direction
export const trainInstance = signal<Train | null>(null);
export const trainDoorsOpen = signal(false);
export const trainHeadlightsOn = signal(false);
export const trainControlsOpen = signal(true);
export const trainDebugMode = signal(false); // Enable debug visualization

// Train geographic position - stored as integers to preserve precision
// lat/lon are multiplied by 1e7 (0.0000001 degree precision ~ 1cm)
export const trainLatE7 = signal(0);
export const trainLonE7 = signal(0);

// Front and back of train positions for accurate bearing calculation on 2D maps
// These allow Maps2D to calculate bearing from actual track positions
export const trainFrontLatE7 = signal(0);
export const trainFrontLonE7 = signal(0);
export const trainBackLatE7 = signal(0);
export const trainBackLonE7 = signal(0);

// Computed values for easy access to floating point front/back lat/lon
export const trainFrontLat = computed(() => trainFrontLatE7.value / 1e7);
export const trainFrontLon = computed(() => trainFrontLonE7.value / 1e7);
export const trainBackLat = computed(() => trainBackLatE7.value / 1e7);
export const trainBackLon = computed(() => trainBackLonE7.value / 1e7);

// Camera yaw relative to train (in degrees, 0 = looking along train direction)
// Used by 2D map to rotate the map to match camera view
export const cameraYawRelativeToTrain = signal(0);

// Computed values for easy access to floating point lat/lon
export const trainLat = computed(() => trainLatE7.value / 1e7);
export const trainLon = computed(() => trainLonE7.value / 1e7);

// Update tick signal - increment this to trigger React components to update
export const updateTick = signal(0);

// Delta time in milliseconds for frame-based calculations
export const deltaTimeMs = signal(16); // Default to ~60fps

// Train path progress
export const trainDistanceTraveled = signal(0); // Distance traveled along the path in meters
export const trainPathTotalLength = signal(0);  // Total path length in meters
export const trainLength = signal(0);           // Total train length in meters

// Train consist layout for 2D map rendering
export interface ConsistCar {
    type: 'cab' | 'wagon' | 'rearCab';
    length: number; // meters
}
export const trainConsist = signal<ConsistCar[]>([]);

// Computed values
export const trainPowerPercent = computed(() => trainPower.value * 100);

// Internal state for delta time calculation
let lastUpdateTime = performance.now();

// Set up bidirectional sync when train instance is available
effect(() => {
    const train = trainInstance.value;
    if (!train) return;

    // Dial is direction-agnostic: positive = accelerate, negative = brake.
    // Multiply by direction so physics receives the correct signed power.
    train.setPower(trainPower.value * trainDirection.value);
});

effect(() => {
    const train = trainInstance.value;
    if (!train) return;
    train.setDoorsOpen(trainDoorsOpen.value);
});

effect(() => {
    const train = trainInstance.value;
    if (!train) return;
    train.setTrainLightsOn(trainHeadlightsOn.value);
});

/**
 * Call this from the game loop to update velocity and trigger React components
 */
export function updateTrainState() {
    const train = trainInstance.value;
    if (train) {
        trainVelocityKmh.value = train.getVelocityKmh();
        trainTractiveEffort.value = train.getNormalizedTractiveEffort();
        trainBraking.value = train.isBraking();
        trainDistanceTraveled.value = train.distanceTraveled;
        trainPathTotalLength.value = train.getPath()?.getTotalLength() ?? 0;
        trainLength.value = train.getTotalLength();

        // Populate consist layout once
        if (trainConsist.value.length === 0) {
            trainConsist.value = train.getConsistLayout();
        }
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
    trainDirection.value = 1;
    trainVelocityKmh.value = 0;
    trainDistanceTraveled.value = 0;
    trainPathTotalLength.value = 0;
    trainLength.value = 0;
    trainTractiveEffort.value = 0;
    trainBraking.value = false;
    trainConsist.value = [];
    const train = trainInstance.value;
    if (train) {
        train.setPower(0);
    }
}
