import NSSGMRaw from './NS-SGM.secure.json?raw';
import NSDM90Raw from './NS-DM90.secure.json?raw';
import type { TrainConfig, TrainDisplayConfig } from '../TrainConfig';

export const nssgmTrainType = 'nssgm';
export const nsdm90TrainType = 'nsdm90';

const rawConfigurations = {
    [nssgmTrainType]: NSSGMRaw,
    [nsdm90TrainType]: NSDM90Raw,


} as Record<string, string>;

export const trainAssetsPath = '/models';

export const availableTrainTypes: string[] = Object.keys(rawConfigurations);

export function getTrainConfiguration(trainType: string): TrainConfig {
    return JSON.parse(rawConfigurations[trainType]);
}

export function getTrainDisplay(trainType: string): TrainDisplayConfig {
    return getTrainConfiguration(trainType).display;
}
