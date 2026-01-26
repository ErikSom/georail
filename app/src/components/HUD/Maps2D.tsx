import { useRef, useEffect, useState } from 'preact/hooks';
import type { CSSProperties } from 'preact';
import maplibregl from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";

import { useTransformable } from '../../hooks/useTransformable';
import { trainLat, trainLon, trainFrontLat, trainFrontLon, trainBackLat, trainBackLon, updateTick, trainLatE7, cameraYawRelativeToTrain } from '../../store/train';
import styles from './Maps2D.module.css';

const DEFAULT_CENTER: [number, number] = [0, 0]; // Will be updated when train position is available
const MIN_SIZE = 100; // Container can go down to 100px
const BASE_MAP_SIZE = 200; // The internal map renders at this size and scales

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
    // Normalize to 0-360
    if (bearing < 0) bearing += 360;
    return bearing;
}

function Maps2D() {
    const mapContainerRef = useRef<HTMLDivElement | null>(null);
    const mapRef = useRef<maplibregl.Map | null>(null);
    const indicatorRef = useRef<HTMLDivElement | null>(null);

    const [trainBearing, setTrainBearing] = useState(0);
    const [cameraYaw, setCameraYaw] = useState(0);
    const [mapLoaded, setMapLoaded] = useState(false);

    const {
        position,
        size,
        ready,
        containerRef,
        handleContainerPointerDown,
        renderResizeHandles,
    } = useTransformable({
        initialPosition: { x: 100, y: 100 },
        initialSize: 200,
        minSize: MIN_SIZE,
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

    // Subscribe to train position and bearing updates
    useEffect(() => {
        if (!mapLoaded) return;

        let initialCenterSet = false;

        // Watch for when train coordinates first become valid
        const unsubLatE7 = trainLatE7.subscribe((latE7) => {
            if (!initialCenterSet && latE7 !== 0 && mapRef.current) {
                const lat = trainLat.value;
                const lon = trainLon.value;
                mapRef.current.setCenter([lon, lat]);
                // Calculate bearing from back to front of train
                const newBearing = calculateBearing(
                    trainBackLat.value, trainBackLon.value,
                    trainFrontLat.value, trainFrontLon.value
                );
                setTrainBearing(newBearing);
                setCameraYaw(cameraYawRelativeToTrain.value);
                // Rotate map to match camera view
                mapRef.current.setBearing(-cameraYawRelativeToTrain.value);
                initialCenterSet = true;
            }
        });

        // Check immediately in case coordinates are already valid
        const initialLat = trainLat.value;
        const initialLon = trainLon.value;
        if ((initialLat !== 0 || initialLon !== 0) && mapRef.current) {
            mapRef.current.setCenter([initialLon, initialLat]);
            const newBearing = calculateBearing(
                trainBackLat.value, trainBackLon.value,
                trainFrontLat.value, trainFrontLon.value
            );
            setTrainBearing(newBearing);
            setCameraYaw(cameraYawRelativeToTrain.value);
            mapRef.current.setBearing(-cameraYawRelativeToTrain.value);
            initialCenterSet = true;
        }

        // Continue updating on each tick
        const unsubTick = updateTick.subscribe(() => {
            const lat = trainLat.value;
            const lon = trainLon.value;

            if ((lat !== 0 || lon !== 0) && mapRef.current) {
                mapRef.current.setCenter([lon, lat]);
            }

            // Calculate bearing from back to front of train
            const newBearing = calculateBearing(
                trainBackLat.value, trainBackLon.value,
                trainFrontLat.value, trainFrontLon.value
            );
            setTrainBearing(newBearing);
            setCameraYaw(cameraYawRelativeToTrain.value);
            // Rotate map to match camera view
            if (mapRef.current) {
                mapRef.current.setBearing(-cameraYawRelativeToTrain.value);
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
            zoom: 16,
            minZoom: 10,
            maxZoom: 18,
            pitch: 0,
            bearing: 0,
            maxPitch: 0,
            interactive: false,
            attributionControl: false,
        });

        // const nav = new maplibregl.NavigationControl({ showCompass: true, showZoom: false });
        // map.addControl(nav, 'top-right');

        mapRef.current = map;

        const canvas = map.getCanvas();
        const handleCanvasFocus = () => canvas.blur();

        // Custom wheel zoom handler (since native scrollZoom may be blocked)
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
                // Convert scale to zoom delta (log scale feels more natural)
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

    // Map container is always at least BASE_MAP_SIZE (200px)
    // When container is >= 200px, map fills it at scale 1
    // When container is < 200px, map stays at 200px but scales down
    const currentSize = size ?? BASE_MAP_SIZE;
    const mapContainerSize = Math.max(currentSize, BASE_MAP_SIZE);
    const scale = currentSize < BASE_MAP_SIZE ? currentSize / BASE_MAP_SIZE : 1;

    return (
        <div
            ref={containerRef}
            className={styles.container}
            style={{
                left: `${position.x}px`,
                top: `${position.y}px`,
                width: `${currentSize}px`,
                height: `${currentSize}px`,
                visibility: ready ? 'visible' : 'hidden',
            }}
            onPointerDown={handleContainerPointerDown}
        >
            <div
                ref={mapContainerRef}
                className={styles.mapContainer}
                style={{
                    width: `${mapContainerSize}px`,
                    height: `${mapContainerSize}px`,
                    transform: scale < 1 ? `scale(${scale})` : undefined,
                    borderRadius: scale < 1 ? `${16 / scale}px` : undefined,
                }}
            />

            <div
                ref={indicatorRef}
                className={styles.indicator}
                style={{ transform: `translate(-50%, -50%) rotate(${trainBearing + cameraYaw}deg)` }}
            />


            <div className={styles.compass}
                style={{ '--rotation': `${-cameraYaw}deg` } as CSSProperties}
            >
                <div className={styles.compassNeedle}></div>
            </div>

            {renderResizeHandles()}
        </div>
    );
}

export default Maps2D;
