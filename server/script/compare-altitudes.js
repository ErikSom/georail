// Throwaway: compare seed altitudes (rail_point_overrides, AHN-derived ellipsoidal)
// against ProRail PVS_Verticale_Elementen HOOGTE (NAP track design height).
//
// Run from /server:
//   node script/compare-altitudes.js
//
// Optional: extra points via --point "Naam,lat,lon" (repeatable).

import { createClient } from '@supabase/supabase-js';
import * as egm96 from 'egm96-universal';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
dotenv.config({ path: path.resolve(__dirname, '../.env') });

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);
const PRORAIL_URL = 'https://mapservices.prorail.nl/arcgis/rest/services/Spoorgeometrie_006/FeatureServer/12/query';

const DEFAULT_POINTS = [
    { name: 'Amsterdam CS (viaduct)',     lat: 52.37893, lon: 4.90031 },
    { name: 'Utrecht CS (at grade)',      lat: 52.08953, lon: 5.10979 },
    { name: 'Den Haag CS',                lat: 52.08055, lon: 4.32530 },
    { name: 'Rotterdam CS (cutting)',     lat: 51.92464, lon: 4.46897 },
    { name: 'Eindhoven CS',               lat: 51.44348, lon: 5.47930 },
    { name: 'Schiphol (tunnel)',          lat: 52.30940, lon: 4.76140 },
    { name: 'HSL Hoofddorp viaduct',      lat: 52.28900, lon: 4.69500 },
    { name: 'Maastricht',                 lat: 50.85027, lon: 5.70503 },
    { name: 'Sneek (flat polder)',        lat: 53.03300, lon: 5.65800 },
    { name: 'Arnhem CS',                  lat: 51.98480, lon: 5.89880 },
];

function parseArgs() {
    const extra = [];
    const a = process.argv.slice(2);
    for (let i = 0; i < a.length; i++) {
        if (a[i] === '--point' && a[i + 1]) {
            const [name, lat, lon] = a[++i].split(',');
            extra.push({ name, lat: +lat, lon: +lon });
        }
    }
    return extra;
}

// Haversine distance in meters
function distM(aLat, aLon, bLat, bLon) {
    const R = 6371000;
    const dLat = (bLat - aLat) * Math.PI / 180;
    const dLon = (bLon - aLon) * Math.PI / 180;
    const la1 = aLat * Math.PI / 180;
    const la2 = bLat * Math.PI / 180;
    const x = Math.sin(dLat / 2) ** 2 + Math.cos(la1) * Math.cos(la2) * Math.sin(dLon / 2) ** 2;
    return 2 * R * Math.asin(Math.sqrt(x));
}

// Project p onto segment a→b in 2D (degrees treated as planar — fine for ~100m)
function projectOntoSegment(pLat, pLon, aLat, aLon, bLat, bLon) {
    const dx = bLon - aLon;
    const dy = bLat - aLat;
    const len2 = dx * dx + dy * dy;
    if (len2 === 0) return { t: 0, lat: aLat, lon: aLon };
    let t = ((pLon - aLon) * dx + (pLat - aLat) * dy) / len2;
    t = Math.max(0, Math.min(1, t));
    return { t, lat: aLat + t * dy, lon: aLon + t * dx };
}

async function getSeedAtPoint(lat, lon) {
    const { data, error } = await supabase.rpc('get_rail_in_area', {
        p_lat: lat, p_lon: lon, p_radius_m: 200, p_country: 'NL',
    });
    if (error) throw new Error(`get_rail_in_area: ${error.message}`);
    const route = data?.route ?? [];
    const meta = data?.metadata ?? [];
    if (route.length === 0) return null;

    // route[i] = [lon, lat, x_off, y_off (ellipsoidal), z_off]
    // metadata may or may not include `source` depending on RPC version.
    let bestSeeded = null;
    let bestAny = null;
    for (let i = 0; i < route.length; i++) {
        const pLon = route[i][0];
        const pLat = route[i][1];
        const yEll = route[i][3];
        const d = distM(lat, lon, pLat, pLon);
        const source = meta[i]?.source ?? (yEll !== 0 ? 'seed?' : null);
        const cand = { d, lat: pLat, lon: pLon, yEll, source };
        if (bestAny == null || d < bestAny.d) bestAny = cand;
        if (yEll !== 0 && (bestSeeded == null || d < bestSeeded.d)) bestSeeded = cand;
    }
    const pick = bestSeeded ?? bestAny;
    if (pick == null) return null;
    const napFromSeed = egm96.ellipsoidToEgm96(pick.lat, pick.lon, pick.yEll);
    return {
        distM: pick.d,
        ellipsoidal: pick.yEll,
        nap: napFromSeed,
        source: pick.source,
        nearestAnyDist: bestAny?.d ?? null,
        candidates: route.length,
    };
}

