export interface BogieConfig {
    zOffset: number;
    wheelOffsetFront: number;
    wheelOffsetRear: number;
    entityName?: string;
    boneForwardAxis: { x: number; y: number; z: number };
}

export interface WheelConfig {
    pattern: string; // Regex pattern to match wheel mesh names
    rotationAxis: { x: number; y: number; z: number }; // Axis to rotate around
    radius: number; // Wheel radius in meters
}

export interface AnimationGroupConfig {
    name: string;
    pattern: string;
    speed: number;
    reverse: boolean;
    autoPlay: boolean;
    loop: boolean;
    alternate: boolean;
}

export interface InteriorMaterialConfig {
    pattern: string; // Regex pattern to match material names (e.g., "inside|seats")
    emissiveColor: number; // Hex color (e.g., 0xff8c00)
    emissiveIntensity: number; // 0-1 range
}

export type AudioCurvePoint = { x: number; y: number };
export type AudioCurveAxis = { min: number; max: number; label?: string };
export type AudioCurveAxes = { x: AudioCurveAxis; y: AudioCurveAxis };
export interface AudioCurve {
    points: AudioCurvePoint[];
    axis?: AudioCurveAxes;
}
export interface AudioSound {
    file: string;
    curves: AudioCurve[];
}
export interface AudioComposition {
    title: string;
    sounds: AudioSound[];
}
export interface AudioFile {
    name: string;
    url: string;
}

export interface AudioConfig {
    files: AudioFile[];
    compositions: AudioComposition[];
}

export interface RollingStockConfig {
    length: number; // in meters
    weight: number; // in metric tons
    width: number; // in meters
    height: number; // in meters

    modelPath: string;
    internal?: boolean;
    scale: number;
    modelOffset: {
        x: number;
        y: number;
        z: number;
    }
    // Model forward axis - defines which local axis of the model should point forward along the track
    modelForwardAxis: { x: number; y: number; z: number };
    reverseOnTrack: boolean;

    frontBogie: BogieConfig;
    rearBogie: BogieConfig;

    couplerLengthFront: number; // in meters
    couplerLengthRear: number; // in meters

    // Optional properties
    engine: boolean;
    enginePower: number; // in kW
    brakingPower: number; // in kN

    // Animation groups
    animationGroups: AnimationGroupConfig[];

    // Wheel configurations for rotation
    wheels: WheelConfig[];

    // Interior material configuration
    interiorMaterial: InteriorMaterialConfig;
}

export interface CabConfig extends RollingStockConfig {
    // Additional cab-specific properties can go here
}

export interface WagonConfig extends RollingStockConfig {
    // Additional wagon-specific properties can go here
}

export interface TrainGeneralConfig {
    maxSpeed?: number; // Maximum speed in km/h - defaults to 120
}

export interface TrainConfig {
    general?: TrainGeneralConfig;
    cab: CabConfig;
    wagons: WagonConfig[];
    rearCab?: CabConfig;
    audio: AudioConfig;
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
            modelForwardAxis: { x: 0, y: 0, z: 1 }, // Default: +Z forward
            reverseOnTrack: false,
            frontBogie: {
                zOffset: 5.0,
                wheelOffsetFront: 1.0,
                wheelOffsetRear: -1.0,
                entityName: '',
                boneForwardAxis: { x: 0, y: 0, z: 1 }, // Default: +Z forward
            },
            rearBogie: {
                zOffset: -5.0,
                wheelOffsetFront: 1.0,
                wheelOffsetRear: -1.0,
                entityName: '',
                boneForwardAxis: { x: 0, y: 0, z: 1 }, // Default: +Z forward
            },
            couplerLengthFront: 0.0,
            couplerLengthRear: 0.5,
            engine: false,
            enginePower: 0.0,
            brakingPower: 0.0,
            animationGroups: [],
            wheels: [],
            interiorMaterial: {
                pattern: '',
                emissiveColor: 0xffffff,
                emissiveIntensity: 1.0,
            },
        },
        wagons: [],
        audio: {
            files: [],
            compositions: []
        },
    };
}
