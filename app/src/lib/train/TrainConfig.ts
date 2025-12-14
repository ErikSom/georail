// Train configuration types

export interface BogieConfig {
    zOffset: number;
    frontWheelOffset: number;
    backWheelOffset: number;
    entityName?: string;
}

export interface CabConfig {
    modelPath: string;
    scale: number;
    modelOffset: {
        x: number;
        y: number;
        z: number;
    }
    frontBogie: BogieConfig;
    rearBogie: BogieConfig;
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
            },
            rearBogie: {
                zOffset: -5.0,  // 5 meters backward from cab center
                frontWheelOffset: 1.0,  // 1 meter forward from bogie center
                backWheelOffset: -1.0,  // 1 meter backward from bogie center
                entityName: '',  // Name of rear bogie in GLB (leave empty to auto-detect)
            },
        }
    };
}
