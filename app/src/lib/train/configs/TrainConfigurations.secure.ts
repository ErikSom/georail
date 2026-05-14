import NSSGMRaw from './NS-SGM.secure.json?raw';
import type { TrainConfig, TrainDisplayConfig } from '../TrainConfig';

export const nssgmTrainType = 'nssgm';

const rawConfigurations = {
    [nssgmTrainType]: NSSGMRaw,
} as Record<string, string>;

export const trainAssetsPath = '/models';

export const availableTrainTypes: string[] = Object.keys(rawConfigurations);

export function getTrainConfiguration(trainType: string): TrainConfig {
    return JSON.parse(rawConfigurations[trainType]);
}

export function getTrainDisplay(trainType: string): TrainDisplayConfig {
    return getTrainConfiguration(trainType).display;
}
