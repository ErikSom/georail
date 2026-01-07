import NSSGMRaw from './NS-SGM.secure.json?raw';

const rawConfigurations = {
    NSSGM: NSSGMRaw
} as Record<string, string>;

export const trainAssetsPath = '/models';

export function getTrainConfiguration(trainType: keyof typeof rawConfigurations) {
    return JSON.parse(rawConfigurations[trainType]);
}

