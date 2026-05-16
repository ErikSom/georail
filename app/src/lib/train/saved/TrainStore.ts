import type { TrainConfig } from '../TrainConfig';

export interface SavedTrainRecord {
    id: string;
    name: string;
    config: TrainConfig;
    assets: Record<string, ArrayBuffer>;
    enabled: boolean;
    createdAt: number;
    updatedAt: number;
    schemaVersion: 1;
}

const DB_NAME = 'georail';
const DB_VERSION = 1;
const STORE_NAME = 'trains';

type Listener = (records: SavedTrainRecord[]) => void;

let dbPromise: Promise<IDBDatabase> | null = null;
const listeners = new Set<Listener>();

function openDb(): Promise<IDBDatabase> {
    if (dbPromise) return dbPromise;
    dbPromise = new Promise<IDBDatabase>((resolve, reject) => {
        const req = indexedDB.open(DB_NAME, DB_VERSION);
        req.onupgradeneeded = () => {
            const db = req.result;
            if (!db.objectStoreNames.contains(STORE_NAME)) {
                db.createObjectStore(STORE_NAME, { keyPath: 'id' });
            }
        };
        req.onerror = () => reject(req.error);
        req.onsuccess = () => resolve(req.result);
    });
    return dbPromise;
}

async function withStore<T>(mode: IDBTransactionMode, fn: (store: IDBObjectStore) => IDBRequest<T>): Promise<T> {
    const db = await openDb();
    return new Promise<T>((resolve, reject) => {
        const tx = db.transaction(STORE_NAME, mode);
        const store = tx.objectStore(STORE_NAME);
        const req = fn(store);
        let result: T;
        req.onsuccess = () => { result = req.result; };
        req.onerror = () => reject(req.error);
        tx.oncomplete = () => resolve(result);
        tx.onerror = () => reject(tx.error);
        tx.onabort = () => reject(tx.error);
    });
}

async function notify(): Promise<void> {
    if (listeners.size === 0) return;
    const all = await list();
    listeners.forEach(l => l(all));
}

export async function list(): Promise<SavedTrainRecord[]> {
    return withStore('readonly', store => store.getAll() as IDBRequest<SavedTrainRecord[]>);
}

export async function get(id: string): Promise<SavedTrainRecord | null> {
    const value = await withStore('readonly', store => store.get(id) as IDBRequest<SavedTrainRecord | undefined>);
    return value ?? null;
}

export async function put(record: SavedTrainRecord): Promise<void> {
    await withStore('readwrite', store => store.put(record));
    void notify();
}

export async function remove(id: string): Promise<void> {
    await withStore('readwrite', store => store.delete(id));
    void notify();
}

export function subscribe(listener: Listener): () => void {
    listeners.add(listener);
    void list().then(all => listener(all)).catch(() => { });
    return () => { listeners.delete(listener); };
}
