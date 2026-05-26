const DEFAULT_MAX_TRAIL_POINTS = 20;
const DEFAULT_EDGE_PAD_DEG = 0.02;
const DEFAULT_PRUNE_AFTER_MS = 5 * 60 * 1000;
const DEFAULT_CELL_SCALE = 10;

function assertFiniteNumber(value, name) {
    if (!Number.isFinite(value)) {
        throw new TypeError(`${name} must be a finite number`);
    }
}

function canonicalSource(source) {
    if (source === 'p') return 'player';
    if (source === 'player' || source === 'ns') return source;
    throw new TypeError('source must be "ns" or "player"');
}

export function getCellKey(lat, lon, cellScale = DEFAULT_CELL_SCALE) {
    assertFiniteNumber(lat, 'lat');
    assertFiniteNumber(lon, 'lon');
    return `${Math.floor(lat * cellScale)}_${Math.floor(lon * cellScale)}`;
}

export function cellRangeFor(lonMin, latMin, lonMax, latMax, cellScale = DEFAULT_CELL_SCALE) {
    assertFiniteNumber(lonMin, 'lonMin');
    assertFiniteNumber(latMin, 'latMin');
    assertFiniteNumber(lonMax, 'lonMax');
    assertFiniteNumber(latMax, 'latMax');

    if (lonMin > lonMax || latMin > latMax) {
        throw new RangeError('bbox min values must be <= max values');
    }

    const lonStart = Math.floor(lonMin * cellScale);
    const lonEnd = Math.floor(lonMax * cellScale);
    const latStart = Math.floor(latMin * cellScale);
    const latEnd = Math.floor(latMax * cellScale);
    const keys = [];

    for (let lat = latStart; lat <= latEnd; lat++) {
        for (let lon = lonStart; lon <= lonEnd; lon++) {
            keys.push(`${lat}_${lon}`);
        }
    }

    return keys;
}

export function quantizeBBoxOutward(lonMin, latMin, lonMax, latMax, precision = 1000) {
    assertFiniteNumber(lonMin, 'lonMin');
    assertFiniteNumber(latMin, 'latMin');
    assertFiniteNumber(lonMax, 'lonMax');
    assertFiniteNumber(latMax, 'latMax');

    if (lonMin > lonMax || latMin > latMax) {
        throw new RangeError('bbox min values must be <= max values');
    }

    return {
        lonMin: Math.floor(lonMin * precision) / precision,
        latMin: Math.floor(latMin * precision) / precision,
        lonMax: Math.ceil(lonMax * precision) / precision,
        latMax: Math.ceil(latMax * precision) / precision,
    };
}

function normalizePoint(input, now) {
    const lon = Number(input.lon);
    const lat = Number(input.lat);
    assertFiniteNumber(lon, 'lon');
    assertFiniteNumber(lat, 'lat');

    const ts = Number.isFinite(input.ts) ? Number(input.ts) : now;
    const speedMs = Number.isFinite(input.speedMs) ? Number(input.speedMs) : undefined;
    const bearingDeg = Number.isFinite(input.bearingDeg) ? Number(input.bearingDeg) : undefined;

    return { ts, lon, lat, speedMs, bearingDeg };
}

function roughlySamePoint(a, b) {
    if (!a || !b) return false;
    return a.lon === b.lon &&
        a.lat === b.lat &&
        a.speedMs === b.speedMs &&
        a.bearingDeg === b.bearingDeg;
}

