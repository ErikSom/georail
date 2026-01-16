import { useRef, useEffect } from 'preact/hooks';
import maplibregl from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";

import styles from './Maps2D.module.css';

const HOORN: [number, number] = [5.0597, 52.6424];
const AMSTERDAM: [number, number] = [4.9041, 52.3676];

console.log('dafuqqq')

function Maps2D() {
    const containerRef = useRef<HTMLDivElement | null>(null);
    const mapContainerRef = useRef<HTMLDivElement | null>(null);
    const mapRef = useRef<maplibregl.Map | null>(null);

    console.log("Maps2D Rendered...", containerRef.current, mapContainerRef.current);

    useEffect(() => {
        console.log("Initializing 2D Map...", containerRef.current, mapContainerRef.current);
        if (!containerRef.current || !mapContainerRef.current) return;

        // 1. Initialize Map
        const map = new maplibregl.Map({
            style: "https://tiles.openfreemap.org/styles/liberty",
            container: mapContainerRef.current,
            center: HOORN,
            zoom: 18,
            minZoom: 10,
            maxZoom: 18,
            pitch: 0,
            bearing: 0,
            maxPitch: 0,
            interactive: true,
            attributionControl: false, // Hide default
        });

        mapRef.current = map;

        // 2. Add Custom Attribution
        const attribution = new maplibregl.AttributionControl({ compact: true });
        map.addControl(attribution, "bottom-right");

        // Expose attribution to window for debugging if needed (TypeScript cast required)
        (window as any).attribution = attribution;

        // 3. Disable Interactions
        map.boxZoom.disable();
        map.dragPan.disable();
        map.dragRotate.disable();
        map.keyboard.disable();
        map.doubleClickZoom.disable();
        map.touchZoomRotate.disable();

        // 4. Remove Canvas Focus Border
        const canvas = map.getCanvas();
        const handleCanvasFocus = () => canvas.blur();
        canvas.addEventListener("focus", handleCanvasFocus);

        // 5. Custom Keydown Logic
        const step = 0.5;
        const handleKeyDown = (e: KeyboardEvent) => {
            const tag = (e.target as HTMLElement | null)?.tagName?.toLowerCase?.() ?? "";
            if (tag === "input" || tag === "textarea") return;

            // Zoom
            if (e.key === "-" || e.key === "_") {
                e.preventDefault();
                const z = Math.max(map.getMinZoom(), map.getZoom() - step);
                map.setZoom(z);
                console.log("Zoom:", z);
            }

            if (e.key === "+" || e.key === "=") {
                e.preventDefault();
                const z = Math.min(map.getMaxZoom(), map.getZoom() + step);
                map.setZoom(z);
                console.log("Zoom:", z);
            }

            // Pan (Arrow keys)
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
        map.on("zoomend", () => console.log("Zoomend:", map.getZoom()));

        // 6. On Load Logic (Hiding Layers)
        map.on("load", async () => {
            // Toggle attribution programmatically (using private method as per original code)
            // @ts-ignore
            if (attribution._toggleAttribution) attribution._toggleAttribution();

            // Hide 3D buildings + POIs
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

            console.log("Map Loaded. Zoom:", map.getZoom());
        });

        return () => {
            window.removeEventListener("keydown", handleKeyDown);
            canvas.removeEventListener("focus", handleCanvasFocus);
            map.remove();
            mapRef.current = null;
        };
    }, []);

    return (
        <div ref={containerRef} className={styles.container}>
            <div ref={mapContainerRef} className={styles.mapContainer} />
        </div>
    );
};

export default Maps2D;