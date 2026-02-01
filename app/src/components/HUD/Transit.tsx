import { useRef, useEffect, useState } from 'preact/hooks';
import { useTransformable } from '../../hooks/useTransformable';
import {
    stops,
    distanceToStop,
    formatDistance,
    journeyStartTime,
    updateElapsedTime,
    getProgressBetweenStops,
    stopDistances,
    stopStatuses,
    updateStopStatuses,
    formatTimeDelta,
    elapsedMinutes,
    type StopStatus,
} from '../../store/journey';
import { updateTick, trainDistanceTraveled, trainVelocityKmh, trainMaxSpeedKmh } from '../../store/train';
import styles from './Transit.module.css';

const MIN_WIDTH = 200;
const MIN_HEIGHT = 180;
const COMPACT_WIDTH_THRESHOLD = 280;

/**
 * Format countdown with optional predicted delta
 * e.g., "26m" or "26m(+4)" if running late
 */
function formatCountdownWithDelta(
    timeRemaining: number,
    scheduledTime: number,
    currentElapsed: number,
    distanceKm: number,
    velocityKmh: number,
    maxSpeedKmh: number
): { time: string; delta: string | null; isLate: boolean } {
    const rounded = Math.round(timeRemaining);

    // Calculate predicted arrival time based on current speed
    // Only show prediction when at cruising speed (> 40% of max speed)
    // to avoid misleading predictions during acceleration/deceleration
    let predictedDelta: number | null = null;
    const cruisingThreshold = maxSpeedKmh * 0.4;

    if (velocityKmh > cruisingThreshold && distanceKm > 0) {
        // Use a weighted estimate: blend current speed with expected average
        // (assumes train will maintain roughly current speed)
        const estimatedAvgSpeed = velocityKmh;
        const hoursToArrive = distanceKm / estimatedAvgSpeed;
        const minutesToArrive = hoursToArrive * 60;
        const predictedArrivalTime = currentElapsed + minutesToArrive;
        predictedDelta = Math.round(predictedArrivalTime - scheduledTime);
    }

    const timeStr = rounded === 0 ? '0m' : rounded > 0 ? `${rounded}m` : `${rounded}m`;
    const isLate = rounded < 0;

    // Only show delta if we have a prediction and it's significant (> 1 min)
    let deltaStr: string | null = null;
    if (predictedDelta !== null && Math.abs(predictedDelta) > 1) {
        deltaStr = predictedDelta > 0 ? `(+${predictedDelta})` : `(${predictedDelta})`;
    }

    return { time: timeStr, delta: deltaStr, isLate };
}

