import { useEffect, useState, useCallback } from "preact/hooks";

import { trainVelocityKmh, trainMaxSpeedKmh, updateTick } from "../../store/train";
import { configs } from "../../store/globals";
import { formatSpeed, getSpeedUnit } from "../../lib/utils/Units";

import { useTransformable } from '../../hooks/useTransformable';
import SpeedometerAnalog from './SpeedometerAnalog';

import styles from './Speedometer.module.css';

type SpeedometerMode = 'digital' | 'analog';

const STORAGE_KEY_MODE = 'georail_speedometer_mode';

function Speedometer() {
    const [speed, setSpeed] = useState(0);
    const [maxSpeed, setMaxSpeed] = useState(120);
    const [unitSystem] = useState(configs.value.unitSystem);
    const [mode, setMode] = useState<SpeedometerMode>(() => {
        const stored = localStorage.getItem(STORAGE_KEY_MODE);
        return (stored === 'analog' || stored === 'digital') ? stored : 'digital';
    });
    const [showSelector, setShowSelector] = useState(false);

    const {
        position,
        ready,
        containerRef,
        handleContainerPointerDown,
    } = useTransformable({
        initialPosition: { x: 100, y: 100 },
        storageKey: 'georail_speedometer_state',
    });

    // update on tick
    useEffect(() => {
        const unsubTick = updateTick.subscribe(() => {
            setSpeed(trainVelocityKmh.value);
            setMaxSpeed(trainMaxSpeedKmh.value);
        });

        return () => {
            unsubTick();
        };
    }, []);

    // Persist mode to localStorage
    useEffect(() => {
        localStorage.setItem(STORAGE_KEY_MODE, mode);
    }, [mode]);

    // Handle click outside to close selector
    useEffect(() => {
        if (!showSelector) return;

        const handleClickOutside = (e: PointerEvent) => {
            const container = containerRef.current;
            if (container && !container.contains(e.target as Node)) {
                setShowSelector(false);
            }
        };

        // Delay adding listener to avoid immediate trigger
        const timer = setTimeout(() => {
            document.addEventListener('pointerdown', handleClickOutside);
        }, 0);

        return () => {
            clearTimeout(timer);
            document.removeEventListener('pointerdown', handleClickOutside);
        };
    }, [showSelector, containerRef]);

    const handleContainerTap = useCallback((e: PointerEvent) => {
        // Call the original handler for drag functionality
        handleContainerPointerDown(e);

        // Toggle selector on tap (not drag)
        // We'll show selector immediately, drag handler will handle movement
        setShowSelector(prev => !prev);
    }, [handleContainerPointerDown]);

    const handleModeSelect = useCallback((newMode: SpeedometerMode) => {
        setMode(newMode);
        setShowSelector(false);
    }, []);

    if (!ready) return null;

    const displaySpeed = formatSpeed(speed, unitSystem);
    const unit = getSpeedUnit(unitSystem);

    return (
        <div
            ref={containerRef}
            className={`${styles.speedometer} ${mode === 'analog' ? styles.analogMode : ''}`}
            style={{ transform: `translate(${position.x}px, ${position.y}px)` }}
            onPointerDown={handleContainerTap}
        >
            {mode === 'digital' ? (
                <>
                    <span className={styles.speedValue}>{displaySpeed}</span>
                    <span className={styles.speedUnit}>{unit}</span>
                </>
            ) : (
                <SpeedometerAnalog
                    speed={speed}
                    maxSpeed={maxSpeed}
                    unitSystem={unitSystem}
                />
            )}

            {showSelector && (
                <div
                    className={styles.modeSelector}
                    onPointerDown={(e) => e.stopPropagation()}
                    onPointerUp={(e) => e.stopPropagation()}
                >
                    <button
                        className={`${styles.modeButton} ${mode === 'digital' ? styles.active : ''}`}
                        onPointerUp={() => handleModeSelect('digital')}
                    >
                        Digital
                    </button>
                    <button
                        className={`${styles.modeButton} ${mode === 'analog' ? styles.active : ''}`}
                        onPointerUp={() => handleModeSelect('analog')}
                    >
                        Analog
                    </button>
                </div>
            )}
        </div>
    );
};

export default Speedometer;
