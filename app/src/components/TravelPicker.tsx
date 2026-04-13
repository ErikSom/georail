import { useState, useEffect } from 'preact/hooks';
import { fetchAllStations, fetchStationDepartures, fetchJourney, type StationTrackInfo, type Departure, type Journey } from '../lib/api/station';
import { fetchJourneyRoute, calculateStopTimes, type RouteData, type RouteStop, type JourneyStopInput } from '../lib/api/navigation';
import { fetchJourneyHistory, fetchFavoriteRoutes, toggleFavorite, type JourneyHistoryEntry, type FavoriteRoute } from '../lib/api/journey';
import { configs, country, gameConditions, setGameCondition, type GameConditions } from '../store/globals';
import { appScreen } from '../store/app';
import { startJourney } from '../store/journey';
import StationPicker from './StationPicker';
import RouteMinimap from './RouteMinimap';
import TimePicker from './TimePicker';
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
                    <StationPicker
                        stations={stations}
                        selectedStation={stop.station}
                        selectedTrack={stop.track}
                        availableTracks={stop.availableTracks}
                        onSelectStation={(name) => onUpdate(index, 'station', name)}
                        onSelectTrack={(track) => onUpdate(index, 'track', track)}
                        disabled={disabled}
                        label={getStopLabel(index)}
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

    // Custom tab state - multi-stop support
    const [customStops, setCustomStops] = useState<Stop[]>([
        { station: '', track: '', availableTracks: [] },
        { station: '', track: '', availableTracks: [] }
    ]);
    const [returnToStart, setReturnToStart] = useState(false);
    const MAX_STOPS = 10;
    const CUSTOM_STORAGE_KEY = 'travelPickerStopsCustom';

    // Regular tab state - single from station
    const [regularFrom, setRegularFrom] = useState<Stop>({ station: '', track: '', availableTracks: [] });
    const REGULAR_STORAGE_KEY = 'travelPickerStopsRegular';

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

    // Archive tab state
    type ArchiveView = 'history' | 'favorites';
    const [archiveView, setArchiveView] = useState<ArchiveView>('history');
    const [history, setHistory] = useState<JourneyHistoryEntry[]>([]);
    const [favorites, setFavorites] = useState<FavoriteRoute[]>([]);
    const [loadingArchive, setLoadingArchive] = useState(false);
    const [archiveError, setArchiveError] = useState<string | null>(null);
    const [expandedArchiveId, setExpandedArchiveId] = useState<string | null>(null);

    // Conditions panel
    const [showConditions, setShowConditions] = useState(false);
    const conditions = gameConditions.value;

    const canSubmit = customStops.every(s => s.station) && !fetchingRoute;
    const fromStation = regularFrom.station || '';

    useEffect(() => {
        loadStations();
    }, []);

    // Save custom stops to localStorage when they change
    useEffect(() => {
        if (stations.length === 0) return;
        const hasSelection = customStops.some(s => s.station);
        if (hasSelection) {
            const toSave = customStops.map(s => ({ station: s.station, track: s.track }));
            localStorage.setItem(CUSTOM_STORAGE_KEY, JSON.stringify({ stops: toSave, returnToStart }));
        }
    }, [customStops, returnToStart, stations]);

    // Save regular from station to localStorage when it changes
    useEffect(() => {
        if (stations.length === 0) return;
        if (regularFrom.station) {
            localStorage.setItem(REGULAR_STORAGE_KEY, JSON.stringify({ station: regularFrom.station, track: regularFrom.track }));
        }
    }, [regularFrom, stations]);

    // Auto-fetch route preview for minimap when all stops are filled (custom tab)
    useEffect(() => {
        if (activeTab !== 'custom') return;

        const allFilled = customStops.every(s => s.station && (s.availableTracks.length === 0 || s.track));
        if (!allFilled || customStops.length < 2 || stations.length === 0) {
            setMinimapReady(false);
            setPreviewRoute(null);
            setPreviewStopIndices([]);
            return;
        }

        // Route API only needs the forward leg — round trip is handled at journey start
        const journeyStops: JourneyStopInput[] = customStops.map(stop => {
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
    }, [customStops, stations, activeTab, returnToStart]);

    // Fetch departures when switching to Regular tab with a station already selected
    useEffect(() => {
        if (activeTab === 'regular' && regularFrom.station && stations.length > 0 && departures.length === 0) {
            const station = stations.find(s => s.name === regularFrom.station);
            if (station?.code) {
                fetchDepartures(station.code);
            }
        }
    }, [activeTab, regularFrom.station, stations]);

    // Fetch archive data when switching to archive tab
    useEffect(() => {
        if (activeTab !== 'archive') return;
        let cancelled = false;
        setLoadingArchive(true);

        Promise.all([fetchJourneyHistory(country.value), fetchFavoriteRoutes(country.value)]).then(([historyRes, favRes]) => {
            if (cancelled) return;
            setHistory(historyRes?.history || []);
            setFavorites(favRes?.favorites || []);
            setLoadingArchive(false);
        });

        return () => { cancelled = true; };
    }, [activeTab]);

    const resolveStationName = (code: string) => {
        return stations.find(s => s.code === code)?.name || code;
    };

    const handleToggleFavorite = async (stationCodes: string[], totalKm?: number, routeCountry?: string, isRoundTrip?: boolean) => {
        setArchiveError(null);
        try {
            const stationNames = stationCodes.map(resolveStationName);
            const result = await toggleFavorite(stationCodes, stationNames, totalKm, routeCountry, isRoundTrip);
            if (!result) return;

            // Update history entries' is_favorited status
            setHistory(prev => prev.map(h => {
                const matches = h.station_codes.length === stationCodes.length &&
                    h.station_codes.every((c, i) => c === stationCodes[i]);
                return matches ? { ...h, is_favorited: result.favorited } : h;
            }));

            if (result.favorited) {
                // Re-fetch favorites to get the new entry with server-generated id
                const favRes = await fetchFavoriteRoutes(country.value);
                if (favRes) setFavorites(favRes.favorites);
            } else {
                // Remove from local favorites
                setFavorites(prev => prev.filter(f => {
                    return !(f.station_codes.length === stationCodes.length &&
                        f.station_codes.every((c, i) => c === stationCodes[i]));
                }));
            }
        } catch (err) {
            setArchiveError(err instanceof Error ? err.message : 'Failed to update favorite');
        }
    };

    const loadRouteIntoCustom = (stationCodes: string[], isRoundTrip: boolean) => {
        // For round trips [A,B,C,D,C,B,A], extract original stops [A,B,C,D]
        const codes = isRoundTrip && stationCodes.length >= 3
            ? stationCodes.slice(0, Math.ceil(stationCodes.length / 2))
            : stationCodes;

        const newStops: Stop[] = codes.map(code => {
            const stationData = stations.find(s => s.code === code);
            return {
                station: stationData?.name || code,
                track: '',
                availableTracks: stationData?.tracks || [],
            };
        });

        setCustomStops(newStops);
        setReturnToStart(isRoundTrip);
        setActiveTab('custom');
        setMinimapReady(false);
    };

    const formatDate = (dateStr: string) => {
        const d = new Date(dateStr);
        return d.toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' });
    };

    // Custom stop management functions
    const updateCustomStop = (index: number, field: 'station' | 'track', value: string) => {
        setCustomStops(prev => {
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
        if (customStops.length >= MAX_STOPS) return;
        setCustomStops(prev => {
            const newStops = [...prev];
            // Insert before the last stop
            newStops.splice(prev.length - 1, 0, { station: '', track: '', availableTracks: [] });
            return newStops;
        });
    };

    const removeStop = (index: number) => {
        if (customStops.length <= 2) return;
        if (index === 0 || index === customStops.length - 1) return; // Can't remove first or last
        setCustomStops(prev => prev.filter((_, i) => i !== index));
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

            // Load saved custom stops from localStorage
            const savedCustom = localStorage.getItem(CUSTOM_STORAGE_KEY);
            if (savedCustom) {
                try {
                    const { stops: savedStops, returnToStart: savedReturn } = JSON.parse(savedCustom);
                    if (Array.isArray(savedStops) && savedStops.length >= 2) {
                        const restoredStops = savedStops.map((s: { station: string; track: string }) => {
                            const stationData = data.find(st => st.name === s.station);
                            return {
                                station: s.station || '',
                                track: s.track || '',
                                availableTracks: stationData?.tracks || []
                            };
                        });
                        setCustomStops(restoredStops);
                        if (typeof savedReturn === 'boolean') {
                            setReturnToStart(savedReturn);
                        }
                    }
                } catch (e) {
                    console.error('Failed to parse saved custom stops:', e);
                }
            }

            // Load saved regular from station from localStorage
            const savedRegular = localStorage.getItem(REGULAR_STORAGE_KEY);
            if (savedRegular) {
                try {
                    const { station, track } = JSON.parse(savedRegular);
                    if (station) {
                        const stationData = data.find(st => st.name === station);
                        setRegularFrom({
                            station: station || '',
                            track: track || '',
                            availableTracks: stationData?.tracks || []
                        });
                    }
                } catch (e) {
                    console.error('Failed to parse saved regular station:', e);
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
        const emptyStops = customStops.filter(s => !s.station);
        if (emptyStops.length > 0) {
            setError('Please select all stations');
            return;
        }

        // Build stops array — fetch only the forward leg from the route API
        const forwardJourneyStops: JourneyStopInput[] = customStops.map(stop => {
            const stationData = stations.find(s => s.name === stop.station);
            return {
                code: stationData?.code || '',
                track: stop.track || undefined
            };
        }).filter(s => s.code);

        if (forwardJourneyStops.length < 2) {
            setError('Could not find station codes');
            return;
        }

        // Round trip: mirror stops for the journey session (A,B,C,D → A,B,C,D,C,B,A)
        let effectiveStops = customStops;
        let effectiveJourneyStops = forwardJourneyStops;
        if (returnToStart && customStops.length >= 2) {
            const returnStops = customStops.slice(0, -1).reverse();
            effectiveStops = [...customStops, ...returnStops];
            const returnJourneyStops = forwardJourneyStops.slice(0, -1).reverse();
            effectiveJourneyStops = [...forwardJourneyStops, ...returnJourneyStops];
        }

        try {
            setFetchingRoute(true);
            setError(null);

            // Fetch route geometry for the forward leg only
            const journeyData = await fetchJourneyRoute(forwardJourneyStops);

            // For round trips, mirror the geometry: reverse route points and stop indices
            if (returnToStart && customStops.length >= 2) {
                const geo = journeyData.geometry;
                const forwardRoute = geo.route;
                const forwardStopIndices = geo.stop_indices;

                // Reverse the route points (skip first of reversed to avoid duplicating the turnaround point)
                const returnRoute = [...forwardRoute].reverse().slice(1);
                // Map forward stop indices into the appended return portion
                const lastForwardIdx = forwardRoute.length - 1;
                const returnStopIndices = [...forwardStopIndices].reverse().slice(1)
                    .map(idx => 2 * lastForwardIdx - idx);

                geo.route = [...forwardRoute, ...returnRoute];
                geo.stop_indices = [...forwardStopIndices, ...returnStopIndices];
            }

            // Calculate arrival/departure times from route metadata
            const routeStops = calculateStopTimes(
                effectiveStops.map(s => s.station),
                effectiveJourneyStops.map(s => s.code),
                effectiveStops.map(s => s.track || null),
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

            startJourney(routeData, routeData.properties.startTime, returnToStart);
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
        const stationData = stations.find(s => s.name === stationName);
        setRegularFrom({
            station: stationName,
            track: '',
            availableTracks: stationData?.tracks || []
        });
        setDepartures([]);
        setExpandedDeparture(null);
        setSelectedDeparture(null);
        setExpandedJourney(null);
        setError(null);

        if (!stationName) return;

        if (!stationData?.code) {
            setError('Station code not found');
            return;
        }

        fetchDepartures(stationData.code);
    };

    const updateRegularTrack = (track: string) => {
        setRegularFrom(prev => ({ ...prev, track }));
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
                                            <div className={`${styles.timeline} thinScroll`}>
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
                                    <StationPicker
                                        stations={stations}
                                        selectedStation={fromStation}
                                        selectedTrack={regularFrom.track}
                                        availableTracks={regularFrom.availableTracks}
                                        onSelectStation={(name) => handleRegularStationSelect(name)}
                                        onSelectTrack={(track) => updateRegularTrack(track)}
                                        disabled={loadingDepartures}
                                        label="From"
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
                                                        {track && <span className={styles.timelineTrackBadge}>{track}</span>}
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
                ) : activeTab === 'archive' ? (
                    /* Archive Tab Content */
                    <>
                        <div className={styles.archiveToggle}>
                            <button
                                className={`${styles.archiveToggleButton} ${archiveView === 'history' ? styles.archiveToggleButtonActive : ''}`}
                                onClick={() => setArchiveView('history')}
                            >
                                History
                            </button>
                            <button
                                className={`${styles.archiveToggleButton} ${archiveView === 'favorites' ? styles.archiveToggleButtonActive : ''}`}
                                onClick={() => setArchiveView('favorites')}
                            >
                                Starred
                            </button>
                        </div>

                        {archiveError && <div className={styles.error}>{archiveError}</div>}

                        {loadingArchive ? (
                            <div className={styles.loading}>Loading...</div>
                        ) : archiveView === 'history' ? (
                            history.length === 0 ? (
                                <div className={styles.archiveEmpty}>No journeys yet</div>
                            ) : (
                                <div className={styles.archiveList}>
                                    {history.map(entry => {
                                        const isExpanded = expandedArchiveId === entry.id;
                                        return (
                                            <div key={entry.id} className={`${styles.archiveItem} ${isExpanded ? styles.archiveExpanded : ''}`}>
                                                <div
                                                    className={styles.archiveItemHeader}
                                                    onClick={() => setExpandedArchiveId(isExpanded ? null : entry.id)}
                                                >
                                                    <div className={styles.archiveItemContent}>
                                                        <span className={styles.archiveRoute}>
                                                            {resolveStationName(entry.station_codes[0])} → {resolveStationName(entry.station_codes[entry.station_codes.length - 1])}
                                                            {entry.is_round_trip && <span className={styles.roundTripBadge}>Round trip</span>}
                                                        </span>
                                                        <span className={styles.archiveMeta}>
                                                            <span>{formatDate(entry.started_at)}</span>
                                                            <span>{entry.station_codes.length} stops</span>
                                                            <span>{entry.total_km_earned} km</span>
                                                        </span>
                                                    </div>
                                                    <button
                                                        className={`${styles.starButton} ${entry.is_favorited ? styles.starButtonActive : ''}`}
                                                        onClick={(e) => { e.stopPropagation(); handleToggleFavorite(entry.station_codes, entry.total_km_earned, entry.country, entry.is_round_trip); }}
                                                    >
                                                        {entry.is_favorited ? '★' : '☆'}
                                                    </button>
                                                </div>
                                                {isExpanded && (
                                                    <div className={styles.archiveDetail}>
                                                        <div className={styles.timeline}>
                                                            {entry.station_codes.map((code, idx) => {
                                                                const isFirst = idx === 0;
                                                                const isLast = idx === entry.station_codes.length - 1;
                                                                return (
                                                                    <div key={idx} className={`${styles.timelineStop} ${isFirst ? styles.origin : ''} ${isLast ? styles.destination : ''}`}>
                                                                        <div className={styles.timelineTrack}>
                                                                            <div className={`${styles.timelineDot} ${isFirst ? styles.origin : ''} ${isLast ? styles.destination : ''}`} />
                                                                        </div>
                                                                        <div className={styles.timelineInfo}>
                                                                            <div className={styles.timelineStationRow}>
                                                                                <span className={styles.timelineStation}>{resolveStationName(code)}</span>
                                                                            </div>
                                                                        </div>
                                                                    </div>
                                                                );
                                                            })}
                                                        </div>
                                                        <div className={styles.archiveActions}>
                                                            <button
                                                                className={styles.driveButton}
                                                                onClick={() => loadRouteIntoCustom(entry.station_codes, entry.is_round_trip)}
                                                            >
                                                                Drive this route
                                                            </button>
                                                        </div>
                                                    </div>
                                                )}
                                            </div>
                                        );
                                    })}
                                </div>
                            )
                        ) : (
                            favorites.length === 0 ? (
                                <div className={styles.archiveEmpty}>No starred routes</div>
                            ) : (
                                <div className={styles.archiveList}>
                                    {favorites.map(fav => {
                                        const isExpanded = expandedArchiveId === fav.id;
                                        return (
                                            <div key={fav.id} className={`${styles.archiveItem} ${isExpanded ? styles.archiveExpanded : ''}`}>
                                                <div
                                                    className={styles.archiveItemHeader}
                                                    onClick={() => setExpandedArchiveId(isExpanded ? null : fav.id)}
                                                >
                                                    <div className={styles.archiveItemContent}>
                                                        <span className={styles.archiveRoute}>
                                                            {(fav.station_names?.[0] || resolveStationName(fav.station_codes[0]))} → {(fav.station_names?.[fav.station_names.length - 1] || resolveStationName(fav.station_codes[fav.station_codes.length - 1]))}
                                                            {fav.is_round_trip && <span className={styles.roundTripBadge}>Round trip</span>}
                                                        </span>
                                                        <span className={styles.archiveMeta}>
                                                            <span>{fav.station_codes.length} stops</span>
                                                            {fav.total_km && <span>{Math.round(fav.total_km * 100) / 100} km</span>}
                                                        </span>
                                                    </div>
                                                    <button
                                                        className={`${styles.starButton} ${styles.starButtonActive}`}
                                                        onClick={(e) => { e.stopPropagation(); handleToggleFavorite(fav.station_codes, fav.total_km || undefined, fav.country, fav.is_round_trip); }}
                                                    >
                                                        ★
                                                    </button>
                                                </div>
                                                {isExpanded && (
                                                    <div className={styles.archiveDetail}>
                                                        <div className={styles.timeline}>
                                                            {fav.station_codes.map((code, idx) => {
                                                                const isFirst = idx === 0;
                                                                const isLast = idx === fav.station_codes.length - 1;
                                                                return (
                                                                    <div key={idx} className={`${styles.timelineStop} ${isFirst ? styles.origin : ''} ${isLast ? styles.destination : ''}`}>
                                                                        <div className={styles.timelineTrack}>
                                                                            <div className={`${styles.timelineDot} ${isFirst ? styles.origin : ''} ${isLast ? styles.destination : ''}`} />
                                                                        </div>
                                                                        <div className={styles.timelineInfo}>
                                                                            <div className={styles.timelineStationRow}>
                                                                                <span className={styles.timelineStation}>{fav.station_names?.[idx] || resolveStationName(code)}</span>
                                                                            </div>
                                                                        </div>
                                                                    </div>
                                                                );
                                                            })}
                                                        </div>
                                                        <div className={styles.archiveActions}>
                                                            <button
                                                                className={styles.driveButton}
                                                                onClick={() => loadRouteIntoCustom(fav.station_codes, fav.is_round_trip)}
                                                            >
                                                                Drive this route
                                                            </button>
                                                        </div>
                                                    </div>
                                                )}
                                            </div>
                                        );
                                    })}
                                </div>
                            )
                        )}
                    </>
                ) : (
                    /* Custom Tab Content */
                    <>
                        <div className={`${styles.customRow} ${minimapReady ? styles.customRowWithMap : ''}`}>
                            {/* Stops List */}
                            <div className={styles.stopsList}>
                                {customStops.map((stop, index) => (
                                    <StopRow
                                        key={index}
                                        index={index}
                                        stops={customStops}
                                        stations={stations}
                                        onUpdate={updateCustomStop}
                                        onRemove={removeStop}
                                        canRemove={customStops.length > 2 && index !== 0 && index !== customStops.length - 1}
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
                        {customStops.length < MAX_STOPS && (
                            <button
                                className={styles.addStopButton}
                                onClick={addStop}
                                disabled={fetchingRoute}
                            >
                                + Add Stop
                            </button>
                        )}

                        {/* Options row */}
                        <div className={styles.optionsRow}>
                            <div
                                className={styles.optionCard}
                                onClick={() => !fetchingRoute && setReturnToStart(prev => !prev)}
                            >
                                <span className={styles.optionLabel}>Round trip</span>
                                <div className={`${styles.returnToggleSwitch} ${returnToStart ? styles.returnToggleSwitchOn : ''}`} />
                            </div>
                            <div
                                className={`${styles.optionCard} ${showConditions ? styles.optionCardActive : ''}`}
                                onClick={() => setShowConditions(prev => !prev)}
                            >
                                <span className={styles.optionLabel}>Conditions</span>
                                <span className={styles.optionArrow}>{showConditions ? '▾' : '▸'}</span>
                            </div>
                        </div>

                        {/* Conditions panel */}
                        {showConditions && (
                            <div className={styles.conditionsPanel}>
                                <div className={styles.conditionSection}>
                                    <div className={styles.conditionHeader}>
                                        <span className={styles.conditionLabel}>Time of day</span>
                                        <button
                                            className={`${styles.conditionPill} ${conditions.timeOfDay < 0 ? styles.conditionPillActive : ''}`}
                                            onClick={() => setGameCondition('timeOfDay', -1)}
                                        >
                                            Auto
                                        </button>
                                    </div>
                                    {conditions.timeOfDay >= 0 ? (
                                        <TimePicker
                                            hour={Math.floor(conditions.timeOfDay / 100)}
                                            minute={conditions.timeOfDay % 100}
                                            onChange={(h, m) => setGameCondition('timeOfDay', h * 100 + m)}
                                        />
                                    ) : (
                                        <div className={styles.timePresets}>
                                            {([
                                                ['Dawn', 600],
                                                ['Morning', 900],
                                                ['Noon', 1200],
                                                ['Afternoon', 1500],
                                                ['Sunset', 1900],
                                                ['Night', 2200],
                                            ] as const).map(([label, value]) => (
                                                <button
                                                    key={label}
                                                    className={styles.timePresetButton}
                                                    onClick={() => setGameCondition('timeOfDay', value)}
                                                >
                                                    {label}
                                                </button>
                                            ))}
                                        </div>
                                    )}
                                </div>

                                <div className={styles.conditionSection}>
                                    <span className={styles.conditionLabel}>Weather</span>
                                    <div className={styles.weatherOptions}>
                                        {([
                                            ['clear', 'Clear'],
                                            ['cloudy', 'Cloudy'],
                                            ['overcast', 'Overcast'],
                                            ['rain', 'Rain'],
                                            ['heavy-rain', 'Storm'],
                                        ] as [GameConditions['weather'], string][]).map(([value, label]) => (
                                            <button
                                                key={value}
                                                className={`${styles.weatherButton} ${conditions.weather === value ? styles.weatherButtonActive : ''}`}
                                                onClick={() => setGameCondition('weather', value)}
                                            >
                                                {label}
                                            </button>
                                        ))}
                                    </div>
                                </div>
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
    );
}