function Transit() {
    const scrollContainerRef = useRef<HTMLDivElement>(null);
    const [, forceUpdate] = useState(0);

    const {
        position,
        size,
        ready,
        containerRef,
        handleContainerPointerDown,
        renderResizeHandles,
    } = useTransformable({
        initialPosition: { x: 20, y: 200 },
        initialSize: { width: 300, height: 380 },
        minSize: { width: MIN_WIDTH, height: MIN_HEIGHT },
        keepAspectRatio: false,
        storageKey: 'georail_transit_state',
    });

    // Subscribe to updates
    useEffect(() => {
        const unsub = updateTick.subscribe(() => {
            updateElapsedTime();
            updateStopStatuses();
            forceUpdate(v => v + 1);
        });
        return unsub;
    }, []);

    // Don't render if no journey
    if (!journeyStartTime.value || stops.value.length === 0) {
        return null;
    }

    const currentWidth = size?.width ?? 300;
    const currentHeight = size?.height ?? 380;
    const isCompact = currentWidth < COMPACT_WIDTH_THRESHOLD;
    const stopsArr = stops.value;
    const distances = stopDistances.value;
    const statuses = stopStatuses.value;
    const trainDistance = trainDistanceTraveled.value / 1000; // km
    const velocity = trainVelocityKmh.value;
    const maxSpeed = trainMaxSpeedKmh.value;
    const elapsed = elapsedMinutes.value;

    // Find current segment
    let currentSegmentFrom = 0;
    for (let i = 0; i < distances.length - 1; i++) {
        if (trainDistance >= distances[i] && trainDistance < distances[i + 1]) {
            currentSegmentFrom = i;
            break;
        }
        if (i === distances.length - 2 && trainDistance >= distances[i + 1]) {
            currentSegmentFrom = i;
        }
    }

    const segmentProgress = currentSegmentFrom < stopsArr.length - 1
        ? getProgressBetweenStops(currentSegmentFrom, currentSegmentFrom + 1)
        : 1;

    return (
        <div
            ref={containerRef}
            className={styles.container}
            style={{
                left: `${position.x}px`,
                top: `${position.y}px`,
                width: `${currentWidth}px`,
                height: `${currentHeight}px`,
                visibility: ready ? 'visible' : 'hidden',
            }}
            onPointerDown={handleContainerPointerDown}
        >
            <div ref={scrollContainerRef} className={styles.stopList}>
                {stopsArr.map((stop, idx) => {
                    const status: StopStatus = statuses[idx] || {
                        arrived: false,
                        departed: false,
                        actualArrivalTime: null,
                        actualDepartureTime: null,
                        arrivalDelta: null,
                        departureDelta: null,
                    };

                    const distance = distanceToStop(idx);
                    const isFirst = idx === 0;
                    const isLast = idx === stopsArr.length - 1;
                    const isPast = status.departed || (isLast && status.arrived);
                    const isCurrentSegmentStart = idx === currentSegmentFrom && idx < stopsArr.length - 1;

                    // Time calculations with predicted deltas
                    const timeUntilArr = stop.arrivalTime - elapsed;
                    const timeUntilDep = stop.departureTime - elapsed;

                    const arrDisplay = formatCountdownWithDelta(
                        timeUntilArr,
                        stop.arrivalTime,
                        elapsed,
                        distance,
                        velocity,
                        maxSpeed
                    );

                    const depDisplay = formatCountdownWithDelta(
                        timeUntilDep,
                        stop.departureTime,
                        elapsed,
                        0, // For departure, we're already at the station
                        0,
                        maxSpeed
                    );

                    // Format deltas for completed events
                    const arrDelta = formatTimeDelta(status.arrivalDelta);
                    const depDelta = formatTimeDelta(status.departureDelta);

                    return (
                        <div
                            key={idx}
                            className={`${styles.stop} ${isPast ? styles.past : ''}`}
                        >
                            {/* Timeline */}
                            <div className={styles.timeline}>
                                {idx > 0 && (
                                    <div className={`${styles.lineAbove} ${isPast || idx <= currentSegmentFrom ? styles.traveled : ''}`} />
                                )}
                                <div className={`${styles.dot} ${isFirst ? styles.origin : ''} ${isLast ? styles.destination : ''} ${isPast ? styles.pastDot : ''}`} />
                                {!isLast && (
                                    <div className={styles.lineContainer}>
                                        <div className={`${styles.lineBelow} ${isPast ? styles.traveled : ''}`} />
                                        {isCurrentSegmentStart && (
                                            <>
                                                <div className={styles.progressLine} style={{ height: `${segmentProgress * 100}%` }} />
                                                <div className={styles.trainIndicator} style={{ top: `${segmentProgress * 100}%` }} />
                                            </>
                                        )}
                                    </div>
                                )}
                            </div>

                            {/* Station info */}
                            <div className={styles.stopContent}>
                                <div className={styles.stationHeader}>
                                    <span className={styles.stationName}>
                                        {isCompact ? stop.code : stop.station}
                                    </span>
                                    {stop.track && <span className={styles.track}>{stop.track}</span>}
                                </div>

                                {/* Schedule rows */}
                                <div className={styles.scheduleRows}>
                                    {/* Arrival row (not for first stop) */}
                                    {!isFirst && (
                                        <div className={styles.scheduleRow}>
                                            <span className={styles.scheduleLabel}>Arr</span>
                                            {status.arrived ? (
                                                <span className={`${styles.scheduleDelta} ${styles[arrDelta.status]}`}>
                                                    {arrDelta.text}
                                                </span>
                                            ) : (
                                                <span className={styles.scheduleValue}>
                                                    <span className={`${styles.scheduleCountdown} ${arrDisplay.isLate ? styles.late : ''}`}>
                                                        {arrDisplay.time}
                                                    </span>
                                                    {arrDisplay.delta && (
                                                        <span className={`${styles.predictedDelta} ${arrDisplay.delta.includes('+') ? styles.late : styles.early}`}>
                                                            {arrDisplay.delta}
                                                        </span>
                                                    )}
                                                </span>
                                            )}
                                        </div>
                                    )}

                                    {/* Departure row (not for last stop) */}
                                    {!isLast && (
                                        <div className={styles.scheduleRow}>
                                            <span className={styles.scheduleLabel}>Dep</span>
                                            {status.departed ? (
                                                <span className={`${styles.scheduleDelta} ${styles[depDelta.status]}`}>
                                                    {depDelta.text}
                                                </span>
                                            ) : (
                                                <span className={styles.scheduleValue}>
                                                    <span className={`${styles.scheduleCountdown} ${depDisplay.isLate ? styles.late : ''}`}>
                                                        {depDisplay.time}
                                                    </span>
                                                </span>
                                            )}
                                        </div>
                                    )}
                                </div>
                            </div>

                            {/* Distance */}
                            <div className={styles.stopMeta}>
                                {isPast ? (
                                    <span className={styles.checkmark}>✓</span>
                                ) : (
                                    <span className={styles.distance}>{formatDistance(distance)}</span>
                                )}
                            </div>
                        </div>
                    );
                })}
            </div>

            {renderResizeHandles()}
        </div>
    );
}

export default Transit;
