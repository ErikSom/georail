import { useState, useEffect } from 'preact/hooks';
import type { RouteInfo } from '../lib/types/Patch';
import { fetchAllStations, type StationTrackInfo } from '../lib/api/station';
import { submitPatch } from '../lib/api/patches';

import styles from './PatchCreator.module.css';

interface PatchCreatorProps {
    onClose: () => void;
    onSubmit: (patchId: number, routeInfo: RouteInfo) => void;
}

function PatchCreator({ onClose, onSubmit }: PatchCreatorProps) {
    const [stations, setStations] = useState<StationTrackInfo[]>([]);
    const [loading, setLoading] = useState(true);
    const [fromStation, setFromStation] = useState('');
    const [fromTrack, setFromTrack] = useState('');
    const [toStation, setToStation] = useState('');
    const [toTrack, setToTrack] = useState('');
    const [description, setDescription] = useState('');

    useEffect(() => {
        loadStations();
    }, []);

    const loadStations = async () => {
        try {
            setLoading(true);
            const data = await fetchAllStations();
            setStations(data);
        } catch (err) {
            console.error('Error loading stations:', err);
            alert('Failed to load stations. Please try again.');
        } finally {
            setLoading(false);
        }
    };

    const getTracksForStation = (stationName: string): string[] => {
        const station = stations.find(s => s.name === stationName);
        return station?.tracks || [];
    };

    const handleSubmit = async (e: Event) => {
        e.preventDefault();

        if (!fromStation || !toStation) {
            alert('Please provide both from and to stations');
            return;
        }

        try {
            setLoading(true);

            // Create empty patch with route info
            const result = await submitPatch({
                data: [], // Empty data initially
                fromStation,
                fromTrack: fromTrack || undefined,
                toStation,
                toTrack: toTrack || undefined,
                description: description || undefined,
            });

            const patchId = result.patchId;

            onSubmit(patchId, {
                fromStation,
                fromTrack,
                toStation,
                toTrack,
                description: description || undefined,
            });
        } catch (err) {
            console.error('Error creating patch:', err);
            alert('Failed to create patch. Please try again.');
        } finally {
            setLoading(false);
        }
    };

    const getTitle = () => {
        if (!fromStation || !toStation) return 'New Patch';
        const fromTrackText = fromTrack ? ` (${fromTrack})` : '';
        const toTrackText = toTrack ? ` (${toTrack})` : '';
        return `${fromStation}${fromTrackText} → ${toStation}${toTrackText}`;
    };

    if (loading) {
        return (
            <div className={styles.overlay}>
                <div className={styles.modal}>
                    <div className={styles.loading}>Loading stations...</div>
                </div>
            </div>
        );
    }

    const fromTracks = getTracksForStation(fromStation);
    const toTracks = getTracksForStation(toStation);

    return (
        <div className={styles.overlay}>
            <div className={styles.modal}>
                <div className={styles.header}>
                    <h2 className={styles.title}>Create New Patch</h2>
                    <button onClick={onClose} className={styles.closeButton}>
                        ✕
                    </button>
                </div>

                <form onSubmit={handleSubmit} className={styles.form}>
                    <div className={styles.preview}>
                        <div className={styles.previewLabel}>Patch Title:</div>
                        <div className={styles.previewTitle}>{getTitle()}</div>
                    </div>

                    <div className={styles.section}>
                        <h3 className={styles.sectionTitle}>From Station</h3>
                        <div className={styles.inputGroup}>
                            <label className={styles.label}>
                                Station Name *
                                <select
                                    value={fromStation}
                                    onChange={(e) => {
                                        setFromStation((e.target as HTMLSelectElement).value);
                                        setFromTrack(''); // Reset track when station changes
                                    }}
                                    className={styles.select}
                                    required
                                >
                                    <option value="">Select a station...</option>
                                    {stations.map((station) => (
                                        <option key={station.name} value={station.name}>
                                            {station.name}
                                        </option>
                                    ))}
                                </select>
                            </label>
                            <label className={styles.label}>
                                Track
                                <select
                                    value={fromTrack}
                                    onChange={(e) => setFromTrack((e.target as HTMLSelectElement).value)}
                                    className={styles.select}
                                    disabled={!fromStation || fromTracks.length === 0}
                                >
                                    <option value="">Select a track...</option>
                                    {fromTracks.map((track) => (
                                        <option key={track} value={track}>
                                            {track}
                                        </option>
                                    ))}
                                </select>
                            </label>
                        </div>
                    </div>

                    <div className={styles.section}>
                        <h3 className={styles.sectionTitle}>To Station</h3>
                        <div className={styles.inputGroup}>
                            <label className={styles.label}>
                                Station Name *
                                <select
                                    value={toStation}
                                    onChange={(e) => {
                                        setToStation((e.target as HTMLSelectElement).value);
                                        setToTrack(''); // Reset track when station changes
                                    }}
                                    className={styles.select}
                                    required
                                >
                                    <option value="">Select a station...</option>
                                    {stations.map((station) => (
                                        <option key={station.name} value={station.name}>
                                            {station.name}
                                        </option>
                                    ))}
                                </select>
                            </label>
                            <label className={styles.label}>
                                Track
                                <select
                                    value={toTrack}
                                    onChange={(e) => setToTrack((e.target as HTMLSelectElement).value)}
                                    className={styles.select}
                                    disabled={!toStation || toTracks.length === 0}
                                >
                                    <option value="">Select a track...</option>
                                    {toTracks.map((track) => (
                                        <option key={track} value={track}>
                                            {track}
                                        </option>
                                    ))}
                                </select>
                            </label>
                        </div>
                    </div>

                    <div className={styles.section}>
                        <label className={styles.label}>
                            Description (Optional)
                            <textarea
                                value={description}
                                onInput={(e) => setDescription((e.target as HTMLTextAreaElement).value)}
                                placeholder="Describe what changes you'll be making..."
                                className={styles.textarea}
                                rows={4}
                            />
                        </label>
                    </div>

                    <div className={styles.footer}>
                        <button type="button" onClick={onClose} className={styles.cancelButton}>
                            Cancel
                        </button>
                        <button type="submit" className={styles.submitButton}>
                            Continue to Editor
                        </button>
                    </div>
                </form>
            </div>
        </div>
    );
}

export default PatchCreator;