export function createLiveTrainStore(options = {}) {
    const now = options.now || (() => Date.now());
    const maxTrailPoints = options.maxTrailPoints || DEFAULT_MAX_TRAIL_POINTS;
    const edgePadDeg = options.edgePadDeg ?? DEFAULT_EDGE_PAD_DEG;
    const pruneAfterMs = options.pruneAfterMs || DEFAULT_PRUNE_AFTER_MS;
    const cellScale = options.cellScale || DEFAULT_CELL_SCALE;
    const trains = new Map();
    const bucketIndex = new Map();
    let nextUpdatedSeq = 1;

    function addToBucket(cellKey, id) {
        let bucket = bucketIndex.get(cellKey);
        if (!bucket) {
            bucket = new Set();
            bucketIndex.set(cellKey, bucket);
        }
        bucket.add(id);
    }

    function removeFromBucket(cellKey, id) {
        if (!cellKey) return;
        const bucket = bucketIndex.get(cellKey);
        if (!bucket) return;
        bucket.delete(id);
        if (bucket.size === 0) bucketIndex.delete(cellKey);
    }

    function upsert(input) {
        if (!input || typeof input !== 'object') {
            throw new TypeError('upsert input must be an object');
        }
        if (!input.id || typeof input.id !== 'string') {
            throw new TypeError('id is required');
        }

        const source = canonicalSource(input.source);
        const existing = trains.get(input.id);
        const hasExplicitTs = Number.isFinite(input.ts);
        let inputTs = hasExplicitTs ? Number(input.ts) : now();
        if (existing?.latest && hasExplicitTs && inputTs <= existing.latest.ts) {
            existing.source = source;
            existing.meta = { ...(existing.meta || {}), ...(input.meta || {}) };
            existing.lastSeenAt = now();
            return { record: existing, changed: false, stale: true };
        }
        if (existing?.latest && !hasExplicitTs && inputTs <= existing.latest.ts) {
            inputTs = existing.latest.ts + 1;
        }

        const point = normalizePoint(input, inputTs);
        const cellKey = getCellKey(point.lat, point.lon, cellScale);
        const changed = !roughlySamePoint(existing?.latest, point);

        let record = existing;
        if (!record) {
            record = {
                id: input.id,
                source,
                positions: [],
                latest: null,
                trailNewestTs: point.ts,
                updatedSeq: 0,
                meta: {},
                lastSeenAt: now(),
                cellKey,
            };
            trains.set(input.id, record);
            addToBucket(cellKey, input.id);
        } else if (record.cellKey !== cellKey) {
            removeFromBucket(record.cellKey, input.id);
            addToBucket(cellKey, input.id);
            record.cellKey = cellKey;
        }

        record.source = source;
        record.positions.push(point);
        if (record.positions.length > maxTrailPoints) {
            record.positions.splice(0, record.positions.length - maxTrailPoints);
        }
        record.latest = record.positions[record.positions.length - 1];
        record.trailNewestTs = record.latest.ts;
        record.updatedSeq = nextUpdatedSeq++;
        record.meta = { ...(record.meta || {}), ...(input.meta || {}) };
        record.lastSeenAt = now();

        return { record, changed };
    }

    function queryBBox(lonMin, latMin, lonMax, latMax) {
        assertFiniteNumber(lonMin, 'lonMin');
        assertFiniteNumber(latMin, 'latMin');
        assertFiniteNumber(lonMax, 'lonMax');
        assertFiniteNumber(latMax, 'latMax');
        if (lonMin > lonMax || latMin > latMax) {
            throw new RangeError('bbox min values must be <= max values');
        }

        const padded = {
            lonMin: lonMin - edgePadDeg,
            latMin: latMin - edgePadDeg,
            lonMax: lonMax + edgePadDeg,
            latMax: latMax + edgePadDeg,
        };
        const ids = new Set();
        for (const key of cellRangeFor(padded.lonMin, padded.latMin, padded.lonMax, padded.latMax, cellScale)) {
            const bucket = bucketIndex.get(key);
            if (!bucket) continue;
            for (const id of bucket) ids.add(id);
        }

        const out = [];
        for (const id of ids) {
            const record = trains.get(id);
            const p = record?.latest;
            if (!record || !p) continue;
            if (p.lon < padded.lonMin || p.lon > padded.lonMax || p.lat < padded.latMin || p.lat > padded.latMax) {
                continue;
            }
            out.push(record);
        }
        return out;
    }

    function queryAll() {
        return Array.from(trains.values());
    }

    function getById(id) {
        return trains.get(id) || null;
    }

    function prune() {
        const cutoff = now() - pruneAfterMs;
        let pruned = 0;
        for (const [id, record] of trains) {
            if (record.lastSeenAt > cutoff) continue;
            removeFromBucket(record.cellKey, id);
            trains.delete(id);
            pruned++;
        }
        return pruned;
    }

    function clear() {
        trains.clear();
        bucketIndex.clear();
        nextUpdatedSeq = 1;
    }

    return {
        upsert,
        queryBBox,
        queryAll,
        getById,
        prune,
        clear,
        trains,
        bucketIndex,
        getCellKey: (lat, lon) => getCellKey(lat, lon, cellScale),
        cellRangeFor: (lonMin, latMin, lonMax, latMax) => cellRangeFor(lonMin, latMin, lonMax, latMax, cellScale),
        edgePadDeg,
    };
}

export const liveTrainStore = createLiveTrainStore();
