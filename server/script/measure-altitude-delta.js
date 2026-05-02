// Measures the constant offset between manually-edited rail point heights
// (world_offset[y]) and AHN bare-earth elevation (m NAP) along a known-good
// reference route. Output drives the AHN seeding script.
//
// Usage:
//   node script/measure-altitude-delta.js
//
// Default route is Hoorn track 2 → Amsterdam Centraal track 4b. Override via
// --from CODE:TRACK --to CODE:TRACK.

import { createClient } from '@supabase/supabase-js';
import fs from 'fs';
import path from 'path';
import dotenv from 'dotenv';
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
const REQUEST_DELAY_MS = 80;

function parseStop(arg, fallback) {
    if (!arg) return fallback;
    const [code, track] = arg.split(':');
    return { code, track: track || null };
}

function parseArgs() {
    const args = process.argv.slice(2);
    let from = null;
    let to = null;
    for (let i = 0; i < args.length; i++) {
        if (args[i] === '--from' && args[i + 1]) from = args[++i];
        if (args[i] === '--to' && args[i + 1]) to = args[++i];
    }
    return {
        from: parseStop(from, { code: 'HRN', track: '2' }),
        to: parseStop(to, { code: 'ASD', track: '4b' }),
    };
}

async function sampleAhn(lon, lat) {
    // WMS 1.3.0 with EPSG:4326 expects (lat, lon) bbox order.
    const eps = 0.00005; // ~5m in lat at NL latitudes
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
    const url = `${AHN_WMS}?${params.toString()}`;
    const res = await fetch(url);
    if (!res.ok) return null;
    const json = await res.json();
    const raw = json?.features?.[0]?.properties?.value_list;
    if (raw == null) return null;
    const v = parseFloat(String(raw).split(/\s+/)[0]);
    return Number.isFinite(v) ? v : null;
}

function stats(values) {
    const sorted = [...values].sort((a, b) => a - b);
    const n = sorted.length;
    const mean = sorted.reduce((a, b) => a + b, 0) / n;
    const median = n % 2 ? sorted[(n - 1) / 2] : (sorted[n / 2 - 1] + sorted[n / 2]) / 2;
    const variance = sorted.reduce((s, x) => s + (x - mean) ** 2, 0) / n;
    return {
        count: n,
        mean,
        median,
        stdev: Math.sqrt(variance),
        min: sorted[0],
        max: sorted[n - 1],
        p10: sorted[Math.floor(n * 0.1)],
        p90: sorted[Math.floor(n * 0.9)],
    };
}

async function main() {
    const { from, to } = parseArgs();
    console.log(`Route: ${from.code}/${from.track} → ${to.code}/${to.track}`);

    const { data: route, error: rpcErr } = await supabase.rpc('find_journey_route', {
        stops: [from, to],
        editor: true,
    });
    if (rpcErr) { console.error('find_journey_route failed:', rpcErr); process.exit(1); }
    if (route?.error) { console.error('Route error:', route.error); process.exit(1); }

    const points = route.route;
    const editor = route.editor;
    if (!Array.isArray(points) || !Array.isArray(editor) || points.length !== editor.length) {
        console.error('Unexpected route shape'); process.exit(1);
    }
    console.log(`Route has ${points.length} points across ${new Set(editor.map(e => e.segment_id)).size} segments.`);

    // Pull every override row that lives on these segments. We only want
    // 'manual' rows (user-edited). 'seed' rows would skew the calibration.
    const segmentIds = [...new Set(editor.map(e => e.segment_id))];
    const overrides = [];
    const CHUNK = 200;
    for (let i = 0; i < segmentIds.length; i += CHUNK) {
        const chunk = segmentIds.slice(i, i + CHUNK);
        const { data, error } = await supabase
            .from('rail_point_overrides')
            .select('segment_id, point_index, world_offset, source')
            .in('segment_id', chunk);
        if (error) { console.error('rail_point_overrides query failed:', error); process.exit(1); }
        if (data) overrides.push(...data);
    }

    const overrideMap = new Map();
    for (const o of overrides) {
        overrideMap.set(`${o.segment_id}:${o.point_index}`, o);
    }

    const calibration = [];
    for (let i = 0; i < editor.length; i++) {
        const e = editor[i];
        const o = overrideMap.get(`${e.segment_id}:${e.index}`);
        if (!o || o.source !== 'manual') continue;
        const [lon, lat] = points[i];
        const manualHeight = o.world_offset[1]; // y axis
        if (!Number.isFinite(manualHeight)) continue;
        calibration.push({
            segmentId: e.segment_id,
            pointIndex: e.index,
            lon, lat, manualHeight,
        });
    }
    console.log(`Calibration points (manual overrides on this route): ${calibration.length}`);
    if (calibration.length === 0) {
        console.error('No manual override points found on the requested route — nothing to calibrate against.');
        process.exit(1);
    }

    // Sample AHN. Polite throttle to avoid hammering PDOK.
    const results = [];
    let progress = 0;
    for (const c of calibration) {
        const ahn = await sampleAhn(c.lon, c.lat);
        progress++;
        if (progress % 25 === 0 || progress === calibration.length) {
            process.stdout.write(`  ${progress}/${calibration.length} sampled\r`);
        }
        if (ahn == null) continue;
        results.push({ ...c, ahnHeight: ahn, delta: c.manualHeight - ahn });
        await new Promise(r => setTimeout(r, REQUEST_DELAY_MS));
    }
    process.stdout.write('\n');

    if (results.length === 0) {
        console.error('AHN returned no values — check network and endpoint.');
        process.exit(1);
    }

    const s = stats(results.map(r => r.delta));
    console.log('\n=== delta = manualHeight - ahnHeight (meters) ===');
    console.log(`samples: ${s.count} (skipped ${calibration.length - s.count})`);
    console.log(`mean:    ${s.mean.toFixed(3)}`);
    console.log(`median:  ${s.median.toFixed(3)}`);
    console.log(`stdev:   ${s.stdev.toFixed(3)}`);
    console.log(`min:     ${s.min.toFixed(3)}`);
    console.log(`p10:     ${s.p10.toFixed(3)}`);
    console.log(`p90:     ${s.p90.toFixed(3)}`);
    console.log(`max:     ${s.max.toFixed(3)}`);
    console.log('\nIf stdev is small (<~0.5m), the median is a clean constant offset to bake into seeding.');
    console.log('If stdev is large, expect to seed using AHN directly without a constant offset, or look at per-region calibration.');

    const csvPath = path.resolve(__dirname, 'altitude-delta.csv');
    const csv = [
        'segment_id,point_index,lon,lat,manual_height,ahn_height,delta',
        ...results.map(r =>
            `${r.segmentId},${r.pointIndex},${r.lon},${r.lat},${r.manualHeight},${r.ahnHeight},${r.delta}`
        ),
    ].join('\n');
    fs.writeFileSync(csvPath, csv);
    console.log(`\nFull CSV → ${csvPath}`);
}

main().catch(err => { console.error(err); process.exit(1); });
