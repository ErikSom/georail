import { useState, useEffect, useRef } from 'preact/hooks';
import IconButton from './IconButton';
import { hudSettings, setHudSetting, type HudSettings } from '../../store/globals';
import styles from './GUIControls.module.css';

const TOGGLES: { key: keyof HudSettings; label: string }[] = [
    { key: 'showMap2D', label: 'Map' },
    { key: 'showSpeedometer', label: 'Speedometer' },
    { key: 'showTransit', label: 'Transit' },
];

function GUIControls({ className }: { className?: string }) {
    const [isOpen, setIsOpen] = useState(false);
    const containerRef = useRef<HTMLDivElement>(null);

    useEffect(() => {
        if (!isOpen) return;

        const handlePointerDown = (e: PointerEvent) => {
            if (containerRef.current?.contains(e.target as Node)) return;
            setIsOpen(false);
        };

        document.addEventListener('pointerdown', handlePointerDown);
        return () => document.removeEventListener('pointerdown', handlePointerDown);
    }, [isOpen]);

    return (
        <div ref={containerRef} className={className}>
            <IconButton
                icon="/icons/settings.svg"
                onClick={() => setIsOpen(!isOpen)}
                ariaLabel="Toggle GUI settings"
            />

            <div className={`${styles.panel} ${isOpen ? styles.panelOpen : ''}`}>
                {TOGGLES.map(({ key, label }) => (
                    <label key={key} className={styles.row}>
                        <span className={styles.label}>{label}</span>
                        <span className={styles.switch}>
                            <input
                                type="checkbox"
                                checked={hudSettings.value[key]}
                                onChange={() => setHudSetting(key, !hudSettings.value[key])}
                            />
                            <span className={styles.lever} />
                        </span>
                    </label>
                ))}
            </div>
        </div >
    );
}

export default GUIControls;
