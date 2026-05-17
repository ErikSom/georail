import { signal } from '@preact/signals';
import { list, get, put, remove, type SavedTrainRecord } from '../lib/train/saved/TrainStore';
import { captureLiveTrainAssets, materializeSavedTrain } from '../lib/train/saved/SavedTrainResolver';
import { packTrain, unpackTrain } from '../lib/train/saved/TrainPackage';
import { userTrainRecords, hydrateUserTrains } from '../lib/train/configs/UserTrainsCatalog';
import type { TrainConfig } from '../lib/train/TrainConfig';

export const chooserOpen = signal<boolean>(false);
// Identity of the train currently loaded in the editor — assigned on New/Load,
// independent of whether the train has been written to IndexedDB yet.
export const currentSavedTrainId = signal<string | null>(null);
export const currentIsPersisted = signal<boolean>(false);

export async function refresh(): Promise<SavedTrainRecord[]> {
    await hydrateUserTrains();
    const all = await list();
    userTrainRecords.value = all;
    return all;
}

export async function saveCurrent(name: string, liveConfig: TrainConfig): Promise<string> {
    const captured = await captureLiveTrainAssets(liveConfig);
    const id = captured.config.display.id;
    const previous = await get(id);
    const now = Date.now();
    const record: SavedTrainRecord = {
        id,
        name,
        config: captured.config,
        assets: captured.assets,
        enabled: previous?.enabled ?? false,
        createdAt: previous?.createdAt ?? now,
        updatedAt: now,
        schemaVersion: 1,
    };
    await put(record);
    currentSavedTrainId.value = id;
    currentIsPersisted.value = true;
    return id;
}

export async function loadSavedConfig(id: string): Promise<{ config: TrainConfig; dispose(): void; record: SavedTrainRecord }> {
    const record = await get(id);
    if (!record) throw new Error(`Saved train not found: ${id}`);
    const resolved = await materializeSavedTrain(id);
    currentSavedTrainId.value = id;
    currentIsPersisted.value = true;
    return { config: resolved.config, dispose: resolved.dispose, record };
}

export async function deleteSaved(id: string): Promise<void> {
    await remove(id);
    if (currentSavedTrainId.value === id) {
        currentSavedTrainId.value = null;
        currentIsPersisted.value = false;
    }
}

export async function toggleEnabled(id: string): Promise<void> {
    const record = await get(id);
    if (!record) return;
    record.enabled = !record.enabled;
    record.updatedAt = Date.now();
    await put(record);
}

export async function renameSaved(id: string, name: string): Promise<void> {
    const record = await get(id);
    if (!record) return;
    record.name = name;
    record.updatedAt = Date.now();
    await put(record);
}

export async function exportSaved(id: string): Promise<void> {
    const record = await get(id);
    if (!record) throw new Error(`Saved train not found: ${id}`);
    const blob = await packTrain(record);
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    const safeName = record.name.replace(/[^a-z0-9-_]+/gi, '-').toLowerCase() || 'train';
    a.download = `${safeName}.georail-train`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
}

export interface ImportPreview {
    config: SavedTrainRecord['config'];
    assets: SavedTrainRecord['assets'];
    suggestedName: string;
}

export async function previewImport(file: File): Promise<ImportPreview> {
    return unpackTrain(file);
}

export async function commitImport(preview: ImportPreview, name: string): Promise<string> {
    // Mint a fresh id on import so a re-import (or someone else's export of
    // the same train) doesn't overwrite a local saved train under the same id.
    const id = crypto.randomUUID();
    const config = { ...preview.config, display: { ...preview.config.display, id, name } };
    const now = Date.now();
    const record: SavedTrainRecord = {
        id,
        name,
        config,
        assets: preview.assets,
        enabled: false,
        createdAt: now,
        updatedAt: now,
        schemaVersion: 1,
    };
    await put(record);
    return id;
}
