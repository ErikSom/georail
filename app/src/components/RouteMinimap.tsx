import { useRef, useEffect, useState } from 'preact/hooks';
import maplibregl from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';
import styles from './RouteMinimap.module.css';

interface RouteminimapProps {
    route: number[][]; // [lon, lat, ...]
    stopIndices: number[];
    onReady?: () => void;
}

export default function RouteMinimap({ route, stopIndices, onReady }: RouteminimapProps) {
    const mapContainerRef = useRef<HTMLDivElement>(null);
    const mapRef = useRef<maplibregl.Map | null>(null);
    const [svgPath, setSvgPath] = useState('');
    const [stationPoints, setStationPoints] = useState<{ x: number; y: number }[]>([]);
    const [svgSize, setSvgSize] = useState({ width: 0, height: 0 });

    useEffect(() => {
        if (!mapContainerRef.current || route.length === 0) return;

        const container = mapContainerRef.current;
        const bounds = new maplibregl.LngLatBounds();
        for (const point of route) {
            bounds.extend([point[0], point[1]]);
        }

        const map = new maplibregl.Map({
            container,
            style: 'https://tiles.openfreemap.org/styles/liberty',
            bounds,
            fitBoundsOptions: { padding: 30 },
            interactive: false,
            attributionControl: false,
            pitchWithRotate: false,
            dragRotate: false,
        });

        mapRef.current = map;

        map.on('load', () => {
            map.once('idle', () => {
                projectRoute(map);
                onReady?.();
            });
        });

        return () => {
            mapRef.current = null;
            map.remove();
        };
    }, [route, stopIndices]);

    const projectRoute = (map: maplibregl.Map) => {
        const container = mapContainerRef.current;
        if (!container) return;

        const { width, height } = container.getBoundingClientRect();
        setSvgSize({ width, height });

        const step = Math.max(1, Math.floor(route.length / 500));
        const points: string[] = [];
        for (let i = 0; i < route.length; i += step) {
            const { x, y } = map.project([route[i][0], route[i][1]]);
            points.push(`${x.toFixed(1)},${y.toFixed(1)}`);
        }
        const last = route[route.length - 1];
        const lastPx = map.project([last[0], last[1]]);
        points.push(`${lastPx.x.toFixed(1)},${lastPx.y.toFixed(1)}`);

        setSvgPath(`M${points.join('L')}`);

        const dots = stopIndices.map(idx => {
            const pt = route[idx];
            if (!pt) return { x: 0, y: 0 };
            const { x, y } = map.project([pt[0], pt[1]]);
            return { x, y };
        });
        setStationPoints(dots);
    };

    return (
        <div className={styles.wrapper}>
            <div ref={mapContainerRef} className={styles.mapContainer} />
            {svgPath && (
                <svg
                    className={styles.routeOverlay}
                    width={svgSize.width}
                    height={svgSize.height}
                    viewBox={`0 0 ${svgSize.width} ${svgSize.height}`}
                >
                    <path className={styles.routeLine} d={svgPath} />
                    {stationPoints.map((pt, i) => {
                        const isFirst = i === 0;
                        const isLast = i === stationPoints.length - 1;
                        return (
                            <circle
                                key={i}
                                className={`${styles.stationDot} ${isFirst ? styles.origin : ''} ${isLast ? styles.destination : ''}`}
                                cx={pt.x}
                                cy={pt.y}
                                r={isFirst ? 6 : isLast ? 6.5 : 4}
                            />
                        );
                    })}
                </svg>
            )}
        </div>
    );
}
