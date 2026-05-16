import { signal } from '@preact/signals';
import { subscribe, type SavedTrainRecord } from '../saved/TrainStore';

export const userTrainRecords = signal<SavedTrainRecord[]>([]);

let firstHydrate: Promise<void> | null = null;
let hydrated = false;

export function hydrateUserTrains(): Promise<void> {
    if (firstHydrate) return firstHydrate;
    if (typeof indexedDB === 'undefined') {
        firstHydrate = Promise.resolve();
        return firstHydrate;
    }
    firstHydrate = new Promise<void>(resolve => {
        subscribe(records => {
            userTrainRecords.value = records;
            if (!hydrated) {
                hydrated = true;
                resolve();
            }
        });
    });
    return firstHydrate;
}
