import { useRef, useEffect, useState } from 'preact/hooks';
import styles from './TimePicker.module.css';

interface TimePickerProps {
    hour: number;
    minute: number;
    onChange: (hour: number, minute: number) => void;
}

function ScrollWheel({ items, selected, onSelect }: {
    items: number[];
    selected: number;
    onSelect: (value: number) => void;
}) {
    const containerRef = useRef<HTMLDivElement>(null);
    const itemHeight = 40;
    const scrollTimeout = useRef<ReturnType<typeof setTimeout>>();
    const dragState = useRef<{ active: boolean; startY: number; startScroll: number }>({ active: false, startY: 0, startScroll: 0 });

    useEffect(() => {
        const container = containerRef.current;
        if (!container) return;
        const idx = items.indexOf(selected);
        if (idx >= 0) {
            container.scrollTop = idx * itemHeight;
        }
    }, []);

    const snapToNearest = () => {
        if (scrollTimeout.current) clearTimeout(scrollTimeout.current);
        scrollTimeout.current = setTimeout(() => {
            const container = containerRef.current;
            if (!container) return;
            const idx = Math.round(container.scrollTop / itemHeight);
            const clamped = Math.max(0, Math.min(idx, items.length - 1));
            container.scrollTo({ top: clamped * itemHeight, behavior: 'smooth' });
            onSelect(items[clamped]);
        }, 80);
    };

    const handleScroll = () => {
        if (dragState.current.active) return;
        snapToNearest();
    };

    const handlePointerDown = (e: PointerEvent) => {
        const container = containerRef.current;
        if (!container) return;
        if (scrollTimeout.current) clearTimeout(scrollTimeout.current);
        dragState.current = { active: true, startY: e.clientY, startScroll: container.scrollTop };
        container.setPointerCapture(e.pointerId);
    };

    const handlePointerMove = (e: PointerEvent) => {
        if (!dragState.current.active) return;
        const container = containerRef.current;
        if (!container) return;
        const delta = dragState.current.startY - e.clientY;
        container.scrollTop = dragState.current.startScroll + delta;
    };

    const handlePointerUp = () => {
        if (!dragState.current.active) return;
        dragState.current.active = false;
        snapToNearest();
    };

    return (
        <div className={styles.wheelContainer}>
            <div className={styles.wheelHighlight} />
            <div
                ref={containerRef}
                className={styles.wheelScroll}
                onScroll={handleScroll}
                onPointerDown={handlePointerDown}
                onPointerMove={handlePointerMove}
                onPointerUp={handlePointerUp}
                onPointerCancel={handlePointerUp}
                style={{ touchAction: 'none' }}
            >
                <div style={{ height: `${itemHeight}px` }} />
                {items.map(item => (
                    <div
                        key={item}
                        className={`${styles.wheelItem} ${item === selected ? styles.wheelItemActive : ''}`}
                        style={{ height: `${itemHeight}px` }}
                        onClick={() => {
                            const container = containerRef.current;
                            if (!container) return;
                            const idx = items.indexOf(item);
                            container.scrollTo({ top: idx * itemHeight, behavior: 'smooth' });
                            onSelect(item);
                        }}
                    >
                        {String(item).padStart(2, '0')}
                    </div>
                ))}
                <div style={{ height: `${itemHeight}px` }} />
            </div>
        </div>
    );
}

const HOURS = Array.from({ length: 24 }, (_, i) => i);
const MINUTES = Array.from({ length: 12 }, (_, i) => i * 5);

export default function TimePicker({ hour, minute, onChange }: TimePickerProps) {
    const [h, setH] = useState(hour);
    const [m, setM] = useState(minute);

    useEffect(() => { onChange(h, m); }, [h, m]);

    return (
        <div className={styles.picker}>
            <ScrollWheel items={HOURS} selected={h} onSelect={setH} />
            <div className={styles.separator}>:</div>
            <ScrollWheel items={MINUTES} selected={m} onSelect={setM} />
        </div>
    );
}
