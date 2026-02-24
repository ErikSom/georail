import { h } from 'preact';
import { useState, useEffect } from 'preact/hooks';
import {
    stationArrivalResults,
    stopDistances,
    stops,
    alreadyVisitedStations,
} from '../store/journey';
import { computeLevel, getLevelInfo } from '../lib/levels';
import { clearProfileCache } from '../lib/api/profile';
import styles from './JourneyComplete.module.css';

interface JourneyCompleteProps {
    onDismiss: () => void;
}

export default function JourneyComplete({ onDismiss }: JourneyCompleteProps) {
    const [animatedKm, setAnimatedKm] = useState(0);
    const [showLevelUp, setShowLevelUp] = useState(false);
    const [phase, setPhase] = useState<'waiting' | 'animating' | 'done'>('waiting');

    const results = stationArrivalResults.value;
    const distances = stopDistances.value;
    const stopsArr = stops.value;

    // Journey distance from route geometry
    const journeyDistanceKm = distances.length > 0
        ? distances[distances.length - 1]
        : 0;

    // Stats from server responses
    const lastResult = results[results.length - 1];
    const totalKmAfter = lastResult?.total_km ?? 0;
    const journeyKmEarned = lastResult?.journey_km ?? 0;
    const totalKmBefore = totalKmAfter - journeyKmEarned;
    const totalStationsVisited = lastResult?.total_stations_visited ?? 0;

    // Level calculations
    const levelBefore = computeLevel(totalKmBefore);
    const levelAfter = computeLevel(totalKmAfter);
    const didLevelUp = levelAfter > levelBefore;

    // New stations = route stops that weren't already visited before this journey
    const visited = alreadyVisitedStations.value;
    const newStations = stopsArr
        .filter(s => s.code && !visited.has(s.code))
        .map(s => ({ code: s.code, name: s.station }));

    // Animated km counter
    useEffect(() => {
        if (phase !== 'animating') return;

        const duration = 2000;
        const startTime = performance.now();

        const animate = (now: number) => {
            const elapsed = now - startTime;
            const progress = Math.min(1, elapsed / duration);
            // Ease-out cubic
            const eased = 1 - Math.pow(1 - progress, 3);
            setAnimatedKm(totalKmBefore + (totalKmAfter - totalKmBefore) * eased);

            if (progress < 1) {
                requestAnimationFrame(animate);
            } else {
                setAnimatedKm(totalKmAfter);
                if (didLevelUp) {
                    setShowLevelUp(true);
                }
                setPhase('done');
            }
        };

        requestAnimationFrame(animate);
    }, [phase, totalKmBefore, totalKmAfter, didLevelUp]);

    // Start animation after brief delay
    useEffect(() => {
        setAnimatedKm(totalKmBefore);
        const timer = setTimeout(() => setPhase('animating'), 600);
        return () => clearTimeout(timer);
    }, [totalKmBefore]);

    const handleDismiss = () => {
        clearProfileCache();
        onDismiss();
    };

    const currentAnimLevel = computeLevel(animatedKm);
    const currentAnimLevelInfo = getLevelInfo(animatedKm);

    return (
        <div className={styles.overlay}>
            <div className={styles.container}>
                <h1 className={styles.title}>Journey Complete</h1>

                {/* Journey distance */}
                <div className={styles.stat}>
                    <span className={styles.statLabel}>Distance</span>
                    <span className={styles.statValue}>
                        {journeyDistanceKm.toFixed(1)} km
                    </span>
                </div>

                <div className={styles.stat}>
                    <span className={styles.statLabel}>Stops</span>
                    <span className={styles.statValue}>
                        {stopsArr.length}
                    </span>
                </div>

                {/* KM counter animation */}
                <div className={styles.kmSection}>
                    <div className={styles.kmLabel}>Total Kilometers</div>
                    <div className={styles.kmValue}>
                        {animatedKm.toFixed(1)} km
                    </div>
                    <div className={styles.kmAdded}>
                        +{journeyKmEarned.toFixed(1)} km
                    </div>
                </div>

                {/* Level progress bar */}
                <div className={styles.levelSection}>
                    <div className={styles.levelHeader}>
                        <span className={styles.levelLabel}>
                            Level {currentAnimLevel}
                        </span>
                        <span className={styles.levelProgress}>
                            {currentAnimLevelInfo.progressKm.toFixed(0)} / {currentAnimLevelInfo.bracketKm.toFixed(0)} km
                        </span>
                    </div>
                    <div className={styles.progressBar}>
                        <div
                            className={styles.progressFill}
                            style={{ width: `${currentAnimLevelInfo.progressFraction * 100}%` }}
                        />
                    </div>
                </div>

                {/* Level up animation */}
                {showLevelUp && (
                    <div className={styles.levelUp}>
                        Level Up! You are now Level {levelAfter}
                    </div>
                )}

                {/* Stations */}
                <div className={styles.stationsSection}>
                    <div className={styles.stationCount}>
                        Stations Visited: {totalStationsVisited}
                    </div>
                    {newStations.length > 0 && (
                        <div className={styles.newStations}>
                            <div className={styles.newStationsLabel}>
                                Newly Unlocked
                            </div>
                            <div className={styles.stationList}>
                                {newStations.map(s => (
                                    <span key={s.code} className={styles.stationBadge}>
                                        {s.name}
                                    </span>
                                ))}
                            </div>
                        </div>
                    )}
                </div>

                {/* Dismiss button */}
                <button className={styles.doneButton} onClick={handleDismiss}>
                    Continue
                </button>
            </div>
        </div>
    );
}
