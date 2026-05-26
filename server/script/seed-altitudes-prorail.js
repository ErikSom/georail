// Seed rail_point_overrides from ProRail PVS_Verticale_Elementen (HOOGTE in NAP).
//
// Per rail vertex: find nearest ProRail vertical element line within 10m, project,
// linear-interpolate HOOGTE_BEGIN→HOOGTE_EIND, convert NAP→ellipsoidal via EGM96,
// upsert. Vertices without match: linear-interpolate from seeded neighbors in same
// rail_lines segment. Segments with zero ProRail matches: fall back to AHN.
//
// Modes (same shape as seed-altitudes.js):
//   --route FROM:TRACK:TO:TRACK
//   --country NL
//   --dry-run
//   --limit N
//   --concurrency N        (only used for AHN fallback)
//   --refresh-cache        force re-download of ProRail data
//
// Cache: server/.cache/prorail-vertical.json  (~50 MB, all 133k features)

import { createClient } from '@supabase/supabase-js';
import * as egm96 from 'egm96-universal';
import dotenv from 'dotenv';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
dotenv.config({ path: path.resolve(__dirname, '../.env') });

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);

const PRORAIL_URL = 'https://mapservices.prorail.nl/arcgis/rest/services/Spoorgeometrie_006/FeatureServer/12/query';
const CACHE_DIR = path.resolve(__dirname, '../.cache');
const CACHE_FILE = path.join(CACHE_DIR, 'prorail-vertical.json');

const AHN_WMS = 'https://service.pdok.nl/rws/ahn/wms/v1_0';
const AHN_LAYER = 'dtm_05m';

const MATCH_RADIUS_M = 10;
const GRID_DEG = 0.005; // ~555 m cells
const UPSERT_CHUNK = 500;
const SELECT_CHUNK = 200;
const COUNTRY_PAGE_SIZE = 200;
const PRORAIL_PAGE_SIZE = 2000;

function parseArgs() {
    const args = process.argv.slice(2);
    const out = { mode: null, route: null, country: null, dryRun: false, limit: null, concurrency: 20, refreshCache: false };
    for (let i = 0; i < args.length; i++) {
        if (args[i] === '--route' && args[i + 1]) {
            const parts = args[++i].split(':');
            if (parts.length !== 4) { console.error('Expected --route FROM:TRACK:TO:TRACK'); process.exit(1); }
            out.mode = 'route';
            out.route = { from: { code: parts[0], track: parts[1] }, to: { code: parts[2], track: parts[3] } };
        } else if (args[i] === '--country' && args[i + 1]) { out.mode = 'country'; out.country = args[++i].toUpperCase(); }
        else if (args[i] === '--dry-run') { out.dryRun = true; }
        else if (args[i] === '--limit' && args[i + 1]) { out.limit = parseInt(args[++i], 10); }
        else if (args[i] === '--concurrency' && args[i + 1]) { out.concurrency = parseInt(args[++i], 10); }
        else if (args[i] === '--refresh-cache') { out.refreshCache = true; }
    }
    if (!out.mode) {
        console.error('Usage: node script/seed-altitudes-prorail.js --route FROM:TRACK:TO:TRACK | --country NL [--dry-run] [--limit N] [--refresh-cache]');
        process.exit(1);
    }
    return out;
}

function formatDuration(seconds) {
    if (!Number.isFinite(seconds) || seconds < 0) return '–';
    const h = Math.floor(seconds / 3600);
    const m = Math.floor((seconds % 3600) / 60);
    const s = Math.floor(seconds % 60);
    return h > 0 ? `${h}h${String(m).padStart(2, '0')}m` : `${m}m${String(s).padStart(2, '0')}s`;
}

// ---------- ProRail bulk download ----------

