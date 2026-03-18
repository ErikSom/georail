import { useRef, useEffect, useState, useLayoutEffect, useCallback } from 'preact/hooks';
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
    getRunningDelayMinutes,
    getCurrentGameTime,
    formatClockTime,
    getPredictedTime,
    elapsedMinutes,
    type StopStatus,
} from '../../store/journey';
import { updateTick, trainDistanceTraveled } from '../../store/train';
import { isSmallScreen } from '../../store/globals';
import styles from './Transit.module.css';
import InlineSVG from '../InlineSVG';

const MIN_SIZE = 100;
const BASE_SIZE = 200; // Below this size, content scales down
const INITIAL_WIDTH = 300;
const INITIAL_HEIGHT = 380;
const COMPACT_WIDTH_THRESHOLD = 280;

type ScrollMode = 'AUTO' | 'DRAG' | 'MOMENTUM';

function Transit() {
    const scrollContainerRef = useRef<HTMLDivElement>(null);
    const stopRefs = useRef<(HTMLDivElement | null)[]>([]);
    const [, forceUpdate] = useState(0);
    const [dotPositions, setDotPositions] = useState<number[]>([]);

    // Physics constants
    const FRICTION_COEFF = 0.004;        // Friction per ms (exponential decay)
    const MIN_VELOCITY = 0.008;          // Threshold to stop momentum

    // Physics State
    // We use a ref for physics to avoid re-renders during the animation loop
    const physics = useRef({
        mode: 'AUTO' as ScrollMode,
        velocity: 0,           // Pixels per ms
        lastY: 0,              // Last pointer Y position
        lastTime: 0,           // Timestamp of last frame
        dragStartY: 0,         // To track start of gesture
        velocitySamples: [] as number[], // Recent velocity samples for smoothing
    });

    const {
        position,
        size,
        ready,
        containerRef,
        handleContainerPointerDown,
        renderResizeHandles,
    } = useTransformable({
        initialPosition: { x: 10, y: 10 },
        initialSize: isSmallScreen
            ? { width: 136, height: 160 }
            : { width: INITIAL_WIDTH, height: INITIAL_HEIGHT },
        minSize: { width: MIN_SIZE, height: MIN_SIZE },
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

        // Calculate current scale factor (same logic as render)
        const currentWidth = size?.width ?? INITIAL_WIDTH;
        const currentHeight = size?.height ?? INITIAL_HEIGHT;
        const scale = Math.min(currentWidth / BASE_SIZE, currentHeight / BASE_SIZE, 1);

        const positions: number[] = [];
        stopRefs.current.forEach((ref) => {
            if (ref) {
                const rect = ref.getBoundingClientRect();
                // Position dot at the center of the station header (first line)
                // getBoundingClientRect returns scaled pixels, convert to unscaled coordinates
                const visualOffset = rect.top - containerRect.top;
                const dotY = (visualOffset / scale) + container.scrollTop + 18;
                positions.push(dotY);
            }
        });

        // Only update if positions actually changed
        if (positions.length !== dotPositions.length ||
            positions.some((p, i) => Math.abs(p - (dotPositions[i] ?? 0)) > 1)) {
            setDotPositions(positions);
        }
    }, [stops.value.length, size]);

    // THE MAIN PHYSICS LOOP
    // Handles Auto-Scroll (Train following) AND Momentum (After user drag)
    useEffect(() => {
        const container = scrollContainerRef.current;
        if (!container) return;

        let rafId: number;

        const loop = (time: number) => {
            // Calculate delta time (dt) in milliseconds
            // Prevent large jumps if tab was backgrounded (cap dt at 50ms)
            const rawDt = time - (physics.current.lastTime || time);
            const dt = Math.min(rawDt, 50);
            physics.current.lastTime = time;

            // --- MODE 1: AUTO (Train Following) ---
            if (physics.current.mode === 'AUTO') {
                if (dotPositions.length > 0) {
                    const trainDistance = trainDistanceTraveled.value / 1000; // km
                    const distances = stopDistances.value;
                    const stopsArr = stops.value;

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

                    // Calculate train indicator Y position
                    const firstDotY = dotPositions[0] ?? 15;
                    let trainY = firstDotY;
                    if (dotPositions.length > 1 && currentSegmentFrom < dotPositions.length) {
                        const segmentStartY = dotPositions[currentSegmentFrom] ?? 0;
                        const segmentEndY = dotPositions[currentSegmentFrom + 1] ?? segmentStartY;
                        trainY = segmentStartY + (segmentEndY - segmentStartY) * segmentProgress;
                    }

                    // Get container visible height
                    const containerHeight = container.clientHeight;

                    // Calculate offset based on arrival status
                    const statuses = stopStatuses.value;
                    const isAtStation = statuses.some(s => s?.arrived && !s?.departed);
                    const offsetRatio = isAtStation ? 0.4 : 0.3;

                    // Calculate target scroll position
                    const targetScroll = trainY - (containerHeight * offsetRatio);

                    // Clamp to valid scroll range
                    const maxScroll = container.scrollHeight - containerHeight;
                    const clampedTarget = Math.max(0, Math.min(targetScroll, maxScroll));

                    // Smooth interpolation towards target
                    const currentScroll = container.scrollTop;
                    const distance = clampedTarget - currentScroll;

                    // Only scroll if we're more than 0.5px away
                    if (Math.abs(distance) > 0.5) {
                        // Faster lerp for larger distances, slower for fine adjustment
                        const lerpFactor = Math.abs(distance) > 50 ? 0.12 : 0.08;
                        const step = distance * lerpFactor;
                        // Ensure minimum movement so we don't get stuck
                        const minStep = 0.5;
                        const actualStep = Math.abs(step) < minStep ? Math.sign(distance) * minStep : step;
                        container.scrollTop = currentScroll + actualStep;
                    }
                }
            }
            // --- MODE 2: DRAG (User is holding) ---
            else if (physics.current.mode === 'DRAG') {
                // Movement happens in onPointerMove.
                // We keep the loop running to maintain time tracking.
            }
            // --- MODE 3: MOMENTUM (User let go) ---
            else if (physics.current.mode === 'MOMENTUM') {
                const maxScroll = container.scrollHeight - container.clientHeight;

                // Apply velocity with time-based friction
                container.scrollTop -= physics.current.velocity * dt;

                // Exponential decay based on time (frame-rate independent)
                physics.current.velocity *= Math.exp(-FRICTION_COEFF * dt);

                // Check if we've hit a boundary - add extra friction
                const currentScroll = container.scrollTop;
                if (currentScroll <= 0 || currentScroll >= maxScroll) {
                    physics.current.velocity *= 0.5;
                }

                // Stop condition: If very slow, snap to AUTO
                if (Math.abs(physics.current.velocity) < MIN_VELOCITY) {
                    physics.current.mode = 'AUTO';
                    physics.current.velocity = 0;
                }
            }

            rafId = requestAnimationFrame(loop);
        };

        rafId = requestAnimationFrame(loop);

        return () => {
            cancelAnimationFrame(rafId);
        };
    }, [dotPositions]);

    // --- Custom Pointer Event Handlers for Scrolling ---

    const onPointerDown = useCallback((e: PointerEvent) => {
        if (!scrollContainerRef.current) return;

        // IMPORTANT: Prevent default browser dragging/scrolling
        e.preventDefault();
        e.stopPropagation();

        // Capture pointer to track it even if it leaves the div
        scrollContainerRef.current.setPointerCapture(e.pointerId);

        physics.current.mode = 'DRAG';
        physics.current.lastY = e.clientY;
        physics.current.dragStartY = e.clientY;
        physics.current.velocity = 0;
        physics.current.velocitySamples = []; // Clear samples for fresh tracking
    }, []);

    const onPointerMove = useCallback((e: PointerEvent) => {
        if (!scrollContainerRef.current || physics.current.mode !== 'DRAG') return;

        e.preventDefault();

        const deltaY = e.clientY - physics.current.lastY;
        const now = performance.now();
        const dt = now - (physics.current.lastTime || now);

        // Move the scroll immediately (1:1 movement)
        // deltaY > 0 means mouse moved DOWN, so we scroll UP (decrease scrollTop)
        scrollContainerRef.current.scrollTop -= deltaY;

        // Calculate and store velocity samples for momentum
        if (dt > 0 && dt < 100) { // Ignore stale samples
            const newVelocity = deltaY / dt;
            // Keep last 5 samples for averaging
            physics.current.velocitySamples.push(newVelocity);
            if (physics.current.velocitySamples.length > 5) {
                physics.current.velocitySamples.shift();
            }
        }

        physics.current.lastY = e.clientY;
        physics.current.lastTime = now;
    }, []);

    const onPointerUp = useCallback((e: PointerEvent) => {
        if (!scrollContainerRef.current) return;

        // Release capture
        try {
            scrollContainerRef.current.releasePointerCapture(e.pointerId);
        } catch (err) {
            // Ignore if already released
        }

        // Calculate final velocity from recent samples (weighted average, recent = more weight)
        const samples = physics.current.velocitySamples;
        if (samples.length > 0) {
            let totalWeight = 0;
            let weightedSum = 0;
            samples.forEach((v, i) => {
                const weight = i + 1; // More recent samples have higher weight
                weightedSum += v * weight;
                totalWeight += weight;
            });
            physics.current.velocity = weightedSum / totalWeight;
        }

        // Clear samples for next gesture
        physics.current.velocitySamples = [];

        // Switch to momentum mode
        physics.current.mode = 'MOMENTUM';
    }, []);

    // Don't render if no journey
    if (!journeyStartTime.value || stops.value.length === 0) {
        return null;
    }

    const currentWidth = size?.width ?? INITIAL_WIDTH;
    const currentHeight = size?.height ?? INITIAL_HEIGHT;

    // Calculate scale factor - scale down when below BASE_SIZE
    const scale = Math.min(currentWidth / BASE_SIZE, currentHeight / BASE_SIZE, 1);
    const contentWidth = currentWidth / scale;
    const contentHeight = currentHeight / scale;

    const isCompact = currentWidth < COMPACT_WIDTH_THRESHOLD;
    const stopsArr = stops.value;
    const distances = stopDistances.value;
    const statuses = stopStatuses.value;
    const trainDistance = trainDistanceTraveled.value / 1000; // km
    const runningDelay = getRunningDelayMinutes();
    const currentTime = getCurrentGameTime();
    const elapsed = elapsedMinutes.value;

    // Find the first unarrived stop (the one we're heading to)
    const nextStopIdx = statuses.findIndex(s => !s?.arrived);
    const firstUnarrivedIdx = nextStopIdx === -1 ? stopsArr.length : nextStopIdx;

    // Find current segment (for timeline calculation only, physics loop does its own)
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
            {/* Scale wrapper - scales content when below BASE_SIZE */}
            <div
                className={styles.scaleWrapper}
                style={{
                    width: `${contentWidth}px`,
                    height: `${contentHeight}px`,
                    transform: scale < 1 ? `scale(${scale})` : undefined,
                }}
            >
                {/* Content wrapper for overflow/border-radius */}
                <div
                    className={styles.content}
                    style={{
                        borderRadius: `calc(var(--ui-radius) / ${scale})`,
                    }}
                >
                    {/* Header with current time (including seconds) */}
                    <div className={styles.header}>
                        <span className={styles.currentTime}>{formatClockTime(currentTime, true)}</span>
                    </div>

                    <div
                        ref={scrollContainerRef}
                        className={styles.stopList}
                        data-no-drag
                        // CRITICAL: CSS property to disable browser handling of gestures
                        style={{ touchAction: 'none' }}
                        // Custom Scrolling Handlers
                        onPointerDown={onPointerDown}
                        onPointerMove={onPointerMove}
                        onPointerUp={onPointerUp}
                        onPointerCancel={onPointerUp} // Treat cancel as up for safety
                    >
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
                                            {!isFirst && (() => {
                                                // Determine the delay to use for this arrival
                                                let arrivalDelay: number;
                                                if (status.arrived) {
                                                    arrivalDelay = status.arrivalDelta ?? 0;
                                                } else if (idx === firstUnarrivedIdx) {
                                                    // Immediate next stop - show actual running delay
                                                    arrivalDelay = runningDelay;
                                                } else {
                                                    // Future stops - early arrivals don't cascade (we wait at stations)
                                                    arrivalDelay = Math.max(0, runningDelay);
                                                }
                                                const predictedArrTime = getPredictedTime(stop.arrivalTime, arrivalDelay);
                                                const hasDelay = arrivalDelay !== 0;
                                                const delayStatus = arrivalDelay > 0 ? 'late' : arrivalDelay < 0 ? 'early' : 'ontime';

                                                return (
                                                    <div className={styles.scheduleRow}>
                                                        <span className={styles.scheduleLabel}>Arr</span>
                                                        <span className={`${styles.scheduleTime} ${hasDelay ? styles[delayStatus] : ''}`}>
                                                            {formatClockTime(predictedArrTime)}
                                                        </span>
                                                        {hasDelay && (
                                                            <span className={`${styles.scheduleDelta} ${styles[delayStatus]}`}>
                                                                ({arrivalDelay > 0 ? '+' : ''}{arrivalDelay})
                                                            </span>
                                                        )}
                                                    </div>
                                                );
                                            })()}

                                            {/* Departure row (not for last stop) */}
                                            {!isLast && (() => {
                                                // Calculate departure delay
                                                let departureDelay: number;
                                                if (status.departed) {
                                                    departureDelay = status.departureDelta ?? 0;
                                                } else if (status.arrived) {
                                                    // Waiting at station - delay is at least the arrival delay,
                                                    // or how long we've waited past scheduled departure
                                                    const arrDelay = status.arrivalDelta ?? 0;
                                                    const waitingPastSchedule = Math.floor(elapsed - stop.departureTime);
                                                    departureDelay = Math.max(0, arrDelay, waitingPastSchedule);
                                                } else {
                                                    // Not yet arrived - no departure delay to show
                                                    departureDelay = 0;
                                                }
                                                const predictedDepTime = getPredictedTime(stop.departureTime, departureDelay);
                                                const hasDelay = departureDelay !== 0;
                                                const delayStatus = departureDelay > 0 ? 'late' : departureDelay < 0 ? 'early' : 'ontime';

                                                return (
                                                    <div className={styles.scheduleRow}>
                                                        <span className={styles.scheduleLabel}>Dep</span>
                                                        <span className={`${styles.scheduleTime} ${hasDelay ? styles[delayStatus] : ''}`}>
                                                            {formatClockTime(predictedDepTime)}
                                                        </span>
                                                        {hasDelay && (
                                                            <span className={`${styles.scheduleDelta} ${styles[delayStatus]}`}>
                                                                ({departureDelay > 0 ? '+' : ''}{departureDelay})
                                                            </span>
                                                        )}
                                                    </div>
                                                );
                                            })()}
                                        </div>
                                    </div>

                                    {/* Distance */}
                                    <div className={styles.stopMeta}>
                                        {isPast ? (
                                            <InlineSVG src="icons/circle-check.svg" className={styles.checkmark} />
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
                </div>
            </div>

            {renderResizeHandles()}
        </div>
    );
}

export default Transit;
