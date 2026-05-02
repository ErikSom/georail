// Seed rail_point_overrides with per-point WGS84 ellipsoidal heights so that
// the renderer (CoordinateHelpers.applyENUOffset) places rails on the ground
// instead of falling back to the constant 42m default.
//
//   ellipsoidalHeight = egm96ToEllipsoid(lat, lon, ahn_nap)
//
//   ahn_nap          → from PDOK AHN WMS GetFeatureInfo (dtm_05m)
//   egm96ToEllipsoid → from egm96-universal (NAP ≈ EGM96 MSL within <1m in NL)
//
// Modes
//   --route FROM:TRACK:TO:TRACK   (e.g. HRN:2:ASD:4b)   route-only seed
//   --country NL                                         full country seed
//   --dry-run                                            log counts only
//   --limit N                                            cap points sampled
//   --concurrency N                                      AHN parallelism (default 20)
//
// Behaviour: always overwrites existing source='seed' rows; existing
// source='manual' rows are never touched.

import { createClient } from '@supabase/supabase-js';
import * as egm96 from 'egm96-universal';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
dotenv.config({ path: path.resolve(__dirname, '../.env') });

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY;
if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY) {
    console.error('Missing SUPABASE_URL or SUPABASE_SERVICE_KEY in server/.env');
    process.exit(1);
}
const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);

const AHN_WMS = 'https://service.pdok.nl/rws/ahn/wms/v1_0';
const AHN_LAYER = 'dtm_05m';
const UPSERT_CHUNK = 500;
const SELECT_CHUNK = 200;
const COUNTRY_PAGE_SIZE = 200; // rail_lines segments per page

function parseArgs() {
    const args = process.argv.slice(2);
    const out = { mode: null, route: null, country: null, dryRun: false, limit: null, concurrency: 20 };
    for (let i = 0; i < args.length; i++) {
        if (args[i] === '--route' && args[i + 1]) {
            const parts = args[++i].split(':');
            if (parts.length !== 4) {
                console.error('Expected --route FROM_CODE:FROM_TRACK:TO_CODE:TO_TRACK (e.g. HRN:2:ASD:4b)');
                process.exit(1);
            }
            out.mode = 'route';
            out.route = {
                from: { code: parts[0], track: parts[1] },
                to: { code: parts[2], track: parts[3] },
            };
        } else if (args[i] === '--country' && args[i + 1]) {
            out.mode = 'country';
            out.country = args[++i].toUpperCase();
        } else if (args[i] === '--dry-run') {
            out.dryRun = true;
        } else if (args[i] === '--limit' && args[i + 1]) {
            out.limit = parseInt(args[++i], 10);
        } else if (args[i] === '--concurrency' && args[i + 1]) {
            out.concurrency = parseInt(args[++i], 10);
        }
    }
    if (!out.mode) {
        console.error('Usage:');
        console.error('  node script/seed-altitudes.js --route HRN:2:ASD:4b [--dry-run] [--limit N] [--concurrency N]');
        console.error('  node script/seed-altitudes.js --country NL [--dry-run] [--limit N] [--concurrency N]');
        process.exit(1);
    }
    return out;
}

async function parallelPool(items, concurrency, worker) {
    const results = new Array(items.length);
    let nextIndex = 0;
    let completed = 0;
    const onProgress = worker.onProgress;
    const runners = [];
    for (let w = 0; w < concurrency; w++) {
        runners.push((async () => {
            while (true) {
                const i = nextIndex++;
                if (i >= items.length) return;
                results[i] = await worker(items[i], i);
                completed++;
                if (onProgress) onProgress(completed, items.length);
            }
        })());
    }
    await Promise.all(runners);
    return results;
}

function formatDuration(seconds) {
    if (!Number.isFinite(seconds) || seconds < 0) return '–';
    const h = Math.floor(seconds / 3600);
    const m = Math.floor((seconds % 3600) / 60);
    const s = Math.floor(seconds % 60);
    return h > 0 ? `${h}h${String(m).padStart(2, '0')}m` : `${m}m${String(s).padStart(2, '0')}s`;
}

