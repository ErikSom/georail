// Despike rail_point_overrides: detect AHN sample artifacts (e.g. a single
// point whose height matches a station roof, canopy, or platform overhang
// instead of rail level) and replace them with values interpolated from
// nearby rail-level neighbors.
//
// Algorithm
//   For each segment, walk its points in point_index order.
//   For each seed point, compute the median height of a window of neighbors
//   (excluding self). If the point deviates from that median by more than
//   the threshold, flag it. Then for each flagged point, replace its height
//   with linear interpolation from the nearest non-flagged neighbors on
//   either side. Manual rows are anchors — never modified, always usable as
//   anchors.
//
//   The median tracks gradual real climbs (so a 4% rail grade is not
//   flagged), and is robust against single- and few-point spikes.
//
// Usage
//   node script/despike-altitudes.js [--country NL] [--threshold 1.5] [--window 4]
//                                    [--segment ID] [--dry-run]
//
// Flags
//   --country NL         only segments from this country (default NL)
//   --segment ID         process just one rail_lines segment_id
//   --threshold M        deviation in meters that flags a point (default 1.5)
//   --window N           half-window size, in points, on each side (default 4)
//   --dry-run            log changes and stats; do not write
//
// Output: histogram of detected deviations, sample of largest fixes.

import { createClient } from '@supabase/supabase-js';
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

const DEFAULT_THRESHOLD_M = 1.5;
const DEFAULT_HALF_WINDOW = 4;
const SEGMENTS_PER_PAGE = 500;
const UPSERT_CHUNK = 500;

function parseArgs() {
    const args = process.argv.slice(2);
    const out = {
        country: 'NL',
        segment: null,
        threshold: DEFAULT_THRESHOLD_M,
        halfWindow: DEFAULT_HALF_WINDOW,
        dryRun: false,
    };
    for (let i = 0; i < args.length; i++) {
        if (args[i] === '--country' && args[i + 1]) out.country = args[++i].toUpperCase();
        else if (args[i] === '--segment' && args[i + 1]) out.segment = parseInt(args[++i], 10);
        else if (args[i] === '--threshold' && args[i + 1]) out.threshold = parseFloat(args[++i]);
        else if (args[i] === '--window' && args[i + 1]) out.halfWindow = parseInt(args[++i], 10);
        else if (args[i] === '--dry-run') out.dryRun = true;
    }
    return out;
}

function median(values) {
    const sorted = [...values].sort((a, b) => a - b);
    const n = sorted.length;
    return n % 2 ? sorted[(n - 1) / 2] : (sorted[n / 2 - 1] + sorted[n / 2]) / 2;
}

// points: [{ segmentId, pointIndex, height, source }]  (sorted by pointIndex)
// Returns updates to upsert.
function despikeSegment(points, threshold, halfWindow) {
    const N = points.length;
    if (N < 3) return [];

    // Flag pass: anything deviating from the local median by more than threshold.
    const flagged = new Set();
    for (let i = 0; i < N; i++) {
        if (points[i].source === 'manual') continue; // anchors, untouchable
        const lo = Math.max(0, i - halfWindow);
        const hi = Math.min(N, i + halfWindow + 1);
        const window = [];
        for (let j = lo; j < hi; j++) {
            if (j !== i) window.push(points[j].height);
        }
        if (window.length === 0) continue;
        const m = median(window);
        if (Math.abs(points[i].height - m) > threshold) {
            flagged.add(i);
        }
    }

    if (flagged.size === 0) return [];

    // Replacement pass: linear interp between nearest non-flagged neighbors.
    // Manual or unflagged seed both count as anchors.
    const updates = [];
    for (const i of flagged) {
        let beforeIdx = -1;
        for (let j = i - 1; j >= 0; j--) {
            if (points[j].source === 'manual' || !flagged.has(j)) { beforeIdx = j; break; }
        }
        let afterIdx = -1;
        for (let j = i + 1; j < N; j++) {
            if (points[j].source === 'manual' || !flagged.has(j)) { afterIdx = j; break; }
        }
        let newHeight;
        if (beforeIdx >= 0 && afterIdx >= 0) {
            const yBefore = points[beforeIdx].height;
            const yAfter = points[afterIdx].height;
            const t = (i - beforeIdx) / (afterIdx - beforeIdx);
            newHeight = yBefore + (yAfter - yBefore) * t;
        } else if (beforeIdx >= 0) {
            newHeight = points[beforeIdx].height;
        } else if (afterIdx >= 0) {
            newHeight = points[afterIdx].height;
        } else {
            continue; // entire segment flagged; nothing reliable to use
        }

        updates.push({
            segment_id: points[i].segmentId,
            point_index: points[i].pointIndex,
            world_offset: [0, newHeight, 0],
            source: 'seed',
            keynode: false,
            _oldHeight: points[i].height,
            _newHeight: newHeight,
        });
    }
    return updates;
}

async function fetchOverridesForSegments(segIds) {
    const out = [];
    const CHUNK = 200;
    for (let i = 0; i < segIds.length; i += CHUNK) {
        const chunk = segIds.slice(i, i + CHUNK);
        const { data, error } = await supabase
            .from('rail_point_overrides')
            .select('segment_id, point_index, world_offset, source')
            .in('segment_id', chunk);
        if (error) throw new Error(`rail_point_overrides fetch failed: ${error.message}`);
        if (data) out.push(...data);
    }
    return out;
}

function groupBySegment(rows) {
    const map = new Map();
    for (const r of rows) {
        const arr = map.get(r.segment_id) ?? [];
        arr.push({
            segmentId: r.segment_id,
            pointIndex: r.point_index,
            height: Array.isArray(r.world_offset) ? r.world_offset[1] : 0,
            source: r.source ?? 'seed',
        });
        map.set(r.segment_id, arr);
    }
    for (const arr of map.values()) {
        arr.sort((a, b) => a.pointIndex - b.pointIndex);
    }
    return map;
}

