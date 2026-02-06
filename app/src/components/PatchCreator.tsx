import { useState, useEffect } from 'preact/hooks';
import type { RouteInfo, OpenRoute } from '../lib/types/Patch';
import { fetchAllStations, type StationTrackInfo } from '../lib/api/station';

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
    const [suggesting, setSuggesting] = useState(false);
    const [suggestion, setSuggestion] = useState<OpenRoute | null>(null);
    const [cachedRoutes, setCachedRoutes] = useState<OpenRoute[]>([]);
    const [routeIndex, setRouteIndex] = useState(0);

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

            const { submitPatch } = await import('../lib/api/patches');

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

            // Look up station codes
            const fromStationData = stations.find(s => s.name === fromStation);
            const toStationData = stations.find(s => s.name === toStation);

            onSubmit(patchId, {
                fromStation,
                fromStationCode: fromStationData?.code || '',
                fromTrack,
                toStation,
                toStationCode: toStationData?.code || '',
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

    const applySuggestion = (route: OpenRoute) => {
        setSuggestion(route);

        const fromMatch = stations.find(s => s.name === route.station_a);
        const toMatch = stations.find(s => s.name === route.station_b);

        setFromStation(fromMatch?.name || route.station_a);
        setFromTrack(fromMatch?.tracks?.[0] || '');
        setToStation(toMatch?.name || route.station_b);
        setToTrack(toMatch?.tracks?.[0] || '');
    };

    const fetchAndApplyRoutes = async () => {
        try {
            setSuggesting(true);
            const { fetchOpenRoutes } = await import('../lib/api/patches');
            const routes = await fetchOpenRoutes({ limit: 10 });
            if (routes.length === 0) {
                alert('No open routes found!');
                return;
            }
            setCachedRoutes(routes);
            setRouteIndex(0);
            applySuggestion(routes[0]);
        } catch (err) {
            console.error('Error fetching open routes:', err);
            alert('Failed to fetch route suggestions.');
        } finally {
            setSuggesting(false);
        }
    };

    const handleSuggestRoute = async () => {
        if (cachedRoutes.length === 0) {
            await fetchAndApplyRoutes();
            return;
        }

        const nextIndex = routeIndex + 1;
        if (nextIndex >= cachedRoutes.length) {
            // Exhausted cache, fetch a fresh batch
            setCachedRoutes([]);
            await fetchAndApplyRoutes();
        } else {
            setRouteIndex(nextIndex);
            applySuggestion(cachedRoutes[nextIndex]);
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

                    <button
                        type="button"
                        onClick={handleSuggestRoute}
                        className={styles.suggestButton}
                        disabled={suggesting}
                    >
                        {suggesting ? 'Finding route...' : 'Suggest a route'}
                    </button>
                    {suggestion && (
                        <div className={styles.suggestionInfo}>
                            {suggestion.line_description || `Line ${suggestion.line_ref}`}
                            {' — '}
                            {suggestion.length_km} km, {suggestion.points_to_do} points
                        </div>
                    )}

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
