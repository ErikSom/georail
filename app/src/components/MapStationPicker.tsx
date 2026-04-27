import { useEffect, useRef, useState } from 'preact/hooks';
import { createPortal } from 'preact/compat';
import maplibregl from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';
import type { StationTrackInfo } from '../lib/api/station';
import { t } from '../i18n';
import styles from './MapStationPicker.module.css';

interface Props {
    stations: StationTrackInfo[];
    onSelect: (stationName: string) => void;
    onClose: () => void;
}

interface HoverInfo {
    name: string;
    x: number;
    y: number;
}

const isTouchDevice = () =>
    typeof window !== 'undefined' && window.matchMedia('(pointer: coarse)').matches;

export default function MapStationPicker({ stations, onSelect, onClose }: Props) {
    const mapContainerRef = useRef<HTMLDivElement | null>(null);
    const mapRef = useRef<maplibregl.Map | null>(null);
    const popupRef = useRef<maplibregl.Popup | null>(null);
    const pendingNameRef = useRef<string | null>(null);
    const [hover, setHover] = useState<HoverInfo | null>(null);

    useEffect(() => {
        if (!mapContainerRef.current) return;

        const validStations = stations.filter(
            (s): s is StationTrackInfo & { lat: number; lon: number } =>
                typeof s.lat === 'number' && typeof s.lon === 'number'
        );
        if (validStations.length === 0) return;

        const lons = validStations.map((s) => s.lon);
        const lats = validStations.map((s) => s.lat);
        const bounds: [[number, number], [number, number]] = [
            [Math.min(...lons), Math.min(...lats)],
            [Math.max(...lons), Math.max(...lats)],
        ];

        const map = new maplibregl.Map({
            style: 'https://tiles.openfreemap.org/styles/liberty',
            container: mapContainerRef.current,
            bounds,
            fitBoundsOptions: { padding: 40 },
            attributionControl: false,
        });
        mapRef.current = map;

        const touch = isTouchDevice();

        const clearPending = () => {
            pendingNameRef.current = null;
            popupRef.current?.remove();
            popupRef.current = null;
        };

        map.on('load', () => {
            map.addSource('stations', {
                type: 'geojson',
                data: {
                    type: 'FeatureCollection',
                    features: validStations.map((s) => ({
                        type: 'Feature',
                        geometry: { type: 'Point', coordinates: [s.lon, s.lat] },
                        properties: { name: s.name, code: s.code },
                    })),
                },
            });

            map.addLayer({
                id: 'stations-circle',
                type: 'circle',
                source: 'stations',
                paint: {
                    'circle-radius': ['interpolate', ['linear'], ['zoom'], 7, 3, 12, 8],
                    'circle-color': '#3473e6',
                    'circle-stroke-color': '#ffffff',
                    'circle-stroke-width': 1.5,
                },
            });

            // Hover tooltip is mouse-only; on touch the synthetic mouse events
            // would briefly flash a tooltip after every tap.
            if (!touch) {
                map.on('mouseenter', 'stations-circle', () => {
                    map.getCanvas().style.cursor = 'pointer';
                });
                map.on('mouseleave', 'stations-circle', () => {
                    map.getCanvas().style.cursor = '';
                    setHover(null);
                });
                map.on('mousemove', 'stations-circle', (e) => {
                    const feature = e.features?.[0];
                    const name = feature?.properties?.name;
                    if (typeof name !== 'string') return;
                    const point = map.project(
                        (feature.geometry as GeoJSON.Point).coordinates as [number, number]
                    );
                    setHover({ name, x: point.x, y: point.y });
                });
            }

            map.on('click', 'stations-circle', (e) => {
                const feature = e.features?.[0];
                const name = feature?.properties?.name;
                if (typeof name !== 'string') return;
                if (!touch) {
                    onSelect(name);
                    return;
                }
                // Touch: first tap shows label popup, second tap on same station selects.
                if (pendingNameRef.current === name) {
                    onSelect(name);
                    clearPending();
                    return;
                }
                pendingNameRef.current = name;
                const coords = (feature.geometry as GeoJSON.Point).coordinates as [number, number];
                popupRef.current?.remove();
                popupRef.current = new maplibregl.Popup({
                    closeButton: false,
                    closeOnClick: false,
                    offset: 14,
                })
                    .setLngLat(coords)
                    .setText(name)
                    .addTo(map);
            });

            // Tap on empty map clears the pending preview.
            if (touch) {
                map.on('click', (e) => {
                    const features = map.queryRenderedFeatures(e.point, {
                        layers: ['stations-circle'],
                    });
                    if (features.length === 0) clearPending();
                });
            }
        });

        return () => {
            popupRef.current?.remove();
            popupRef.current = null;
            mapRef.current?.remove();
            mapRef.current = null;
        };
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    if (typeof document === 'undefined') return null;

    return createPortal(
        <div
            className={styles.overlay}
            role="dialog"
            aria-label={t('travel.mapPickerTitle')}
            // Stop the parent StationPicker's document-level mousedown click-outside
            // handler from seeing clicks on this portaled overlay.
            onMouseDown={(e) => e.stopPropagation()}
            onTouchStart={(e) => e.stopPropagation()}
        >
            <div className={styles.header}>
                <span className={styles.title}>{t('travel.mapPickerTitle')}</span>
                <button className={styles.closeButton} onClick={onClose} aria-label="Close">✕</button>
            </div>
            <div className={styles.mapContainer} ref={mapContainerRef}>
                {hover && (
                    <div
                        className={styles.tooltip}
                        style={{ left: `${hover.x}px`, top: `${hover.y}px` }}
                    >
                        {hover.name}
                    </div>
                )}
            </div>
        </div>,
        document.body
    );
}