async function downloadProRailVertical() {
    fs.mkdirSync(CACHE_DIR, { recursive: true });
    const all = [];
    let offset = 0;
    const t0 = Date.now();
    while (true) {
        const params = new URLSearchParams({
            where: '1=1',
            outFields: 'OBJECTID,ELEMENT_TYPE,HOOGTE_BEGIN,HOOGTE_EIND',
            outSR: '4326',
            returnGeometry: 'true',
            f: 'geojson',
            resultOffset: String(offset),
            resultRecordCount: String(PRORAIL_PAGE_SIZE),
            orderByFields: 'OBJECTID',
        });
        const res = await fetch(`${PRORAIL_URL}?${params}`);
        if (!res.ok) throw new Error(`ProRail HTTP ${res.status}`);
        const json = await res.json();
        const feats = json.features ?? [];
        for (const f of feats) {
            const props = f.properties;
            if (!Number.isFinite(props.HOOGTE_BEGIN) || !Number.isFinite(props.HOOGTE_EIND)) continue;
            // Flatten geometry to one or more lines (each is array of [lon, lat])
            const lines = f.geometry.type === 'MultiLineString' ? f.geometry.coordinates : [f.geometry.coordinates];
            all.push({
                hb: props.HOOGTE_BEGIN,
                he: props.HOOGTE_EIND,
                t: props.ELEMENT_TYPE,
                lines, // [[lon,lat],...] each
            });
        }
        process.stdout.write(`\r  ProRail page offset=${offset}, total=${all.length} (${formatDuration((Date.now() - t0) / 1000)})`);
        if (feats.length < PRORAIL_PAGE_SIZE) break;
        offset += PRORAIL_PAGE_SIZE;
    }
    process.stdout.write('\n');
    fs.writeFileSync(CACHE_FILE, JSON.stringify(all));
    console.log(`  Cached ${all.length} features → ${CACHE_FILE}`);
    return all;
}

async function loadProRail(refresh) {
    if (!refresh && fs.existsSync(CACHE_FILE)) {
        console.log(`Loading ProRail cache from ${CACHE_FILE}`);
        const raw = JSON.parse(fs.readFileSync(CACHE_FILE, 'utf8'));
        console.log(`  Loaded ${raw.length} features`);
        return raw;
    }
    console.log('Downloading ProRail PVS_Verticale_Elementen...');
    return await downloadProRailVertical();
}

// ---------- Spatial grid index ----------

function buildGridIndex(features) {
    const cells = new Map();
    const addFeatureToCell = (key, idx) => {
        let arr = cells.get(key);
        if (!arr) { arr = []; cells.set(key, arr); }
        arr.push(idx);
    };
    for (let i = 0; i < features.length; i++) {
        const seen = new Set();
        for (const line of features[i].lines) {
            for (const [lon, lat] of line) {
                const cx = Math.floor(lon / GRID_DEG);
                const cy = Math.floor(lat / GRID_DEG);
                const key = `${cx}:${cy}`;
                if (!seen.has(key)) { seen.add(key); addFeatureToCell(key, i); }
            }
        }
    }
    return cells;
}

// ---------- Geometry helpers ----------

const M_PER_DEG_LAT = 111320;
function mPerDegLon(lat) { return Math.cos(lat * Math.PI / 180) * 111320; }

// Project p onto segment a→b using local equirectangular (meters at p's lat).
// Returns {t in [0,1], distM, projLat, projLon}.
function projectPointOntoSegment(pLat, pLon, aLat, aLon, bLat, bLon) {
    const mLon = mPerDegLon(pLat);
    const ax = (aLon - pLon) * mLon, ay = (aLat - pLat) * M_PER_DEG_LAT;
    const bx = (bLon - pLon) * mLon, by = (bLat - pLat) * M_PER_DEG_LAT;
    const dx = bx - ax, dy = by - ay;
    const len2 = dx * dx + dy * dy;
    let t = 0;
    if (len2 > 0) t = Math.max(0, Math.min(1, -(ax * dx + ay * dy) / len2));
    const px = ax + t * dx, py = ay + t * dy;
    const distM = Math.hypot(px, py);
    const projLat = pLat + py / M_PER_DEG_LAT;
    const projLon = pLon + px / mLon;
    return { t, distM, projLat, projLon };
}

