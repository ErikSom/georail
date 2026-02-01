import { useRef, useEffect, useState, useLayoutEffect } from 'preact/hooks';
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
    getRunningDelayMinutes,
    getCurrentGameTime,
    getScheduledTime,
    formatClockTime,
    elapsedMinutes,
    type StopStatus,
} from '../../store/journey';
import { updateTick, trainDistanceTraveled } from '../../store/train';
import styles from './Transit.module.css';

const MIN_WIDTH = 200;
const MIN_HEIGHT = 180;
const COMPACT_WIDTH_THRESHOLD = 280;

function Transit() {
    const scrollContainerRef = useRef<HTMLDivElement>(null);
    const stopRefs = useRef<(HTMLDivElement | null)[]>([]);
    const [, forceUpdate] = useState(0);
    const [dotPositions, setDotPositions] = useState<number[]>([]);

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

    // Calculate dot positions after render
    useLayoutEffect(() => {
        if (!scrollContainerRef.current) return;

        const container = scrollContainerRef.current;
        const containerRect = container.getBoundingClientRect();

        const positions: number[] = [];
        stopRefs.current.forEach((ref) => {
            if (ref) {
                const rect = ref.getBoundingClientRect();
                // Position dot at the center of the station header (first line)
                // Station header is at top of stopContent, ~15px from top of stop row
                const dotY = rect.top - containerRect.top + container.scrollTop + 15;
                positions.push(dotY);
            }
        });

        // Only update if positions actually changed
        if (positions.length !== dotPositions.length ||
            positions.some((p, i) => Math.abs(p - (dotPositions[i] ?? 0)) > 1)) {
            setDotPositions(positions);
        }
    }, [stops.value.length]);

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
    const runningDelay = getRunningDelayMinutes();
    const currentTime = getCurrentGameTime();
    const elapsed = elapsedMinutes.value;

    // Find current segment
    let currentSegmentFrom = 0;
    for (let i = 0; i < distances.length - 1; i++) {
        if (trainDistance >= distances[i] && trainDistance < distances[i + 1]) {
            currentSegmentFrom = i;
            break;
        }
        if (i === distances.length - 2 && trainDistance >= distances[i + 1]) {
            currentSegmentFrom = distances.length - 1;
        }
    }

    const segmentProgress = currentSegmentFrom < stopsArr.length - 1
        ? getProgressBetweenStops(currentSegmentFrom, currentSegmentFrom + 1)
        : 1;

    // Calculate timeline positions
    const firstDotY = dotPositions[0] ?? 15;
    const lastDotY = dotPositions[dotPositions.length - 1] ?? 15;
    const baseLineTop = firstDotY;
    const baseLineHeight = Math.max(0, lastDotY - firstDotY);

    // Calculate progress line height (up to current position)
    let progressLineHeight = 0;
    if (dotPositions.length > 1 && currentSegmentFrom < dotPositions.length) {
        const segmentStartY = dotPositions[currentSegmentFrom] ?? 0;
        const segmentEndY = dotPositions[currentSegmentFrom + 1] ?? segmentStartY;
        const currentY = segmentStartY + (segmentEndY - segmentStartY) * segmentProgress;
        progressLineHeight = currentY - firstDotY;
    }

    // Train indicator Y position
    const trainIndicatorY = firstDotY + progressLineHeight;

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
            {/* Header with current time */}
            <div className={styles.header}>
                <span className={styles.currentTime}>{formatClockTime(currentTime)}</span>
            </div>

            <div ref={scrollContainerRef} className={styles.stopList}>
                {/* Timeline layer */}
                <div className={styles.timelineContainer}>
                    {/* Base line (gray) */}
                    <div
                        className={styles.timelineBase}
                        style={{
                            top: `${baseLineTop}px`,
                            height: `${baseLineHeight}px`,
                        }}
                    />
                    {/* Progress line (green) */}
                    <div
                        className={styles.timelineProgress}
                        style={{
                            top: `${baseLineTop}px`,
                            height: `${Math.max(0, progressLineHeight)}px`,
                        }}
                    />
                    {/* Station dots */}
                    {dotPositions.map((y, idx) => {
                        const status: StopStatus = statuses[idx] || {
                            arrived: false,
                            departed: false,
                            actualArrivalTime: null,
                            actualDepartureTime: null,
                            arrivalDelta: null,
                            departureDelta: null,
                        };
                        const isFirst = idx === 0;
                        const isLast = idx === stopsArr.length - 1;
                        const isPast = status.departed || (isLast && status.arrived);
                        const isAtStation = status.arrived && !status.departed;

                        return (
                            <div
                                key={idx}
                                className={`${styles.dot} ${isFirst ? styles.origin : ''} ${isLast ? styles.destination : ''} ${isPast ? styles.past : ''} ${isAtStation ? styles.atStation : ''}`}
                                style={{ top: `${y}px` }}
                            />
                        );
                    })}
                    {/* Train indicator */}
                    <div
                        className={styles.trainIndicator}
                        style={{ top: `${trainIndicatorY}px` }}
                    />
                </div>

                {/* Stop rows */}
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
                    const isAtStation = status.arrived && !status.departed;

                    // Scheduled times as clock times
                    const scheduledArr = formatClockTime(getScheduledTime(stop.arrivalTime));
                    const scheduledDep = formatClockTime(getScheduledTime(stop.departureTime));

                    // Format deltas for completed events
                    const arrDelta = formatTimeDelta(status.arrivalDelta);
                    const depDelta = formatTimeDelta(status.departureDelta);

                    return (
                        <div
                            key={idx}
                            ref={(el) => { stopRefs.current[idx] = el; }}
                            className={`${styles.stop} ${isPast ? styles.past : ''} ${isAtStation ? styles.atStation : ''}`}
                        >
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
                                            <span className={styles.scheduleTime}>{scheduledArr}</span>
                                            {status.arrived ? (
                                                <span className={`${styles.scheduleDelta} ${styles[arrDelta.status]}`}>
                                                    {arrDelta.text}
                                                </span>
                                            ) : (
                                                runningDelay !== 0 && (
                                                    <span className={`${styles.scheduleDelta} ${runningDelay > 0 ? styles.late : styles.early}`}>
                                                        {runningDelay > 0 ? `(+${runningDelay})` : `(${runningDelay})`}
                                                    </span>
                                                )
                                            )}
                                        </div>
                                    )}

                                    {/* Departure row (not for last stop) */}
                                    {!isLast && (() => {
                                        // Calculate departure delay when at station but not yet departed
                                        const waitingDelay = status.arrived && !status.departed
                                            ? Math.floor(elapsed - stop.departureTime)
                                            : 0;

                                        return (
                                            <div className={styles.scheduleRow}>
                                                <span className={styles.scheduleLabel}>Dep</span>
                                                <span className={styles.scheduleTime}>{scheduledDep}</span>
                                                {status.departed ? (
                                                    <span className={`${styles.scheduleDelta} ${styles[depDelta.status]}`}>
                                                        {depDelta.text}
                                                    </span>
                                                ) : (
                                                    waitingDelay > 0 && (
                                                        <span className={`${styles.scheduleDelta} ${styles.late}`}>
                                                            (+{waitingDelay})
                                                        </span>
                                                    )
                                                )}
                                            </div>
                                        );
                                    })()}
                                </div>
                            </div>

                            {/* Distance */}
                            <div className={styles.stopMeta}>
                                {isPast ? (
                                    <span className={styles.checkmark}>✓</span>
                                ) : isAtStation ? (
                                    <span className={styles.distance}>0 m</span>
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
