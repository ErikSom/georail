/**
 * Obfuscation layer - XOR transform + interleave
 * Makes the hash input harder to reverse engineer
 * @param {string} str - String to transform
 * @returns {string} Transformed string
 */
function obfuscate(str) {
    // XOR each char with position-derived value
    const xorKey = 0x5A; // Arbitrary constant
    let transformed = '';
    for (let i = 0; i < str.length; i++) {
        const code = str.charCodeAt(i);
        // XOR with rotating pattern based on position
        const xorValue = (i * 7 + xorKey) & 0x7F;
        transformed += String.fromCharCode(code ^ xorValue);
    }

    // Interleave: split in half, weave together
    const mid = Math.floor(transformed.length / 2);
    const left = transformed.slice(0, mid);
    const right = transformed.slice(mid);
    let interleaved = '';
    const maxLen = Math.max(left.length, right.length);
    for (let i = 0; i < maxLen; i++) {
        if (i < left.length) interleaved += left[i];
        if (i < right.length) interleaved += right[i];
    }

    return interleaved;
}

/**
 * FNV-1a hash with obfuscation layer
 * Must be identical in server and client!
 * @param {string} str - String to hash
 * @returns {string} 8-character hex hash
 */
export function fnvHash(str) {
    const prepared = obfuscate(str);
    let hash = 2166136261; // FNV offset basis
    for (let i = 0; i < prepared.length; i++) {
        hash ^= prepared.charCodeAt(i);
        hash = Math.imul(hash, 16777619); // FNV prime
    }
    return (hash >>> 0).toString(16).padStart(8, '0');
}
