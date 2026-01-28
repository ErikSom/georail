import { useEffect, useState } from "preact/hooks";

import { trainVelocityKmh, updateTick } from "../../store/train";
import { configs } from "../../store/globals";

import { useTransformable } from '../../hooks/useTransformable';

import styles from './Speedometer.module.css';

function Speedometer() {
    const [speed, setSpeed] = useState(0);
    const [unitSystem] = useState(configs.value.unitSystem);

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
        });

        return () => {
            unsubTick();
        };
    }, []);

    if (!ready) return null;

    return (
        <div
            ref={containerRef}
            className={styles.speedometer}
            style={{ transform: `translate(${position.x}px, ${position.y}px)` }}
            onPointerDown={handleContainerPointerDown}
        >
            <span className={styles.speedValue}>{Math.round(speed)}</span>
            <span className={styles.speedUnit}>{unitSystem === 'metric' ? 'km/h' : 'mph'}</span>
        </div>
    );
};

export default Speedometer;