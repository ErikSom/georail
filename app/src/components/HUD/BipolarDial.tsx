import { useEffect, useMemo, useRef, useState } from "preact/hooks";
import type { CSSProperties, JSX } from "preact";
import styles from "./BipolarDial.module.css";

interface BipolarDialProps {
    min?: number;
    max?: number;
    value: number; // controlled input (used to sync when not dragging)
    step?: number;
    onChange: (val: number) => void;
    size?: number;
    ticks?: number;
}

const MAX_ANGLE = 150;
const TOTAL_RANGE = MAX_ANGLE * 2;
const STICK_THRESHOLD = 20;
const TICK_DISTANCE = 24;

const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));

const stepDecimals = (step: number) => (step.toString().split(".")[1] || "").length;

function BipolarDial({
    min = -100,
    max = 100,
    value,
    step = 1,
    onChange,
    size = 220,
    ticks = 41,
}: BipolarDialProps) {
    // --- Physics State ---
    const wrapperRef = useRef<HTMLDivElement | null>(null);
    const isDragging = useRef(false);
    const lastMousePos = useRef<{ x: number; y: number }>({ x: 0, y: 0 });
    const rollingDelta = useRef<number[]>([]);

    const currentAngleRef = useRef(0); // continuous physics angle
    const isStuckAtZero = useRef(false);
    const stickiness = useRef(0);

    // --- “Internal” knob value (parity with original this.value) ---
    const internalValueRef = useRef<number>(value);

    // --- Rendering State (parity: display is based on stepped value, not physics angle) ---
    const [displayAngle, setDisplayAngle] = useState(0); // snapped angle derived from internal value
    const [displayValue, setDisplayValue] = useState<number>(value); // internal knob value for UI
    const [tooltipPos, setTooltipPos] = useState<{ x: number; y: number } | null>(null);

    // --- Audio ---
    const audioCtxRef = useRef<AudioContext | null>(null);
    const lastTickTime = useRef(0);

    const initAudio = () => {
        if (!audioCtxRef.current) {
            const Ctor = window.AudioContext || (window as any).webkitAudioContext;
            if (Ctor) audioCtxRef.current = new Ctor();
        }
        if (audioCtxRef.current?.state === "suspended") {
            void audioCtxRef.current.resume();
        }
    };

    const playTick = (isMajor: boolean) => {
        const ctx = audioCtxRef.current;
        if (!ctx) return;

        if (!isMajor && Date.now() < lastTickTime.current + 50) return;
        lastTickTime.current = Date.now();

        const t = ctx.currentTime;
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();

        osc.connect(gain);
        gain.connect(ctx.destination);

        osc.type = "triangle";

        const randomDetune = (Math.random() - 0.5) * 10;
        const startFreq = 30 + randomDetune;
        const duration = 0.008;

        osc.frequency.setValueAtTime(startFreq, t);

        gain.gain.setValueAtTime(0, t);
        gain.gain.linearRampToValueAtTime(0.15, t + 0.001);
        gain.gain.exponentialRampToValueAtTime(0.001, t + duration);

        osc.start(t);
        osc.stop(t + duration + 0.01);
    };

    const triggerFeedback = (newValue: number) => {
        const isMajor = Math.abs(newValue) % 20 === 0;
        playTick(isMajor);

        if (navigator.vibrate) {
            navigator.vibrate(isMajor ? 20 : 4);
        }
    };

    // --- Conversion ---
    const valueToAngle = (val: number) => {
        const clamped = clamp(val, min, max);
        const percent = (clamped - min) / (max - min);
        return -MAX_ANGLE + percent * TOTAL_RANGE;
    };

    // --- Parity update (equivalent to original updateByValue) ---
    const updateByValue = (newValue: number, syncState: boolean) => {
        internalValueRef.current = newValue;
        setDisplayValue(newValue);

        const percent = (newValue - min) / (max - min);
        const angle = -MAX_ANGLE + percent * TOTAL_RANGE;

        if (syncState) {
            currentAngleRef.current = angle;
        }

        setDisplayAngle(angle);
    };

    // --- Sync from parent when not dragging (parity with original calling updateByValue(value, true)) ---
    useEffect(() => {
        if (!isDragging.current) {
            updateByValue(value, true);
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [value, min, max]);

    // --- Window listeners (parity: original listens on window for move/up) ---
    useEffect(() => {
        const onMove = (e: PointerEvent) => {
            if (!isDragging.current || !wrapperRef.current) return;
            e.preventDefault();

            const dx = e.clientX - lastMousePos.current.x;
            const dy = e.clientY - lastMousePos.current.y;

            const rect = wrapperRef.current.getBoundingClientRect();
            const centerX = rect.left + rect.width / 2;
            const centerY = rect.top + rect.height / 2;

            const mx = e.clientX - centerX;
            const my = e.clientY - centerY;

            // distance clamp
            let dist = Math.sqrt(mx * mx + my * my);
            dist = Math.max(25, dist);

            // torque -> angular change
            const torque = mx * dy - my * dx;
            const deltaRad = torque / (dist * dist);
            let delta = deltaRad * (180 / Math.PI);

            // acceleration logic (exact)
            rollingDelta.current.push(Math.abs(delta));
            if (rollingDelta.current.length > 5) rollingDelta.current.shift();

            const avgSpeed =
                rollingDelta.current.reduce((a, b) => a + b, 0) / rollingDelta.current.length;

            let velocityFactor = 1.0;
            if (avgSpeed > 2.0) {
                velocityFactor = 1.0 + (avgSpeed - 2.0) * 0.5;
                velocityFactor = Math.min(velocityFactor, 3.0);
            }

            delta *= velocityFactor;

            // sticky zero logic (exact)
            if (isStuckAtZero.current) {
                stickiness.current += delta;

                if (Math.abs(stickiness.current) > STICK_THRESHOLD) {
                    isStuckAtZero.current = false;
                    currentAngleRef.current =
                        stickiness.current > 0
                            ? stickiness.current - STICK_THRESHOLD
                            : stickiness.current + STICK_THRESHOLD;
                } else {
                    currentAngleRef.current = 0;
                }
            } else {
                const prev = currentAngleRef.current;
                const next = prev + delta;

                const crossedFromPos = prev > 0 && next <= 0;
                const crossedFromNeg = prev < 0 && next >= 0;

                if (crossedFromPos || crossedFromNeg) {
                    isStuckAtZero.current = true;
                    stickiness.current = 0;
                    currentAngleRef.current = 0;

                    if (navigator.vibrate) navigator.vibrate(30);
                } else {
                    currentAngleRef.current = next;
                }
            }

            currentAngleRef.current = clamp(currentAngleRef.current, -MAX_ANGLE, MAX_ANGLE);

            // physics angle -> value (exact)
            const percent = (currentAngleRef.current + MAX_ANGLE) / TOTAL_RANGE;
            const rawValue = min + percent * (max - min);

            let steppedValue = Math.round(rawValue / step) * step;
            steppedValue = clamp(steppedValue, min, max);

            const prevValue = internalValueRef.current;

            // feedback BEFORE updating internal value (exact)
            if (steppedValue !== prevValue) {
                triggerFeedback(steppedValue);
                onChange(steppedValue);
            }

            // always update visuals/value (exact)
            updateByValue(steppedValue, false);

            // update tooltip position
            // client coords -> wrapper-local coords (control panel is transformed)
            setTooltipPos({ x: e.clientX - rect.left, y: e.clientY - rect.top });

            // last mouse update at end (exact)
            lastMousePos.current = { x: e.clientX, y: e.clientY };
        };

        const onUp = () => {
            if (!isDragging.current) return;

            isDragging.current = false;
            rollingDelta.current.length = 0;
            setTooltipPos(null);

            if (Math.abs(currentAngleRef.current) < 0.1) {
                isStuckAtZero.current = false;
            }
        };

        window.addEventListener("pointermove", onMove, { passive: false });
        window.addEventListener("pointerup", onUp);
        window.addEventListener("pointercancel", onUp);

        return () => {
            window.removeEventListener("pointermove", onMove as any);
            window.removeEventListener("pointerup", onUp as any);
            window.removeEventListener("pointercancel", onUp as any);
        };
    }, [min, max, step, onChange]);

    // --- Pointer down ---
    const handlePointerDown = (e: JSX.TargetedPointerEvent<HTMLDivElement>) => {
        const rect = wrapperRef.current?.getBoundingClientRect();
        if (wrapperRef.current) wrapperRef.current.setPointerCapture(e.pointerId);

        isDragging.current = true;
        lastMousePos.current = { x: e.clientX, y: e.clientY };
        rollingDelta.current.length = 0;
        if (rect) {
            setTooltipPos({ x: e.clientX - rect.left, y: e.clientY - rect.top });
        }

        initAudio();
    };

    // --- Ticks ---
    const renderedTicks = useMemo(() => {
        const out: JSX.Element[] = [];
        const radius = size / 2;
        const tickDistance = radius - TICK_DISTANCE;

        for (let i = 0; i < ticks; i++) {
            const ratio = i / (ticks - 1);
            const angle = -MAX_ANGLE + ratio * TOTAL_RANGE;

            const tolerance = 2;
            let isActive = false;

            if (displayAngle > 0) {
                if (angle > 0 && angle <= displayAngle + tolerance) isActive = true;
            } else if (displayAngle < 0) {
                if (angle < 0 && angle >= displayAngle - tolerance) isActive = true;
            }

            const isZero = Math.abs(angle) < 0.1;
            if (isZero && Math.abs(displayValue) >= step) {
                isActive = true;
            }

            const style: CSSProperties = {
                transform: `rotate(${angle}deg) translateY(-${tickDistance}px)`,
            };

            out.push(
                <div
                    key={i}
                    className={`${styles.scalePoint} ${isActive ? styles.scalePointActive : ""}`}
                    style={style}
                />
            );
        }

        return out;
    }, [ticks, size, displayAngle, displayValue, step]);

    const decimals = stepDecimals(step);

    return (
        <>
            <div
                className={styles.knobWrapper}
                ref={wrapperRef}
                style={{ width: size, height: size } as CSSProperties}
                onPointerDown={handlePointerDown}
            >
                <div className={styles.knobScale}>{renderedTicks}</div>

                <div className={styles.knobDial}>
                    <div className={styles.knobIndicator} style={{ transform: `rotate(${displayAngle}deg)` }} />
                </div>

                <div className={styles.knobValue}>
                    {displayValue.toFixed(decimals)}
                </div>

                {tooltipPos && (
                    <div
                        className={styles.tooltip}
                        style={{
                            left: `${tooltipPos.x}px`,
                            top: `${tooltipPos.y - 30}px`,
                        }}
                    >
                        {displayValue.toFixed(decimals)}
                    </div>
                )}
            </div>
        </>
    );
}

export default BipolarDial;
