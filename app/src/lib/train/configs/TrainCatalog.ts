import { computed } from '@preact/signals';
import { availableTrainTypes, getTrainConfiguration, getTrainDisplay } from './TrainConfigurations.secure';
import { userTrainRecords } from './UserTrainsCatalog';
import { materializeSavedTrain } from '../saved/SavedTrainResolver';
import type { TrainConfig, TrainDisplayConfig, TrainOperator } from '../TrainConfig';

export type { TrainOperator };

export interface TrainCatalogEntry extends TrainDisplayConfig {
    id: string;
    trainType: string;
    kind: 'builtin' | 'user';
    savedTrainId?: string;
    enabled?: boolean;
}

const builtinEntries: TrainCatalogEntry[] = availableTrainTypes.map(trainType => {
    const display = getTrainDisplay(trainType);
    return {
        ...display,
        id: display.id,
        trainType,
        kind: 'builtin' as const,
    };
});

export const trainCatalog = computed<TrainCatalogEntry[]>(() => {
    const userEnabled: TrainCatalogEntry[] = userTrainRecords.value
        .filter(r => r.enabled)
        .map(r => ({
            ...r.config.display,
            id: r.config.display.id,
            trainType: r.config.display.id,
            kind: 'user' as const,
            savedTrainId: r.id,
            enabled: r.enabled,
            name: r.name || r.config.display?.name || 'Untitled',
        }));
    return [...builtinEntries, ...userEnabled];
});

export function getCatalogEntry(id: string): TrainCatalogEntry | undefined {
    return trainCatalog.value.find(e => e.id === id);
}

export function getDefaultCatalogEntry(): TrainCatalogEntry {
    return trainCatalog.value[0] ?? builtinEntries[0];
}

export function getOperators(): TrainOperator[] {
    const seen = new Set<TrainOperator>();
    const out: TrainOperator[] = [];
    for (const e of trainCatalog.value) {
        if (!seen.has(e.operator)) {
            seen.add(e.operator);
            out.push(e.operator);
        }
    }
    return out;
}

export interface ResolvedTrain {
    config: TrainConfig;
    dispose(): void;
}

export async function resolveTrainEntry(entry: TrainCatalogEntry): Promise<ResolvedTrain> {
    if (entry.kind === 'user' && entry.savedTrainId) {
        const resolved = await materializeSavedTrain(entry.savedTrainId);
        return { config: resolved.config, dispose: resolved.dispose };
    }
    return { config: getTrainConfiguration(entry.trainType), dispose: () => { } };
}
