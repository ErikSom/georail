import { useState } from 'preact/hooks';
import PatchList from './PatchList';
import PatchEditor from './PatchEditor';
import PatchCreator from './PatchCreator';
import type { PatchDataInput, RouteInfo, Patch } from '../lib/types/Patch';

import styles from './PatchManagement.module.css';

interface PatchManagementProps {
    // Optional: provide initial patch data from the editor
    currentPatchData?: PatchDataInput[];
    onClose?: () => void;
    onStartEditing?: (patchId: number, routeInfo: RouteInfo) => void;
    activePatchId?: number | null;
}

function PatchManagement({ currentPatchData, onClose, onStartEditing, activePatchId }: PatchManagementProps) {
    const [selectedPatchId, setSelectedPatchId] = useState<number | null>(null);
    const [showCreator, setShowCreator] = useState(false);
    const [showEditor, setShowEditor] = useState(false);
    const [routeInfo, setRouteInfo] = useState<RouteInfo | null>(null);
    const [refreshKey, setRefreshKey] = useState(0);

    const handleSelectPatch = (patchId: number) => {
        setSelectedPatchId(patchId);
        setShowEditor(true);
        setShowCreator(false);
    };

    const handleCreateNew = () => {
        setSelectedPatchId(null);
        setShowCreator(true);
        setShowEditor(false);
        setRouteInfo(null);
    };

    const handleRouteSubmit = (patchId: number, info: RouteInfo) => {
        setSelectedPatchId(patchId);
        setRouteInfo(info);
        setShowCreator(false);

        // If onStartEditing is provided, use the integrated editor
        if (onStartEditing) {
            onStartEditing(patchId, info);
        } else {
            // Otherwise show modal editor (legacy)
            setShowEditor(true);
        }
    };

    const handleCloseCreator = () => {
        setShowCreator(false);
        setRouteInfo(null);
    };

    const handleClosePatchEditor = () => {
        setSelectedPatchId(null);
        setShowEditor(false);
        setRouteInfo(null);
    };

    const handlePatchSaved = () => {
        setSelectedPatchId(null);
        setShowEditor(false);
        setRouteInfo(null);
        setRefreshKey((prev) => prev + 1); // Trigger refresh of patch list
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
                key={refreshKey}
                onSelectPatch={handleSelectPatch}
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

            {showEditor && (
                <PatchEditor
                    patchId={selectedPatchId}
                    onClose={handleClosePatchEditor}
                    onSaved={handlePatchSaved}
                    initialData={currentPatchData}
                    routeInfo={routeInfo}
                />
            )}
        </div>
    );
}

export default PatchManagement;
