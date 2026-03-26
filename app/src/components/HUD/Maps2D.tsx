import { useRef, useEffect, useState } from 'preact/hooks';
import maplibregl from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";

import { useTransformable } from '../../hooks/useTransformable';
import { trainLat, trainLon, trainFrontLat, trainFrontLon, trainBackLat, trainBackLon, updateTick, trainLatE7, cameraYawRelativeToTrain, trainDistanceTraveled, trainConsist } from '../../store/train';
import { isSmallScreen, screenWidth } from '../../store/globals';
import { routeData } from '../../store/journey';
import { trainPath } from '../../store/journey';
import styles from './Maps2D.module.css';

const DEFAULT_CENTER: [number, number] = [0, 0];
const MIN_SIZE = 100;
const BASE_MAP_SIZE = 200;

// Min/max pixel size for each car icon on the map
const MIN_CAR_ICON_PX = 6;
const MAX_CAR_ICON_PX = 200;

/**
 * Calculate bearing (in degrees) from point 1 to point 2 using lat/lon coordinates.
 * Returns bearing in degrees where 0 = north, 90 = east, 180 = south, 270 = west.
 */
function calculateBearing(lat1: number, lon1: number, lat2: number, lon2: number): number {
    const toRad = Math.PI / 180;
    const toDeg = 180 / Math.PI;

    const dLon = (lon2 - lon1) * toRad;
    const lat1Rad = lat1 * toRad;
    const lat2Rad = lat2 * toRad;

    const x = Math.sin(dLon) * Math.cos(lat2Rad);
    const y = Math.cos(lat1Rad) * Math.sin(lat2Rad) - Math.sin(lat1Rad) * Math.cos(lat2Rad) * Math.cos(dLon);

    let bearing = Math.atan2(x, y) * toDeg + 90;
    if (bearing < 0) bearing += 360;
    return bearing;
}


/**
 * Route distance lookup: maps 3D path distance → lat/lon via route geometry point indices.
 * Both the route geometry and the 3D Path share the same point indices.
 */
interface RouteLookupEntry {
    distance: number; // meters along the 3D path
    lon: number;
    lat: number;
}

function buildRouteLookup(route: number[][], path: { getDistanceAtPointIndex: (i: number) => number; getTotalLength: () => number }): RouteLookupEntry[] {
    const entries: RouteLookupEntry[] = [];
    for (let i = 0; i < route.length; i++) {
        entries.push({
            distance: path.getDistanceAtPointIndex(i),
            lon: route[i][0],
            lat: route[i][1],
        });
    }
    return entries;
}

/**
 * Interpolate lat/lon at a given distance along the route lookup.
 * Writes into `out` to avoid per-frame object allocations.
 */
function interpolateAtDistance(lookup: RouteLookupEntry[], distance: number, out: { lat: number; lon: number }): void {
    if (lookup.length === 0) { out.lat = 0; out.lon = 0; return; }
    if (lookup.length === 1) { out.lat = lookup[0].lat; out.lon = lookup[0].lon; return; }

    // Extrapolate before start
    if (distance <= lookup[0].distance) {
        const a = lookup[0];
        const b = lookup[1];
        const segLen = b.distance - a.distance;
        if (segLen <= 0) { out.lat = a.lat; out.lon = a.lon; return; }
        const t = (distance - a.distance) / segLen;
        out.lat = a.lat + (b.lat - a.lat) * t;
        out.lon = a.lon + (b.lon - a.lon) * t;
        return;
    }

    // Extrapolate past end
    if (distance >= lookup[lookup.length - 1].distance) {
        const a = lookup[lookup.length - 2];
        const b = lookup[lookup.length - 1];
        const segLen = b.distance - a.distance;
        if (segLen <= 0) { out.lat = b.lat; out.lon = b.lon; return; }
        const t = (distance - a.distance) / segLen;
        out.lat = a.lat + (b.lat - a.lat) * t;
        out.lon = a.lon + (b.lon - a.lon) * t;
        return;
    }

    // Binary search for segment
    let lo = 0, hi = lookup.length - 2;
    while (lo <= hi) {
        const mid = (lo + hi) >>> 1;
        if (lookup[mid + 1].distance < distance) lo = mid + 1;
        else if (lookup[mid].distance > distance) hi = mid - 1;
        else { lo = mid; break; }
    }
    if (lo > lookup.length - 2) lo = lookup.length - 2;

    const a = lookup[lo];
    const b = lookup[lo + 1];
    const segLen = b.distance - a.distance;
    const t = segLen > 0 ? (distance - a.distance) / segLen : 0;
    out.lat = a.lat + (b.lat - a.lat) * t;
    out.lon = a.lon + (b.lon - a.lon) * t;
}