// Returns Array<[lon, lat]> for a rail_lines.geom value as PostgREST returns
// it. Supabase typically returns GeoJSON objects for geometry columns, but
// older configs return EWKB hex strings — handle both.
function parseGeomLineString(geom) {
    // GeoJSON object form: { type: 'LineString', coordinates: [[lon,lat],...] }
    if (geom && typeof geom === 'object' && Array.isArray(geom.coordinates)) {
        if (geom.type !== 'LineString') {
            throw new Error(`Expected LineString geom, got ${geom.type}`);
        }
        return geom.coordinates.map(([x, y]) => [x, y]);
    }
    // GeoJSON as string
    if (typeof geom === 'string' && geom.trim().startsWith('{')) {
        const parsed = JSON.parse(geom);
        if (parsed.type !== 'LineString') {
            throw new Error(`Expected LineString geom, got ${parsed.type}`);
        }
        return parsed.coordinates.map(([x, y]) => [x, y]);
    }
    // EWKB hex form
    if (typeof geom === 'string' && /^[0-9a-fA-F]+$/.test(geom)) {
        return parseEwkbLineString(geom);
    }
    throw new Error(`Unrecognized geom format (type=${typeof geom})`);
}

function parseEwkbLineString(hex) {
    const bytes = new Uint8Array(hex.length / 2);
    for (let i = 0; i < bytes.length; i++) {
        bytes[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
    }
    const view = new DataView(bytes.buffer);
    let offset = 0;
    const littleEndian = view.getUint8(offset) === 1;
    offset += 1;
    const typeWord = view.getUint32(offset, littleEndian);
    offset += 4;
    const HAS_Z = 0x80000000;
    const HAS_M = 0x40000000;
    const HAS_SRID = 0x20000000;
    const baseType = typeWord & 0xff;
    if (baseType !== 2) throw new Error(`Expected LineString (type 2), got type ${baseType}`);
    const hasZ = !!(typeWord & HAS_Z);
    const hasM = !!(typeWord & HAS_M);
    if (typeWord & HAS_SRID) offset += 4;
    const numPoints = view.getUint32(offset, littleEndian);
    offset += 4;
    const coords = new Array(numPoints);
    for (let i = 0; i < numPoints; i++) {
        const x = view.getFloat64(offset, littleEndian); offset += 8;
        const y = view.getFloat64(offset, littleEndian); offset += 8;
        if (hasZ) offset += 8;
        if (hasM) offset += 8;
        coords[i] = [x, y];
    }
    return coords;
}

async function sampleAhn(lon, lat) {
    // WMS 1.3.0 with EPSG:4326 expects (lat, lon) bbox order.
    const eps = 0.00005;
    const params = new URLSearchParams({
        SERVICE: 'WMS',
        VERSION: '1.3.0',
        REQUEST: 'GetFeatureInfo',
        LAYERS: AHN_LAYER,
        QUERY_LAYERS: AHN_LAYER,
        CRS: 'EPSG:4326',
        BBOX: `${lat - eps},${lon - eps},${lat + eps},${lon + eps}`,
        WIDTH: '11',
        HEIGHT: '11',
        I: '5',
        J: '5',
        INFO_FORMAT: 'application/json',
    });
    const res = await fetch(`${AHN_WMS}?${params.toString()}`);
    if (!res.ok) return null;
    const json = await res.json();
    const raw = json?.features?.[0]?.properties?.value_list;
    if (raw == null) return null;
    const v = parseFloat(String(raw).split(/\s+/)[0]);
    return Number.isFinite(v) ? v : null;
}

async function getRoutePoints({ from, to }) {
    const { data: route, error } = await supabase.rpc('find_journey_route', {
        stops: [from, to],
        editor: true,
    });
    if (error) throw new Error(`find_journey_route failed: ${error.message}`);
    if (route?.error) throw new Error(`Route error: ${route.error}`);

    const points = route.route;
    const editor = route.editor;
    if (!Array.isArray(points) || !Array.isArray(editor) || points.length !== editor.length) {
        throw new Error('Unexpected find_journey_route shape');
    }

    const seen = new Set();
    const out = [];
    for (let i = 0; i < editor.length; i++) {
        const e = editor[i];
        const key = `${e.segment_id}:${e.index}`;
        if (seen.has(key)) continue;
        seen.add(key);
        const [lon, lat] = points[i];
        out.push({ segmentId: e.segment_id, pointIndex: e.index, lon, lat });
    }
    return out;
}

async function loadExistingSources(segmentIds) {
    const map = new Map();
    for (let i = 0; i < segmentIds.length; i += SELECT_CHUNK) {
        const chunk = segmentIds.slice(i, i + SELECT_CHUNK);
        const { data, error } = await supabase
            .from('rail_point_overrides')
            .select('segment_id, point_index, source')
            .in('segment_id', chunk);
        if (error) throw new Error(`rail_point_overrides query failed: ${error.message}`);
        for (const r of data ?? []) {
            map.set(`${r.segment_id}:${r.point_index}`, r.source ?? null);
        }
    }
    return map;
}

async function upsertSeed(rows) {
    for (let i = 0; i < rows.length; i += UPSERT_CHUNK) {
        const chunk = rows.slice(i, i + UPSERT_CHUNK);
        const { error } = await supabase
            .from('rail_point_overrides')
            .upsert(chunk, { onConflict: 'segment_id,point_index' });
        if (error) throw new Error(`upsert failed at offset ${i}: ${error.message}`);
    }
}

// Process one batch of candidate points: skip manuals, sample AHN, interpolate
// missed points, upsert. Returns aggregate stats for this batch.
async function processBatch(candidates, args) {
    const stats = {
        candidates: candidates.length,
        manualSkipped: 0,
        directCount: 0,
        interpolatedCount: 0,
        stillMissingCount: 0,
        upserted: 0,
    };

    if (candidates.length === 0) return stats;

    const segmentIds = [...new Set(candidates.map(c => c.segmentId))];
    const existing = await loadExistingSources(segmentIds);

    const toSample = [];
    for (const c of candidates) {
        const src = existing.get(`${c.segmentId}:${c.pointIndex}`);
        if (src === 'manual') { stats.manualSkipped++; continue; }
        toSample.push(c);
    }

    if (toSample.length === 0) return stats;

    const worker = async (c) => {
        const ahnNap = await sampleAhn(c.lon, c.lat);
        if (ahnNap == null) return { outside: true };
        const ellipsoidal = egm96.egm96ToEllipsoid(c.lat, c.lon, ahnNap);
        if (!Number.isFinite(ellipsoidal)) return { outside: true };
        return {
            row: {
                segment_id: c.segmentId,
                point_index: c.pointIndex,
                world_offset: [0, ellipsoidal, 0],
                source: 'seed',
                keynode: false,
            },
        };
    };
    const sampled = await parallelPool(toSample, args.concurrency, worker);

    const seeds = [];
    const directByIndex = new Map();
    const missedIndices = [];
    for (let i = 0; i < sampled.length; i++) {
        const r = sampled[i];
        if (r?.outside) missedIndices.push(i);
        else if (r?.row) {
            seeds.push(r.row);
            directByIndex.set(i, r.row);
        }
    }
    stats.directCount = seeds.length;

    for (const i of missedIndices) {
        let beforeIdx = -1;
        for (let j = i - 1; j >= 0; j--) {
            if (directByIndex.has(j)) { beforeIdx = j; break; }
        }
        let afterIdx = -1;
        for (let j = i + 1; j < sampled.length; j++) {
            if (directByIndex.has(j)) { afterIdx = j; break; }
        }
        let y;
        if (beforeIdx >= 0 && afterIdx >= 0) {
            const yBefore = directByIndex.get(beforeIdx).world_offset[1];
            const yAfter = directByIndex.get(afterIdx).world_offset[1];
            const t = (i - beforeIdx) / (afterIdx - beforeIdx);
            y = yBefore + (yAfter - yBefore) * t;
        } else if (beforeIdx >= 0) {
            y = directByIndex.get(beforeIdx).world_offset[1];
        } else if (afterIdx >= 0) {
            y = directByIndex.get(afterIdx).world_offset[1];
        } else {
            stats.stillMissingCount++;
            continue;
        }
        const c = toSample[i];
        seeds.push({
            segment_id: c.segmentId,
            point_index: c.pointIndex,
            world_offset: [0, y, 0],
            source: 'seed',
            keynode: false,
        });
        stats.interpolatedCount++;
    }

    if (!args.dryRun && seeds.length > 0) {
        await upsertSeed(seeds);
        stats.upserted = seeds.length;
    }
    return stats;
}

async function runRoute(args) {
    console.log(`Route: ${args.route.from.code}/${args.route.from.track} → ${args.route.to.code}/${args.route.to.track}`);
    let candidates = await getRoutePoints(args.route);
    console.log(`Candidate points: ${candidates.length}`);
    if (args.limit) {
        candidates = candidates.slice(0, args.limit);
        console.log(`Capped to first ${candidates.length} for --limit`);
    }
    const stats = await processBatch(candidates, args);
    console.log(`Manual skipped: ${stats.manualSkipped}`);
    console.log(`Direct AHN samples: ${stats.directCount}`);
    console.log(`Interpolated from neighbors: ${stats.interpolatedCount}`);
    console.log(`Still without value: ${stats.stillMissingCount}`);
    console.log(args.dryRun ? '\n[dry-run] No rows written.' : `Upserted: ${stats.upserted}`);
}

async function runCountry(args) {
    const { count: totalSegments, error: countErr } = await supabase
        .from('rail_lines')
        .select('id', { count: 'exact', head: true })
        .eq('country', args.country);
    if (countErr) throw new Error(`count rail_lines failed: ${countErr.message}`);
    console.log(`Country ${args.country}: ${totalSegments} segments to scan, concurrency=${args.concurrency}`);

    const totals = {
        candidates: 0,
        manualSkipped: 0,
        directCount: 0,
        interpolatedCount: 0,
        stillMissingCount: 0,
        upserted: 0,
    };
    const startTime = Date.now();
    let cursor = 0;
    let segmentsProcessed = 0;

    while (true) {
        const { data: segments, error } = await supabase
            .from('rail_lines')
            .select('id, geom')
            .eq('country', args.country)
            .gt('id', cursor)
            .order('id')
            .limit(COUNTRY_PAGE_SIZE);
        if (error) throw new Error(`rail_lines fetch failed: ${error.message}`);
        if (!segments || segments.length === 0) break;

        const candidates = [];
        for (const seg of segments) {
            let coords;
            try {
                coords = parseGeomLineString(seg.geom);
            } catch (e) {
                console.warn(`  skip segment ${seg.id}: ${e.message}`);
                continue;
            }
            for (let i = 0; i < coords.length; i++) {
                const [lon, lat] = coords[i];
                if (Number.isFinite(lon) && Number.isFinite(lat)) {
                    candidates.push({ segmentId: seg.id, pointIndex: i, lon, lat });
                }
            }
            if (args.limit && candidates.length >= args.limit) break;
        }

        const stats = await processBatch(candidates, args);
        for (const k of Object.keys(totals)) totals[k] += stats[k];

        cursor = segments[segments.length - 1].id;
        segmentsProcessed += segments.length;

        const elapsed = (Date.now() - startTime) / 1000;
        const rate = segmentsProcessed / Math.max(elapsed, 0.001);
        const remaining = Math.max(0, totalSegments - segmentsProcessed);
        const eta = rate > 0 ? remaining / rate : 0;

        console.log(
            `[${segmentsProcessed}/${totalSegments} segs · ${formatDuration(elapsed)} elapsed · ETA ${formatDuration(eta)}] ` +
            `direct=${stats.directCount} interp=${stats.interpolatedCount} skipManual=${stats.manualSkipped} upsert=${stats.upserted}`
        );

        if (args.limit && totals.candidates >= args.limit) break;
    }

    console.log('\n=== Country seed complete ===');
    console.log(`Segments scanned:           ${segmentsProcessed}`);
    console.log(`Candidate points:           ${totals.candidates}`);
    console.log(`Manual skipped:             ${totals.manualSkipped}`);
    console.log(`Direct AHN samples:         ${totals.directCount}`);
    console.log(`Interpolated from neighbors:${totals.interpolatedCount}`);
    console.log(`Still without value:        ${totals.stillMissingCount}`);
    console.log(`Total upserted:             ${totals.upserted}`);
    console.log(`Total elapsed:              ${formatDuration((Date.now() - startTime) / 1000)}`);
}

async function main() {
    const args = parseArgs();
    console.log(`Mode: ${args.mode}${args.dryRun ? ' (dry-run)' : ''}`);
    if (args.mode === 'route') await runRoute(args);
    else await runCountry(args);
}

main().catch(err => { console.error(err); process.exit(1); });
