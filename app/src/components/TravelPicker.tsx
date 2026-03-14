import { useState, useEffect } from 'preact/hooks';
import { fetchAllStations, fetchStationDepartures, fetchJourney, type StationTrackInfo, type Departure, type Journey } from '../lib/api/station';
import { fetchJourneyRoute, calculateStopTimes, type RouteData, type RouteStop, type JourneyStopInput } from '../lib/api/navigation';
import { configs, country } from '../store/globals';
import { appScreen } from '../store/app';
import { startJourney } from '../store/journey';
import StationPicker from './StationPicker';
import RouteMinimap from './RouteMinimap';
import styles from './TravelPicker.module.css';

type TabType = 'regular' | 'custom' | 'archive';
const TAB_ORDER: TabType[] = ['regular', 'custom', 'archive'];

interface Stop {
    station: string;
    track: string;
    availableTracks: string[];
}

function StopRow({ index, stops, stations, onUpdate, onRemove, canRemove, disabled }: {
    index: number;
    stops: Stop[];
    stations: StationTrackInfo[];
    onUpdate: (index: number, field: 'station' | 'track', value: string) => void;
    onRemove: (index: number) => void;
    canRemove: boolean;
    disabled: boolean;
}) {
    const getStopLabel = (index: number): string => {
        if (index === 0) return 'From';
        if (index === stops.length - 1) return 'To';
        return `Stop ${index}`;
    };

    const stop = stops[index];

    return (
        <>
            <div key={index} className={styles.stopRow}>
                <div className={styles.stopField}>
                    <div className={styles.stopLabel}>{getStopLabel(index)}</div>
                    <StationPicker
                        stations={stations}
                        selectedStation={stop.station}
                        selectedTrack={stop.track}
                        availableTracks={stop.availableTracks}
                        onSelectStation={(name) => onUpdate(index, 'station', name)}
                        onSelectTrack={(track) => onUpdate(index, 'track', track)}
                        disabled={disabled}
                    />
                </div>
                {
                    index > 0 && index < stops.length - 1 && (
                        <button
                            className={styles.removeStopButton}
                            onClick={() => onRemove(index)}
                            disabled={disabled}
                            title="Remove stop"
                        >
                            ×
                        </button>
                    )
                }
            </div>
            {(index < stops.length - 1) && <div className={styles.stopDivider} />}
        </>
    )
}

