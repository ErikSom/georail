export interface BogieConfig {
    zOffset: number;
    frontWheelOffset: number;
    backWheelOffset: number;
    entityName?: string;
}

export interface RollingStockConfig {
    length: number; // in meters
    weight: number; // in metric tons
    modelPath: string;
    scale: number;
    modelOffset: {
        x: number;
        y: number;
        z: number;
    }
    frontBogie: BogieConfig;
    rearBogie: BogieConfig;

    // Optional properties
    engine: boolean;
    enginePower: number; // in kW
    brakingPower: number; // in kN
}

export interface CabConfig extends RollingStockConfig {
    // Additional cab-specific properties can go here
}

export interface WagonConfig extends RollingStockConfig {
    // Additional wagon-specific properties can go here
}

export interface TrainConfig {
    cab: CabConfig;
    wagons: WagonConfig[];
    rearCab?: CabConfig;
}

// Default configuration
export function getDefaultTrainConfig(): TrainConfig {
    return {
        cab: {
            length: 10.0,
            weight: 40.0,
            modelPath: '/models/train/cab.glb',
            scale: 1.0,
            modelOffset: {
                x: 0.0,
                y: 0.0,
                z: 0.0
            },
            frontBogie: {
                zOffset: 5.0,
                frontWheelOffset: 1.0,
                backWheelOffset: -1.0,
                entityName: '',
            },
            rearBogie: {
                zOffset: -5.0,
                frontWheelOffset: 1.0,
                backWheelOffset: -1.0,
                entityName: '',
            },
            engine: false,
            enginePower: 0.0,
            brakingPower: 0.0,
        },
        wagons: []
    };
}
