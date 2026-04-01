import { useState, useEffect, useRef, useCallback } from 'preact/hooks';
import type { StationTrackInfo } from '../lib/api/station';
import styles from './StationPicker.module.css';

interface StationPickerProps {
    stations: StationTrackInfo[];
    selectedStation: string;
    selectedTrack: string;
    availableTracks: string[];
    onSelectStation: (stationName: string) => void;
    onSelectTrack: (track: string) => void;
    disabled?: boolean;
    label?: string;
}

const isTouchDevice = () => window.matchMedia('(pointer: coarse)').matches;

export default function StationPicker({
    stations,
    selectedStation,
    selectedTrack,
    availableTracks,
    onSelectStation,
    onSelectTrack,
    disabled,
    label,
}: StationPickerProps) {
    const [isOpen, setIsOpen] = useState(false);
    const [searchQuery, setSearchQuery] = useState('');
    const [pickingTrack, setPickingTrack] = useState(false);
    const [mobileMode, setMobileMode] = useState(false);
    const [viewportHeight, setViewportHeight] = useState<number | null>(null);
    const containerRef = useRef<HTMLDivElement>(null);
    const inputRef = useRef<HTMLInputElement>(null);

    const close = useCallback(() => {
        setIsOpen(false);
        setSearchQuery('');
        setPickingTrack(false);
        setMobileMode(false);
    }, []);

    // Click-outside handler (desktop only)
    useEffect(() => {
        if (!isOpen || mobileMode) return;
        const handleClickOutside = (e: Event) => {
            if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
                close();
            }
        };
        document.addEventListener('mousedown', handleClickOutside);
        document.addEventListener('touchstart', handleClickOutside);
        return () => {
            document.removeEventListener('mousedown', handleClickOutside);
            document.removeEventListener('touchstart', handleClickOutside);
        };
    }, [isOpen, mobileMode, close]);

    // Track visual viewport height for mobile (keyboard detection)
    useEffect(() => {
        if (!isOpen || !mobileMode) return;
        const vv = window.visualViewport;
        if (!vv) return;

        const update = () => setViewportHeight(vv.height);
        update();
        vv.addEventListener('resize', update);
        return () => vv.removeEventListener('resize', update);
    }, [isOpen, mobileMode]);

    // Auto-focus input when opened
    useEffect(() => {
        if (isOpen && !pickingTrack && inputRef.current) {
            inputRef.current.focus();
        }
    }, [isOpen, pickingTrack]);

    const handleOpen = () => {
        if (disabled) return;
        const mobile = isTouchDevice();
        setMobileMode(mobile);
        setIsOpen(true);
    };

    const filteredStations = searchQuery
        ? stations.filter(s => s.name.toLowerCase().includes(searchQuery.toLowerCase())).slice(0, 50)
        : stations;

    console.log("**** Filtered stations:", filteredStations, searchQuery)

    const handleStationClick = (station: StationTrackInfo) => {
        onSelectStation(station.name);
        if (station.tracks && station.tracks.length > 0) {
            setPickingTrack(true);
            setSearchQuery('');
        } else {
            close();
        }
    };

    const handleTrackClick = (track: string) => {
        onSelectTrack(track);
        close();
    };

    if (!isOpen) {
        return (
            <div ref={containerRef} className={styles.container}>
                <button
                    className={styles.display}
                    onClick={handleOpen}
                    disabled={disabled}
                >
                    {label && <span className={styles.label}>{label}</span>}
                    <span className={styles.displayStation}>
                        <span className={selectedStation ? styles.selectedStation : styles.placeholder}>
                            {selectedStation || 'Select station'}
                        </span>
                        {selectedTrack && (
                            <span className={styles.trackBadge}>{selectedTrack}</span>
                        )}
                    </span>
                </button>
            </div>
        );
    }

    const pickerContent = pickingTrack ? (
        <div className={styles.trackPicker}>
            <div className={styles.trackList}>
                <button className={styles.trackOption} onClick={() => handleTrackClick('')}>
                    Any track
                </button>
                {[...availableTracks].sort((a, b) => {
                    const numA = parseInt(a), numB = parseInt(b);
                    if (numA !== numB) return numA - numB;
                    return a.localeCompare(b);
                }).map(track => (
                    <button key={track} className={styles.trackOption} onClick={() => handleTrackClick(track)}>
                        {track}
                    </button>
                ))}
            </div>
        </div>
    ) : (
        <>
            <input
                ref={inputRef}
                type="text"
                className={styles.searchInput}
                value={searchQuery}
                onInput={(e) => setSearchQuery((e.target as HTMLInputElement).value)}
                placeholder="Search stations..."
            />
            <div key={searchQuery} className={`${mobileMode ? styles.mobileResultsList : styles.resultsList} thinScroll`}>
                {filteredStations.map(station => {
                    console.log("**** Rendering station:", station.name, station.code);
                    return (
                        <button
                            key={station.code}
                            className={styles.resultItem}
                            onClick={() => handleStationClick(station)}
                        >
                            {station.name}
                        </button>
                    )
                })}
                {filteredStations.length === 0 && (
                    <div className={styles.noResults}>No stations found</div>
                )}
            </div>
        </>
    );

    // Mobile mode: fixed overlay at top of screen
    if (mobileMode) {
        return (
            <div ref={containerRef} className={styles.container}>
                <div className={styles.mobileBackdrop} onClick={close} />
                <div
                    className={styles.mobileOverlay}
                    style={viewportHeight ? { maxHeight: `${viewportHeight - 16}px` } : undefined}
                >
                    <div className={styles.mobileHeader}>
                        <span className={styles.mobileTitle}>
                            {pickingTrack ? 'Select track' : label ? `${label} — Select station` : 'Select station'}
                        </span>
                        <button className={styles.mobileClose} onClick={close}>✕</button>
                    </div>
                    {pickerContent}
                </div>
            </div>
        );
    }

    // Desktop mode: dropdown
    return (
        <div ref={containerRef} className={styles.container} data-picker-open>
            {label && <div className={styles.label}>{label}</div>}
            {pickingTrack ? (
                <>
                    <div className={styles.display}>
                        <span className={styles.selectedStation}>{selectedStation}</span>
                    </div>
                    {pickerContent}
                </>
            ) : (
                pickerContent
            )}
        </div>
    );
}
