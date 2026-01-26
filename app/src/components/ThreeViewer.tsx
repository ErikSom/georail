import { useState, useEffect, useRef } from 'preact/hooks';
import { World } from '../lib/World';
import TravelPicker from './TravelPicker';
import TrainControls from './HUD/TrainControls';
import type { RouteData } from '../lib/api/navigation';
import Maps2D from './HUD/Maps2D';
import Tiles3DAttribution, { type Tiles3DAttributionCredits } from './HUD/Tiles3DAttribution';
import styles from './ThreeViewer.module.css';

function ThreeViewer() {
    const mountRef = useRef<HTMLDivElement | null>(null);
    const worldRef = useRef<World | null>(null);
    const [attribution, setAttribution] = useState<Tiles3DAttributionCredits>(null);
    const [showPicker, setShowPicker] = useState(true);
    const [routeData, setRouteData] = useState<RouteData | null>(null);

    // Initialize World only after route is selected
    useEffect(() => {
        if (!routeData || !mountRef.current || worldRef.current) {
            return;
        }

        worldRef.current = new World(mountRef.current, setAttribution, routeData);
        worldRef.current.init();

        // Cleanup function
        return () => {
            worldRef.current?.cleanup();
            worldRef.current = null;
        };
    }, [routeData]);

    const handleRouteSelected = (route: RouteData) => {
        setRouteData(route);
        setShowPicker(false);
    };

    return (
        <div className={styles.container}>
            <div ref={mountRef} className={styles.canvas} />

            {!showPicker && <TrainControls />}
            {!showPicker && <Maps2D />}

            <Tiles3DAttribution attribution={attribution} />

            {showPicker && <TravelPicker onRouteSelected={handleRouteSelected} />}
        </div>
    );
}

export default ThreeViewer;