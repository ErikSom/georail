import { useState, useEffect, useRef } from 'preact/hooks';
import { World } from '../lib/World';
import JourneyComplete from './JourneyComplete';
import TrainControls from './HUD/TrainControls';
import GameMenu from './HUD/GameMenu';
import Maps2D from './HUD/Maps2D';
import Transit from './HUD/Transit';
import DebugPanel from './HUD/DebugPanel';
import DoorPrompt from './HUD/DoorPrompt';
import Tiles3DAttribution, { type Tiles3DAttributionCredits } from './HUD/Tiles3DAttribution';
import TrainSpinner from './TrainSpinner';
import styles from './ThreeViewer.module.css';
import Speedometer from './HUD/Speedometer';
import { routeData, resetJourney, journeyCompleted } from '../store/journey';
import { appScreen, gameReady } from '../store/app';
import { hudSettings } from '../store/globals';
import { t } from '../i18n';

function ThreeViewer() {
    const mountRef = useRef<HTMLDivElement | null>(null);
    const worldRef = useRef<World | null>(null);
    const [attribution, setAttribution] = useState<Tiles3DAttributionCredits>(null);
    const [showComplete, setShowComplete] = useState(false);

    // Initialize World on mount
    useEffect(() => {
        const route = routeData.value;
        if (!mountRef.current || worldRef.current || !route) return;

        worldRef.current = new World(mountRef.current, setAttribution, route);
        worldRef.current.init();

        return () => {
            worldRef.current?.cleanup();
            worldRef.current = null;
        };
    }, []);

    // Watch for journey completion
    useEffect(() => {
        const unsub = journeyCompleted.subscribe(completed => {
            if (completed) {
                setShowComplete(true);
            }
        });
        return unsub;
    }, []);

    const exitToMenu = () => {
        worldRef.current?.cleanup();
        worldRef.current = null;
        resetJourney();
        appScreen.value = 'menu';
    };

    const handleJourneyDismiss = () => {
        setShowComplete(false);
        exitToMenu();
    };

    // Reset journey on unmount
    useEffect(() => {
        return () => {
            resetJourney();
        };
    }, []);

    const ready = gameReady.value;

    return (
        <div className={styles.container}>
            <div ref={mountRef} className={`${styles.canvas} ${!ready ? styles.canvasLoading : ''}`} />

            <div className={`${styles.loadingOverlay} ${ready ? styles.loadingOverlayHidden : ''}`}>
                <TrainSpinner />
                <p className={styles.loadingText}>{t('hud.loading')}</p>
            </div>

            {!showComplete && ready && (
                <>
                    <TrainControls />
                    <GameMenu onExit={exitToMenu} />
                    {hudSettings.value.showMap2D && <Maps2D />}
                    {hudSettings.value.showTransit && <Transit />}
                    {hudSettings.value.showSpeedometer && <Speedometer />}
                    <DoorPrompt />
                    <DebugPanel />
                </>
            )}

            <Tiles3DAttribution attribution={attribution} showMap2DAttribution={hudSettings.value.showMap2D} />

            {showComplete && <JourneyComplete onDismiss={handleJourneyDismiss} />}
        </div>
    );
}

export default ThreeViewer;
