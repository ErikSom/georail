import { h } from 'preact';
import { useState, useEffect } from 'preact/hooks';
import {
    stationArrivalResults,
    stopDistances,
    stops,
    alreadyVisitedStations,
    formatDistanceKm,
} from '../store/journey';
import { computeLevel, getLevelInfo } from '../lib/levels';
import { clearProfileCache } from '../lib/api/profile';
import { t } from '../i18n';
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
                <h1 className={styles.title}>{t('journeyComplete.title')}</h1>

                {/* Journey distance */}
                <div className={styles.stat}>
                    <span className={styles.statLabel}>{t('journeyComplete.distance')}</span>
                    <span className={styles.statValue}>
                        {formatDistanceKm(journeyDistanceKm)}
                    </span>
                </div>

                <div className={styles.stat}>
                    <span className={styles.statLabel}>{t('journeyComplete.stops')}</span>
                    <span className={styles.statValue}>
                        {stopsArr.length}
                    </span>
                </div>

                {/* KM counter animation */}
                <div className={styles.kmSection}>
                    <div className={styles.kmLabel}>{t('journeyComplete.totalKilometers')}</div>
                    <div className={styles.kmValue}>
                        {formatDistanceKm(animatedKm)}
                    </div>
                    <div className={styles.kmAdded}>
                        +{formatDistanceKm(journeyKmEarned)}
                    </div>
                </div>

                {/* Level progress bar */}
                <div className={styles.levelSection}>
                    <div className={styles.levelHeader}>
                        <span className={styles.levelLabel}>
                            {t('journeyComplete.level', { n: currentAnimLevel })}
                        </span>
                        <span className={styles.levelProgress}>
                            {formatDistanceKm(currentAnimLevelInfo.progressKm)} / {formatDistanceKm(currentAnimLevelInfo.bracketKm)}
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
                        {t('journeyComplete.levelUp', { n: levelAfter })}
                    </div>
                )}

                {/* Stations */}
                <div className={styles.stationsSection}>
                    <div className={styles.stationCount}>
                        {t('journeyComplete.stationsVisited', { n: totalStationsVisited })}
                    </div>
                    {newStations.length > 0 && (
                        <div className={styles.newStations}>
                            <div className={styles.newStationsLabel}>
                                {t('journeyComplete.newlyUnlocked')}
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
                    {t('journeyComplete.continue')}
                </button>
            </div>
        </div>
    );
}
