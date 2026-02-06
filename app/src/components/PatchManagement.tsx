import { useState, useEffect } from 'preact/hooks';
import PatchList from './PatchList';
import PatchCreator from './PatchCreator';
import type { RouteInfo, Patch, NetworkCoverage } from '../lib/types/Patch';
import { fetchUserProfile, type UserRole, type UserProfile } from '../lib/api/profile';
import { fetchAllStations, type StationTrackInfo } from '../lib/api/station';

import styles from './PatchManagement.module.css';

interface PatchManagementProps {
    onClose?: () => void;
    onStartEditing?: (patchId: number, routeInfo: RouteInfo, reviewMode?: boolean, declineReason?: string) => void;
    activePatchId?: number | null;
}

function PatchManagement({ onClose, onStartEditing, activePatchId }: PatchManagementProps) {
    const [showCreator, setShowCreator] = useState(false);
    const [patchListKey, setPatchListKey] = useState(0);
    const [moderatorMode, setModeratorMode] = useState(false);
    const [userRole, setUserRole] = useState<UserRole>('editor');
    const [profile, setProfile] = useState<UserProfile | null>(null);
    const [stations, setStations] = useState<StationTrackInfo[]>([]);
    const [coverage, setCoverage] = useState<NetworkCoverage | null>(null);

    useEffect(() => {
        fetchUserProfile().then((p) => {
            setProfile(p);
            setUserRole(p?.role || 'user');
        }).catch(console.error);
        fetchAllStations().then(setStations).catch(console.error);
        import('../lib/api/patches').then(({ fetchNetworkCoverage }) =>
            fetchNetworkCoverage().then(setCoverage).catch(() => {})
        );
    }, []);

    const getStationCode = (stationName: string): string => {
        const station = stations.find(s => s.name === stationName);
        return station?.code || '';
    };

    const handleCreateNew = () => {
        setShowCreator(true);
    };

    const handleRouteSubmit = (patchId: number, info: RouteInfo) => {
        setShowCreator(false);

        if (onStartEditing) {
            onStartEditing(patchId, info);
        }
    };

    const handleCloseCreator = () => {
        setShowCreator(false);
    };

    const handleEditPatch = (patchId: number, patch: Patch) => {
        if (onStartEditing) {
            const routeInfo: RouteInfo = {
                fromStation: patch.from_station || '',
                fromStationCode: getStationCode(patch.from_station || ''),
                fromTrack: patch.from_track || '',
                toStation: patch.to_station || '',
                toStationCode: getStationCode(patch.to_station || ''),
                toTrack: patch.to_track || '',
                description: patch.description,
            };
            onStartEditing(patchId, routeInfo, false);
        }
    };

    const handleReviewPatch = (patchId: number, patch: Patch) => {
        if (onStartEditing) {
            const routeInfo: RouteInfo = {
                fromStation: patch.from_station || '',
                fromStationCode: getStationCode(patch.from_station || ''),
                fromTrack: patch.from_track || '',
                toStation: patch.to_station || '',
                toStationCode: getStationCode(patch.to_station || ''),
                toTrack: patch.to_track || '',
                description: patch.description,
            };
            onStartEditing(patchId, routeInfo, true, patch.decline_reason);
        }
    };

    const handleCancelPatch = async (patchId: number) => {
        try {
            const { cancelPatch } = await import('../lib/api/patches');
            await cancelPatch(patchId);
            // Force PatchList to reload by changing its key
            setPatchListKey(k => k + 1);
        } catch (err) {
            alert(err instanceof Error ? err.message : 'Failed to cancel patch');
        }
    };

    const handleSubmitPatch = async (patchId: number) => {
        try {
            const { submitPatchForReview } = await import('../lib/api/patches');
            await submitPatchForReview(patchId);
            // Force PatchList to reload by changing its key
            setPatchListKey(k => k + 1);
        } catch (err) {
            alert(err instanceof Error ? err.message : 'Failed to submit patch');
        }
    };

    const handleReopenPatch = async (patchId: number) => {
        try {
            const { reopenPatch } = await import('../lib/api/patches');
            await reopenPatch(patchId);
            // Force PatchList to reload by changing its key
            setPatchListKey(k => k + 1);
        } catch (err) {
            alert(err instanceof Error ? err.message : 'Failed to reopen patch');
        }
    };

    return (
        <div className={styles.container}>
            <div className={styles.topBar}>
                {onClose && (
                    <button onClick={onClose} className={styles.closeButton}>
                        ✕ Close
                    </button>
                )}
                {coverage?.summary && (
                    <div className={styles.coverageInfo}>
                        <div className={styles.coverageTrack}>
                            <div
                                className={styles.coverageFill}
                                style={{ width: `${coverage.summary.coverage_pct ?? 0}%` }}
                            />
                        </div>
                        <span className={styles.coverageText}>
                            {coverage.summary.coverage_pct ?? 0}% coverage
                        </span>
                    </div>
                )}
                {profile && (
                    <div className={styles.contributionInfo}>
                        <span className={styles.contributionStat}>
                            {profile.nodes_edited.toLocaleString()} nodes edited
                        </span>
                        {profile.nodes_reviewed > 0 && (
                            <span className={styles.contributionStat}>
                                {profile.nodes_reviewed.toLocaleString()} reviewed
                            </span>
                        )}
                    </div>
                )}
                {userRole === 'moderator' && (
                    <div className={styles.viewSwitcher}>
                        <button
                            onClick={() => setModeratorMode(false)}
                            className={`${styles.viewButton} ${!moderatorMode ? styles.viewButtonActive : ''}`}
                        >
                            My Patches
                        </button>
                        <button
                            onClick={() => setModeratorMode(true)}
                            className={`${styles.viewButton} ${moderatorMode ? styles.viewButtonActive : ''}`}
                        >
                            All Patches
                        </button>
                    </div>
                )}
            </div>

            <PatchList
                key={`${patchListKey}-${moderatorMode}`}
                onCreateNew={handleCreateNew}
                onEditPatch={onStartEditing ? handleEditPatch : undefined}
                onReviewPatch={onStartEditing ? handleReviewPatch : undefined}
                onReopenPatch={handleReopenPatch}
                onCancelPatch={handleCancelPatch}
                onSubmitPatch={handleSubmitPatch}
                activePatchId={activePatchId}
                moderatorMode={moderatorMode}
            />

            {showCreator && (
                <PatchCreator
                    onClose={handleCloseCreator}
                    onSubmit={handleRouteSubmit}
                />
            )}
        </div>
    );
}

export default PatchManagement;