// Pre-allocated reusable objects for per-frame calculations
const _front = { lat: 0, lon: 0 };
const _back = { lat: 0, lon: 0 };

interface CarRenderData {
    type: 'cab' | 'wagon' | 'rearCab';
    cx: number; // screen x
    cy: number; // screen y
    bearing: number; // degrees
    sizePx: number; // pixel size scaled to zoom
}

function Maps2D() {
    const mapContainerRef = useRef<HTMLDivElement | null>(null);
    const mapRef = useRef<maplibregl.Map | null>(null);

    const [mapLoaded, setMapLoaded] = useState(false);

    const [northUp, setNorthUp] = useState(false);

    // Use refs instead of state for per-frame values to avoid 60fps re-renders
    const trainBearingRef = useRef(0);
    const cameraYawRef = useRef(0);
    const carRendersRef = useRef<CarRenderData[]>([]);
    const carDivsRef = useRef<HTMLDivElement | null>(null);
    const compassRef = useRef<HTMLDivElement | null>(null);
    const fallbackIconRef = useRef<HTMLDivElement | null>(null);
    const northUpRef = useRef(false);

    // Route lookup table — rebuilt when route/path changes
    const routeLookupRef = useRef<RouteLookupEntry[]>([]);

    const {
        position,
        size,
        ready,
        containerRef,
        handleContainerPointerDown,
        renderResizeHandles,
    } = useTransformable({
        initialPosition: isSmallScreen
            ? { x: screenWidth() - 10, y: 10 }
            : { x: screenWidth() - 10, y: 10 },
        initialSize: isSmallScreen
            ? { width: 100, height: 100 }
            : { width: 200, height: 200 },
        minSize: { width: MIN_SIZE, height: MIN_SIZE },
        keepAspectRatio: false,
        storageKey: 'georail_map2d_state',
        onSizeChange: () => {
            if (mapRef.current) {
                mapRef.current.resize();
            }
        },
        onResizeEnd: () => {
            if (mapRef.current) {
                mapRef.current.resize();
            }
        },
    });

    // Resize map when size changes
    useEffect(() => {
        if (mapRef.current) {
            mapRef.current.resize();
        }
    }, [size]);

    // Build route lookup when route data or path changes
    useEffect(() => {
        const route = routeData.value;
        const path = trainPath.value;
        if (route?.geometry?.route && path) {
            routeLookupRef.current = buildRouteLookup(route.geometry.route, path);
        } else {
            routeLookupRef.current = [];
        }

        // Re-subscribe on signal changes
        const unsubRoute = routeData.subscribe(() => {
            const r = routeData.value;
            const p = trainPath.value;
            if (r?.geometry?.route && p) {
                routeLookupRef.current = buildRouteLookup(r.geometry.route, p);
            } else {
                routeLookupRef.current = [];
            }
        });
        const unsubPath = trainPath.subscribe(() => {
            const r = routeData.value;
            const p = trainPath.value;
            if (r?.geometry?.route && p) {
                routeLookupRef.current = buildRouteLookup(r.geometry.route, p);
            } else {
                routeLookupRef.current = [];
            }
        });

        return () => {
            unsubRoute();
            unsubPath();
        };
    }, []);

    // Subscribe to train position and bearing updates
    useEffect(() => {
        if (!mapLoaded) return;

        let initialCenterSet = false;

        const applyMapPosition = (map: maplibregl.Map, lat: number, lon: number) => {
            const yaw = cameraYawRelativeToTrain.value;
            const bearing = calculateBearing(
                trainBackLat.value, trainBackLon.value,
                trainFrontLat.value, trainFrontLon.value
            );
            trainBearingRef.current = bearing;
            cameraYawRef.current = yaw;
            const mapBearing = northUpRef.current ? 0 : -(bearing + yaw);
            map.jumpTo({ center: [lon, lat], bearing: mapBearing });
        };

        const unsubLatE7 = trainLatE7.subscribe((latE7) => {
            if (!initialCenterSet && latE7 !== 0 && mapRef.current) {
                applyMapPosition(mapRef.current, trainLat.value, trainLon.value);
                initialCenterSet = true;
            }
        });

        const initialLat = trainLat.value;
        const initialLon = trainLon.value;
        if ((initialLat !== 0 || initialLon !== 0) && mapRef.current) {
            applyMapPosition(mapRef.current, initialLat, initialLon);
            initialCenterSet = true;
        }

        // Update on each tick — direct DOM manipulation, no setState
        const unsubTick = updateTick.subscribe(() => {
            const lat = trainLat.value;
            const lon = trainLon.value;
            const map = mapRef.current;

            if (!map) return;

            // Update map position + bearing in one call
            const yaw = cameraYawRelativeToTrain.value;
            const bearing = calculateBearing(
                trainBackLat.value, trainBackLon.value,
                trainFrontLat.value, trainFrontLon.value
            );
            trainBearingRef.current = bearing;
            cameraYawRef.current = yaw;

            const mapBearing = northUpRef.current ? 0 : -yaw;

            if (lat !== 0 || lon !== 0) {
                map.jumpTo({ center: [lon, lat], bearing: mapBearing });
            }

            // Update compass via direct DOM
            if (compassRef.current) {
                compassRef.current.style.setProperty('--rotation', `${northUpRef.current ? 0 : -yaw}deg`);
            }

            // Compute car positions
            const lookup = routeLookupRef.current;
            const consist = trainConsist.value;
            const container = carDivsRef.current;
            if (!container) return;

            if (lookup.length === 0 || consist.length === 0) {
                // Show fallback icon
                container.style.display = 'none';
                if (fallbackIconRef.current) {
                    fallbackIconRef.current.style.display = '';
                    const iconRotation = bearing - mapBearing;
                    fallbackIconRef.current.style.transform = `translate(-50%, -50%) rotate(${iconRotation}deg)`;
                }
                return;
            }

            // Hide fallback, show car container
            if (fallbackIconRef.current) fallbackIconRef.current.style.display = 'none';
            container.style.display = '';

            const distanceTraveled = trainDistanceTraveled.value;

            // Compute total real length of consist in meters
            let totalRealMeters = 0;
            for (let i = 0; i < consist.length; i++) totalRealMeters += consist[i].length;

            // Center the consist around the train center (distanceTraveled)
            const clusterFront = distanceTraveled + totalRealMeters / 2;

            // Ensure we have the right number of child divs
            while (container.children.length < consist.length) {
                container.appendChild(document.createElement('div'));
            }
            while (container.children.length > consist.length) {
                container.removeChild(container.lastChild!);
            }

            let cursor = clusterFront;

            for (let i = 0; i < consist.length; i++) {
                const car = consist[i];
                const carFrontDist = cursor;
                const carBackDist = cursor - car.length;

                interpolateAtDistance(lookup, carFrontDist, _front);
                interpolateAtDistance(lookup, carBackDist, _back);
                const frontPx = map.project([_front.lon, _front.lat]);
                const backPx = map.project([_back.lon, _back.lat]);

                const cx = (frontPx.x + backPx.x) / 2;
                const cy = (frontPx.y + backPx.y) / 2;
                const dx = frontPx.x - backPx.x;
                const dy = frontPx.y - backPx.y;
                const carBearing = Math.atan2(dx, -dy) * (180 / Math.PI) + 90;
                const screenDist = Math.sqrt(dx * dx + dy * dy);
                const sizePx = Math.max(MIN_CAR_ICON_PX, Math.min(MAX_CAR_ICON_PX, screenDist));

                const rotation = car.type === 'rearCab' ? carBearing + 180 : carBearing;

                const div = container.children[i] as HTMLDivElement;
                div.className = car.type === 'cab' ? styles.cabIcon
                    : car.type === 'rearCab' ? styles.rearCabIcon
                        : styles.wagonIcon;
                div.style.left = `${cx}px`;
                div.style.top = `${cy}px`;
                div.style.width = `${sizePx}px`;
                div.style.height = `${sizePx}px`;
                div.style.transform = `translate(-50%, -50%) rotate(${rotation}deg)`;

                cursor = carBackDist;
            }
        });

        return () => {
            unsubLatE7();
            unsubTick();
        };
    }, [mapLoaded]);


    // Initialize MapLibre
    useEffect(() => {
        if (!mapContainerRef.current) return;

        const map = new maplibregl.Map({
            style: "https://tiles.openfreemap.org/styles/liberty",
            container: mapContainerRef.current,
            center: DEFAULT_CENTER,
            zoom: 15,
            minZoom: 10,
            maxZoom: 18,
            pitch: 0,
            bearing: 0,
            maxPitch: 0,
            interactive: false,
            attributionControl: false,
        });

        mapRef.current = map;

        const canvas = map.getCanvas();
        const handleCanvasFocus = () => canvas.blur();

        // Custom wheel zoom handler
        const handleWheel = (e: WheelEvent) => {
            e.preventDefault();
            e.stopPropagation();
            const delta = -e.deltaY * 0.01;
            const currentZoom = map.getZoom();
            const newZoom = Math.max(map.getMinZoom(), Math.min(map.getMaxZoom(), currentZoom + delta));
            map.setZoom(newZoom);
        };
        mapContainerRef.current!.addEventListener('wheel', handleWheel, { passive: false, capture: true });

        // Custom pinch-to-zoom handler
        let initialPinchDistance: number | null = null;
        let initialZoom: number | null = null;

        const getDistance = (touches: TouchList) => {
            const dx = touches[0].clientX - touches[1].clientX;
            const dy = touches[0].clientY - touches[1].clientY;
            return Math.sqrt(dx * dx + dy * dy);
        };

        const handleTouchStart = (e: TouchEvent) => {
            if (e.touches.length === 2) {
                e.preventDefault();
                initialPinchDistance = getDistance(e.touches);
                initialZoom = map.getZoom();
            }
        };

        const handleTouchMove = (e: TouchEvent) => {
            if (e.touches.length === 2 && initialPinchDistance !== null && initialZoom !== null) {
                e.preventDefault();
                const currentDistance = getDistance(e.touches);
                const scale = currentDistance / initialPinchDistance;
                const zoomDelta = Math.log2(scale);
                const newZoom = Math.max(map.getMinZoom(), Math.min(map.getMaxZoom(), initialZoom + zoomDelta));
                map.setZoom(newZoom);
            }
        };

        const handleTouchEnd = (e: TouchEvent) => {
            if (e.touches.length < 2) {
                initialPinchDistance = null;
                initialZoom = null;
            }
        };

        mapContainerRef.current!.addEventListener('touchstart', handleTouchStart, { passive: false });
        mapContainerRef.current!.addEventListener('touchmove', handleTouchMove, { passive: false });
        mapContainerRef.current!.addEventListener('touchend', handleTouchEnd);

        // Custom keyboard controls
        const step = 0.5;
        const handleKeyDown = (e: KeyboardEvent) => {
            const tag = (e.target as HTMLElement | null)?.tagName?.toLowerCase?.() ?? "";
            if (tag === "input" || tag === "textarea") return;

            if (e.key === "-" || e.key === "_") {
                e.preventDefault();
                const z = Math.max(map.getMinZoom(), map.getZoom() - step);
                map.setZoom(z);
            }

            if (e.key === "+" || e.key === "=") {
                e.preventDefault();
                const z = Math.min(map.getMaxZoom(), map.getZoom() + step);
                map.setZoom(z);
            }
        };

        window.addEventListener("keydown", handleKeyDown);

        map.on("load", async () => {
            const layers = map.getStyle().layers || [];
            for (const layer of layers) {
                if (layer.type === "fill-extrusion") {
                    map.setLayoutProperty(layer.id, "visibility", "none");
                    continue;
                }

                const srcLayer = String((layer as any)["source-layer"] || "").toLowerCase();
                const id = String(layer.id || "").toLowerCase();

                const keep = srcLayer.includes("place") || id.includes("place");
                const hide =
                    srcLayer.includes("poi") ||
                    id.includes("poi") ||
                    srcLayer.includes("amenity") ||
                    id.includes("amenity") ||
                    id.includes("restaurant") ||
                    srcLayer.includes("shop") ||
                    id.includes("airport");

                if (layer.type === "symbol" && hide && !keep) {
                    map.setLayoutProperty(layer.id, "visibility", "none");
                }
            }

            setMapLoaded(true);
        });

        return () => {
            window.removeEventListener("keydown", handleKeyDown);
            canvas.removeEventListener("focus", handleCanvasFocus);
            mapContainerRef.current?.removeEventListener("wheel", handleWheel, { capture: true });
            mapContainerRef.current?.removeEventListener("touchstart", handleTouchStart);
            mapContainerRef.current?.removeEventListener("touchmove", handleTouchMove);
            mapContainerRef.current?.removeEventListener("touchend", handleTouchEnd);
            map.remove();
            mapRef.current = null;
        };
    }, []);

    const toggleNorthUp = (e: Event) => {
        e.stopPropagation();
        setNorthUp(prev => {
            const next = !prev;
            northUpRef.current = next;
            return next;
        });
    };

    const currentWidth = size?.width ?? BASE_MAP_SIZE;
    const currentHeight = size?.height ?? BASE_MAP_SIZE;

    return (
        <div
            ref={containerRef}
            className={styles.container}
            style={{
                left: `${position.x}px`,
                top: `${position.y}px`,
                width: `${currentWidth}px`,
                height: `${currentHeight}px`,
                visibility: ready ? 'visible' : 'hidden',
                '--train-icon-size': `18px`,
            }}
            onPointerDown={handleContainerPointerDown}
        >
            <div className={styles.mapContainer} style={{ width: `${currentWidth}px`, height: `${currentHeight}px` }}>
                <div
                    ref={mapContainerRef}
                    style={{ width: '100%', height: '100%' }}
                />

                {/* Car divs managed via direct DOM manipulation in tick handler */}
                <div ref={carDivsRef} />
                <div ref={fallbackIconRef} className={styles.cabIcon}
                    style={{ transform: 'translate(-50%, -50%)' }}
                />

                <div className={styles.compassHitArea} onPointerDown={toggleNorthUp}>
                    <div
                        ref={compassRef}
                        className={`${styles.compass} ${northUp ? styles.compassNorthUp : ''}`}
                    >
                        <span className={styles.compassLabel}>N</span>
                        <div className={styles.compassNeedle}></div>
                    </div>
                </div>
            </div>

            {renderResizeHandles()}
        </div>
    );
}

export default Maps2D;