async function getProrailAtPoint(lat, lon) {
    const eps = 0.0008; // ~50–90 m bbox
    const params = new URLSearchParams({
        geometry: JSON.stringify({
            xmin: lon - eps, ymin: lat - eps, xmax: lon + eps, ymax: lat + eps,
            spatialReference: { wkid: 4326 },
        }),
        geometryType: 'esriGeometryEnvelope',
        inSR: '4326', outSR: '4326',
        spatialRel: 'esriSpatialRelIntersects',
        outFields: 'OBJECTID,REF_FUNC_SPOORTAK_NAAM_LANG,ELEMENT_TYPE,HOOGTE_BEGIN,HOOGTE_EIND,M_SIGMATRAJECT_BEGIN,M_SIGMATRAJECT_EIND',
        returnGeometry: 'true',
        f: 'geojson',
        resultRecordCount: '50',
    });
    const res = await fetch(`${PRORAIL_URL}?${params}`);
    if (!res.ok) throw new Error(`ProRail HTTP ${res.status}`);
    const json = await res.json();
    const feats = json.features ?? [];
    if (feats.length === 0) return null;

    let best = null;
    for (const f of feats) {
        const geom = f.geometry;
        const lines = geom.type === 'MultiLineString' ? geom.coordinates : [geom.coordinates];
        for (const line of lines) {
            for (let i = 0; i + 1 < line.length; i++) {
                const [aLon, aLat] = line[i];
                const [bLon, bLat] = line[i + 1];
                const proj = projectOntoSegment(lat, lon, aLat, aLon, bLat, bLon);
                const d = distM(lat, lon, proj.lat, proj.lon);
                if (best == null || d < best.d) {
                    const props = f.properties ?? {};
                    const mTotal = (props.M_SIGMATRAJECT_EIND ?? 0) - (props.M_SIGMATRAJECT_BEGIN ?? 0);
                    // We don't know exact M along the segment without more info, so
                    // use t (fractional position along this geometry segment) as a
                    // proxy. For short rechtstanden this is fine for sanity check.
                    const hoogte = props.HOOGTE_BEGIN + (props.HOOGTE_EIND - props.HOOGTE_BEGIN) * proj.t;
                    best = {
                        d, hoogte,
                        elementType: props.ELEMENT_TYPE,
                        spoortak: props.REF_FUNC_SPOORTAK_NAAM_LANG,
                        beginH: props.HOOGTE_BEGIN, eindH: props.HOOGTE_EIND,
                        mTotal,
                    };
                }
            }
        }
    }
    return best;
}

function fmt(v, w = 7) {
    if (v == null || !Number.isFinite(v)) return '   —   '.padStart(w);
    return v.toFixed(2).padStart(w);
}

async function main() {
    const points = [...DEFAULT_POINTS, ...parseArgs()];
    console.log(`Comparing ${points.length} points\n`);
    console.log(
        'Locatie'.padEnd(28) + ' | ' +
        'seed_NAP'.padStart(8) + ' | ' +
        'prorail'.padStart(8) + ' | ' +
        'diff_m'.padStart(8) + ' | ' +
        'd_seed'.padStart(7) + ' | ' +
        'd_prr'.padStart(6) + ' | ' +
        'src'.padStart(6) + ' | ' +
        'spoortak / type'
    );
    console.log('-'.repeat(125));

    for (const p of points) {
        try {
            const [seed, prr] = await Promise.all([
                getSeedAtPoint(p.lat, p.lon),
                getProrailAtPoint(p.lat, p.lon),
            ]);
            const isSeeded = seed && seed.yEll !== 0;
            const diff = (isSeeded && prr) ? (prr.hoogte - seed.nap) : null;
            const tag = prr ? `${prr.spoortak} / ${prr.elementType}` : '—';
            console.log(
                p.name.padEnd(28) + ' | ' +
                fmt(seed?.nap, 8) + ' | ' +
                fmt(prr?.hoogte, 8) + ' | ' +
                fmt(diff, 8) + ' | ' +
                fmt(seed?.distM, 7) + ' | ' +
                fmt(prr?.d, 6) + ' | ' +
                (seed?.source ?? '—').padStart(6) + ' | ' +
                tag
            );
        } catch (e) {
            console.log(p.name.padEnd(28) + ' | ERROR: ' + e.message);
        }
    }
}

main().catch(e => { console.error(e); process.exit(1); });
