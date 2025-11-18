import { useState } from 'preact/hooks';
import PatchList from './PatchList';
import PatchCreator from './PatchCreator';
import type { RouteInfo, Patch } from '../lib/types/Patch';

import styles from './PatchManagement.module.css';

interface PatchManagementProps {
    onClose?: () => void;
    onStartEditing?: (patchId: number, routeInfo: RouteInfo) => void;
    activePatchId?: number | null;
}

function PatchManagement({ onClose, onStartEditing, activePatchId }: PatchManagementProps) {
    const [showCreator, setShowCreator] = useState(false);

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

    return (
        <div className={styles.container}>
            {onClose && (
                <button onClick={onClose} className={styles.closeButton}>
                    ✕ Close
                </button>
            )}

            <PatchList
                onCreateNew={handleCreateNew}
                onEditPatch={onStartEditing ? handleEditPatch : undefined}
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
