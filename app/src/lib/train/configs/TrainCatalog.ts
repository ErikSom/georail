import { availableTrainTypes, getTrainDisplay } from './TrainConfigurations.secure';
import type { TrainDisplayConfig, TrainOperator } from '../TrainConfig';

export type { TrainOperator };

export interface TrainCatalogEntry extends TrainDisplayConfig {
    id: string;
    trainType: string;
}

export const trainCatalog: TrainCatalogEntry[] = availableTrainTypes.map(trainType => ({
    id: trainType,
    trainType,
    ...getTrainDisplay(trainType),
}));

export function getCatalogEntry(id: string): TrainCatalogEntry | undefined {
    return trainCatalog.find(e => e.id === id);
}

export function getDefaultCatalogEntry(): TrainCatalogEntry {
    return trainCatalog[0];
}

export function getOperators(): TrainOperator[] {
    const seen = new Set<TrainOperator>();
    const out: TrainOperator[] = [];
    for (const e of trainCatalog) {
        if (!seen.has(e.operator)) {
            seen.add(e.operator);
            out.push(e.operator);
        }
    }
    return out;
}
