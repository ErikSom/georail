import type { JSX } from "preact";
import { useMemo } from "preact/hooks";
import { formatSpeed, getSpeedUnit, KMH_TO_MPH } from "../../lib/utils/Units";
import styles from './Speedometer.module.css';

// Arc from bottom-left to bottom-right (270 degrees, like a real train speedometer)
// In our coordinate system: 0° = up, 90° = right, 180° = down, 270° = left
const START_ANGLE = 225;  // degrees (0 speed - bottom left, ~7:30 position)
const END_ANGLE = 495;    // degrees (maxSpeed - bottom right, ~4:30 position, going clockwise through top)
const TOTAL_RANGE = END_ANGLE - START_ANGLE; // 270 degrees

interface SpeedometerAnalogProps {
    speed: number; // in km/h
    maxSpeed: number; // in km/h
    unitSystem: 'metric' | 'imperial';
}

function speedToAngle(speed: number, maxSpeed: number): number {
    const clampedSpeed = Math.max(0, Math.min(speed, maxSpeed));
    const ratio = clampedSpeed / maxSpeed;
    return START_ANGLE + (ratio * TOTAL_RANGE);
}

function polarToCartesian(cx: number, cy: number, radius: number, angleDeg: number) {
    const angleRad = (angleDeg - 90) * (Math.PI / 180);
    return {
        x: cx + radius * Math.cos(angleRad),
        y: cy + radius * Math.sin(angleRad),
    };
}

function SpeedometerAnalog({ speed, maxSpeed, unitSystem }: SpeedometerAnalogProps) {
    const displaySpeed = formatSpeed(speed, unitSystem);
    const displayMaxSpeed = unitSystem === 'imperial'
        ? Math.round(maxSpeed * KMH_TO_MPH)
        : maxSpeed;
    const unit = getSpeedUnit(unitSystem);

    // Calculate needle angle
    const needleAngle = speedToAngle(speed, maxSpeed);

    const size = 160;
    const cx = size / 2;
    const cy = size / 2;
    const outerRadius = 70;
    const majorTickLength = 14;
    const minorTickLength = 8;
    const microTickLength = 4;
    const labelRadius = outerRadius - majorTickLength - 2; // Position labels just inside tick ends

    // Generate tick marks and labels
    const ticks = useMemo(() => {
        const result: JSX.Element[] = [];

        // Determine tick intervals based on maxSpeed
        let majorInterval: number;
        if (displayMaxSpeed <= 80) majorInterval = 10;
        else if (displayMaxSpeed <= 120) majorInterval = 20;
        else if (displayMaxSpeed <= 200) majorInterval = 20;
        else majorInterval = 40;

        const minorInterval = majorInterval / 2;
        const microInterval = majorInterval / 4;

        // Generate ticks from 0 to displayMaxSpeed
        for (let value = 0; value <= displayMaxSpeed; value += microInterval) {
            const ratio = value / displayMaxSpeed;
            const angle = START_ANGLE + (ratio * TOTAL_RANGE);

            const isMajor = value % majorInterval === 0;
            const isMinor = !isMajor && value % minorInterval === 0;
            const tickLength = isMajor ? majorTickLength : isMinor ? minorTickLength : microTickLength;
            const tickClass = isMajor ? styles.tickMajor : isMinor ? styles.tick : styles.tickMicro;

            const outer = polarToCartesian(cx, cy, outerRadius, angle);
            const inner = polarToCartesian(cx, cy, outerRadius - tickLength, angle);

            result.push(
                <line
                    key={`tick-${value}`}
                    x1={outer.x}
                    y1={outer.y}
                    x2={inner.x}
                    y2={inner.y}
                    className={tickClass}
                />
            );

            // Add labels at major ticks
            if (isMajor) {
                const labelPos = polarToCartesian(cx, cy, labelRadius, angle);

                // Calculate offset based on angle to push label away from center
                // This prevents labels from overlapping with tick marks
                const angleRad = (angle - 90) * (Math.PI / 180);
                const charWidth = 6.5; // estimated width per character at current font size
                const textWidth = String(value).length * charWidth;
                const textHeight = 11; // approximate font height
                const padding = 2;

                // Push label outward based on its position around the dial
                const dx = -Math.cos(angleRad) * (textWidth / 2 + padding);
                const dy = -Math.sin(angleRad) * (textHeight / 2 + padding);

                result.push(
                    <text
                        key={`label-${value}`}
                        x={labelPos.x + dx}
                        y={labelPos.y + dy}
                        className={styles.tickLabel}
                    >
                        {value}
                    </text>
                );
            }
        }

        return result;
    }, [displayMaxSpeed, cx, cy, outerRadius, majorTickLength, minorTickLength, labelRadius]);

    // Arc path for the outer ring
    const arcPath = useMemo(() => {
        const start = polarToCartesian(cx, cy, outerRadius, START_ANGLE);
        const end = polarToCartesian(cx, cy, outerRadius, END_ANGLE);
        // Large arc flag is 1 since we're drawing more than 180 degrees
        return `M ${start.x} ${start.y} A ${outerRadius} ${outerRadius} 0 1 1 ${end.x} ${end.y}`;
    }, [cx, cy]);

    // Needle path - a pointed triangle
    const needleLength = 70;
    const needleWidth = 4;

    const readoutYOffset = 36;

    return (
        <svg
            viewBox={`0 0 ${size} ${size}`}
            width={size}
            height={size}
            className={styles.analogDial}
        >
            {/* Outer arc */}
            <path
                d={arcPath}
                fill="none"
                stroke="var(--text-dim)"
                strokeWidth="2"
                opacity="0.3"
            />

            {/* Tick marks and labels */}
            <g>{ticks}</g>

            {/* Needle */}
            <g transform={`rotate(${needleAngle}, ${cx}, ${cy})`}>
                <polygon
                    points={`${cx},${cy - needleLength} ${cx - needleWidth},${cy - 8} ${cx + needleWidth},${cy - 8}`}
                    className={styles.needle}
                    fill="var(--led-amber)"
                />
            </g>

            {/* Center cap */}
            <circle
                cx={cx}
                cy={cy}
                r="8"
                className={styles.centerCap}
            />
            <circle
                cx={cx}
                cy={cy}
                r="4"
                fill="var(--text-dim)"
            />

            {/* Digital readout - centered with monospace font for stability */}
            <text
                x={cx}
                y={cy + readoutYOffset + 16}
                className={styles.analogValue}
            >
                {displaySpeed}
            </text>
            <text
                x={cx}
                y={cy + readoutYOffset + 30}
                className={styles.analogUnit}
            >
                {unit}
            </text>
        </svg>
    );
}

export default SpeedometerAnalog;
