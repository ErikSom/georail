// Small geo helpers used by the live-train snap + interpolation pipeline.
// All inputs are WGS84 lon/lat in degrees; all distances are returned in
// meters (geodesic-quality, equirectangular approximation — accurate to
// well under 1 m over the few-hundred-meter spans we actually care about).

export interface LonLat {
    lon: number;
    lat: number;
}

const EARTH_RADIUS_M = 6_371_000;
const DEG2RAD = Math.PI / 180;
const RAD2DEG = 180 / Math.PI;

export function metersPerDegreeLon(lat: number): number {
    return Math.cos(lat * DEG2RAD) * 111_320;
}

export function metersPerDegreeLat(): number {
    return 111_320;
}

export function haversineDistanceM(a: LonLat, b: LonLat): number {
    const lat1 = a.lat * DEG2RAD;
    const lat2 = b.lat * DEG2RAD;
    const dLat = (b.lat - a.lat) * DEG2RAD;
    const dLon = (b.lon - a.lon) * DEG2RAD;
    const sinDLat = Math.sin(dLat / 2);
    const sinDLon = Math.sin(dLon / 2);
    const h = sinDLat * sinDLat + Math.cos(lat1) * Math.cos(lat2) * sinDLon * sinDLon;
    return 2 * EARTH_RADIUS_M * Math.atan2(Math.sqrt(h), Math.sqrt(Math.max(0, 1 - h)));
}

export function bearingDeg(a: LonLat, b: LonLat): number {
    const lat1 = a.lat * DEG2RAD;
    const lat2 = b.lat * DEG2RAD;
    const dLon = (b.lon - a.lon) * DEG2RAD;
    const y = Math.sin(dLon) * Math.cos(lat2);
    const x = Math.cos(lat1) * Math.sin(lat2) - Math.sin(lat1) * Math.cos(lat2) * Math.cos(dLon);
    const deg = Math.atan2(y, x) * RAD2DEG;
    return ((deg % 360) + 360) % 360;
}

export interface SegmentProjection {
    lon: number;            // snapped point lon
    lat: number;            // snapped point lat
    distanceM: number;      // perpendicular distance from raw point to segment
    fraction: number;       // 0..1 along this 2-vertex segment
}

// Project `point` onto the line segment from `a` to `b`. Returns the foot
// of the perpendicular (clamped to the segment), distance in meters, and
// the fractional position along the segment.
export function projectPointOntoSegment(point: LonLat, a: LonLat, b: LonLat): SegmentProjection {
    const refLat = (a.lat + b.lat) * 0.5;
    const mLon = metersPerDegreeLon(refLat);
    const mLat = metersPerDegreeLat();
    const ax = a.lon * mLon, ay = a.lat * mLat;
    const bx = b.lon * mLon, by = b.lat * mLat;
    const px = point.lon * mLon, py = point.lat * mLat;
    const dx = bx - ax, dy = by - ay;
    const len2 = dx * dx + dy * dy;
    let t = len2 > 0 ? ((px - ax) * dx + (py - ay) * dy) / len2 : 0;
    t = Math.max(0, Math.min(1, t));
    const fx = ax + t * dx, fy = ay + t * dy;
    const ddx = px - fx, ddy = py - fy;
    return {
        lon: a.lon + t * (b.lon - a.lon),
        lat: a.lat + t * (b.lat - a.lat),
        distanceM: Math.sqrt(ddx * ddx + ddy * ddy),
        fraction: t,
    };
}

export interface PolylineProjection {
    lon: number;
    lat: number;
    distanceM: number;
    segmentIndex: number;   // which polyline edge (0 = between geom[0] and geom[1])
    fraction: number;       // 0..1 along the entire polyline
    bearing: number;        // bearing of the edge at the snap point
}

// Project `point` onto a polyline, returning the closest point on it.
// `geom` is the vertex list, oldest at index 0.
export function projectPointOntoPolyline(point: LonLat, geom: LonLat[]): PolylineProjection | null {
    if (!Array.isArray(geom) || geom.length < 2) return null;

    let best: SegmentProjection | null = null;
    let bestIndex = -1;
    const edgeLengths: number[] = [];
    let totalLength = 0;

    for (let i = 0; i < geom.length - 1; i++) {
        const a = geom[i];
        const b = geom[i + 1];
        const edgeLen = haversineDistanceM(a, b);
        edgeLengths.push(edgeLen);
        totalLength += edgeLen;
        const proj = projectPointOntoSegment(point, a, b);
        if (!best || proj.distanceM < best.distanceM) {
            best = proj;
            bestIndex = i;
        }
    }

    if (!best || bestIndex < 0) return null;

    let distanceAlong = 0;
    for (let i = 0; i < bestIndex; i++) distanceAlong += edgeLengths[i];
    distanceAlong += edgeLengths[bestIndex] * best.fraction;
    const fraction = totalLength > 0 ? distanceAlong / totalLength : 0;

    return {
        lon: best.lon,
        lat: best.lat,
        distanceM: best.distanceM,
        segmentIndex: bestIndex,
        fraction,
        bearing: bearingDeg(geom[bestIndex], geom[bestIndex + 1]),
    };
}

// Sample a polyline at a given fractional position 0..1, returning lon/lat
// and the bearing of the edge containing that point.
export function samplePolylineAt(geom: LonLat[], fraction: number): { lon: number; lat: number; bearing: number } | null {
    if (!Array.isArray(geom) || geom.length < 2) return null;
    const f = Math.max(0, Math.min(1, fraction));
    const edgeLengths: number[] = [];
    let total = 0;
    for (let i = 0; i < geom.length - 1; i++) {
        const len = haversineDistanceM(geom[i], geom[i + 1]);
        edgeLengths.push(len);
        total += len;
    }
    if (total <= 0) return { lon: geom[0].lon, lat: geom[0].lat, bearing: 0 };
    const target = f * total;
    let accumulated = 0;
    for (let i = 0; i < edgeLengths.length; i++) {
        const next = accumulated + edgeLengths[i];
        if (target <= next || i === edgeLengths.length - 1) {
            const local = edgeLengths[i] > 0 ? (target - accumulated) / edgeLengths[i] : 0;
            const a = geom[i], b = geom[i + 1];
            return {
                lon: a.lon + local * (b.lon - a.lon),
                lat: a.lat + local * (b.lat - a.lat),
                bearing: bearingDeg(a, b),
            };
        }
        accumulated = next;
    }
    const last = geom[geom.length - 1];
    return { lon: last.lon, lat: last.lat, bearing: 0 };
}

// Quick chunk-cell helper. Cell indexes are lon×10 and lat×10 (so a cell
// at (51, 520) covers lon ∈ [5.1, 5.2) and lat ∈ [52.0, 52.1)).
export const CELL_SCALE = 10;

export function cellForPoint(lon: number, lat: number): { lon: number; lat: number } {
    return { lon: Math.floor(lon * CELL_SCALE), lat: Math.floor(lat * CELL_SCALE) };
}

export function cellsCoveringBBox(lonMin: number, latMin: number, lonMax: number, latMax: number): Array<{ lon: number; lat: number }> {
    const out: Array<{ lon: number; lat: number }> = [];
    const lonStart = Math.floor(lonMin * CELL_SCALE);
    const lonEnd = Math.floor(lonMax * CELL_SCALE);
    const latStart = Math.floor(latMin * CELL_SCALE);
    const latEnd = Math.floor(latMax * CELL_SCALE);
    for (let lat = latStart; lat <= latEnd; lat++) {
        for (let lon = lonStart; lon <= lonEnd; lon++) {
            out.push({ lon, lat });
        }
    }
    return out;
}
