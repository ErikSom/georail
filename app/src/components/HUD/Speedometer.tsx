import { useEffect, useState, useCallback, useRef } from "preact/hooks";

import { trainVelocityKmh, trainMaxSpeedKmh, updateTick } from "../../store/train";
import { trackMaxSpeedKmh } from "../../store/journey";
import { configs } from "../../store/globals";
import { formatSpeed, getSpeedUnit } from "../../lib/utils/Units";
import { t } from "../../i18n";

import { isSmallScreen, screenWidth } from '../../store/globals';
import { useTransformable } from '../../hooks/useTransformable';
import SpeedometerAnalog from './SpeedometerAnalog';

import styles from './Speedometer.module.css';

type SpeedometerMode = 'digital' | 'analog';

const STORAGE_KEY_MODE = 'georail_speedometer_mode';
const SPEEDOMETER_UPDATE_INTERVAL_MS = 100;

function Speedometer() {
    const [speed, setSpeed] = useState(0);
    const [maxSpeed, setMaxSpeed] = useState(120);
    const [trackLimit, setTrackLimit] = useState<number | null>(null);
    const initialPositionRef = useRef(
        isSmallScreen
            ? { x: screenWidth() - 75, y: 120 }
            : { x: screenWidth() - 186, y: 230 }
    );
    const unitSystem = configs.value.unitSystem;
    const [mode, setMode] = useState<SpeedometerMode>(() => {
        const stored = localStorage.getItem(STORAGE_KEY_MODE);
        if (stored === 'analog' || stored === 'digital') return stored;
        return isSmallScreen ? 'digital' : 'analog';
    });
    const [showSelector, setShowSelector] = useState(false);

    const {
        position,
        ready,
        containerRef,
        setPosition,
        handleContainerPointerDown,
    } = useTransformable({
        initialPosition: initialPositionRef.current,
        storageKey: 'georail_speedometer_state',
    });

    // update on tick
    useEffect(() => {
        let lastUpdateAt = 0;
        const unsubTick = updateTick.subscribe(() => {
            const now = performance.now();
            if (now - lastUpdateAt < SPEEDOMETER_UPDATE_INTERVAL_MS) return;
            lastUpdateAt = now;

            const nextSpeed = Math.abs(trainVelocityKmh.value);
            const nextMaxSpeed = trainMaxSpeedKmh.value + 20;
            const nextTrackLimit = trackMaxSpeedKmh.value;

            setSpeed(current => Math.abs(current - nextSpeed) >= 0.1 ? nextSpeed : current);
            setMaxSpeed(current => current !== nextMaxSpeed ? nextMaxSpeed : current);
            setTrackLimit(current => current !== nextTrackLimit ? nextTrackLimit : current);
        });

        return () => {
            unsubTick();
        };
    }, []);

    // Persist mode to localStorage
    useEffect(() => {
        localStorage.setItem(STORAGE_KEY_MODE, mode);
    }, [mode]);

    // Re-clamp position when mode changes (size changes)
    const prevMode = useRef(mode);
    useEffect(() => {
        if (prevMode.current === mode) return;
        prevMode.current = mode;

        // Wait for DOM to update with new size
        requestAnimationFrame(() => {
            if (!containerRef.current) return;

            const padding = 10;
            const rect = containerRef.current.getBoundingClientRect();
            const maxX = window.innerWidth - rect.width - padding;
            const maxY = window.innerHeight - rect.height - padding;

            const clampedX = Math.max(padding, Math.min(position.x, maxX));
            const clampedY = Math.max(padding, Math.min(position.y, maxY));

            if (clampedX !== position.x || clampedY !== position.y) {
                setPosition({ x: clampedX, y: clampedY });
            }
        });
    }, [mode, position.x, position.y, setPosition, containerRef]);

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

    // Track if we're dragging to distinguish from taps
    const pointerStartPos = useRef<{ x: number; y: number } | null>(null);
    const didDrag = useRef(false);

    const handlePointerDown = useCallback((e: PointerEvent) => {
        pointerStartPos.current = { x: e.clientX, y: e.clientY };
        didDrag.current = false;
        handleContainerPointerDown(e);
    }, [handleContainerPointerDown]);

    const handlePointerMove = useCallback((e: PointerEvent) => {
        if (pointerStartPos.current) {
            const dx = Math.abs(e.clientX - pointerStartPos.current.x);
            const dy = Math.abs(e.clientY - pointerStartPos.current.y);
            if (dx > 5 || dy > 5) {
                didDrag.current = true;
            }
        }
    }, []);

    const handlePointerUp = useCallback(() => {
        // Only toggle selector if we initiated the pointer on this element (not on buttons)
        // and it was a tap (not a drag)
        if (pointerStartPos.current !== null && !didDrag.current) {
            setShowSelector(prev => !prev);
        }
        pointerStartPos.current = null;
    }, []);

    const handleModeSelect = useCallback((newMode: SpeedometerMode) => {
        setMode(newMode);
        setShowSelector(false);
    }, []);

    if (!ready) return null;

    const displaySpeed = formatSpeed(speed, unitSystem);
    const unit = getSpeedUnit(unitSystem);
    const overLimit = trackLimit != null && speed > trackLimit + 1;

    return (
        <div
            ref={containerRef}
            className={`${styles.speedometer} ${mode === 'analog' ? styles.analogMode : ''}`}
            style={{ transform: `translate(${position.x}px, ${position.y}px)` }}
            onPointerDown={handlePointerDown}
            onPointerMove={handlePointerMove}
            onPointerUp={handlePointerUp}
        >
            {mode === 'digital' ? (
                <>
                    <span className={`${styles.speedValue} ${overLimit ? styles.overLimit : ''}`}>{displaySpeed}</span>
                    <span className={styles.speedUnit}>{unit}</span>
                </>
            ) : (
                <SpeedometerAnalog
                    speed={speed}
                    maxSpeed={maxSpeed}
                    unitSystem={unitSystem}
                    overLimit={overLimit}
                />
            )}

            {trackLimit != null && (() => {
                const limitDisplay = formatSpeed(trackLimit, unitSystem);
                const isThreeDigit = limitDisplay >= 100;
                const signOnLeft = position.x > window.innerWidth / 2;
                return (
                    <div
                        className={`${styles.speedLimitSign} ${signOnLeft ? styles.speedLimitSignLeft : ''}`}
                        aria-label={`Speed limit ${limitDisplay} ${unit}`}
                    >
                        <span className={`${styles.speedLimitValue} ${isThreeDigit ? styles.speedLimitValueTight : ''}`}>{limitDisplay}</span>
                    </div>
                );
            })()}

            {showSelector && (
                <div
                    className={styles.modeSelector}
                    onPointerDown={(e) => e.stopPropagation()}
                >
                    <button
                        className={`${styles.modeButton} ${mode === 'digital' ? styles.active : ''}`}
                        onClick={() => handleModeSelect('digital')}
                    >
                        {t('hud.speedometer.digital')}
                    </button>
                    <button
                        className={`${styles.modeButton} ${mode === 'analog' ? styles.active : ''}`}
                        onClick={() => handleModeSelect('analog')}
                    >
                        {t('hud.speedometer.analog')}
                    </button>
                </div>
            )}
        </div>
    );
};

export default Speedometer;
