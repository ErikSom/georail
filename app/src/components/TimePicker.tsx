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
    const isScrolling = useRef(false);
    const scrollTimeout = useRef<ReturnType<typeof setTimeout>>();

    useEffect(() => {
        const container = containerRef.current;
        if (!container) return;
        const idx = items.indexOf(selected);
        if (idx >= 0) {
            container.scrollTop = idx * itemHeight;
        }
    }, []);

    const handleScroll = () => {
        isScrolling.current = true;
        if (scrollTimeout.current) clearTimeout(scrollTimeout.current);

        scrollTimeout.current = setTimeout(() => {
            const container = containerRef.current;
            if (!container) return;

            const idx = Math.round(container.scrollTop / itemHeight);
            const clamped = Math.max(0, Math.min(idx, items.length - 1));
            container.scrollTo({ top: clamped * itemHeight, behavior: 'smooth' });
            onSelect(items[clamped]);
            isScrolling.current = false;
        }, 80);
    };

    return (
        <div className={styles.wheelContainer}>
            <div className={styles.wheelHighlight} />
            <div
                ref={containerRef}
                className={styles.wheelScroll}
                onScroll={handleScroll}
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
