import JSZip from 'jszip';
import type { TrainConfig } from '../TrainConfig';
import type { SavedTrainRecord } from './TrainStore';
import {
    MAGIC,
    HEADER_SIZE,
    OBFUSCATE_WINDOW,
    applyXor,
    computeLockBytes,
    startsWithMagic,
    type ZipEntryMeta,
} from './PackageObfuscation.secure';

const CRC_TABLE = (() => {
    const t = new Uint32Array(256);
    for (let n = 0; n < 256; n++) {
        let c = n;
        for (let k = 0; k < 8; k++) c = (c & 1) ? (0xedb88320 ^ (c >>> 1)) : (c >>> 1);
        t[n] = c >>> 0;
    }
    return t;
})();

function crc32(bytes: Uint8Array): number {
    let c = 0xffffffff;
    for (let i = 0; i < bytes.length; i++) {
        c = CRC_TABLE[(c ^ bytes[i]) & 0xff] ^ (c >>> 8);
    }
    return (c ^ 0xffffffff) >>> 0;
}

function entriesFromRecord(record: SavedTrainRecord): { path: string; bytes: Uint8Array }[] {
    const out: { path: string; bytes: Uint8Array }[] = [];
    out.push({ path: 'train.json', bytes: new TextEncoder().encode(JSON.stringify(record.config, null, 2)) });
    for (const [path, buffer] of Object.entries(record.assets)) {
        out.push({ path, bytes: new Uint8Array(buffer) });
    }
    return out;
}

function lockFromEntries(entries: { bytes: Uint8Array }[]): Uint8Array {
    const metas: ZipEntryMeta[] = entries.map(e => ({
        uncompressedSize: e.bytes.length,
        crc32: crc32(e.bytes),
    }));
    return computeLockBytes(metas);
}

function buildXorKey(lock: Uint8Array, length: number): Uint8Array {
    const key = new Uint8Array(length);
    for (let i = 0; i < length; i++) key[i] = lock[i % lock.length];
    return key;
}

export async function packTrain(record: SavedTrainRecord): Promise<Blob> {
    const entries = entriesFromRecord(record);
    const lock = lockFromEntries(entries);

    const zip = new JSZip();
    for (const e of entries) zip.file(e.path, e.bytes);
    const zipBytes = await zip.generateAsync({ type: 'uint8array' });

    const windowSize = Math.min(OBFUSCATE_WINDOW, zipBytes.length);
    const xorred = zipBytes.slice(0, windowSize);
    applyXor(xorred, buildXorKey(lock, windowSize));

    const out = new Uint8Array(HEADER_SIZE + zipBytes.length);
    out.set(MAGIC, 0);
    out.set(lock, MAGIC.length);
    out.set(xorred, HEADER_SIZE);
    if (zipBytes.length > windowSize) {
        out.set(zipBytes.subarray(windowSize), HEADER_SIZE + windowSize);
    }
    return new Blob([out], { type: 'application/octet-stream' });
}

export interface UnpackedTrain {
    config: TrainConfig;
    assets: Record<string, ArrayBuffer>;
    suggestedName: string;
}

export async function unpackTrain(file: File | Blob): Promise<UnpackedTrain> {
    const buf = new Uint8Array(await file.arrayBuffer());
    if (!startsWithMagic(buf)) {
        throw new Error('Not a GeoRail train file (magic mismatch).');
    }
    if (buf.length < HEADER_SIZE) {
        throw new Error('Truncated GeoRail train file.');
    }

    const lock = buf.slice(MAGIC.length, MAGIC.length + 4);
    const zipBytes = buf.slice(HEADER_SIZE);
    const windowSize = Math.min(OBFUSCATE_WINDOW, zipBytes.length);
    applyXor(zipBytes.subarray(0, windowSize), buildXorKey(lock, windowSize));

    const zip = await JSZip.loadAsync(zipBytes);

    const filenames = Object.keys(zip.files).filter(n => !zip.files[n].dir);
    const loaded: { path: string; bytes: Uint8Array }[] = [];
    for (const name of filenames) {
        const bytes = await zip.files[name].async('uint8array');
        loaded.push({ path: name, bytes });
    }

    const recomputed = lockFromEntries(loaded);
    for (let i = 0; i < 4; i++) {
        if (recomputed[i] !== lock[i]) {
            throw new Error('Train file lock mismatch — file may be corrupted or tampered with.');
        }
    }

    const trainJson = loaded.find(l => l.path === 'train.json');
    if (!trainJson) throw new Error('Train file is missing train.json.');
    let config: TrainConfig;
    try {
        config = JSON.parse(new TextDecoder().decode(trainJson.bytes));
    } catch (err) {
        throw new Error(`train.json is not valid JSON: ${(err as Error).message}`);
    }

    const assets: Record<string, ArrayBuffer> = {};
    for (const entry of loaded) {
        if (entry.path === 'train.json') continue;
        const ab = new ArrayBuffer(entry.bytes.length);
        new Uint8Array(ab).set(entry.bytes);
        assets[entry.path] = ab;
    }

    const suggestedName = config.display?.name?.trim() || 'Imported Train';
    return { config, assets, suggestedName };
}
