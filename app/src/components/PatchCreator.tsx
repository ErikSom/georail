import { useState, useEffect } from 'preact/hooks';
import type { RouteInfo, ViaStop, OpenRoute } from '../lib/types/Patch';
import { fetchAllStations, type StationTrackInfo } from '../lib/api/station';
import { country } from '../store/globals';

import styles from './PatchCreator.module.css';

interface PatchCreatorProps {
    onClose: () => void;
    onSubmit: (patchId: number, routeInfo: RouteInfo) => void;
}

interface ViaStopLocal {
    station: string;
    track: string;
}

function PatchCreator({ onClose, onSubmit }: PatchCreatorProps) {
    const [stations, setStations] = useState<StationTrackInfo[]>([]);
    const [loading, setLoading] = useState(true);
    const [fromStation, setFromStation] = useState('');
    const [fromTrack, setFromTrack] = useState('');
    const [toStation, setToStation] = useState('');
    const [toTrack, setToTrack] = useState('');
    const [viaStops, setViaStops] = useState<ViaStopLocal[]>([]);
    const [shortcode, setShortcode] = useState('');
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
            const data = await fetchAllStations(country.value);
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

    const getStationByCode = (code: string): StationTrackInfo | undefined => {
        return stations.find(s => s.code?.toLowerCase() === code.toLowerCase());
    };

    const parseShortcode = (input: string) => {
        const trimmed = input.trim();
        if (!trimmed) return;

        let parts: string[] = [];

        if (trimmed.startsWith('[')) {
            try {
                const arr = JSON.parse(trimmed);
                if (Array.isArray(arr) && arr.every(s => typeof s === 'string')) {
                    parts = arr;
                }
            } catch {
                return;
            }
        } else {
            parts = trimmed.split(',').map(s => s.trim()).filter(Boolean);
        }

        if (parts.length < 2) return;

        const parseStop = (part: string) => {
            // Format: CODE-track or just CODE
            const dashIdx = part.indexOf('-');
            if (dashIdx !== -1) {
                return { code: part.slice(0, dashIdx), track: part.slice(dashIdx + 1) };
            }
            return { code: part, track: '' };
        };

        const parsed = parts.map(parseStop);

        const fromData = getStationByCode(parsed[0].code);
        const toData = getStationByCode(parsed[parsed.length - 1].code);

        if (!fromData || !toData) {
            alert(`Could not find stations for codes: ${!fromData ? parsed[0].code : parsed[parsed.length - 1].code}`);
            return;
        }

        setFromStation(fromData.name);
        setFromTrack(parsed[0].track);
        setToStation(toData.name);
        setToTrack(parsed[parsed.length - 1].track);

        if (parsed.length > 2) {
            const via = parsed.slice(1, -1).map(p => {
                const s = getStationByCode(p.code);
                return { station: s?.name || '', track: p.track };
            }).filter(v => v.station);
            setViaStops(via);
        } else {
            setViaStops([]);
        }
    };

    const addViaStop = () => {
        setViaStops(prev => [...prev, { station: '', track: '' }]);
    };

    const removeViaStop = (index: number) => {
        setViaStops(prev => prev.filter((_, i) => i !== index));
    };

    const updateViaStop = (index: number, field: 'station' | 'track', value: string) => {
        setViaStops(prev => prev.map((v, i) => {
            if (i !== index) return v;
            if (field === 'station') return { station: value, track: '' };
            return { ...v, [field]: value };
        }));
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

            const resolvedViaStops: ViaStop[] = viaStops
                .filter(v => v.station)
                .map(v => {
                    const s = stations.find(st => st.name === v.station);
                    return { station: v.station, stationCode: s?.code || '', track: v.track };
                });

            const result = await submitPatch({
                data: [],
                fromStation,
                fromTrack: fromTrack || undefined,
                toStation,
                toTrack: toTrack || undefined,
                viaStops: resolvedViaStops.length > 0 ? resolvedViaStops : undefined,
                description: description || undefined,
            });

            const patchId = result.patchId;

            const fromStationData = stations.find(s => s.name === fromStation);
            const toStationData = stations.find(s => s.name === toStation);

            onSubmit(patchId, {
                fromStation,
                fromStationCode: fromStationData?.code || '',
                fromTrack,
                toStation,
                toStationCode: toStationData?.code || '',
                toTrack,
                viaStops: resolvedViaStops.length > 0 ? resolvedViaStops : undefined,
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
        setViaStops([]);
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
            setCachedRoutes([]);
            await fetchAndApplyRoutes();
        } else {
            setRouteIndex(nextIndex);
            applySuggestion(cachedRoutes[nextIndex]);
        }
    };

    const getTitle = () => {
        if (!fromStation || !toStation) return 'New Patch';
        const fromText = fromStation + (fromTrack ? ` (${fromTrack})` : '');
        const toText = toStation + (toTrack ? ` (${toTrack})` : '');
        if (viaStops.length > 0) {
            const viaText = viaStops.filter(v => v.station).map(v => v.station + (v.track ? ` (${v.track})` : '')).join(' → ');
            return `${fromText} → ${viaText} → ${toText}`;
        }
        return `${fromText} → ${toText}`;
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
                        <label className={styles.label}>
                            Journey shortcode
                            <div className={styles.shortcodeRow}>
                                <input
                                    type="text"
                                    value={shortcode}
                                    onInput={(e) => setShortcode((e.target as HTMLInputElement).value)}
                                    placeholder='e.g. ASD-7a,HN,UT-1 or ["ASD-7a","HN","UT-1"]'
                                    className={styles.input}
                                />
                                <button
                                    type="button"
                                    onClick={() => parseShortcode(shortcode)}
                                    className={styles.applyButton}
                                >
                                    Apply
                                </button>
                            </div>
                        </label>
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
                                        setFromTrack('');
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

                    {viaStops.map((via, i) => {
                        const viaTracks = getTracksForStation(via.station);
                        return (
                            <div key={i} className={styles.section}>
                                <div className={styles.viaSectionHeader}>
                                    <h3 className={styles.sectionTitle}>Via Stop {viaStops.length > 1 ? i + 1 : ''}</h3>
                                    <button
                                        type="button"
                                        onClick={() => removeViaStop(i)}
                                        className={styles.removeStopButton}
                                    >
                                        Remove
                                    </button>
                                </div>
                                <div className={styles.inputGroup}>
                                    <label className={styles.label}>
                                        Station Name
                                        <select
                                            value={via.station}
                                            onChange={(e) => updateViaStop(i, 'station', (e.target as HTMLSelectElement).value)}
                                            className={styles.select}
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
                                            value={via.track}
                                            onChange={(e) => updateViaStop(i, 'track', (e.target as HTMLSelectElement).value)}
                                            className={styles.select}
                                            disabled={!via.station || viaTracks.length === 0}
                                        >
                                            <option value="">Select a track...</option>
                                            {viaTracks.map((track) => (
                                                <option key={track} value={track}>
                                                    {track}
                                                </option>
                                            ))}
                                        </select>
                                    </label>
                                </div>
                            </div>
                        );
                    })}

                    <button
                        type="button"
                        onClick={addViaStop}
                        className={styles.addStopButton}
                    >
                        + Add via stop
                    </button>

                    <div className={styles.section}>
                        <h3 className={styles.sectionTitle}>To Station</h3>
                        <div className={styles.inputGroup}>
                            <label className={styles.label}>
                                Station Name *
                                <select
                                    value={toStation}
                                    onChange={(e) => {
                                        setToStation((e.target as HTMLSelectElement).value);
                                        setToTrack('');
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
