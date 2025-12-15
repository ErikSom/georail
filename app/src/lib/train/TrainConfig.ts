export interface BogieConfig {
    zOffset: number;
    wheelOffsetFront: number;
    wheelOffsetRear: number;
    entityName?: string;
}

export interface RollingStockConfig {
    length: number; // in meters
    weight: number; // in metric tons
    width: number; // in meters
    height: number; // in meters

    modelPath: string;
    scale: number;
    modelOffset: {
        x: number;
        y: number;
        z: number;
    }

    frontBogie: BogieConfig;
    rearBogie: BogieConfig;

    couplerLengthFront: number; // in meters
    couplerLengthRear: number; // in meters

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
            height: 4.0,
            width: 3.0,
            modelPath: '/models/train/cab.glb',
            scale: 1.0,
            modelOffset: {
                x: 0.0,
                y: 0.0,
                z: 0.0
            },
            frontBogie: {
                zOffset: 5.0,
                wheelOffsetFront: 1.0,
                wheelOffsetRear: -1.0,
                entityName: '',
            },
            rearBogie: {
                zOffset: -5.0,
                wheelOffsetFront: 1.0,
                wheelOffsetRear: -1.0,
                entityName: '',
            },
            couplerLengthFront: 0.0,
            couplerLengthRear: 0.5,
            engine: false,
            enginePower: 0.0,
            brakingPower: 0.0,
        },
        wagons: []
    };
}