// Find nearest ProRail line within MATCH_RADIUS_M; return interpolated NAP height
// or null if no match.
function nearestProRailNap(features, cells, lat, lon) {
    const cx = Math.floor(lon / GRID_DEG);
    const cy = Math.floor(lat / GRID_DEG);
    let best = null;
    const seen = new Set();
    for (let dx = -1; dx <= 1; dx++) {
        for (let dy = -1; dy <= 1; dy++) {
            const arr = cells.get(`${cx + dx}:${cy + dy}`);
            if (!arr) continue;
            for (const fi of arr) {
                if (seen.has(fi)) continue;
                seen.add(fi);
                const f = features[fi];
                // Total geometric length over all sub-lines, used to map projection
                // back to fraction of the whole feature for HOOGTE interpolation.
                let total = 0;
                const segLens = [];
                for (const line of f.lines) {
                    for (let i = 0; i + 1 < line.length; i++) {
                        const [aLon, aLat] = line[i];
                        const [bLon, bLat] = line[i + 1];
                        const mLon = mPerDegLon((aLat + bLat) / 2);
                        const len = Math.hypot((bLon - aLon) * mLon, (bLat - aLat) * M_PER_DEG_LAT);
                        segLens.push(len);
                        total += len;
                    }
                }
                let cumul = 0;
                let segIdx = 0;
                for (const line of f.lines) {
                    for (let i = 0; i + 1 < line.length; i++) {
                        const [aLon, aLat] = line[i];
                        const [bLon, bLat] = line[i + 1];
                        const proj = projectPointOntoSegment(lat, lon, aLat, aLon, bLat, bLon);
                        if (proj.distM < MATCH_RADIUS_M && (best == null || proj.distM < best.distM)) {
                            const segLen = segLens[segIdx];
                            const featureFrac = total > 0 ? (cumul + proj.t * segLen) / total : 0;
                            const hoogte = f.hb + (f.he - f.hb) * featureFrac;
                            best = { distM: proj.distM, hoogte, fi };
                        }
                        cumul += segLens[segIdx];
                        segIdx++;
                    }
                }
            }
        }
    }
    return best;
}

// ---------- AHN fallback ----------

async function sampleAhn(lon, lat) {
    const eps = 0.00005;
    const params = new URLSearchParams({
        SERVICE: 'WMS', VERSION: '1.3.0', REQUEST: 'GetFeatureInfo',
        LAYERS: AHN_LAYER, QUERY_LAYERS: AHN_LAYER, CRS: 'EPSG:4326',
        BBOX: `${lat - eps},${lon - eps},${lat + eps},${lon + eps}`,
        WIDTH: '11', HEIGHT: '11', I: '5', J: '5', INFO_FORMAT: 'application/json',
    });
    const res = await fetch(`${AHN_WMS}?${params}`);
    if (!res.ok) return null;
    const json = await res.json();
    const raw = json?.features?.[0]?.properties?.value_list;
    if (raw == null) return null;
    const v = parseFloat(String(raw).split(/\s+/)[0]);
    return Number.isFinite(v) ? v : null;
}

async function parallelPool(items, concurrency, worker) {
    const results = new Array(items.length);
    let nextIndex = 0;
    const runners = [];
    for (let w = 0; w < concurrency; w++) {
        runners.push((async () => {
            while (true) {
                const i = nextIndex++;
                if (i >= items.length) return;
                results[i] = await worker(items[i], i);
            }
        })());
    }
    await Promise.all(runners);
    return results;
}

// ---------- DB I/O ----------

