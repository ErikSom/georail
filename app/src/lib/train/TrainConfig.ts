// Train configuration types

export interface BogieConfig {
    // Offset from cab center along Z axis (forward/backward)
    zOffset: number;
    // Offset of front wheel from bogie center along Z axis
    frontWheelOffset: number;
    // Offset of back wheel from bogie center along Z axis
    backWheelOffset: number;
    // Name of the bogie entity in the GLB model hierarchy (optional)
    entityName?: string;
    // Visual debug options
    showDebug: boolean;
}

export interface CabConfig {
    // GLB model path
    modelPath: string;
    // Scale of the cab model
    scale: number;
    // Vertical offset from rail (altitude)
    altitudeOffset: number;
    // Position offset for the visual model (X, Y, Z)
    // Use this to align the GLB model with the mechanical cab center
    modelOffset: {
        x: number;
        y: number;
        z: number;
    }
    // Front bogie configuration
    frontBogie: BogieConfig;
    // Rear bogie configuration
    rearBogie: BogieConfig;
    // Visual debug options
    showDebug: boolean;
}

export interface TrainConfig {
    cab: CabConfig;
    // Future: wagons will go here
    // wagons: WagonConfig[];
}

// Default configuration
export function getDefaultTrainConfig(): TrainConfig {
    return {
        cab: {
            modelPath: '/models/train/cab.glb',
            scale: 1.0,
            altitudeOffset: 0.0,
            modelOffset: {
                x: 0.0,
                y: 0.0,
                z: 0.0
            },
            frontBogie: {
                zOffset: 5.0,  // 5 meters forward from cab center
                frontWheelOffset: 1.0,  // 1 meter forward from bogie center
                backWheelOffset: -1.0,  // 1 meter backward from bogie center
                entityName: '',  // Name of front bogie in GLB (leave empty to auto-detect)
                showDebug: true
            },
            rearBogie: {
                zOffset: -5.0,  // 5 meters backward from cab center
                frontWheelOffset: 1.0,  // 1 meter forward from bogie center
                backWheelOffset: -1.0,  // 1 meter backward from bogie center
                entityName: '',  // Name of rear bogie in GLB (leave empty to auto-detect)
                showDebug: true
            },
            showDebug: true
        }
    };
}
