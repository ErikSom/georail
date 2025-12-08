import { h } from 'preact';
import { useState, useEffect } from 'preact/hooks';
import { fetchAllStations, type StationTrackInfo } from '../lib/api/station';
import { fetchRouteByName, type RouteData } from '../lib/Georail';
import styles from './TravelPicker.module.css';

interface TravelPickerProps {
    onRouteSelected: (routeData: RouteData) => void;
}

type TabType = 'regular' | 'custom';

export default function TravelPicker({ onRouteSelected }: TravelPickerProps) {
    const [activeTab, setActiveTab] = useState<TabType>('custom');
    const [stations, setStations] = useState<StationTrackInfo[]>([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const [fetchingRoute, setFetchingRoute] = useState(false);

    // Form state
    const [fromStation, setFromStation] = useState<string>('');
    const [fromTrack, setFromTrack] = useState<string>('');
    const [toStation, setToStation] = useState<string>('');
    const [toTrack, setToTrack] = useState<string>('');

    // Available tracks for selected stations
    const [fromTracks, setFromTracks] = useState<string[]>([]);
    const [toTracks, setToTracks] = useState<string[]>([]);

    useEffect(() => {
        loadStations();
    }, []);

    // Update available tracks when station selection changes
    useEffect(() => {
        if (fromStation) {
            const station = stations.find(s => s.name === fromStation);
            setFromTracks(station?.tracks || []);
            setFromTrack('');
        } else {
            setFromTracks([]);
            setFromTrack('');
        }
    }, [fromStation, stations]);

    useEffect(() => {
        if (toStation) {
            const station = stations.find(s => s.name === toStation);
            setToTracks(station?.tracks || []);
            setToTrack('');
        } else {
            setToTracks([]);
            setToTrack('');
        }
    }, [toStation, stations]);

    const loadStations = async () => {
        try {
            setLoading(true);
            const data = await fetchAllStations();
            setStations(data);
            setError(null);
        } catch (err) {
            setError('Failed to load stations. Please try again.');
            console.error(err);
        } finally {
            setLoading(false);
        }
    };

    const handleGo = async () => {
        if (!fromStation || !toStation) {
            setError('Please select both from and to stations');
            return;
        }

        if (activeTab === 'regular') {
            setError('Regular route planning is not yet available. Please use the Custom tab.');
            return;
        }

        try {
            setFetchingRoute(true);
            setError(null);

            const routeData = await fetchRouteByName(
                fromStation,
                fromTrack || null,
                toStation,
                toTrack || null,
                false
            );

            onRouteSelected(routeData);
        } catch (err) {
            setError(err instanceof Error ? err.message : 'Failed to fetch route');
            console.error(err);
        } finally {
            setFetchingRoute(false);
        }
    };

    const canSubmit = fromStation && toStation && !fetchingRoute;

    return (
        <div className={styles.overlay}>
            <div className={styles.container}>
                <h1 className={styles.title}>Plan Your Journey</h1>

                {/* Tabs */}
                <div className={styles.tabs}>
                    <button
                        className={`${styles.tab} ${activeTab === 'regular' ? styles.activeTab : ''}`}
                        onClick={() => setActiveTab('regular')}
                    >
                        Regular
                    </button>
                    <button
                        className={`${styles.tab} ${activeTab === 'custom' ? styles.activeTab : ''}`}
                        onClick={() => setActiveTab('custom')}
                    >
                        Custom
                    </button>
                </div>

                {/* Content */}
                <div className={styles.content}>
                    {loading ? (
                        <div className={styles.loading}>Loading stations...</div>
                    ) : (
                        <>
                            {/* From Station */}
                            <div className={styles.field}>
                                <label className={styles.label}>From</label>
                                <select
                                    className={styles.select}
                                    value={fromStation}
                                    onChange={(e) => setFromStation((e.target as HTMLSelectElement).value)}
                                    disabled={fetchingRoute}
                                >
                                    <option value="">Select station</option>
                                    {stations.map((station) => (
                                        <option key={station.name} value={station.name}>
                                            {station.name}
                                        </option>
                                    ))}
                                </select>
                            </div>

                            {/* From Track (only in custom tab) */}
                            {activeTab === 'custom' && fromTracks.length > 0 && (
                                <div className={styles.field}>
                                    <label className={styles.label}>From Track (optional)</label>
                                    <select
                                        className={styles.select}
                                        value={fromTrack}
                                        onChange={(e) => setFromTrack((e.target as HTMLSelectElement).value)}
                                        disabled={fetchingRoute}
                                    >
                                        <option value="">Any track</option>
                                        {fromTracks.map((track) => (
                                            <option key={track} value={track}>
                                                {track}
                                            </option>
                                        ))}
                                    </select>
                                </div>
                            )}

                            {/* Swap button */}
                            <div className={styles.swapContainer}>
                                <button
                                    className={styles.swapButton}
                                    onClick={() => {
                                        const tempStation = fromStation;
                                        const tempTrack = fromTrack;
                                        setFromStation(toStation);
                                        setFromTrack(toTrack);
                                        setToStation(tempStation);
                                        setToTrack(tempTrack);
                                    }}
                                    disabled={fetchingRoute}
                                    title="Swap stations"
                                >
                                    ⇅
                                </button>
                            </div>

                            {/* To Station */}
                            <div className={styles.field}>
                                <label className={styles.label}>To</label>
                                <select
                                    className={styles.select}
                                    value={toStation}
                                    onChange={(e) => setToStation((e.target as HTMLSelectElement).value)}
                                    disabled={fetchingRoute}
                                >
                                    <option value="">Select station</option>
                                    {stations.map((station) => (
                                        <option key={station.name} value={station.name}>
                                            {station.name}
                                        </option>
                                    ))}
                                </select>
                            </div>

                            {/* To Track (only in custom tab) */}
                            {activeTab === 'custom' && toTracks.length > 0 && (
                                <div className={styles.field}>
                                    <label className={styles.label}>To Track (optional)</label>
                                    <select
                                        className={styles.select}
                                        value={toTrack}
                                        onChange={(e) => setToTrack((e.target as HTMLSelectElement).value)}
                                        disabled={fetchingRoute}
                                    >
                                        <option value="">Any track</option>
                                        {toTracks.map((track) => (
                                            <option key={track} value={track}>
                                                {track}
                                            </option>
                                        ))}
                                    </select>
                                </div>
                            )}

                            {/* Error message */}
                            {error && <div className={styles.error}>{error}</div>}

                            {/* Go button */}
                            <button
                                className={styles.goButton}
                                onClick={handleGo}
                                disabled={!canSubmit}
                            >
                                {fetchingRoute ? 'Loading route...' : 'Go'}
                            </button>
                        </>
                    )}
                </div>
            </div>
        </div>
    );
}
