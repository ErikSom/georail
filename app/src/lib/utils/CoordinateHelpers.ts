import { Vector3 } from 'three';
import { DEG2RAD } from 'three/src/math/MathUtils.js';
import type { MapViewer } from '../MapViewer';

// WGS84 ellipsoid constants for more accurate conversion
// These provide better precision than simple approximations
export const METERS_PER_DEGREE_LAT = 111319.49079327358; // More precise value at equator

export interface GeoCoords {
    lat: number;
    lon: number;
    height: number;
}

/**
 * Convert geographic coordinates difference to ENU (East-North-Up) offset in meters
 * @param geoCoords - Current geographic coordinates
 * @param origGeoCoords - Original/reference geographic coordinates
 * @returns Vector3 with X=East, Y=Up, Z=North in meters
 */
export function geoToENU(geoCoords: GeoCoords, origGeoCoords: GeoCoords): Vector3 {
    const metersPerDegreeLon = METERS_PER_DEGREE_LAT * Math.cos(origGeoCoords.lat * DEG2RAD);

    const east = (geoCoords.lon - origGeoCoords.lon) * metersPerDegreeLon;
    const north = (geoCoords.lat - origGeoCoords.lat) * METERS_PER_DEGREE_LAT;
    const up = geoCoords.height - origGeoCoords.height;

    return new Vector3(east, up, north);
}

/**
 * Apply ENU (East-North-Up) offset to geographic coordinates
 * @param origGeoCoords - Original geographic coordinates
 * @param offset - Vector3 with X=East, Y=Up, Z=North in meters
 * @param mapViewer - MapViewer instance to convert to world position
 * @returns World position as Vector3, or null if conversion fails
 */
export function applyENUOffset(
    origGeoCoords: GeoCoords,
    offset: Vector3,
    mapViewer: MapViewer
): Vector3 | null {
    const metersPerDegreeLon = METERS_PER_DEGREE_LAT * Math.cos(origGeoCoords.lat * DEG2RAD);

    const newLat = origGeoCoords.lat + (offset.z / METERS_PER_DEGREE_LAT);
    const newLon = origGeoCoords.lon + (offset.x / metersPerDegreeLon);
    const newHeight = origGeoCoords.height + offset.y;

    return mapViewer.latLonHeightToWorldPosition(newLat, newLon, newHeight);
}

/**
 * Parse route point data from array format to structured data
 * Route points are in format: [lon, lat, world_offset_x, world_offset_y, world_offset_z]
 * @param routePoint - Array containing longitude, latitude, and world offsets
 * @returns Structured object with coordinates and offset
 */
export function parseRoutePoint(routePoint: number[]): {
    lon: number;
    lat: number;
    worldOffset: Vector3;
} {
    const [lon, lat, world_offset_x, world_offset_y, world_offset_z] = routePoint;
    return {
        lon,
        lat,
        worldOffset: new Vector3(world_offset_x, world_offset_y, world_offset_z)
    };
}

/**
 * Convert route point to world position with offset applied
 * @param routePoint - Array containing [lon, lat, offset_x, offset_y, offset_z]
 * @param mapViewer - MapViewer instance for coordinate conversion
 * @returns World position with offset applied, or null if conversion fails
 */
export function routePointToWorldPosition(
    routePoint: number[],
    mapViewer: MapViewer
): Vector3 | null {
    const { lon, lat, worldOffset } = parseRoutePoint(routePoint);

    // Get base position at altitude 0
    const basePosition = mapViewer.latLonHeightToWorldPosition(lat, lon, 0);
    if (!basePosition) return null;

    // Get geographic coordinates of base position
    const baseGeoCoords = mapViewer.getLatLonHeightFromWorldPosition(basePosition);
    if (!baseGeoCoords) return null;

    // Apply ENU offset to get final position
    return applyENUOffset(baseGeoCoords, worldOffset, mapViewer);
}
