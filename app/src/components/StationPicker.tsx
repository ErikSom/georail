import { useState, useEffect, useRef } from 'preact/hooks';
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
}

export default function StationPicker({
    stations,
    selectedStation,
    selectedTrack,
    availableTracks,
    onSelectStation,
    onSelectTrack,
    disabled,
}: StationPickerProps) {
    const [isOpen, setIsOpen] = useState(false);
    const [searchQuery, setSearchQuery] = useState('');
    const [pickingTrack, setPickingTrack] = useState(false);
    const containerRef = useRef<HTMLDivElement>(null);
    const inputRef = useRef<HTMLInputElement>(null);

    // Click-outside handler
    useEffect(() => {
        if (!isOpen) return;
        const handleClickOutside = (e: Event) => {
            if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
                setIsOpen(false);
                setSearchQuery('');
                setPickingTrack(false);
            }
        };
        document.addEventListener('mousedown', handleClickOutside);
        document.addEventListener('touchstart', handleClickOutside);
        return () => {
            document.removeEventListener('mousedown', handleClickOutside);
            document.removeEventListener('touchstart', handleClickOutside);
        };
    }, [isOpen]);

    // Auto-focus input when opened
    useEffect(() => {
        if (isOpen && !pickingTrack && inputRef.current) {
            inputRef.current.focus();
        }
    }, [isOpen, pickingTrack]);

    const filteredStations = searchQuery
        ? stations.filter(s => s.name.toLowerCase().includes(searchQuery.toLowerCase())).slice(0, 50)
        : stations.slice(0, 50);

    const handleStationClick = (station: StationTrackInfo) => {
        onSelectStation(station.name);
        if (station.tracks && station.tracks.length > 0) {
            setPickingTrack(true);
            setSearchQuery('');
        } else {
            setIsOpen(false);
            setSearchQuery('');
        }
    };

    const handleTrackClick = (track: string) => {
        onSelectTrack(track);
        setIsOpen(false);
        setPickingTrack(false);
        setSearchQuery('');
    };

    if (!isOpen) {
        return (
            <div ref={containerRef} className={styles.container}>
                <button
                    className={styles.display}
                    onClick={() => !disabled && setIsOpen(true)}
                    disabled={disabled}
                >
                    <span className={selectedStation ? undefined : styles.placeholder}>
                        {selectedStation || 'Select station'}
                    </span>
                    {selectedTrack && (
                        <span className={styles.trackBadge}>{selectedTrack}</span>
                    )}
                </button>
            </div>
        );
    }

    return (
        <div ref={containerRef} className={styles.container}>
            {pickingTrack ? (
                <div>
                    <div className={styles.trackHeader}>Select track</div>
                    <div className={styles.trackList}>
                        <button className={styles.trackOption} onClick={() => handleTrackClick('')}>
                            Any
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
                    <div className={styles.resultsList}>
                        {filteredStations.map(station => (
                            <button
                                key={station.code}
                                className={styles.resultItem}
                                onClick={() => handleStationClick(station)}
                            >
                                {station.name}
                            </button>
                        ))}
                        {filteredStations.length === 0 && (
                            <div className={styles.noResults}>No stations found</div>
                        )}
                    </div>
                </>
            )}
        </div>
    );
}