function parseGeomLineString(geom) {
    if (geom && typeof geom === 'object' && Array.isArray(geom.coordinates)) {
        if (geom.type !== 'LineString') throw new Error(`Expected LineString, got ${geom.type}`);
        return geom.coordinates.map(([x, y]) => [x, y]);
    }
    if (typeof geom === 'string' && geom.trim().startsWith('{')) {
        const parsed = JSON.parse(geom);
        return parsed.coordinates.map(([x, y]) => [x, y]);
    }
    if (typeof geom === 'string' && /^[0-9a-fA-F]+$/.test(geom)) return parseEwkbLineString(geom);
    throw new Error(`Unrecognized geom format`);
}

function parseEwkbLineString(hex) {
    const bytes = new Uint8Array(hex.length / 2);
    for (let i = 0; i < bytes.length; i++) bytes[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
    const view = new DataView(bytes.buffer);
    let offset = 0;
    const le = view.getUint8(offset) === 1; offset += 1;
    const typeWord = view.getUint32(offset, le); offset += 4;
    const HAS_Z = 0x80000000, HAS_M = 0x40000000, HAS_SRID = 0x20000000;
    if ((typeWord & 0xff) !== 2) throw new Error(`Expected LineString`);
    const hasZ = !!(typeWord & HAS_Z);
    const hasM = !!(typeWord & HAS_M);
    if (typeWord & HAS_SRID) offset += 4;
    const n = view.getUint32(offset, le); offset += 4;
    const coords = new Array(n);
    for (let i = 0; i < n; i++) {
        const x = view.getFloat64(offset, le); offset += 8;
        const y = view.getFloat64(offset, le); offset += 8;
        if (hasZ) offset += 8;
        if (hasM) offset += 8;
        coords[i] = [x, y];
    }
    return coords;
}

async function loadExistingSources(segmentIds) {
    const map = new Map();
    for (let i = 0; i < segmentIds.length; i += SELECT_CHUNK) {
        const chunk = segmentIds.slice(i, i + SELECT_CHUNK);
        const { data, error } = await supabase
            .from('rail_point_overrides')
            .select('segment_id, point_index, source')
            .in('segment_id', chunk);
        if (error) throw new Error(`overrides query: ${error.message}`);
        for (const r of data ?? []) map.set(`${r.segment_id}:${r.point_index}`, r.source ?? null);
    }
    return map;
}

async function upsertSeed(rows) {
    for (let i = 0; i < rows.length; i += UPSERT_CHUNK) {
        const chunk = rows.slice(i, i + UPSERT_CHUNK);
        const { error } = await supabase.from('rail_point_overrides').upsert(chunk, { onConflict: 'segment_id,point_index' });
        if (error) throw new Error(`upsert at ${i}: ${error.message}`);
    }
}

// ---------- Per-segment processing ----------

// Process a group of vertices that all belong to the same OSM rail_lines segment.
// Returns array of seed rows (or empty if all-unmatched and AHN also failed).
async function processSegmentVertices(vertices, prFeatures, prCells, args, stats) {
    // 1. Try ProRail match for each vertex
    const matched = vertices.map(v => {
        const m = nearestProRailNap(prFeatures, prCells, v.lat, v.lon);
        return m ? { nap: m.hoogte, distM: m.distM } : null;
    });

    const matchedCount = matched.filter(Boolean).length;
    stats.directProrail += matchedCount;

    // 2. If no vertex matched at all → AHN fallback for whole segment
    if (matchedCount === 0) {
        const ahnResults = await parallelPool(vertices, args.concurrency, async (v) => {
            const napAhn = await sampleAhn(v.lon, v.lat);
            return napAhn != null ? { nap: napAhn, distM: null } : null;
        });
        for (let i = 0; i < ahnResults.length; i++) {
            if (ahnResults[i]) { matched[i] = ahnResults[i]; stats.ahnFallback++; }
        }
    } else {
        // 3. Linear-interpolate between matched ProRail neighbors for unmatched
        for (let i = 0; i < matched.length; i++) {
            if (matched[i]) continue;
            let before = -1, after = -1;
            for (let j = i - 1; j >= 0; j--) if (matched[j]) { before = j; break; }
            for (let j = i + 1; j < matched.length; j++) if (matched[j]) { after = j; break; }
            if (before >= 0 && after >= 0) {
                const t = (i - before) / (after - before);
                matched[i] = { nap: matched[before].nap + (matched[after].nap - matched[before].nap) * t, distM: null };
                stats.interpolated++;
            } else if (before >= 0) {
                matched[i] = { nap: matched[before].nap, distM: null }; stats.interpolated++;
            } else if (after >= 0) {
                matched[i] = { nap: matched[after].nap, distM: null }; stats.interpolated++;
            }
        }
    }

    const rows = [];
    for (let i = 0; i < vertices.length; i++) {
        const v = vertices[i];
        const m = matched[i];
        if (!m) { stats.stillMissing++; continue; }
        const ellipsoidal = egm96.egm96ToEllipsoid(v.lat, v.lon, m.nap);
        if (!Number.isFinite(ellipsoidal)) { stats.stillMissing++; continue; }
        rows.push({
            segment_id: v.segmentId,
            point_index: v.pointIndex,
            world_offset: [0, ellipsoidal, 0],
            source: 'seed',
            keynode: false,
        });
    }
    return rows;
}

// ---------- Modes ----------

async function runRoute(args, prFeatures, prCells) {
    const { data: route, error } = await supabase.rpc('find_journey_route', {
        stops: [args.route.from, args.route.to], editor: true,
    });
    if (error) throw new Error(`find_journey_route: ${error.message}`);
    if (route?.error) throw new Error(`Route error: ${route.error}`);

    const points = route.route, editor = route.editor;
    const seen = new Set();
    const all = [];
    for (let i = 0; i < editor.length; i++) {
        const e = editor[i];
        const k = `${e.segment_id}:${e.index}`;
        if (seen.has(k)) continue;
        seen.add(k);
        const [lon, lat] = points[i];
        all.push({ segmentId: e.segment_id, pointIndex: e.index, lon, lat });
    }
    if (args.limit) all.length = Math.min(all.length, args.limit);

    const segmentIds = [...new Set(all.map(c => c.segmentId))];
    const existing = await loadExistingSources(segmentIds);
    const candidates = all.filter(c => existing.get(`${c.segmentId}:${c.pointIndex}`) !== 'manual');
    console.log(`Route candidates: ${all.length}, after manual filter: ${candidates.length}`);

    // Group by segment for interpolation logic
    const bySegment = new Map();
    for (const c of candidates) {
        let arr = bySegment.get(c.segmentId);
        if (!arr) { arr = []; bySegment.set(c.segmentId, arr); }
        arr.push(c);
    }
    for (const arr of bySegment.values()) arr.sort((a, b) => a.pointIndex - b.pointIndex);

    const stats = { directProrail: 0, interpolated: 0, ahnFallback: 0, stillMissing: 0, upserted: 0 };
    const allRows = [];
    for (const arr of bySegment.values()) {
        const rows = await processSegmentVertices(arr, prFeatures, prCells, args, stats);
        allRows.push(...rows);
    }
    if (!args.dryRun && allRows.length > 0) {
        await upsertSeed(allRows);
        stats.upserted = allRows.length;
    }
    console.log(`Direct ProRail:    ${stats.directProrail}`);
    console.log(`Interpolated:      ${stats.interpolated}`);
    console.log(`AHN fallback:      ${stats.ahnFallback}`);
    console.log(`Still missing:     ${stats.stillMissing}`);
    console.log(args.dryRun ? '\n[dry-run] No rows written.' : `Upserted: ${stats.upserted}`);
}

async function runCountry(args, prFeatures, prCells) {
    const { count: totalSegments, error: countErr } = await supabase
        .from('rail_lines').select('id', { count: 'exact', head: true }).eq('country', args.country);
    if (countErr) throw new Error(`count: ${countErr.message}`);
    console.log(`Country ${args.country}: ${totalSegments} segments to scan`);

    const totals = { directProrail: 0, interpolated: 0, ahnFallback: 0, stillMissing: 0, upserted: 0 };
    const t0 = Date.now();
    let cursor = 0, done = 0;

    while (true) {
        const { data: segments, error } = await supabase
            .from('rail_lines').select('id, geom').eq('country', args.country).gt('id', cursor).order('id').limit(COUNTRY_PAGE_SIZE);
        if (error) throw new Error(`fetch: ${error.message}`);
        if (!segments || segments.length === 0) break;

        // Build candidate list per segment, then filter manuals
        const segmentVertices = new Map();
        for (const seg of segments) {
            let coords;
            try { coords = parseGeomLineString(seg.geom); }
            catch (e) { console.warn(`  skip segment ${seg.id}: ${e.message}`); continue; }
            const arr = [];
            for (let i = 0; i < coords.length; i++) {
                const [lon, lat] = coords[i];
                if (Number.isFinite(lon) && Number.isFinite(lat)) {
                    arr.push({ segmentId: seg.id, pointIndex: i, lon, lat });
                }
            }
            if (arr.length > 0) segmentVertices.set(seg.id, arr);
        }

        const segmentIds = [...segmentVertices.keys()];
        const existing = await loadExistingSources(segmentIds);
        const allRows = [];
        const batchStats = { directProrail: 0, interpolated: 0, ahnFallback: 0, stillMissing: 0, upserted: 0 };

        for (const [segId, arr] of segmentVertices) {
            const filtered = arr.filter(c => existing.get(`${segId}:${c.pointIndex}`) !== 'manual');
            if (filtered.length === 0) continue;
            const rows = await processSegmentVertices(filtered, prFeatures, prCells, args, batchStats);
            allRows.push(...rows);
        }

        if (!args.dryRun && allRows.length > 0) {
            await upsertSeed(allRows);
            batchStats.upserted = allRows.length;
        }
        for (const k of Object.keys(totals)) totals[k] += batchStats[k];

        cursor = segments[segments.length - 1].id;
        done += segments.length;
        const elapsed = (Date.now() - t0) / 1000;
        const rate = done / Math.max(elapsed, 0.001);
        const eta = rate > 0 ? Math.max(0, totalSegments - done) / rate : 0;
        console.log(`[${done}/${totalSegments} segs · ${formatDuration(elapsed)} · ETA ${formatDuration(eta)}] ` +
            `pr=${batchStats.directProrail} interp=${batchStats.interpolated} ahn=${batchStats.ahnFallback} miss=${batchStats.stillMissing} upsert=${batchStats.upserted}`);

        if (args.limit && totals.directProrail + totals.ahnFallback + totals.interpolated >= args.limit) break;
    }

    console.log('\n=== Country seed complete ===');
    console.log(`Direct ProRail:    ${totals.directProrail}`);
    console.log(`Interpolated:      ${totals.interpolated}`);
    console.log(`AHN fallback:      ${totals.ahnFallback}`);
    console.log(`Still missing:     ${totals.stillMissing}`);
    console.log(`Total upserted:    ${totals.upserted}`);
    console.log(`Elapsed:           ${formatDuration((Date.now() - t0) / 1000)}`);
}

async function main() {
    const args = parseArgs();
    console.log(`Mode: ${args.mode}${args.dryRun ? ' (dry-run)' : ''}`);
    const features = await loadProRail(args.refreshCache);
    console.log('Building grid index...');
    const cells = buildGridIndex(features);
    console.log(`  ${cells.size} cells`);
    if (args.mode === 'route') await runRoute(args, features, cells);
    else await runCountry(args, features, cells);
}

main().catch(e => { console.error(e); process.exit(1); });
