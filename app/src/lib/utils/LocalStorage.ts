const STORAGE_KEY = 'georail_local';

type StorageData = Record<string, unknown>;

let cache: StorageData | null = null;

function readAll(): StorageData {
    if (cache) return cache;
    if (typeof window === 'undefined') return {};
    try {
        const raw = localStorage.getItem(STORAGE_KEY);
        cache = raw ? JSON.parse(raw) : {};
    } catch {
        cache = {};
    }
    return cache!;
}

function writeAll(data: StorageData): void {
    cache = data;
    if (typeof window === 'undefined') return;
    try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
    } catch {
        // Storage full or unavailable
    }
}

export function loadData<T>(key: string, defaultValue: T): T {
    const all = readAll();
    if (key in all) return all[key] as T;
    return defaultValue;
}

export function saveData<T>(key: string, value: T): void {
    const all = { ...readAll(), [key]: value };
    writeAll(all);
}