export default function TravelPicker() {
    const [activeTab, setActiveTab] = useState<TabType>('custom');
    const [stations, setStations] = useState<StationTrackInfo[]>([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const [fetchingRoute, setFetchingRoute] = useState(false);

    console.log("**** Staitions in TravelPicker:", stations);

    // Form state - multi-stop support
    const [stops, setStops] = useState<Stop[]>([
        { station: '', track: '', availableTracks: [] },
        { station: '', track: '', availableTracks: [] }
    ]);
    const [returnToStart, setReturnToStart] = useState(false);
    const MAX_STOPS = 10;
    const STORAGE_KEY = 'travelPickerStops';

    // Route preview for minimap
    const [previewRoute, setPreviewRoute] = useState<number[][] | null>(null);
    const [previewStopIndices, setPreviewStopIndices] = useState<number[]>([]);
    const [minimapReady, setMinimapReady] = useState(false);

    // Regular mode state
    const [departures, setDepartures] = useState<Departure[]>([]);
    const [loadingDepartures, setLoadingDepartures] = useState(false);
    const [expandedDeparture, setExpandedDeparture] = useState<string | null>(null);
    const [expandedJourney, setExpandedJourney] = useState<Journey | null>(null);
    const [loadingJourney, setLoadingJourney] = useState(false);

    const canSubmit = stops.every(s => s.station) && !fetchingRoute;
    const fromStation = stops[0]?.station || '';

    useEffect(() => {
        loadStations();
    }, []);

    // Save stops to localStorage when they change (only if stations are loaded)
    useEffect(() => {
        if (stations.length === 0) return;
        // Only save if at least one stop has a station selected
        const hasSelection = stops.some(s => s.station);
        if (hasSelection) {
            const toSave = stops.map(s => ({ station: s.station, track: s.track }));
            localStorage.setItem(STORAGE_KEY, JSON.stringify({ stops: toSave, returnToStart }));
        }
    }, [stops, returnToStart, stations]);

    // Auto-fetch route preview for minimap when all stops are filled (custom tab)
    useEffect(() => {
        if (activeTab !== 'custom') return;

        const allFilled = stops.every(s => s.station && (s.availableTracks.length === 0 || s.track));
        if (!allFilled || stops.length < 2 || stations.length === 0) {
            setMinimapReady(false);
            setPreviewRoute(null);
            setPreviewStopIndices([]);
            return;
        }

        const journeyStops: JourneyStopInput[] = stops.map(stop => {
            const stationData = stations.find(s => s.name === stop.station);
            return { code: stationData?.code || '', track: stop.track || undefined };
        }).filter(s => s.code);

        if (journeyStops.length < 2) return;

        let cancelled = false;
        setMinimapReady(false);
        fetchJourneyRoute(journeyStops)
            .then(data => {
                if (!cancelled) {
                    setPreviewRoute(data.geometry.route);
                    setPreviewStopIndices(data.geometry.stop_indices);
                }
            })
            .catch(() => {
                if (!cancelled) {
                    setPreviewRoute(null);
                    setPreviewStopIndices([]);
                }
            });

        return () => { cancelled = true; };
    }, [stops, stations, activeTab]);

    // Fetch departures when switching to Regular tab with a station already selected
    useEffect(() => {
        const fromStation = stops[0]?.station;
        if (activeTab === 'regular' && fromStation && stations.length > 0 && departures.length === 0) {
            const station = stations.find(s => s.name === fromStation);
            if (station?.code) {
                fetchDepartures(station.code);
            }
        }
    }, [activeTab, stops[0]?.station, stations]);

    // Stop management functions
    const updateStop = (index: number, field: 'station' | 'track', value: string) => {
        setStops(prev => {
            const newStops = [...prev];
            if (field === 'station') {
                const stationData = stations.find(s => s.name === value);
                newStops[index] = {
                    station: value,
                    track: '',
                    availableTracks: stationData?.tracks || []
                };
            } else {
                newStops[index] = { ...newStops[index], track: value };
            }
            return newStops;
        });
    };

    const addStop = () => {
        if (stops.length >= MAX_STOPS) return;
        setStops(prev => {
            const newStops = [...prev];
            // Insert before the last stop
            newStops.splice(prev.length - 1, 0, { station: '', track: '', availableTracks: [] });
            return newStops;
        });
    };

    const removeStop = (index: number) => {
        if (stops.length <= 2) return;
        if (index === 0 || index === stops.length - 1) return; // Can't remove first or last
        setStops(prev => prev.filter((_, i) => i !== index));
    };

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
            const data = await fetchAllStations(country.value);
            console.log("Stations fetched:", data);
            setStations(data);
            setError(null);

            // Load saved stops from localStorage
            const saved = localStorage.getItem(STORAGE_KEY);
            if (saved) {
                try {
                    const { stops: savedStops, returnToStart: savedReturn } = JSON.parse(saved);
                    if (Array.isArray(savedStops) && savedStops.length >= 2) {
                        const restoredStops = savedStops.map((s: { station: string; track: string }) => {
                            const stationData = data.find(st => st.name === s.station);
                            return {
                                station: s.station || '',
                                track: s.track || '',
                                availableTracks: stationData?.tracks || []
                            };
                        });
                        setStops(restoredStops);
                        if (typeof savedReturn === 'boolean') {
                            setReturnToStart(savedReturn);
                        }
                    }
                } catch (e) {
                    console.error('Failed to parse saved stops:', e);
                }
            }
        } catch (err) {
            setError('Failed to load stations. Please try again.');
            console.error(err);
        } finally {
            setLoading(false);
        }
    };

    const handleGo = async () => {
        // Validate all stops have stations
        const emptyStops = stops.filter(s => !s.station);
        if (emptyStops.length > 0) {
            setError('Please select all stations');
            return;
        }

        // Build stops array for journey API
        const journeyStops: JourneyStopInput[] = stops.map(stop => {
            const stationData = stations.find(s => s.name === stop.station);
            return {
                code: stationData?.code || '',
                track: stop.track || undefined
            };
        }).filter(s => s.code);

        if (journeyStops.length < 2) {
            setError('Could not find station codes');
            return;
        }

        try {
            setFetchingRoute(true);
            setError(null);

            const journeyData = await fetchJourneyRoute(journeyStops);

            // Calculate arrival/departure times from route metadata
            const routeStops = calculateStopTimes(
                stops.map(s => s.station),
                journeyStops.map(s => s.code),
                stops.map(s => s.track || null),
                journeyData.geometry
            );

            // For custom routes, use real time (user can set custom time in the future)
            const routeData: RouteData = {
                geometry: journeyData.geometry,
                properties: {
                    stops: routeStops,
                    startTime: Date.now() // Custom routes use real time
                }
            };

            startJourney(routeData, routeData.properties.startTime);
            appScreen.value = 'game';
        } catch (err) {
            setError(err instanceof Error ? err.message : 'Failed to fetch route');
            console.error(err);
        } finally {
            setFetchingRoute(false);
        }
    };

    // Fetch departures when station is selected in Regular mode
    const handleRegularStationSelect = async (stationName: string) => {
        updateStop(0, 'station', stationName);
        setDepartures([]);
        setExpandedDeparture(null);
        setSelectedDeparture(null);
        setExpandedJourney(null);
        setError(null);

        if (!stationName) return;

        const station = stations.find(s => s.name === stationName);
        if (!station?.code) {
            setError('Station code not found');
            return;
        }

        fetchDepartures(station.code);
    };

    // Regular mode: selected departure for detail view
    const [selectedDeparture, setSelectedDeparture] = useState<Departure | null>(null);

    // Handle selecting a departure - fetch journey details and show detail view
    const handleSelectDeparture = async (departure: Departure) => {
        setSelectedDeparture(departure);
        setExpandedDeparture(departure.product.number + departure.plannedDateTime);
        setExpandedJourney(null);
        setLoadingJourney(true);
        setError(null);
        setMinimapReady(false);
        setPreviewRoute(null);
        setPreviewStopIndices([]);

        try {
            const journey = await fetchJourney(departure.product.number, departure.plannedDateTime);
            if (journey) {
                setExpandedJourney(journey);
            }
        } catch (err) {
            setError(err instanceof Error ? err.message : 'Failed to fetch journey details');
        } finally {
            setLoadingJourney(false);
        }
    };

    const handleBackToDepartures = () => {
        setSelectedDeparture(null);
        setExpandedDeparture(null);
        setExpandedJourney(null);
        setMinimapReady(false);
        setPreviewRoute(null);
        setPreviewStopIndices([]);
    };

    // Fetch route preview for minimap when journey details are loaded (regular mode)
    useEffect(() => {
        if (!expandedJourney || !selectedDeparture || stations.length === 0) return;

        const startIdx = expandedJourney.stops.findIndex(
            stop => stop.stop.name === fromStation
        );
        const relevantStops = expandedJourney.stops
            .slice(startIdx >= 0 ? startIdx : 0)
            .filter(stop => stop.status !== 'PASSING');

        const journeyStops: JourneyStopInput[] = [];
        for (const stop of relevantStops) {
            const stationData = stations.find(s => s.name === stop.stop.name);
            if (stationData?.code) {
                const track = stop.departures[0]?.plannedTrack || stop.arrivals[0]?.plannedTrack;
                journeyStops.push(track ? { code: stationData.code, track } : { code: stationData.code });
            }
        }

        if (journeyStops.length < 2) return;

        let cancelled = false;
        setMinimapReady(false);
        fetchJourneyRoute(journeyStops)
            .then(data => {
                if (!cancelled) {
                    setPreviewRoute(data.geometry.route);
                    setPreviewStopIndices(data.geometry.stop_indices);
                }
            })
            .catch(() => {
                if (!cancelled) {
                    setPreviewRoute(null);
                    setPreviewStopIndices([]);
                }
            });

        return () => { cancelled = true; };
    }, [expandedJourney, selectedDeparture, stations, fromStation]);

    // Handle clicking GO on a departure
    const handleDepartureGo = async () => {
        if (expandedJourney) {
            console.log('Journey:', expandedJourney);

            // Find departure station index
            const startIdx = expandedJourney.stops.findIndex(
                stop => stop.stop.name === fromStation
            );

            // Get stops from departure station onwards, excluding PASSING stops
            const relevantStops = expandedJourney.stops
                .slice(startIdx >= 0 ? startIdx : 0)
                .filter(stop => stop.status !== 'PASSING');

            // Convert to JourneyStopInput format using station codes
            const journeyStops: JourneyStopInput[] = [];
            for (const stop of relevantStops) {
                const stationData = stations.find(s => s.name === stop.stop.name);
                if (stationData?.code) {
                    const track = stop.departures[0]?.plannedTrack || stop.arrivals[0]?.plannedTrack;
                    journeyStops.push(track ? { code: stationData.code, track } : { code: stationData.code });
                }
            }

            if (journeyStops.length < 2) {
                setError('Not enough stations found in our database');
                return;
            }

            try {
                setFetchingRoute(true);
                setError(null);

                const journeyData = await fetchJourneyRoute(journeyStops);

                // Transform to RouteData format with all stops including timing
                // Get the first stop's departure time as reference point (time = 0)
                const firstStopTime = relevantStops[0]?.departures?.[0]?.plannedTime
                    || relevantStops[0]?.arrivals?.[0]?.plannedTime;
                const referenceTime = firstStopTime ? new Date(firstStopTime).getTime() : 0;

                const routeStops: RouteStop[] = relevantStops.map((stop, idx) => {
                    const arrivalTimeStr = stop.arrivals?.[0]?.plannedTime;
                    const departureTimeStr = stop.departures?.[0]?.plannedTime;
                    const stationCode = journeyStops[idx]?.code || '';

                    let arrivalTime: number;
                    let departureTime: number;

                    if (idx === 0) {
                        // First stop: arrival = 0, departure = initialDwellTime
                        arrivalTime = 0;
                        departureTime = configs.value.initialDwellTime;
                    } else {
                        // Calculate relative minutes from first stop
                        const arrivalMs = arrivalTimeStr
                            ? new Date(arrivalTimeStr).getTime() - referenceTime
                            : new Date(departureTimeStr!).getTime() - referenceTime;
                        arrivalTime = Math.round(arrivalMs / 60000);

                        const departureMs = departureTimeStr
                            ? new Date(departureTimeStr).getTime() - referenceTime
                            : arrivalMs + 60000; // +1 minute if no departure time
                        departureTime = Math.round(departureMs / 60000);
                    }

                    return {
                        station: stop.stop.name,
                        code: stationCode,
                        track: stop.departures[0]?.plannedTrack || stop.arrivals[0]?.plannedTrack || null,
                        arrivalTime,
                        departureTime
                    };
                });

                // Calculate the journey start time based on the actual schedule
                // First stop departure time minus initial dwell = arrival/start time
                const firstDepartureTimeStr = relevantStops[0]?.departures?.[0]?.plannedTime;
                const scheduleStartTime = firstDepartureTimeStr
                    ? new Date(firstDepartureTimeStr).getTime() - (configs.value.initialDwellTime * 60 * 1000)
                    : undefined;

                const routeData: RouteData = {
                    geometry: journeyData.geometry,
                    properties: {
                        stops: routeStops,
                        startTime: scheduleStartTime
                    }
                };

                startJourney(routeData, routeData.properties.startTime);
            appScreen.value = 'game';
            } catch (err) {
                setError(err instanceof Error ? err.message : 'Failed to fetch route');
                console.error('Failed to fetch journey route:', err);
            } finally {
                setFetchingRoute(false);
            }
        }
    };

    // Format time from ISO string
    const formatTime = (isoString: string) => {
        const date = new Date(isoString);
        return date.toLocaleTimeString('nl-NL', { hour: '2-digit', minute: '2-digit' });
    };

    return (
        <div className={styles.container}>
                <h1 className={styles.title}>Plan Journey</h1>

                {/* Tabs */}
                <div className={styles.tabs}>
                    <button
                        className={`${styles.tab} ${activeTab === 'regular' ? styles.activeTab : ''}`}
                        onClick={() => { setActiveTab('regular'); setMinimapReady(false); setPreviewRoute(null); setPreviewStopIndices([]); setSelectedDeparture(null); setExpandedDeparture(null); setExpandedJourney(null); setLoadingJourney(false); }}
                    >
                        Regular
                    </button>
                    <button
                        className={`${styles.tab} ${activeTab === 'custom' ? styles.activeTab : ''}`}
                        onClick={() => { setActiveTab('custom'); setMinimapReady(false); }}
                    >
                        Custom
                    </button>

                    <button
                        className={`${styles.tab} ${activeTab === 'archive' ? styles.activeTab : ''}`}
                        onClick={() => { setActiveTab('archive'); setMinimapReady(false); setPreviewRoute(null); setPreviewStopIndices([]); }}
                    >
                        Archive
                    </button>
                    <div
                        className={styles.tabIndicator}
                        style={{ transform: `translateX(${TAB_ORDER.indexOf(activeTab) * 100}%)` }}
                    />
                </div>

                {/* Content */}
                <div className={styles.content}>
                    {loading ? (
                        <div className={styles.loading}>Loading stations...</div>
                    ) : activeTab === 'regular' ? (
                        /* Regular Tab Content */
                        selectedDeparture ? (
                            /* Detail view for selected departure */
                            <>
                                <div className={`${styles.customRow} ${minimapReady ? styles.customRowWithMap : ''}`}>
                                    <div className={styles.stopsList}>
                                        <div className={styles.trainInfo}>
                                            {selectedDeparture.product.longCategoryName} {selectedDeparture.product.number}
                                        </div>

                                        {loadingJourney && (
                                            <div className={styles.loadingStops}>Loading stops...</div>
                                        )}

                                        {!loadingJourney && expandedJourney && (() => {
                                            const startIdx = expandedJourney.stops.findIndex(
                                                stop => stop.stop.name === fromStation
                                            );
                                            const relevantStops = expandedJourney.stops
                                                .slice(startIdx >= 0 ? startIdx : 0)
                                                .filter(stop => stop.status !== 'PASSING');

                                            return (
                                                <div className={styles.timeline}>
                                                    {relevantStops.map((stop, idx) => {
                                                        const isFirst = idx === 0;
                                                        const isLast = idx === relevantStops.length - 1;
                                                        const time = stop.departures?.[0]?.plannedTime || stop.arrivals?.[0]?.plannedTime;
                                                        const track = stop.departures?.[0]?.plannedTrack || stop.arrivals?.[0]?.plannedTrack;

                                                        return (
                                                            <div key={stop.id} className={`${styles.timelineStop} ${isFirst ? styles.origin : ''} ${isLast ? styles.destination : ''}`}>
                                                                <div className={styles.timelineTrack}>
                                                                    <div className={`${styles.timelineDot} ${isFirst ? styles.origin : ''} ${isLast ? styles.destination : ''}`} />
                                                                </div>
                                                                <div className={styles.timelineInfo}>
                                                                    <div className={styles.timelineTime}>
                                                                        {time ? formatTime(time) : ''}
                                                                    </div>
                                                                    <div className={styles.timelineStationRow}>
                                                                        <span className={styles.timelineStation}>
                                                                            {stop.stop.name}
                                                                        </span>
                                                                        {track && (
                                                                            <span className={styles.timelineTrackBadge}>{track}</span>
                                                                        )}
                                                                    </div>
                                                                </div>
                                                            </div>
                                                        );
                                                    })}
                                                </div>
                                            );
                                        })()}
                                    </div>

                                    {/* Route Minimap */}
                                    <div className={`${styles.minimapContainer} ${minimapReady ? styles.minimapVisible : ''}`}>
                                        <div className={styles.minimapInner}>
                                            {previewRoute && (
                                                <RouteMinimap
                                                    route={previewRoute}
                                                    stopIndices={previewStopIndices}
                                                    onReady={() => setMinimapReady(true)}
                                                />
                                            )}
                                        </div>
                                    </div>
                                </div>

                                {error && <div className={styles.error}>{error}</div>}

                                <div className={styles.actionRow}>
                                    <button
                                        className={styles.backButtonSmall}
                                        onClick={handleBackToDepartures}
                                    >
                                        ←
                                    </button>
                                    <button
                                        className={styles.goButton}
                                        onClick={() => handleDepartureGo()}
                                        disabled={fetchingRoute || loadingJourney || !expandedJourney}
                                    >
                                        {fetchingRoute ? 'Loading route...' : 'Go'}
                                    </button>
                                </div>
                            </>
                        ) : (
                            /* Departures list view */
                            <>
                                <div className={styles.stopsList}>
                                    <div className={styles.stopField}>
                                        <div className={styles.stopLabel}>From</div>
                                        <StationPicker
                                            stations={stations}
                                            selectedStation={fromStation}
                                            selectedTrack={stops[0]?.track || ''}
                                            availableTracks={stops[0]?.availableTracks || []}
                                            onSelectStation={(name) => handleRegularStationSelect(name)}
                                            onSelectTrack={(track) => updateStop(0, 'track', track)}
                                            disabled={loadingDepartures}
                                        />
                                    </div>
                                </div>

                                {error && <div className={styles.error}>{error}</div>}

                                {loadingDepartures && (
                                    <div className={styles.loading}>Loading departures...</div>
                                )}

                                {!loadingDepartures && departures.length > 0 && (
                                    <div className={styles.departuresList}>
                                        {departures.map((departure) => {
                                            const destination = departure.direction || departure.routeStations[departure.routeStations.length - 1]?.mediumName || 'Unknown';
                                            const track = departure.actualTrack || departure.plannedTrack;
                                            return (
                                                <button
                                                    key={departure.product.number + departure.plannedDateTime}
                                                    className={`${styles.departureItem} ${departure.cancelled ? styles.cancelled : ''}`}
                                                    onClick={() => !departure.cancelled && handleSelectDeparture(departure)}
                                                    disabled={departure.cancelled}
                                                >
                                                    <div className={styles.departureContent}>
                                                        <span className={styles.departureTime}>
                                                            {formatTime(departure.plannedDateTime)}
                                                        </span>
                                                        <span className={styles.departureDestination}>
                                                            {destination}
                                                            {track && <span className={styles.departureTrackBadge}>{track}</span>}
                                                        </span>
                                                    </div>
                                                    <span className={styles.departureArrow}>›</span>
                                                </button>
                                            );
                                        })}
                                    </div>
                                )}

                                {!loadingDepartures && fromStation && departures.length === 0 && !error && (
                                    <div className={styles.noDepartures}>No departures found</div>
                                )}
                            </>
                        )
                    ) : (
                        /* Custom Tab Content */
                        <>
                            <div className={`${styles.customRow} ${minimapReady ? styles.customRowWithMap : ''}`}>
                                {/* Stops List */}
                                <div className={styles.stopsList}>
                                    {stops.map((stop, index) => (
                                        <StopRow
                                            key={index}
                                            index={index}
                                            stops={stops}
                                            stations={stations}
                                            onUpdate={updateStop}
                                            onRemove={removeStop}
                                            canRemove={stops.length > 2 && index !== 0 && index !== stops.length - 1}
                                            disabled={fetchingRoute}
                                        />
                                    ))}
                                </div>

                                {/* Route Minimap */}
                                <div className={`${styles.minimapContainer} ${minimapReady ? styles.minimapVisible : ''}`}>
                                    <div className={styles.minimapInner}>
                                        {previewRoute && (
                                            <RouteMinimap
                                                route={previewRoute}
                                                stopIndices={previewStopIndices}
                                                onReady={() => setMinimapReady(true)}
                                            />
                                        )}
                                    </div>
                                </div>
                            </div>

                            {/* Add Stop Button */}
                            {stops.length < MAX_STOPS && (
                                <button
                                    className={styles.addStopButton}
                                    onClick={addStop}
                                    disabled={fetchingRoute}
                                >
                                    + Add Stop
                                </button>
                            )}

                            {/* Round trip toggle */}
                            <div
                                className={styles.returnToggle}
                                onClick={() => !fetchingRoute && setReturnToStart(prev => !prev)}
                            >
                                <div className={styles.returnToggleText}>
                                    <span className={styles.returnToggleLabel}>Round trip</span>
                                    <span className={styles.returnToggleHint}>Include the journey back</span>
                                </div>
                                <div className={`${styles.returnToggleSwitch} ${returnToStart ? styles.returnToggleSwitchOn : ''}`} />
                            </div>

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
    );
}
