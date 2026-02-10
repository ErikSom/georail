import { useState, useEffect, useRef } from 'preact/hooks';
import styles from './TrainControls.module.css';
import BipolarDial from './BipolarDial';
import IconButton from './IconButton';
import { Input } from '../../lib/utils/Input';
import { trainPower, trainPowerPercent, trainDoorsOpen, resetTrain, updateTick, deltaTimeMs } from '../../store/train';

function TrainControls() {
    const [isOpen, setIsOpen] = useState(false);
    const holdTimeRef = useRef(0);
    const initialPowerRef = useRef(0);

    // Handle keyboard input - triggered by updateTick from game loop
    useEffect(() => {
        // Subscribe to updateTick to sync with game loop
        const unsubscribe = updateTick.subscribe(() => {
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
        // Convert dial value (-100 to 100) to power (-1 to 1)
        trainPower.value = value / 100;
        holdTimeRef.current = 0; // Reset hold time when using dial
    };

    const handleReset = () => {
        resetTrain();
        holdTimeRef.current = 0;
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

            {/* Control Panel - Bottom of Screen */}
            <div className={`${styles.controlPanel} ${isOpen ? styles.controlPanelOpen : ''}`}>
                {/* Center Content - BipolarDial */}
                <div className={styles.dialContainer}>
                    <BipolarDial
                        value={trainPowerPercent.value}
                        onChange={handleDialChange}
                        min={-100}
                        max={100}
                        size={220}
                    />
                    <IconButton toggle icon="/icons/lightbulb.svg" className={styles.lightIcon} onClick={handleReset} ariaLabel="Reset power" />
                    <IconButton toggle icon={trainDoorsOpen.value ? "/icons/doors-open.svg" : "/icons/doors-close.svg"} className={styles.doorIcon} onClick={() => trainDoorsOpen.value = !trainDoorsOpen.value} ariaLabel="Toggle doors" />
                    <IconButton icon="/icons/controls-off.svg" className={styles.closeControls} onClick={() => setIsOpen(false)} ariaLabel="Close train controls" />
                </div>
            </div>
        </>
    );
}

export default TrainControls;
