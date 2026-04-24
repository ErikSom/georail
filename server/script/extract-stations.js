// script/extract-stations.js
import { createClient } from '@supabase/supabase-js';
import fs from 'fs';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

// --- .env loading part (same as before) ---
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const envPath = path.resolve(__dirname, '../.env');
dotenv.config({ path: envPath });

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY;

if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY) {
    console.error("Error: Could not load SUPABASE_URL or SUPABASE_SERVICE_KEY.");
    process.exit(1);
}
const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);
// --- End of .env loading part ---


function parseArgs() {
    const args = process.argv.slice(2);
    const result = { country: 'NL', data: null };
    for (let i = 0; i < args.length; i++) {
        if (args[i] === '--country' && args[i + 1]) result.country = args[++i].toUpperCase();
        if (args[i] === '--data' && args[i + 1]) result.data = args[++i];
    }
    return result;
}

async function main() {
    const { country, data: dataFile } = parseArgs();
    const dataPath = dataFile
        ? path.resolve(process.cwd(), dataFile)
        : path.resolve(__dirname, './rail-data.json');

    console.log(`Reading ${dataPath} for country=${country}...`);
    const geojsonData = JSON.parse(fs.readFileSync(dataPath, 'utf-8'));
    const allFeatures = geojsonData.features;

    console.log(`Found ${allFeatures.length} total features. Filtering for stations...`);

    const allNodes = allFeatures.filter(f =>
        f.properties?.['@id']?.startsWith('node') &&
        f.geometry?.type === 'Point' &&
        f.properties.name
    );

    // Some stations (Amsterdam Muiderpoort, Buitenpost, Eerbeek, ...) are mapped
    // as polygonal ways, not nodes. Treat them as station fallback points using
    // their polygon centroid.
    function centroid(geom) {
        if (!geom) return null;
        if (geom.type === 'Point') return geom;
        const ring = geom.type === 'Polygon' ? geom.coordinates[0]
            : geom.type === 'LineString' ? geom.coordinates
            : geom.type === 'MultiPolygon' ? geom.coordinates[0][0]
            : null;
        if (!ring || ring.length === 0) return null;
        const [sx, sy] = ring.reduce(([ax, ay], [x, y]) => [ax + x, ay + y], [0, 0]);
        return { type: 'Point', coordinates: [sx / ring.length, sy / ring.length] };
    }
    const stationWays = [];
    for (const f of allFeatures) {
        if (!f.properties?.['@id']?.startsWith('way')) continue;
        if (!f.properties.name) continue;
        const railway = f.properties.railway;
        const ref = f.properties['railway:ref'];
        if (!ref || (railway !== 'station' && railway !== 'halt')) continue;
        const point = centroid(f.geometry);
        if (!point) continue;
        stationWays.push({ ...f, geometry: point });
    }

    // railway=station / railway=halt nodes carry the station code (railway:ref).
    // For large hubs like Amsterdam Centraal and Hoorn, the individual railway=stop
    // platform nodes lack railway:ref — their code only lives on the parent station node.
    const nameToCode = new Map();
    const stationAnchors = []; // { code, lon, lat, name } for spatial fallback
    for (const f of [...allNodes, ...stationWays]) {
        const railway = f.properties.railway;
        const ref = f.properties['railway:ref'];
        if (ref && (railway === 'station' || railway === 'halt')) {
            nameToCode.set(f.properties.name, ref);
            const [lon, lat] = f.geometry.coordinates;
            stationAnchors.push({ code: ref, name: f.properties.name, lon, lat });
        }
    }

    // Haversine distance in meters — spatial fallback when the stop node's name
    // doesn't match any station (e.g. typos like "Hoogkarpsel" vs "Hoogkarspel",
    // or alternate names like "Amsterdam ArenA" vs "Amsterdam Bijlmer ArenA").
    function distanceM(lon1, lat1, lon2, lat2) {
        const R = 6371000;
        const dLat = (lat2 - lat1) * Math.PI / 180;
        const dLon = (lon2 - lon1) * Math.PI / 180;
        const a = Math.sin(dLat / 2) ** 2 +
            Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
            Math.sin(dLon / 2) ** 2;
        return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    }
    const NEAREST_STATION_RADIUS_M = 800;
    function nearestStationCode(lon, lat) {
        let best = null;
        let bestD = Infinity;
        for (const a of stationAnchors) {
            const d = distanceM(lon, lat, a.lon, a.lat);
            if (d < bestD) { bestD = d; best = a; }
        }
        return (best && bestD <= NEAREST_STATION_RADIUS_M) ? { code: best.code, name: best.name, distanceM: bestD } : null;
    }

    // railway=buffer_stop handles terminal stations (Enkhuizen, Den Helder, Zwolle
    // 12-16, Sittard 20, Haarlem 4-5, Utrecht Maliebaan 2, Zuidhorn 3) — the buffer
    // at the end of the track is where the train stops.
    const stopFeatures = allNodes.filter(f =>
        f.properties.railway === 'stop' ||
        f.properties.public_transport === 'stop_position' ||
        (f.properties.railway === 'buffer_stop' && f.properties.train === 'yes' && f.properties.ref)
    );

    const stationsToUpload = [];
    const namesCoveredByStops = new Set();
    let skippedNoCode = 0;
    let spatialFallbacks = 0;
    for (const f of stopFeatures) {
        let code = f.properties['railway:ref'] || nameToCode.get(f.properties.name) || null;
        let resolvedName = f.properties.name;
        if (!code) {
            const [lon, lat] = f.geometry.coordinates;
            const nearest = nearestStationCode(lon, lat);
            if (nearest) {
                code = nearest.code;
                // Use the station's canonical name so downstream grouping matches.
                resolvedName = nearest.name;
                spatialFallbacks++;
                console.log(`  Spatial fallback: stop "${f.properties.name}" → ${nearest.name} (${nearest.code}, ${Math.round(nearest.distanceM)}m)`);
            }
        }
        if (!code) {
            skippedNoCode++;
            continue;
        }
        namesCoveredByStops.add(resolvedName);
        stationsToUpload.push({
            name: resolvedName,
            ref: f.properties.ref || null,
            code: code.toUpperCase(),
            properties: f.properties,
            geom_geojson: f.geometry,
        });
    }

    // Fallback: if a station/halt has no accompanying stop nodes (many smaller /
    // northern NL stations are only mapped as a single point or polygon), insert
    // it as a single platform-less row so routing can still resolve the code.
    // Dedupe by code — OSM sometimes has multiple station entries for one place
    // (e.g. node + way, or parallel operators like Kerkrade Centrum / ZLSM).
    let stationFallbackCount = 0;
    const fallbackCodesSeen = new Set();
    for (const f of [...allNodes, ...stationWays]) {
        const railway = f.properties.railway;
        const ref = f.properties['railway:ref'];
        if (!ref || (railway !== 'station' && railway !== 'halt')) continue;
        if (namesCoveredByStops.has(f.properties.name)) continue;
        const upperCode = ref.toUpperCase();
        if (fallbackCodesSeen.has(upperCode)) continue;
        fallbackCodesSeen.add(upperCode);
        stationFallbackCount++;
        stationsToUpload.push({
            name: f.properties.name,
            ref: null,
            code: upperCode,
            properties: f.properties,
            geom_geojson: f.geometry,
        });
    }

    // Drop ref=null rows for codes that already have platform rows, AND collapse
    // multiple ref=null rows for the same code down to one. Both come from OSM
    // "bare" railway=stop nodes that lack a platform number (e.g. Utrecht Centraal
    // has 15 platform stops plus an extra ref-less one; Simpelveld has three
    // ref-less stops from its heritage line, none with platform numbers).
    const codesWithPlatform = new Set(
        stationsToUpload.filter(s => s.ref !== null).map(s => s.code)
    );
    const beforeDedup = stationsToUpload.length;
    const seenPlatformlessCodes = new Set();
    const deduped = stationsToUpload.filter(s => {
        if (s.ref !== null) return true;
        if (codesWithPlatform.has(s.code)) return false;
        if (seenPlatformlessCodes.has(s.code)) return false;
        seenPlatformlessCodes.add(s.code);
        return true;
    });
    const droppedPlatformless = beforeDedup - deduped.length;
    stationsToUpload.length = 0;
    stationsToUpload.push(...deduped);

    console.log(`Found ${stationsToUpload.length} rows to upload (${stopFeatures.length - skippedNoCode} platforms [${spatialFallbacks} via spatial fallback] + ${stationFallbackCount} station-only fallbacks; ${skippedNoCode} stops skipped: no resolvable code; ${droppedPlatformless} platform-less rows dropped because code already has platforms).`);

    if (stationsToUpload.length === 0) {
        console.log('No stations found. Exiting.');
        return;
    }

    // Clear only stations for this country to prevent duplicates if you run this again
    console.log(`Clearing stations for country=${country}...`);
    const { error: deleteError } = await supabase
        .from('stations')
        .delete()
        .eq('country', country);
    if (deleteError) {
        console.error('FATAL: Could not clear stations for country.', deleteError);
        return;
    }


    const BATCH_SIZE = 500;
    console.log('Starting upload in batches...');

    for (let i = 0; i < stationsToUpload.length; i += BATCH_SIZE) {
        const batch = stationsToUpload.slice(i, i + BATCH_SIZE);

        console.log(`Uploading batch ${Math.floor(i / BATCH_SIZE) + 1} / ${Math.ceil(stationsToUpload.length / BATCH_SIZE)}...`);

        const { error } = await supabase.rpc('insert_stations_batch', {
            stations_data: batch,
            p_country: country
        });

        if (error) {
            console.error(`Error in batch ${Math.floor(i / BATCH_SIZE) + 1}:`, error.message);
        }
    }

    console.log('✅ Station extraction and upload complete!');
}

main();