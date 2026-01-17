import { useState, useEffect, useRef } from 'preact/hooks';
import { World } from '../lib/World';
import TravelPicker from './TravelPicker';
import TrainControls from '../lib/controls/TrainControls';
import type { RouteData } from '../lib/Georail';
import Maps2D from './Maps2D';

function ThreeViewer() {
    const mountRef = useRef<HTMLDivElement | null>(null);
    const worldRef = useRef<World | null>(null);
    const [credits, setCredits] = useState<string>('');
    const [showPicker, setShowPicker] = useState(true);
    const [routeData, setRouteData] = useState<RouteData | null>(null);

    // Initialize World only after route is selected
    useEffect(() => {
        if (!routeData || !mountRef.current || worldRef.current) {
            return;
        }

        worldRef.current = new World(mountRef.current, setCredits, routeData);
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
        <div style={{ position: 'relative', width: '100%', height: '100%' }}>
            <div ref={mountRef} style={{ width: '100%', height: '100%' }} />

            {!showPicker && <TrainControls />}
            {!showPicker && <Maps2D />}

            <div style={{
                position: 'absolute',
                bottom: '10px',
                left: '10px',
                color: 'white',
                fontSize: '12px',
                fontFamily: 'sans-serif',
                textShadow: '1px 1px 2px black',
                whiteSpace: 'pre-wrap',
                zIndex: 10,
                maxWidth: 'calc(100% - 20px)',
            }}>
                {credits}
            </div>

            {showPicker && <TravelPicker onRouteSelected={handleRouteSelected} />}
        </div>
    );
}

export default ThreeViewer;