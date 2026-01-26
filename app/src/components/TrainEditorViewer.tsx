import { useEffect, useRef } from 'preact/hooks';
import { TrainEditorWorld } from '../lib/TrainEditorWorld';
import TrainControls from './HUD/TrainControls';

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
            <TrainControls />
        </div>
    );
}

export default TrainEditorViewer;
