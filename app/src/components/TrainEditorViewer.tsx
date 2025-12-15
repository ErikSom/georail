import { useEffect, useRef } from 'preact/hooks';
import { TrainEditorWorld } from '../lib/TrainEditorWorld';

function TrainEditorViewer() {
    const mountRef = useRef<HTMLDivElement | null>(null);
    const worldRef = useRef<TrainEditorWorld | null>(null);

    useEffect(() => {
        if (!mountRef.current || worldRef.current) {
            return;
        }

        worldRef.current = new TrainEditorWorld(mountRef.current);
        worldRef.current.init();

        return () => {
            worldRef.current?.cleanup();
            worldRef.current = null;
        };
    }, []);

    return (
        <div style={{ position: 'relative', width: '100%', height: '100%' }}>
            <div ref={mountRef} style={{ width: '100%', height: '100%' }} />

            <div style={{
                position: 'absolute',
                top: '10px',
                left: '10px',
                color: 'white',
                fontSize: '16px',
                fontFamily: 'sans-serif',
                textShadow: '1px 1px 2px black',
                zIndex: 10,
                background: 'rgba(0, 0, 0, 0.5)',
                padding: '10px',
                borderRadius: '5px',
            }}>
                <h3 style={{ margin: '0 0 10px 0' }}>Train Editor</h3>
                <p style={{ margin: '5px 0', fontSize: '12px' }}>Select a path from the debug panel to test your train configuration</p>
            </div>
        </div>
    );
}

export default TrainEditorViewer;
