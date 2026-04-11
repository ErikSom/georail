import { useState, useEffect, useRef } from 'preact/hooks';
import IconButton from './IconButton';
import InlineSVG from '../InlineSVG';
import { hudSettings, setHudSetting, masterVolume, setMasterVolume, type HudSettings } from '../../store/globals';
import styles from './GameMenu.module.css';

const TOGGLES: { key: keyof HudSettings; label: string }[] = [
    { key: 'showMap2D', label: 'Map' },
    { key: 'showSpeedometer', label: 'Speedometer' },
    { key: 'showTransit', label: 'Transit' },
];

function volumeIcon(volume: number): string {
    if (volume === 0) return '/icons/volume-mute.svg';
    if (volume < 0.5) return '/icons/volume-down.svg';
    return '/icons/volume-up.svg';
}

interface Props {
    onExit: () => void;
}

function GameMenu({ onExit }: Props) {
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

    const volume = masterVolume.value;

    return (
        <div ref={containerRef} className={styles.container}>
            <IconButton
                icon="/icons/settings.svg"
                onClick={() => setIsOpen(!isOpen)}
                ariaLabel="Game menu"
                iconSize={24}
            />

            <div className={`${styles.panel} ${isOpen ? styles.panelOpen : ''}`}>
                <div className={styles.section}>
                    <div className={styles.sectionTitle}>Widgets</div>
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

                <div className={styles.section}>
                    <div className={styles.sectionTitle}>Volume</div>
                    <div className={styles.volumeRow}>
                        <span className={styles.volumeIcon}>
                            <InlineSVG src={volumeIcon(volume)} width={20} height={20} />
                        </span>
                        <input
                            type="range"
                            min="0"
                            max="1"
                            step="0.01"
                            value={volume}
                            onInput={(e) => setMasterVolume(parseFloat((e.target as HTMLInputElement).value))}
                            className={styles.slider}
                            style={{ '--fill': `${volume * 100}%` } as Record<string, string>}
                            aria-label="Master volume"
                        />
                    </div>
                </div>

                <button className={styles.exitButton} onClick={onExit}>
                    Exit to menu
                </button>
            </div>
        </div>
    );
}

export default GameMenu;
