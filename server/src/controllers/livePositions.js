import { liveTrainStore, quantizeBBoxOutward } from '../lib/liveTrainStore.js';
import { nsConsistStore } from '../lib/nsConsistStore.js';
import { nsPoller } from '../lib/nsPoller.js';

// Number of recent positions to return per train so clients can warm-start
// interpolation without waiting for the next NS poll.
const HISTORY_PER_TRAIN = 5;

function sourceCode(source) {
    return source === 'player' ? 'p' : 'ns';
}

function serializeRecord(record) {
    const recent = record.positions.slice(-HISTORY_PER_TRAIN).map(p => ({
        t: p.ts,
        lon: p.lon,
        lat: p.lat,
        spd: p.speedMs,
        brg: p.bearingDeg,
    }));
    return {
        id: record.id,
        s: sourceCode(record.source),
        meta: record.meta || {},
        seq: record.updatedSeq,
        recent,
    };
}

function parseBBoxParam(value) {
    if (typeof value !== 'string') return null;
    const parts = value.split(',').map(v => Number(v.trim()));
    if (parts.length !== 4 || parts.some(v => !Number.isFinite(v))) return null;
    const [lonMin, latMin, lonMax, latMax] = parts;
    if (lonMin > lonMax || latMin > latMax) return null;
    return { lonMin, latMin, lonMax, latMax };
}

function parseIdsParam(value) {
    if (typeof value !== 'string') return [];
    return value.split(',')
        .map(v => v.trim())
        .filter(Boolean)
        .slice(0, 50);
}

export const listPositions = (req, res) => {
    try {
        let records;
        if (req.query.all === '1') {
            records = liveTrainStore.queryAll();
        } else {
            const bbox = parseBBoxParam(req.query.bbox);
            if (!bbox) {
                return res.status(400).json({
                    error: 'Query must include all=1 or bbox=lonMin,latMin,lonMax,latMax',
                });
            }
            const quantized = quantizeBBoxOutward(bbox.lonMin, bbox.latMin, bbox.lonMax, bbox.latMax);
            records = liveTrainStore.queryBBox(
                quantized.lonMin,
                quantized.latMin,
                quantized.lonMax,
                quantized.latMax
            );
        }

        const status = nsPoller.status();
        res.json({
            fetchedAt: status.lastSuccessfulFetchAt,
            stale: status.stale,
            trains: records.map(serializeRecord),
        });
    } catch (err) {
        res.status(400).json({ error: err.message || 'Invalid live positions query' });
    }
};

export const listConsists = async (req, res) => {
    try {
        const ids = parseIdsParam(req.query.ids);
        if (ids.length === 0) {
            return res.status(400).json({ error: 'Query must include ids=ritnummer[,ritnummer...]' });
        }

        const consists = await nsConsistStore.getMany(ids);
        res.json({
            fetchedAt: Date.now(),
            consists,
        });
    } catch (err) {
        res.status(502).json({ error: err.message || 'Failed to fetch live train consists' });
    }
};

export const __private = { parseBBoxParam, parseIdsParam, serializeRecord };
