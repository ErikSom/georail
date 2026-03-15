import { useState, useEffect, useRef, useCallback } from 'preact/hooks';
import styles from './TrainControls.module.css';
import BipolarDial from './BipolarDial';
import IconButton from './IconButton';
import { Input } from '../../lib/utils/Input';
import { trainPower, trainPowerPercent, trainVelocityKmh, trainDoorsOpen, trainHeadlightsOn, updateTick, deltaTimeMs } from '../../store/train';
import GUIControls from './GUIControls';

function TrainControls() {
    const [isOpen, setIsOpen] = useState(true);
    const [dialError, setDialError] = useState(false);
    const [doorError, setDoorError] = useState(false);
    const holdTimeRef = useRef(0);
    const initialPowerRef = useRef(0);
    const dialErrorTimer = useRef<ReturnType<typeof setTimeout>>();
    const doorErrorTimer = useRef<ReturnType<typeof setTimeout>>();

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

    useEffect(() => {
        const unsubscribe = updateTick.subscribe(() => {
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

    const handleDialChange = (value: number) => {
        if (trainDoorsOpen.value) {
            trainPower.value = 0;
            flashDialError();
            return;
        }

        trainPower.value = value / 100;
        holdTimeRef.current = 0;
    };

    const handleDoorToggle = () => {
        if (!trainDoorsOpen.value && Math.abs(trainVelocityKmh.value) > 3) {
            flashDoorError();
            return;
        }
        trainDoorsOpen.value = !trainDoorsOpen.value;
    };

    const handleStop = () => {
        trainPower.value = 0;
        holdTimeRef.current = 0;
    };

    const handleHorn = () => {
        // play horn sound here
    }

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
                    ariaLabel="Toggle train controls"
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
                    />
                    <IconButton toggle on={trainHeadlightsOn.value} icon="/icons/lightbulb.svg" className={styles.lightIcon} onClick={handleHeadlights} ariaLabel="Toggle headlights" />
                    <IconButton toggle on={trainDoorsOpen.value} icon={trainDoorsOpen.value ? "/icons/doors-open.svg" : "/icons/doors-close.svg"} className={`${styles.doorIcon} ${doorError ? styles.doorError : ''}`} onClick={handleDoorToggle} ariaLabel="Toggle doors" />
                    <IconButton icon="/icons/stop.svg" className={styles.stopIcon} onClick={handleStop} ariaLabel="Emergency stop" />
                    <IconButton icon="/icons/horn.svg" className={styles.hornIcon} onClick={handleHorn} ariaLabel="Sound horn" />
                    <GUIControls className={styles.settingsIcon} />
                    <IconButton icon="/icons/controls-off.svg" className={styles.closeControls} onClick={() => setIsOpen(false)} ariaLabel="Close train controls" />
                </div>
            </div>
        </>
    );
}

export default TrainControls;
