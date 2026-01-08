import NSSGMRaw from './NS-SGM.secure.json?raw';

export const nssgmTrainType = 'nssgm';

const rawConfigurations = {
    [nssgmTrainType]: NSSGMRaw
} as Record<string, string>;

export const trainAssetsPath = '/models';

export function getTrainConfiguration(trainType: keyof typeof rawConfigurations) {
    return JSON.parse(rawConfigurations[trainType]);
}

