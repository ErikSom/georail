import { useState, useEffect, useRef } from 'preact/hooks';
import { World } from '../lib/World';

function ThreeViewer() {
    const mountRef = useRef<HTMLDivElement | null>(null);
    const [credits, setCredits] = useState<string>('');

    useEffect(() => {
        let world: World | null = null;

        if (mountRef.current) {
            world = new World(mountRef.current, setCredits);
            world.init();
        }

        return () => {
            world?.cleanup();
        };

    }, []);

    return (
        <div style={{ position: 'relative', width: '100%', height: '100%' }}>
            <div ref={mountRef} style={{ width: '100%', height: '100%' }} />
            
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
        </div>
    );
}

export default ThreeViewer;