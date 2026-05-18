import { normalizeTrainConfig, type TrainConfig, type CabConfig, type WagonConfig, type AudioFile } from '../TrainConfig';
import { loadEncryptedAsset, getProtectedAssetPath, blobString } from '../../utils/Security.secure';
import { trainAssetsPath } from '../configs/TrainConfigurations.secure';
import { get as getRecord, type SavedTrainRecord } from './TrainStore';

export interface ResolvedSavedTrain {
    config: TrainConfig;
    savedTrainId: string;
    dispose(): void;
}

export interface CapturedTrain {
    config: TrainConfig;
    assets: Record<string, ArrayBuffer>;
}

function mimeForExt(ext: string): string {
    switch (ext.toLowerCase()) {
        case 'glb': return 'model/gltf-binary';
        case 'wav': return 'audio/wav';
        case 'mp3': return 'audio/mpeg';
        case 'ogg': return 'audio/ogg';
        default: return 'application/octet-stream';
    }
}

function extOf(path: string): string {
    const lastDot = path.lastIndexOf('.');
    if (lastDot === -1) return '';
    return path.slice(lastDot + 1);
}

// --- Materialize --------------------------------------------------------

export async function materializeSavedTrain(id: string): Promise<ResolvedSavedTrain> {
    const record = await getRecord(id);
    if (!record) throw new Error(`Saved train not found: ${id}`);

    const blobUrls: string[] = [];
    const pathToBlobUrl: Record<string, string> = {};

    for (const [innerPath, buffer] of Object.entries(record.assets)) {
        const mime = mimeForExt(extOf(innerPath));
        const url = URL.createObjectURL(new Blob([buffer], { type: mime }));
        blobUrls.push(url);
        pathToBlobUrl[innerPath] = url;
    }

    const config = normalizeTrainConfig(structuredClone(record.config) as TrainConfig);

    const rewriteRollingStock = (rs: CabConfig | WagonConfig | undefined) => {
        if (!rs) return;
        const mapped = pathToBlobUrl[rs.modelPath];
        if (mapped) {
            rs.modelPath = mapped;
            rs.internal = false;
        }
    };

    rewriteRollingStock(config.cab);
    config.wagons.forEach(rewriteRollingStock);
    rewriteRollingStock(config.rearCab);

    if (config.audio?.files) {
        config.audio.files = config.audio.files.map(f => {
            const mapped = pathToBlobUrl[f.url];
            return mapped ? { ...f, url: mapped } : f;
        });
    }

    return {
        config,
        savedTrainId: id,
        dispose() {
            for (const url of blobUrls) URL.revokeObjectURL(url);
            blobUrls.length = 0;
        },
    };
}

// --- Capture ------------------------------------------------------------

async function fetchBytes(path: string): Promise<ArrayBuffer> {
    if (path.startsWith(blobString)) {
        const resp = await fetch(path);
        if (!resp.ok) throw new Error(`Blob fetch failed: ${path} (${resp.status})`);
        return resp.arrayBuffer();
    }
    const mangled = getProtectedAssetPath(path);
    if (mangled !== path) {
        return loadEncryptedAsset(`${trainAssetsPath}/${mangled}`, path);
    }
    const resp = await fetch(path);
    if (!resp.ok) throw new Error(`Asset fetch failed: ${path} (${resp.status})`);
    return resp.arrayBuffer();
}

async function hashShort(bytes: ArrayBuffer): Promise<string> {
    const digest = await crypto.subtle.digest('SHA-256', bytes);
    const view = new Uint8Array(digest);
    let hex = '';
    for (let i = 0; i < 6; i++) hex += view[i].toString(16).padStart(2, '0');
    return hex;
}

export async function captureLiveTrainAssets(config: TrainConfig): Promise<CapturedTrain> {
    const assets: Record<string, ArrayBuffer> = {};
    const hashToInnerPath = new Map<string, string>();
    const pathToInnerPath = new Map<string, string>();

    async function intern(sourcePath: string, hint: 'model' | 'audio'): Promise<string> {
        if (!sourcePath) return sourcePath;
        const cached = pathToInnerPath.get(sourcePath);
        if (cached) return cached;

        const bytes = await fetchBytes(sourcePath);
        const ext = extOf(sourcePath) || (hint === 'model' ? 'glb' : 'wav');
        const hash = await hashShort(bytes);
        const existingByHash = hashToInnerPath.get(hash);
        if (existingByHash) {
            pathToInnerPath.set(sourcePath, existingByHash);
            return existingByHash;
        }

        const dir = hint === 'model' ? 'assets/models' : 'assets/sounds';
        const innerPath = `${dir}/${hash}.${ext}`;
        assets[innerPath] = bytes;
        hashToInnerPath.set(hash, innerPath);
        pathToInnerPath.set(sourcePath, innerPath);
        return innerPath;
    }

    const out = structuredClone(config) as TrainConfig;

    const internModel = async (rs: CabConfig | WagonConfig | undefined) => {
        if (!rs?.modelPath) return;
        rs.modelPath = await intern(rs.modelPath, 'model');
        rs.internal = false;
    };

    await internModel(out.cab);
    for (const w of out.wagons) await internModel(w);
    await internModel(out.rearCab);

    if (out.audio?.files) {
        const remapped: AudioFile[] = [];
        for (const f of out.audio.files) {
            const innerPath = await intern(f.url, 'audio');
            remapped.push({ ...f, url: innerPath });
        }
        out.audio.files = remapped;
    }

    return { config: out, assets };
}
