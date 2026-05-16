export const MAGIC = new Uint8Array([0x47, 0x52, 0x54, 0x31]); // "GRT1"
export const OBFUSCATE_WINDOW = 256;
export const HEADER_SIZE = MAGIC.length + 4; // magic + 4-byte lock

export interface ZipEntryMeta {
    uncompressedSize: number;
    crc32: number;
}

export function computeLockBytes(entries: ZipEntryMeta[]): Uint8Array {
    const entryCount = entries.length;
    let totalSize = 0;
    let crcSum = 0;
    for (const e of entries) {
        totalSize = (totalSize + e.uncompressedSize) >>> 0;
        crcSum = (crcSum + (e.crc32 >>> 0)) >>> 0;
    }
    const mixed = (totalSize ^ Math.imul(entryCount, 0x9e3779b1) ^ crcSum) >>> 0;
    const out = new Uint8Array(4);
    out[0] = (mixed >>> 24) & 0xff;
    out[1] = (mixed >>> 16) & 0xff;
    out[2] = (mixed >>> 8) & 0xff;
    out[3] = mixed & 0xff;
    return out;
}

export function applyXor(target: Uint8Array, key: Uint8Array): void {
    if (key.length === 0) return;
    for (let i = 0; i < target.length; i++) {
        target[i] ^= key[i % key.length];
    }
}

export function startsWithMagic(bytes: Uint8Array): boolean {
    if (bytes.length < MAGIC.length) return false;
    for (let i = 0; i < MAGIC.length; i++) {
        if (bytes[i] !== MAGIC[i]) return false;
    }
    return true;
}
