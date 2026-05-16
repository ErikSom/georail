import { useEffect, useRef, useState } from 'preact/hooks';
import { TrainEditorWorld } from '../lib/TrainEditorWorld';
import TrainControls from './HUD/TrainControls';
import TrainEditorChooser from './TrainEditorChooser';
import TrainEditorToolbar from './TrainEditorToolbar';
import { chooserOpen, currentSavedTrainId, loadSavedConfig } from '../store/savedTrains';
import { getTrainConfiguration } from '../lib/train/configs/TrainConfigurations.secure';
import type { TrainConfig } from '../lib/train/TrainConfig';

function TrainEditorViewer() {
    const mountRef = useRef<HTMLDivElement | null>(null);
    const worldRef = useRef<TrainEditorWorld | null>(null);
    const [worldReady, setWorldReady] = useState(false);
    const initRunRef = useRef(false);

    useEffect(() => {
        if (typeof window === 'undefined') return;

        // URL-driven shortcuts that skip the chooser:
        //   ?train=<builtinId>   -> built-in (sync resolve)
        //   ?savedTrain=<uuid>   -> user-saved (async resolve)
        const params = new URLSearchParams(window.location.search);
        const builtinId = params.get('train');
        const savedId = params.get('savedTrain');

        if (builtinId) {
            try {
                // Editing a built-in is a fresh derivative: mint a new id so
                // it doesn't collide with the bundled catalog entry.
                const config = getTrainConfiguration(builtinId);
                config.display = { ...config.display, id: crypto.randomUUID() };
                ensureWorld(config, null, config.display.id);
                return;
            } catch (err) {
                console.error('Failed to load built-in train', err);
            }
        }
        if (savedId) {
            void loadSavedConfig(savedId).then(({ config, dispose }) => {
                ensureWorld(config, dispose, savedId);
            }).catch(err => {
                console.error('Failed to load saved train', err);
                chooserOpen.value = true;
            });
            return;
        }
        // No URL hint — show the chooser to the user.
        chooserOpen.value = true;
    }, []);

    useEffect(() => {
        return () => {
            worldRef.current?.cleanup();
            worldRef.current = null;
        };
    }, []);

    const ensureWorld = (config: TrainConfig, dispose: (() => void) | null, savedId: string | null) => {
        if (!mountRef.current) return;
        if (worldRef.current) {
            worldRef.current.swapConfig(config, dispose);
        } else {
            if (initRunRef.current) return;
            initRunRef.current = true;
            const world = new TrainEditorWorld(mountRef.current);
            world.setInitialConfig(config, dispose);
            world.init();
            worldRef.current = world;
            setWorldReady(true);
        }
        currentSavedTrainId.value = savedId;
    };

    const handleChoose = (config: TrainConfig, dispose: (() => void) | null, savedId: string | null) => {
        ensureWorld(config, dispose, savedId);
    };

    return (
        <div style={{ position: 'relative', width: '100%', height: '100%' }}>
            <div ref={mountRef} style={{ width: '100%', height: '100%' }} />
            {worldReady && <TrainControls />}
            <TrainEditorToolbar
                getCurrentConfig={() => worldRef.current?.getCurrentConfig() ?? null}
            />
            <TrainEditorChooser
                canClose={worldReady}
                onChoose={handleChoose}
            />
        </div>
    );
}

export default TrainEditorViewer;
