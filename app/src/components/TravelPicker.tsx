import { h } from 'preact';
import { useState, useEffect } from 'preact/hooks';
import { fetchAllStations, fetchStationDepartures, fetchJourney, type StationTrackInfo, type Departure, type Journey } from '../lib/api/station';
import { fetchJourneyRoute, type RouteData, type JourneyStopInput } from '../lib/api/navigation';
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

    // Regular mode state
    const [departures, setDepartures] = useState<Departure[]>([]);
    const [loadingDepartures, setLoadingDepartures] = useState(false);
    const [expandedDeparture, setExpandedDeparture] = useState<string | null>(null);
    const [expandedJourney, setExpandedJourney] = useState<Journey | null>(null);
    const [loadingJourney, setLoadingJourney] = useState(false);

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

    // Fetch departures when switching to Regular tab with a station already selected
    useEffect(() => {
        if (activeTab === 'regular' && fromStation && stations.length > 0 && departures.length === 0) {
            const station = stations.find(s => s.name === fromStation);
            if (station?.code) {
                fetchDepartures(station.code);
            }
        }
    }, [activeTab, fromStation, stations]);

    const fetchDepartures = async (stationCode: string) => {
        try {
            setLoadingDepartures(true);
            setError(null);
            const response = await fetchStationDepartures(stationCode);
            if (response?.departures) {
                setDepartures(response.departures);

                console.log("Departures fetched:", response.departures);
            } else {
                setError('Could not fetch departures. Please make sure you are logged in.');
            }
        } catch (err) {
            setError(err instanceof Error ? err.message : 'Failed to fetch departures');
        } finally {
            setLoadingDepartures(false);
        }
    };

    const loadStations = async () => {
        try {
            setLoading(true);
            const data = await fetchAllStations();
            console.log("Stations fetched:", data);
            setStations(data);
            setError(null);

            handleDebug(); // to do remove later
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

        try {
            setFetchingRoute(true);
            setError(null);

            // Build stops array for journey API
            const stops: JourneyStopInput[] = [
                fromTrack ? { name: fromStation, track: fromTrack } : { name: fromStation },
                toTrack ? { name: toStation, track: toTrack } : { name: toStation }
            ];

            const journeyData = await fetchJourneyRoute(stops);

            // Transform to RouteData format
            const routeData: RouteData = {
                geometry: journeyData.geometry,
                properties: {
                    from_station: fromStation,
                    from_track: fromTrack || null,
                    to_station: toStation,
                    to_track: toTrack || null
                }
            };

            onRouteSelected(routeData);
        } catch (err) {
            setError(err instanceof Error ? err.message : 'Failed to fetch route');
            console.error(err);
        } finally {
            setFetchingRoute(false);
        }
    };

    const handleDebug = () => {
        setFromStation('Hoorn Kersenboogerd');
        setToStation('Amsterdam Centraal');

        setTimeout(() => {
            setFromTrack('1');
            setToTrack('4b');
        }, 100);
    };

    // Fetch departures when station is selected in Regular mode
    const handleRegularStationSelect = async (stationName: string) => {
        setFromStation(stationName);
        setDepartures([]);
        setExpandedDeparture(null);
        setError(null);

        if (!stationName) return;

        const station = stations.find(s => s.name === stationName);
        if (!station?.code) {
            setError('Station code not found');
            return;
        }

        fetchDepartures(station.code);
    };

    // Handle expanding a departure - fetch journey details
    const handleExpandDeparture = async (departure: Departure) => {
        const departureKey = departure.product.number + departure.plannedDateTime;

        // If already expanded, collapse it
        if (expandedDeparture === departureKey) {
            setExpandedDeparture(null);
            setExpandedJourney(null);
            return;
        }

        setExpandedDeparture(departureKey);
        setExpandedJourney(null);
        setLoadingJourney(true);
        setError(null);

        try {
            const journey = await fetchJourney(departure.product.number, departure.plannedDateTime);
            console.log('Journey response:', journey);
            if (journey) {
                setExpandedJourney(journey);
            }
        } catch (err) {
            setError(err instanceof Error ? err.message : 'Failed to fetch journey details');
        } finally {
            setLoadingJourney(false);
        }
    };

    // Handle clicking GO on a departure
    const handleDepartureGo = async () => {
        if (expandedJourney) {
            console.log('Journey:', expandedJourney);

            // Convert journey stops to JourneyStopInput format
            const stops: JourneyStopInput[] = expandedJourney.stops.map(stop => ({
                name: stop.stop.name,
                track: stop.departures[0]?.plannedTrack || stop.arrivals[0]?.plannedTrack
            }));

            try {
                const routeData = await fetchJourneyRoute(stops);
                console.log('Journey route:', routeData);
            } catch (err) {
                console.error('Failed to fetch journey route:', err);
            }
        }
    };

    // Format time from ISO string
    const formatTime = (isoString: string) => {
        const date = new Date(isoString);
        return date.toLocaleTimeString('nl-NL', { hour: '2-digit', minute: '2-digit' });
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
                    ) : activeTab === 'regular' ? (
                        /* Regular Tab Content */
                        <>
                            {/* From Station */}
                            <div className={styles.field}>
                                <label className={styles.label}>Departure Station</label>
                                <select
                                    className={styles.select}
                                    value={fromStation}
                                    onChange={(e) => handleRegularStationSelect((e.target as HTMLSelectElement).value)}
                                    disabled={loadingDepartures}
                                >
                                    <option value="">Select station</option>
                                    {stations.map((station) => (
                                        <option key={station.name} value={station.name}>
                                            {station.name}
                                        </option>
                                    ))}
                                </select>
                            </div>

                            {/* Error message */}
                            {error && <div className={styles.error}>{error}</div>}

                            {/* Loading departures */}
                            {loadingDepartures && (
                                <div className={styles.loading}>Loading departures...</div>
                            )}

                            {/* Departures list */}
                            {!loadingDepartures && departures.length > 0 && (
                                <div className={styles.departuresList}>
                                    {departures.map((departure) => {
                                        const isExpanded = expandedDeparture === departure.product.number + departure.plannedDateTime;
                                        const destination = departure.direction || departure.routeStations[departure.routeStations.length - 1]?.mediumName || 'Unknown';

                                        return (
                                            <div
                                                key={departure.product.number + departure.plannedDateTime}
                                                className={`${styles.departureItem} ${isExpanded ? styles.expanded : ''} ${departure.cancelled ? styles.cancelled : ''}`}
                                            >
                                                <div
                                                    className={styles.departureHeader}
                                                    onClick={() => handleExpandDeparture(departure)}
                                                >
                                                    <span className={styles.departureTime}>
                                                        {formatTime(departure.plannedDateTime)}
                                                    </span>
                                                    <span className={styles.departureDestination}>
                                                        {destination}
                                                    </span>
                                                    <span className={styles.departureTrack}>
                                                        {departure.actualTrack || departure.plannedTrack || '-'}
                                                    </span>
                                                    <span className={styles.expandIcon}>
                                                        {isExpanded ? '▼' : '▶'}
                                                    </span>
                                                </div>

                                                {isExpanded && (
                                                    <div className={styles.departureDetails}>
                                                        <div className={styles.trainInfo}>
                                                            {departure.product.longCategoryName} {departure.product.number}
                                                        </div>

                                                        {loadingJourney && (
                                                            <div className={styles.loadingStops}>Loading stops...</div>
                                                        )}

                                                        {!loadingJourney && expandedJourney && (() => {
                                                            // Find the index of our departure station
                                                            const startIdx = expandedJourney.stops.findIndex(
                                                                stop => stop.stop.name === fromStation
                                                            );
                                                            // Get stops from our station onwards, excluding PASSING stops
                                                            const relevantStops = expandedJourney.stops
                                                                .slice(startIdx >= 0 ? startIdx : 0)
                                                                .filter(stop => stop.status !== 'PASSING');

                                                            return (
                                                                <div className={styles.timeline}>
                                                                    {relevantStops.map((stop, idx) => {
                                                                        const isFirst = idx === 0;
                                                                        const isLast = idx === relevantStops.length - 1;
                                                                        const time = stop.departures?.[0]?.plannedTime || stop.arrivals?.[0]?.plannedTime;

                                                                        return (
                                                                            <div key={stop.id} className={styles.timelineStop}>
                                                                                <div className={styles.timelineTime}>
                                                                                    {time ? formatTime(time) : ''}
                                                                                </div>
                                                                                <div className={styles.timelineTrack}>
                                                                                    <div className={`${styles.timelineDot} ${isFirst ? styles.origin : ''} ${isLast ? styles.destination : ''}`} />
                                                                                    {!isLast && <div className={styles.timelineLine} />}
                                                                                </div>
                                                                                <div className={styles.timelineStation}>
                                                                                    {stop.stop.name}
                                                                                </div>
                                                                            </div>
                                                                        );
                                                                    })}
                                                                </div>
                                                            );
                                                        })()}

                                                        <button
                                                            className={styles.goButton}
                                                            onClick={() => handleDepartureGo()}
                                                            disabled={loadingJourney || !expandedJourney}
                                                        >
                                                            {loadingJourney ? 'Loading...' : 'Go'}
                                                        </button>
                                                    </div>
                                                )}
                                            </div>
                                        );
                                    })}
                                </div>
                            )}

                            {/* No departures message */}
                            {!loadingDepartures && fromStation && departures.length === 0 && !error && (
                                <div className={styles.noDepartures}>No departures found</div>
                            )}
                        </>
                    ) : (
                        /* Custom Tab Content */
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

                            {/* From Track */}
                            {fromTracks.length > 0 && (
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

                            {/* To Track */}
                            {toTracks.length > 0 && (
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
