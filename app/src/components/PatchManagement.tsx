import { useState, useEffect } from 'preact/hooks';
import PatchList from './PatchList';
import PatchCreator from './PatchCreator';
import type { RouteInfo, Patch } from '../lib/types/Patch';
import { cancelPatch, submitPatchForReview } from '../lib/api/patches';
import { fetchUserRole, type UserRole } from '../lib/api/profile';

import styles from './PatchManagement.module.css';

interface PatchManagementProps {
    onClose?: () => void;
    onStartEditing?: (patchId: number, routeInfo: RouteInfo) => void;
    activePatchId?: number | null;
}

function PatchManagement({ onClose, onStartEditing, activePatchId }: PatchManagementProps) {
    const [showCreator, setShowCreator] = useState(false);
    const [patchListKey, setPatchListKey] = useState(0);
    const [moderatorMode, setModeratorMode] = useState(false);
    const [userRole, setUserRole] = useState<UserRole>('editor');

    useEffect(() => {
        fetchUserRole().then(setUserRole).catch(console.error);
    }, []);

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
                fromTrack: patch.from_track || '',
                toStation: patch.to_station || '',
                toTrack: patch.to_track || '',
                description: patch.description,
            };
            onStartEditing(patchId, routeInfo);
        }
    };

    const handleCancelPatch = async (patchId: number) => {
        try {
            await cancelPatch(patchId);
            // Force PatchList to reload by changing its key
            setPatchListKey(k => k + 1);
        } catch (err) {
            alert(err instanceof Error ? err.message : 'Failed to cancel patch');
        }
    };

    const handleSubmitPatch = async (patchId: number) => {
        try {
            await submitPatchForReview(patchId);
            // Force PatchList to reload by changing its key
            setPatchListKey(k => k + 1);
        } catch (err) {
            alert(err instanceof Error ? err.message : 'Failed to submit patch');
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