async function upsertCorrections(updates) {
    const cleaned = updates.map(u => ({
        segment_id: u.segment_id,
        point_index: u.point_index,
        world_offset: u.world_offset,
        source: u.source,
        keynode: u.keynode,
    }));
    for (let i = 0; i < cleaned.length; i += UPSERT_CHUNK) {
        const chunk = cleaned.slice(i, i + UPSERT_CHUNK);
        const { error } = await supabase
            .from('rail_point_overrides')
            .upsert(chunk, { onConflict: 'segment_id,point_index' });
        if (error) throw new Error(`upsert failed: ${error.message}`);
    }
}

function recordHistogram(updates, hist) {
    for (const u of updates) {
        const delta = Math.abs(u._oldHeight - u._newHeight);
        const bucket = Math.floor(delta);
        hist[bucket] = (hist[bucket] ?? 0) + 1;
    }
}

async function runSingleSegment(args) {
    const overrides = await fetchOverridesForSegments([args.segment]);
    const grouped = groupBySegment(overrides);
    const points = grouped.get(args.segment) ?? [];
    if (points.length === 0) {
        console.log(`No overrides for segment ${args.segment}.`);
        return;
    }
    const updates = despikeSegment(points, args.threshold, args.halfWindow);
    console.log(`Segment ${args.segment}: ${points.length} points checked, ${updates.length} flagged`);
    for (const u of updates.slice(0, 30)) {
        console.log(`  idx=${u.point_index}  ${u._oldHeight.toFixed(2)}m → ${u._newHeight.toFixed(2)}m  (Δ=${(u._oldHeight - u._newHeight).toFixed(2)}m)`);
    }
    if (!args.dryRun && updates.length > 0) {
        await upsertCorrections(updates);
        console.log(`Upserted ${updates.length} corrections.`);
    } else if (args.dryRun) {
        console.log('[dry-run] No rows written.');
    }
}

async function runCountry(args) {
    const { count: totalSegments } = await supabase
        .from('rail_lines')
        .select('id', { count: 'exact', head: true })
        .eq('country', args.country);

    let cursor = 0;
    let segmentsScanned = 0;
    let totalChecked = 0;
    let totalFlagged = 0;
    const histogram = {};
    const topFixes = [];

    while (true) {
        const { data: segRows, error: segErr } = await supabase
            .from('rail_lines')
            .select('id')
            .eq('country', args.country)
            .gt('id', cursor)
            .order('id')
            .limit(SEGMENTS_PER_PAGE);
        if (segErr) throw new Error(`rail_lines fetch failed: ${segErr.message}`);
        if (!segRows || segRows.length === 0) break;

        const segIds = segRows.map(r => r.id);
        const overrides = await fetchOverridesForSegments(segIds);
        const grouped = groupBySegment(overrides);

        const pageUpdates = [];
        let pageChecked = 0;
        for (const [, points] of grouped) {
            pageChecked += points.length;
            const updates = despikeSegment(points, args.threshold, args.halfWindow);
            pageUpdates.push(...updates);
        }
        recordHistogram(pageUpdates, histogram);
        for (const u of pageUpdates) {
            const delta = Math.abs(u._oldHeight - u._newHeight);
            if (topFixes.length < 20 || delta > topFixes[topFixes.length - 1].delta) {
                topFixes.push({ segId: u.segment_id, idx: u.point_index, delta, oldH: u._oldHeight, newH: u._newHeight });
                topFixes.sort((a, b) => b.delta - a.delta);
                if (topFixes.length > 20) topFixes.length = 20;
            }
        }

        if (!args.dryRun && pageUpdates.length > 0) {
            await upsertCorrections(pageUpdates);
        }

        segmentsScanned += segIds.length;
        totalChecked += pageChecked;
        totalFlagged += pageUpdates.length;
        cursor = segIds[segIds.length - 1];

        console.log(`[${segmentsScanned}/${totalSegments} segs · checked=${pageChecked} flagged=${pageUpdates.length}]`);
    }

    console.log('\n=== Despike complete ===');
    console.log(`Country:           ${args.country}`);
    console.log(`Threshold:         ${args.threshold}m`);
    console.log(`Half-window:       ${args.halfWindow} points each side`);
    console.log(`Segments scanned:  ${segmentsScanned}`);
    console.log(`Points checked:    ${totalChecked}`);
    console.log(`Points fixed:      ${totalFlagged}`);
    console.log(args.dryRun ? '\n[dry-run] No rows written.' : `Upserted: ${totalFlagged}`);

    const buckets = Object.keys(histogram).map(Number).sort((a, b) => a - b);
    if (buckets.length > 0) {
        console.log('\nDelta histogram (|old - new|, m):');
        for (const b of buckets) {
            console.log(`  ${b}-${b + 1}m: ${histogram[b]}`);
        }
    }

    if (topFixes.length > 0) {
        console.log('\nLargest fixes (top 20):');
        for (const t of topFixes) {
            console.log(`  segment=${t.segId} idx=${t.idx}  ${t.oldH.toFixed(2)}m → ${t.newH.toFixed(2)}m  (Δ=${(t.oldH - t.newH).toFixed(2)}m)`);
        }
    }
}

async function main() {
    const args = parseArgs();
    console.log(`Despike (country=${args.country}, threshold=${args.threshold}m, window=±${args.halfWindow}, dryRun=${args.dryRun})`);
    if (args.segment != null) {
        await runSingleSegment(args);
    } else {
        await runCountry(args);
    }
}

main().catch(err => { console.error(err); process.exit(1); });
