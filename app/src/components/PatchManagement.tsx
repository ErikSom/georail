import { useState } from 'preact/hooks';
import PatchList from './PatchList';
import PatchCreator from './PatchCreator';
import type { RouteInfo, Patch } from '../lib/types/Patch';
import { cancelPatch, submitPatchForReview } from '../lib/api/patches';

import styles from './PatchManagement.module.css';

interface PatchManagementProps {
    onClose?: () => void;
    onStartEditing?: (patchId: number, routeInfo: RouteInfo) => void;
    activePatchId?: number | null;
}

function PatchManagement({ onClose, onStartEditing, activePatchId }: PatchManagementProps) {
    const [showCreator, setShowCreator] = useState(false);
    const [patchListKey, setPatchListKey] = useState(0);

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
            {onClose && (
                <button onClick={onClose} className={styles.closeButton}>
                    ✕ Close
                </button>
            )}

            <PatchList
                key={patchListKey}
                onCreateNew={handleCreateNew}
                onEditPatch={onStartEditing ? handleEditPatch : undefined}
                onCancelPatch={handleCancelPatch}
                onSubmitPatch={handleSubmitPatch}
                activePatchId={activePatchId}
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
