import axios from 'axios';

const NS_CONSIST_URL = 'https://gateway.apiportal.ns.nl/virtual-train-api/v1/trein';
const DEFAULT_TTL_MS = 10 * 60 * 1000;
const DEFAULT_MAX_IDS_PER_REQUEST = 50;
const DEFAULT_MAX_CACHE_ENTRIES = 2000;

function normalizeRitNumber(id) {
    const value = String(id ?? '').trim().replace(/^ns:/i, '');
    return /^\d+$/.test(value) ? value : null;
}

function partCarCount(part) {
    if (Array.isArray(part?.bakken)) return part.bakken.length;
    const match = String(part?.type ?? '').match(/\b(\d+)\b/);
    return match ? Number(match[1]) : 0;
}

function normalizePart(part) {
    return {
        materialNumber: Number.isFinite(Number(part?.materieelnummer)) ? Number(part.materieelnummer) : null,
        type: typeof part?.type === 'string' ? part.type : null,
        carCount: partCarCount(part),
        facilities: Array.isArray(part?.faciliteiten) ? part.faciliteiten.filter(Boolean) : [],
        image: typeof part?.afbeelding === 'string' ? part.afbeelding : null,
        imageWidth: Number.isFinite(Number(part?.breedte)) ? Number(part.breedte) : null,
        imageHeight: Number.isFinite(Number(part?.hoogte)) ? Number(part.hoogte) : null,
    };
}

function recordScore(record) {
    let score = 0;
    if (record?.bron === 'DVS') score += 100;
    if (Number(record?.lengteInMeters) > 0) score += 20;
    if ((record?.materieeldelen || []).some(part => Number(part?.materieelnummer) > 0)) score += 10;
    score += (record?.materieeldelen || []).length;
    return score;
}

function normalizeConsist(record) {
    const ritnummer = normalizeRitNumber(record?.ritnummer);
    if (!ritnummer) return null;

    const parts = (record.materieeldelen || []).map(normalizePart).filter(part => part.carCount > 0);
    const partsCarCount = parts.reduce((sum, part) => sum + part.carCount, 0);
    const carCount = Number(record.lengte) > 0 ? Number(record.lengte) : partsCarCount;
    const lengthM = Number(record.lengteInMeters) > 0 ? Number(record.lengteInMeters) : null;

    return {
        ritnummer,
        type: typeof record.type === 'string' ? record.type : null,
        source: typeof record.bron === 'string' ? record.bron : null,
        carrier: typeof record.vervoerder === 'string' ? record.vervoerder : null,
        station: typeof record.station === 'string' ? record.station : null,
        track: record.spoor != null ? String(record.spoor) : null,
        shortened: Boolean(record.ingekort),
        carCount,
        lengthM,
        parts,
    };
}

export function createNsConsistStore(options = {}) {
    const now = options.now || (() => Date.now());
    const ttlMs = options.ttlMs ?? DEFAULT_TTL_MS;
    const maxIdsPerRequest = options.maxIdsPerRequest ?? DEFAULT_MAX_IDS_PER_REQUEST;
    const maxCacheEntries = options.maxCacheEntries ?? DEFAULT_MAX_CACHE_ENTRIES;
    const cache = new Map();
    const inflight = new Map();
    const fetchRaw = options.fetchRaw || (async (ids) => {
        const response = await axios.get(NS_CONSIST_URL, {
            headers: {
                'Ocp-Apim-Subscription-Key': process.env.NS_API_KEY,
            },
            params: { ids: ids.join(',') },
            timeout: 12_000,
        });
        return Array.isArray(response.data) ? response.data : [];
    });

    function pruneCache(time) {
        for (const [id, entry] of cache) {
            if (entry.expiresAt <= time) cache.delete(id);
        }
        while (cache.size > maxCacheEntries) {
            const oldestId = cache.keys().next().value;
            if (!oldestId) break;
            cache.delete(oldestId);
        }
    }

    async function fetchAndCache(ids, time) {
        const rawRecords = await fetchRaw(ids);
        const bestById = new Map();
        for (const record of rawRecords) {
            const id = normalizeRitNumber(record?.ritnummer);
            if (!id || !ids.includes(id)) continue;
            const existing = bestById.get(id);
            if (!existing || recordScore(record) > recordScore(existing)) {
                bestById.set(id, record);
            }
        }

        const values = {};
        for (const id of ids) {
            const value = bestById.has(id) ? normalizeConsist(bestById.get(id)) : null;
            cache.set(id, { value, expiresAt: time + ttlMs });
            values[id] = value;
        }
        pruneCache(time);
        return values;
    }

    async function getMany(inputIds) {
        const ids = [...new Set((inputIds || []).map(normalizeRitNumber).filter(Boolean))].slice(0, maxIdsPerRequest);
        const out = {};
        const missing = [];
        const time = now();
        pruneCache(time);

        for (const id of ids) {
            const cached = cache.get(id);
            if (cached && cached.expiresAt > time) {
                out[id] = cached.value;
            } else {
                missing.push(id);
            }
        }

        if (missing.length > 0) {
            const waiters = [];
            const fetchIds = [];

            for (const id of missing) {
                const pending = inflight.get(id);
                if (pending) {
                    waiters.push(pending.then(value => {
                        out[id] = value;
                    }));
                } else {
                    fetchIds.push(id);
                }
            }

            if (fetchIds.length > 0) {
                const batch = fetchAndCache(fetchIds, time);
                for (const id of fetchIds) {
                    const pending = batch
                        .then(values => values[id] ?? null)
                        .finally(() => inflight.delete(id));
                    inflight.set(id, pending);
                    waiters.push(pending.then(value => {
                        out[id] = value;
                    }));
                }
            }

            await Promise.all(waiters);
        }

        return out;
    }

    function clear() {
        cache.clear();
        inflight.clear();
    }

    return { getMany, clear, cache, inflight };
}

export const nsConsistStore = createNsConsistStore();

export const __private = {
    normalizeRitNumber,
    normalizeConsist,
};
