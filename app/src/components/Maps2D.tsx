import { useRef, useEffect, useState } from 'preact/hooks';
import maplibregl from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";

import { mapPosition, mapSize, mapSelected, initializeMapState } from '../store/maps';
import { trainLat, trainLon, trainFrontLat, trainFrontLon, trainBackLat, trainBackLon, updateTick, trainLatE7, cameraYawRelativeToTrain } from '../store/train';
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

type ResizeCorner = 'tl' | 'tr' | 'bl' | 'br' | null;

function clamp(value: number, min: number, max: number): number {
    return Math.max(min, Math.min(max, value));
}

function Maps2D() {
    const containerRef = useRef<HTMLDivElement | null>(null);
    const mapContainerRef = useRef<HTMLDivElement | null>(null);
    const mapRef = useRef<maplibregl.Map | null>(null);
    const indicatorRef = useRef<HTMLDivElement | null>(null);

    const [position, setPosition] = useState({ x: 100, y: 100 });
    const [size, setSize] = useState(200);
    const [selected, setSelected] = useState(false);
    const [ready, setReady] = useState(false);
    const [trainBearing, setTrainBearing] = useState(0);
    const [cameraYaw, setCameraYaw] = useState(0);
    const [mapLoaded, setMapLoaded] = useState(false);

    const dragState = useRef<{
        isDragging: boolean;
        isResizing: ResizeCorner;
        pointerId: number | null;
        startX: number;
        startY: number;
        startPosX: number;
        startPosY: number;
        startSize: number;
    }>({
        isDragging: false,
        isResizing: null,
        pointerId: null,
        startX: 0,
        startY: 0,
        startPosX: 0,
        startPosY: 0,
        startSize: 0,
    });

    // Track active pointers to detect multi-touch
    const activePointers = useRef<Set<number>>(new Set());

    // Clamp position to keep container within screen bounds
    const clampPosition = (x: number, y: number, sz: number) => {
        if (typeof window === 'undefined') return { x, y };
        const maxX = window.innerWidth - sz;
        const maxY = window.innerHeight - sz;
        return {
            x: clamp(x, 0, Math.max(0, maxX)),
            y: clamp(y, 0, Math.max(0, maxY)),
        };
    };

    // Initialize state from localStorage on mount and subscribe to signal changes
    useEffect(() => {
        initializeMapState();

        // Sync local state with signals
        setPosition({ x: mapPosition.value.x, y: mapPosition.value.y });
        setSize(mapSize.value);
        setSelected(mapSelected.value);

        // Subscribe to signal changes
        const unsubPosition = mapPosition.subscribe((val) => setPosition({ x: val.x, y: val.y }));
        const unsubSize = mapSize.subscribe((val) => {
            setSize(val);
            // Trigger map resize when size changes
            if (mapRef.current) {
                mapRef.current.resize();
            }
        });
        const unsubSelected = mapSelected.subscribe((val) => setSelected(val));

        // on resize, clamp position
        const handleWindowResize = () => {
            const clamped = clampPosition(mapPosition.value.x, mapPosition.value.y, mapSize.value);
            mapPosition.value = clamped;
            setPosition(clamped);
        };

        handleWindowResize();
        window.addEventListener('resize', handleWindowResize);
        setReady(true);

        return () => {
            unsubPosition();
            unsubSize();
            unsubSelected();
            window.removeEventListener('resize', handleWindowResize);
        };
    }, []);

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

    // Handle click outside to deselect
    useEffect(() => {
        const handlePointerDown = (e: PointerEvent) => {
            if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
                mapSelected.value = false;
            }
        };
        document.addEventListener('pointerdown', handlePointerDown);
        return () => document.removeEventListener('pointerdown', handlePointerDown);
    }, []);

    // Handle drag and resize pointer events
    useEffect(() => {
        const cancelDrag = () => {
            const capturedPointerId = dragState.current.pointerId;
            dragState.current.isDragging = false;
            dragState.current.isResizing = null;
            dragState.current.pointerId = null;
            // Release pointer capture so events flow to underlying canvas
            if (capturedPointerId !== null && containerRef.current) {
                try {
                    containerRef.current.releasePointerCapture(capturedPointerId);
                } catch (_) { /* ignore if already released */ }
            }
        };

        const handlePointerDown = (e: PointerEvent) => {
            activePointers.current.add(e.pointerId);
            // Cancel drag/resize if a second finger touches
            if (activePointers.current.size > 1) {
                cancelDrag();
            }
        };

        const handlePointerMove = (e: PointerEvent) => {
            const state = dragState.current;
            if (state.pointerId !== e.pointerId) return;
            // Cancel drag/resize if multi-touch detected
            if (activePointers.current.size > 1) {
                cancelDrag();
                return;
            }

            if (state.isDragging) {
                const dx = e.clientX - state.startX;
                const dy = e.clientY - state.startY;
                const newPos = clampPosition(
                    state.startPosX + dx,
                    state.startPosY + dy,
                    size
                );
                mapPosition.value = newPos;
            } else if (state.isResizing) {
                const dx = e.clientX - state.startX;
                const dy = e.clientY - state.startY;
                const corner = state.isResizing;

                // Calculate delta based on corner - drag direction determines growth
                let delta: number;
                if (corner === 'br') {
                    delta = (dx + dy) / 2;
                } else if (corner === 'bl') {
                    delta = (-dx + dy) / 2;
                } else if (corner === 'tr') {
                    delta = (dx - dy) / 2;
                } else {
                    delta = (-dx - dy) / 2;
                }

                const newSize = Math.max(MIN_SIZE, state.startSize + delta);
                const sizeDiff = newSize - state.startSize;

                let newX = state.startPosX;
                let newY = state.startPosY;

                // Adjust position for corners that resize from top or left
                if (corner === 'tl') {
                    newX = state.startPosX - sizeDiff;
                    newY = state.startPosY - sizeDiff;
                } else if (corner === 'tr') {
                    newY = state.startPosY - sizeDiff;
                } else if (corner === 'bl') {
                    newX = state.startPosX - sizeDiff;
                }

                // Clamp position
                const clamped = clampPosition(newX, newY, newSize);

                mapSize.value = newSize;
                mapPosition.value = clamped;
            }
        };

        const handlePointerUp = (e: PointerEvent) => {
            activePointers.current.delete(e.pointerId);

            if (dragState.current.pointerId !== e.pointerId) return;

            dragState.current.isDragging = false;
            dragState.current.isResizing = null;
            dragState.current.pointerId = null;
            if (mapRef.current) {
                mapRef.current.resize();
            }
        };

        // Use capture phase for pointerdown so we track pointers before container handler runs
        document.addEventListener('pointerdown', handlePointerDown, true);
        document.addEventListener('pointermove', handlePointerMove);
        document.addEventListener('pointerup', handlePointerUp);
        document.addEventListener('pointercancel', handlePointerUp);
        return () => {
            document.removeEventListener('pointerdown', handlePointerDown, true);
            document.removeEventListener('pointermove', handlePointerMove);
            document.removeEventListener('pointerup', handlePointerUp);
            document.removeEventListener('pointercancel', handlePointerUp);
        };
    }, [size]);

    const handleContainerPointerDown = (e: PointerEvent) => {
        const target = e.target as HTMLElement;
        // Check if clicking on a resize handle
        if (target.classList.contains(styles.resizeHandle) ||
            target.classList.contains(styles.handleTL) ||
            target.classList.contains(styles.handleTR) ||
            target.classList.contains(styles.handleBL) ||
            target.classList.contains(styles.handleBR)) {
            return;
        }

        // Don't start drag if multi-touch (let inner canvas handle it)
        if (activePointers.current.size > 1) {
            return;
        }

        e.preventDefault();
        e.stopPropagation();
        containerRef.current?.setPointerCapture(e.pointerId);
        mapSelected.value = true;
        dragState.current = {
            isDragging: true,
            isResizing: null,
            pointerId: e.pointerId,
            startX: e.clientX,
            startY: e.clientY,
            startPosX: position.x,
            startPosY: position.y,
            startSize: size,
        };
    };

    const handleResizePointerDown = (corner: ResizeCorner) => (e: PointerEvent) => {
        // Don't start resize if multi-touch
        if (activePointers.current.size > 1) {
            return;
        }

        e.preventDefault();
        e.stopPropagation();
        (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
        dragState.current = {
            isDragging: false,
            isResizing: corner,
            pointerId: e.pointerId,
            startX: e.clientX,
            startY: e.clientY,
            startPosX: position.x,
            startPosY: position.y,
            startSize: size,
        };
    };

    // Initialize MapLibre
    useEffect(() => {
        if (!mapContainerRef.current) return;

        const map = new maplibregl.Map({
            style: "https://tiles.openfreemap.org/styles/liberty",
            container: mapContainerRef.current,
            center: DEFAULT_CENTER,
            zoom: 18,
            minZoom: 10,
            maxZoom: 18,
            pitch: 0,
            bearing: 0,
            maxPitch: 0,
            interactive: true,
            attributionControl: false,
        });

        mapRef.current = map;

        // Disable native interactions except pinch-to-zoom and scroll zoom
        map.dragPan.disable();
        map.dragRotate.disable();
        map.keyboard.disable();
        map.doubleClickZoom.disable();
        map.touchZoomRotate.disableRotation();

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
        // Use capture phase to intercept wheel events before they reach other handlers
        mapContainerRef.current!.addEventListener('wheel', handleWheel, { passive: false, capture: true });

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

            const center = map.getCenter();
            if (e.key === "ArrowUp") {
                e.preventDefault();
                map.setCenter([center.lng, center.lat + 0.0005]);
            }
            if (e.key === "ArrowDown") {
                e.preventDefault();
                map.setCenter([center.lng, center.lat - 0.0005]);
            }
            if (e.key === "ArrowLeft") {
                e.preventDefault();
                map.setCenter([center.lng - 0.0005, center.lat]);
            }
            if (e.key === "ArrowRight") {
                e.preventDefault();
                map.setCenter([center.lng + 0.0005, center.lat]);
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
            map.remove();
            mapRef.current = null;
        };
    }, []);

    // Map container is always at least BASE_MAP_SIZE (200px)
    // When container is >= 200px, map fills it at scale 1
    // When container is < 200px, map stays at 200px but scales down
    const mapContainerSize = Math.max(size, BASE_MAP_SIZE);
    const scale = size < BASE_MAP_SIZE ? size / BASE_MAP_SIZE : 1;

    return (
        <div
            ref={containerRef}
            className={styles.container}
            style={{
                left: `${position.x}px`,
                top: `${position.y}px`,
                width: `${size}px`,
                height: `${size}px`,
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

            {selected && (
                <>
                    <div className={`${styles.resizeHandle} ${styles.handleTL}`} onPointerDown={handleResizePointerDown('tl')} />
                    <div className={`${styles.resizeHandle} ${styles.handleTR}`} onPointerDown={handleResizePointerDown('tr')} />
                    <div className={`${styles.resizeHandle} ${styles.handleBL}`} onPointerDown={handleResizePointerDown('bl')} />
                    <div className={`${styles.resizeHandle} ${styles.handleBR}`} onPointerDown={handleResizePointerDown('br')} />
                </>
            )}
        </div>
    );
}

export default Maps2D;
