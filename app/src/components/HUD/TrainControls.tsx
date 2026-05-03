import { useState, useEffect, useRef, useCallback } from 'preact/hooks';
import styles from './TrainControls.module.css';
import BipolarDial from './BipolarDial';
import IconButton from './IconButton';
import { Input } from '../../lib/utils/Input';
import { trainPower, trainPowerPercent, trainVelocityKmh, trainDoorsOpen, trainHeadlightsOn, trainInstance, trainBraking, trainDirection, updateTick, deltaTimeMs, trainControlsOpen } from '../../store/train';
import { t } from '../../i18n';

function TrainControls() {
    const isOpen = trainControlsOpen.value;
    const setIsOpen = (v: boolean) => { trainControlsOpen.value = v; };
    const [dialError, setDialError] = useState(false);
    const [doorError, setDoorError] = useState(false);
    const [directionError, setDirectionError] = useState(false);
    const holdTimeRef = useRef(0);
    const initialPowerRef = useRef(0);
    const dialErrorTimer = useRef<ReturnType<typeof setTimeout>>();
    const doorErrorTimer = useRef<ReturnType<typeof setTimeout>>();
    const directionErrorTimer = useRef<ReturnType<typeof setTimeout>>();
    const prevSpeedRef = useRef(0);
    const vibrateTimer = useRef(0);

    const flashDialError = useCallback(() => {
        setDialError(true);
        clearTimeout(dialErrorTimer.current);
        dialErrorTimer.current = setTimeout(() => setDialError(false), 600);
    }, []);

    const flashDoorError = useCallback(() => {
        setDoorError(true);
        clearTimeout(doorErrorTimer.current);
        doorErrorTimer.current = setTimeout(() => setDoorError(false), 600);
    }, []);

    const flashDirectionError = useCallback(() => {
        setDirectionError(true);
        clearTimeout(directionErrorTimer.current);
        directionErrorTimer.current = setTimeout(() => setDirectionError(false), 600);
    }, []);

    useEffect(() => {
        const unsubscribe = updateTick.subscribe(() => {
            // Braking vibration feedback — steady rumble scaled to deceleration
            if (trainBraking.value && navigator.vibrate) {
                const currentSpeed = Math.abs(trainVelocityKmh.value);
                const dt = deltaTimeMs.value / 1000;
                const decel = dt > 0 ? (prevSpeedRef.current - currentSpeed) / dt : 0; // km/h per second
                prevSpeedRef.current = currentSpeed;

                vibrateTimer.current += deltaTimeMs.value;
                // Pulse every 80ms for a steady rumble
                if (decel > 0.5 && vibrateTimer.current >= 80) {
                    // Intensity: 0-1 based on deceleration (5 km/h/s mild, 40+ km/h/s heavy)
                    const intensity = Math.min(decel / 40, 1);
                    navigator.vibrate(Math.round(3 + intensity * 10));
                    vibrateTimer.current = 0;
                }
            } else {
                prevSpeedRef.current = Math.abs(trainVelocityKmh.value);
                vibrateTimer.current = 0;
            }

            if (trainDoorsOpen.value) {
                holdTimeRef.current = 0;
                return;
            }

            // W/UP key = increase power, S/DOWN key = decrease power
            const increasePressed = Input.isDown('KeyW') || Input.isDown('ArrowUp');
            const decreasePressed = Input.isDown('KeyS') || Input.isDown('ArrowDown');

            if (increasePressed && !decreasePressed) {
                // Key just pressed - save initial value
                if (holdTimeRef.current === 0) {
                    initialPowerRef.current = trainPower.value;
                }

                holdTimeRef.current += deltaTimeMs.value;

                // Immediately start changing with acceleration
                const holdSeconds = holdTimeRef.current / 1000;
                const baseSpeed = 0.3; // Base increment per second
                const acceleration = Math.min(holdSeconds * 2, 3); // Up to 3x speed
                const increment = (baseSpeed * acceleration) * (deltaTimeMs.value / 1000);

                const newPower = Math.min(1.0, trainPower.value + increment);
                trainPower.value = newPower;
            } else if (decreasePressed && !increasePressed) {
                // Key just pressed - save initial value
                if (holdTimeRef.current === 0) {
                    initialPowerRef.current = trainPower.value;
                }

                holdTimeRef.current += deltaTimeMs.value;

                // Immediately start changing with acceleration
                const holdSeconds = holdTimeRef.current / 1000;
                const baseSpeed = 0.3;
                const acceleration = Math.min(holdSeconds * 2, 3);
                const decrement = (baseSpeed * acceleration) * (deltaTimeMs.value / 1000);

                const newPower = Math.max(-1.0, trainPower.value - decrement);
                trainPower.value = newPower;
            } else {
                // Key released
                if (holdTimeRef.current > 0 && holdTimeRef.current < 200) {
                    // Quick tap - use initial value +/- 0.01
                    const wasIncreasing = Input.isReleased('KeyW') || Input.isReleased('ArrowUp');
                    const wasDecreasing = Input.isReleased('KeyS') || Input.isReleased('ArrowDown');

                    if (wasIncreasing) {
                        trainPower.value = Math.min(1.0, Math.ceil((initialPowerRef.current + 0.01) * 100) / 100);
                    } else if (wasDecreasing) {
                        trainPower.value = Math.max(-1.0, Math.floor((initialPowerRef.current - 0.01) * 100) / 100);
                    }
                }
                holdTimeRef.current = 0;
            }
        });

        return () => unsubscribe();
    }, []);

    const handleDialChange = useCallback((value: number) => {
        if (trainDoorsOpen.value) {
            trainPower.value = 0;
            flashDialError();
            return;
        }

        trainPower.value = value / 100;
        holdTimeRef.current = 0;
    }, [flashDialError]);

    const handleDoorToggle = () => {
        if (!trainDoorsOpen.value && Math.abs(trainVelocityKmh.value) > 3) {
            flashDoorError();
            return;
        }
        const wasOpen = trainDoorsOpen.value;
        trainDoorsOpen.value = !wasOpen;
        trainInstance.value?.playSound(wasOpen ? 'door_close' : 'door_open');
    };

    const handleDirectionToggle = () => {
        if (Math.abs(trainVelocityKmh.value) > 3) {
            flashDirectionError();
            return;
        }
        trainPower.value = 0;
        trainDirection.value = trainDirection.value === 1 ? -1 : 1;
    };

    const handleStop = () => {
        trainPower.value = 0;
        holdTimeRef.current = 0;
    };

    const handleHornLow = () => {
        trainInstance.value?.playSound('horn_low');
    };

    const handleHornHigh = () => {
        trainInstance.value?.playSound('horn_high');
    };

    const handleHeadlights = () => {
        trainHeadlightsOn.value = !trainHeadlightsOn.value;
    };

    return (
        <>
            {!isOpen &&
                <IconButton
                    icon="/icons/controls.svg"
                    className={styles.toggleButton}
                    onClick={() => setIsOpen(true)}
                    ariaLabel={t('hud.controls.toggle')}
                    iconSize={24}
                />
            }

            <div className={`${styles.controlPanel} ${isOpen ? styles.controlPanelOpen : ''}`}>
                <div className={`${styles.dialContainer} ${dialError ? styles.dialError : ''}`}>
                    <BipolarDial
                        value={trainPowerPercent.value}
                        onChange={handleDialChange}
                        min={-100}
                        max={100}
                        size={220}
                        braking={trainBraking.value}
                    />
                    <IconButton toggle on={trainHeadlightsOn.value} icon="/icons/lightbulb.svg" className={styles.lightIcon} onClick={handleHeadlights} ariaLabel={t('hud.controls.headlights')} />
                    <IconButton toggle on={trainDoorsOpen.value} icon={trainDoorsOpen.value ? "/icons/doors-open.svg" : "/icons/doors-close.svg"} className={`${styles.doorIcon} ${doorError ? styles.doorError : ''}`} onClick={handleDoorToggle} ariaLabel={t('hud.controls.doors')} />
                    <IconButton icon="/icons/stop.svg" className={styles.stopIcon} onClick={handleStop} ariaLabel={t('hud.controls.stop')} />
                    <IconButton icon="/icons/horn.svg" className={styles.hornIcon} onShortPress={handleHornLow} onLongPress={handleHornHigh} ariaLabel={t('hud.controls.horn')} />
                    <IconButton
                        toggle
                        on={trainDirection.value === -1}
                        icon={trainDirection.value === 1 ? "/icons/forward.svg" : "/icons/backward.svg"}
                        className={`${styles.directionIcon} ${directionError ? styles.doorError : ''}`}
                        onClick={handleDirectionToggle}
                        ariaLabel={t('hud.controls.direction')}
                    />
                    <IconButton icon="/icons/controls-off.svg" className={styles.closeControls} onClick={() => setIsOpen(false)} ariaLabel={t('hud.controls.close')} />
                </div>
            </div>
        </>
    );
}

export default TrainControls;
