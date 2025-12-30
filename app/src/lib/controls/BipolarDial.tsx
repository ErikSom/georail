
import { useEffect, useMemo, useRef, useState } from 'preact/hooks';
import styles from './BipolarDial.module.css';
import type { CSSProperties } from 'preact';

interface BipolarDialProps {
    min?: number;
    max?: number;
    value: number;
    step?: number;
    onChange: (val: number) => void;
    size?: number;
    ticks?: number;
}

function BipolarDial({
    min = -100,
    max = 100,
    value,
    step = 1,
    onChange,
    size = 220,
    ticks = 41,
}: BipolarDialProps) {


    // --- Constants ---
    const MAX_ANGLE = 150;
    const TOTAL_RANGE = MAX_ANGLE * 2;

    // --- Refs for Physics Logic (Mutable state that doesn't trigger re-renders) ---
    const wrapperRef = useRef<HTMLDivElement>(null);
    const audioCtxRef = useRef<AudioContext | null>(null);
    const lastMousePos = useRef<{ x: number; y: number }>({ x: 0, y: 0 });
    const isDragging = useRef(false);
    const rollingDelta = useRef<number[]>([]);

    // Sticky Zero Logic State
    const stickiness = useRef(0);
    const isStuckAtZero = useRef(false);
    const currentAngleRef = useRef(0); // Tracks the physics angle

    // --- React State for Rendering ---
    const [displayAngle, setDisplayAngle] = useState(0);

    // --- Audio Engine ---
    const initAudio = () => {
        if (!audioCtxRef.current) {
            const AudioContext = window.AudioContext || (window as any).webkitAudioContext;
            if (AudioContext) {
                audioCtxRef.current = new AudioContext();
            }
        }
        if (audioCtxRef.current?.state === 'suspended') {
            audioCtxRef.current.resume();
        }
    };

    const lastTickTime = useRef(0);

    const playTick = (isMajor: boolean) => {
        const ctx = audioCtxRef.current;
        if (!ctx) return;

        // Debounce minor ticks
        if (!isMajor && Date.now() < lastTickTime.current + 50) return;
        lastTickTime.current = Date.now();

        const t = ctx.currentTime;
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();

        osc.connect(gain);
        gain.connect(ctx.destination);

        osc.type = 'triangle';

        // Slight randomization for organic feel
        const randomDetune = (Math.random() - 0.5) * 10;
        const startFreq = 30;
        const endFreq = 30;

        osc.frequency.setValueAtTime(startFreq + randomDetune, t);
        if (startFreq !== endFreq) {
            osc.frequency.exponentialRampToValueAtTime(endFreq, t + 0.008);
        }

        gain.gain.setValueAtTime(0, t);
        gain.gain.linearRampToValueAtTime(0.15, t + 0.001);
        gain.gain.exponentialRampToValueAtTime(0.001, t + 0.008);

        osc.start(t);
        osc.stop(t + 0.008 + 0.01);
    };

    const triggerFeedback = (newValue: number) => {
        // Major tick every 20 units (or roughly 10% of range if dynamic)
        const isMajor = Math.abs(newValue) % 20 === 0;

        playTick(isMajor);

        if (navigator.vibrate) {
            navigator.vibrate(isMajor ? 20 : 4);
        }
    };

    // --- Math Helpers ---

    // Convert Value to Angle
    const valueToAngle = (val: number) => {
        const clamped = Math.min(max, Math.max(min, val));
        const percent = (clamped - min) / (max - min);
        return -MAX_ANGLE + (percent * TOTAL_RANGE);
    };

    // Convert Angle to Value
    const angleToValue = (angle: number) => {
        const percent = (angle + MAX_ANGLE) / TOTAL_RANGE;
        const rawValue = min + (percent * (max - min));
        // Snap to step
        let stepped = Math.round(rawValue / step) * step;
        return Math.min(max, Math.max(min, stepped));
    };

    // --- Effects ---

    // Sync internal angle when external value changes
    useEffect(() => {
        const newAngle = valueToAngle(value);
        currentAngleRef.current = newAngle;
        setDisplayAngle(newAngle);
    }, [value, min, max]);

    // --- Event Handlers ---

    const handlePointerDown = (e: PointerEvent) => {
        e.preventDefault();
        if (wrapperRef.current) {
            wrapperRef.current.setPointerCapture(e.pointerId);
        }

        isDragging.current = true;
        lastMousePos.current = { x: e.clientX, y: e.clientY };
        rollingDelta.current = [];
        initAudio();
    };

    const handlePointerMove = (e: PointerEvent) => {
        if (!isDragging.current || !wrapperRef.current) return;
        e.preventDefault();

        const dx = e.clientX - lastMousePos.current.x;
        const dy = e.clientY - lastMousePos.current.y;

        const rect = wrapperRef.current.getBoundingClientRect();
        const centerX = rect.left + rect.width / 2;
        const centerY = rect.top + rect.height / 2;

        // Mouse position relative to center
        const mx = e.clientX - centerX;
        const my = e.clientY - centerY;

        // Radius from center
        let dist = Math.sqrt(mx * mx + my * my);
        dist = Math.max(25, dist); // Prevent division by zero close to center

        // Torque Calculation (Tangential force)
        const torque = (mx * dy - my * dx);

        // Convert Torque to Angle (approximate arc length physics)
        let deltaRad = torque / (dist * dist);
        let delta = deltaRad * (180 / Math.PI);

        // Velocity / Acceleration Logic
        rollingDelta.current.push(Math.abs(delta));
        if (rollingDelta.current.length > 5) rollingDelta.current.shift();

        const avgSpeed = rollingDelta.current.reduce((a: number, b: number) => a + b, 0) / rollingDelta.current.length;
        let velocityFactor = 1.0;
        if (avgSpeed > 2.0) {
            velocityFactor = 1.0 + ((avgSpeed - 2.0) * 0.5);
            velocityFactor = Math.min(velocityFactor, 3.0);
        }
        delta *= velocityFactor;

        // Sticky Zero Logic
        let nextAngle = currentAngleRef.current;

        if (isStuckAtZero.current) {
            stickiness.current += delta;
            const stickThreshold = 20;

            if (Math.abs(stickiness.current) > stickThreshold) {
                isStuckAtZero.current = false;
                // Apply the overflow
                nextAngle = stickiness.current > 0
                    ? (stickiness.current - stickThreshold)
                    : (stickiness.current + stickThreshold);
            } else {
                nextAngle = 0;
            }
        } else {
            nextAngle += delta;

            // Check if we crossed zero
            const crossedFromPos = currentAngleRef.current > 0 && nextAngle <= 0;
            const crossedFromNeg = currentAngleRef.current < 0 && nextAngle >= 0;

            if (crossedFromPos || crossedFromNeg) {
                isStuckAtZero.current = true;
                stickiness.current = 0;
                nextAngle = 0;
                if (navigator.vibrate) navigator.vibrate(30); // Stronger bump for zero
            }
        }

        // Clamp Angle
        nextAngle = Math.max(-MAX_ANGLE, Math.min(MAX_ANGLE, nextAngle));

        // Update Refs
        currentAngleRef.current = nextAngle;
        lastMousePos.current = { x: e.clientX, y: e.clientY };

        // Calculate Value
        const nextValue = angleToValue(nextAngle);

        // Update Visuals (Local state)
        setDisplayAngle(nextAngle);

        // Notify Parent (Only if step value changed)
        if (nextValue !== value) {
            triggerFeedback(nextValue);
            onChange(nextValue);
        }
    };

    const handlePointerUp = () => {
        isDragging.current = false;
        rollingDelta.current = [];
        if (Math.abs(currentAngleRef.current) < 0.1) {
            isStuckAtZero.current = false;
        }
    };

    // --- Rendering Helpers ---

    // Generate color based on angle (Green -> Red gradient usually, or Bipolar intensity)
    const getDynamicColor = (angle: number) => {
        const absAngle = Math.abs(angle);
        // 120 (Green) down to 0 (Red) based on distance from center
        const hue = 120 - (absAngle / MAX_ANGLE) * 120;
        return {
            color: `hsl(${hue}, 100%, 50%)`,
            shadow: `hsl(${hue}, 100%, 70%)`,
            text: `hsl(${hue}, 80%, 60%)`
        };
    };

    const themeColors = getDynamicColor(displayAngle);

    // Generate Ticks
    const renderedTicks = useMemo(() => {
        const tickElements = [];
        const radius = size / 2;
        const tickDistance = radius - 20;

        for (let i = 0; i < ticks; i++) {
            const ratio = i / (ticks - 1);
            const angle = -MAX_ANGLE + (ratio * TOTAL_RANGE);

            // Logic for active state
            // Bipolar: Active if between 0 and current angle
            let isActive = false;
            const tolerance = 2;

            if (displayAngle > 0) {
                if (angle > 0 && angle <= displayAngle + tolerance) isActive = true;
            } else if (displayAngle < 0) {
                if (angle < 0 && angle >= displayAngle - tolerance) isActive = true;
            }
            // Zero point active if value exists
            if (Math.abs(angle) < 0.1 && Math.abs(displayAngle) > 0) isActive = true;

            // Color logic for this specific tick
            const tickTheme = getDynamicColor(angle);

            const style: CSSProperties = {
                transform: `rotate(${angle}deg) translateY(-${tickDistance}px)`,
                // We inject CSS variables here for the class active state
                ['--tick-color' as any]: tickTheme.color,
                ['--tick-shadow' as any]: tickTheme.shadow,
            };

            tickElements.push(
                <div
                    key={i}
                    className={`${styles.scalePoint} ${isActive ? styles.scalePointActive : ''}`}
                    style={style}
                />
            );
        }
        return tickElements;
    }, [ticks, size, displayAngle]); // Re-calc if angle changes for active highlighting

    return (
        <div
            className={styles.knobWrapper}
            ref={wrapperRef}
            style={{ width: size, height: size } as CSSProperties}
            onPointerDown={handlePointerDown}
            onPointerMove={handlePointerMove}
            onPointerUp={handlePointerUp}
            onPointerLeave={handlePointerUp}
        >
            <div className={styles.knobScale}>
                {renderedTicks}
            </div>

            <div className={styles.knobDial}>
                <div
                    className={styles.knobIndicator}
                    style={{ transform: `rotate(${displayAngle}deg)` }}
                />
            </div>

            <div
                className={styles.knobValue}
            >
                {value.toFixed(step < 1 ? 2 : 0)}
            </div>
        </div>
    );
};

export default BipolarDial;