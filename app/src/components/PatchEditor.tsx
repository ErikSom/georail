import { useState, useEffect } from 'preact/hooks';
import type { PatchWithData, PatchDataInput, RouteInfo } from '../lib/types/Patch';
import { fetchPatchWithData, submitPatch } from '../lib/api/patches';

import styles from './PatchEditor.module.css';

interface PatchEditorProps {
    patchId: number | null;
    onClose: () => void;
    onSaved: () => void;
    initialData?: PatchDataInput[];
    routeInfo?: RouteInfo | null;
}

function PatchEditor({ patchId, onClose, onSaved, initialData, routeInfo }: PatchEditorProps) {
    const [patch, setPatch] = useState<PatchWithData | null>(null);
    const [patchData, setPatchData] = useState<PatchDataInput[]>(initialData || []);
    const [loading, setLoading] = useState(false);
    const [saving, setSaving] = useState(false);
    const [error, setError] = useState<string | null>(null);

    useEffect(() => {
        if (patchId) {
            loadPatch();
        }
    }, [patchId]);

    const loadPatch = async () => {
        if (!patchId) return;

        try {
            setLoading(true);
            setError(null);
            const data = await fetchPatchWithData(patchId);
            if (data) {
                setPatch(data);
                // Convert PatchData to PatchDataInput
                setPatchData(
                    data.data.map((d) => ({
                        segment_id: d.segment_id,
                        index: d.point_index,
                        height: d.height,
                        lateral_offset: d.lateral_offset,
                        keynode: d.keynode,
                    }))
                );
            }
        } catch (err) {
            setError(err instanceof Error ? err.message : 'Failed to load patch');
        } finally {
            setLoading(false);
        }
    };

    const handleSave = async () => {
        if (patchData.length === 0) {
            alert('Cannot save empty patch');
            return;
        }

        try {
            setSaving(true);
            setError(null);
            await submitPatch({
                data: patchData,
                patchId: patchId || undefined,
                fromStation: routeInfo?.fromStation || patch?.from_station,
                fromTrack: routeInfo?.fromTrack || patch?.from_track,
                toStation: routeInfo?.toStation || patch?.to_station,
                toTrack: routeInfo?.toTrack || patch?.to_track,
                description: routeInfo?.description || patch?.description,
            });
            onSaved();
        } catch (err) {
            setError(err instanceof Error ? err.message : 'Failed to save patch');
        } finally {
            setSaving(false);
        }
    };

    const formatDate = (dateString: string) => {
        const date = new Date(dateString);
        return date.toLocaleDateString('en-US', {
            year: 'numeric',
            month: 'short',
            day: 'numeric',
            hour: '2-digit',
            minute: '2-digit',
        });
    };

    const getStatusColor = (status: string) => {
        switch (status) {
            case 'approved':
                return '#22c55e';
            case 'declined':
                return '#ef4444';
            case 'pending':
            default:
                return '#f59e0b';
        }
    };

    const canEdit = !patch || patch.status === 'pending';

    const getTitle = () => {
        const info = routeInfo || patch;
        if (!info) return 'New Patch';

        if (patchId && patch) {
            // Existing patch
            if (patch.from_station && patch.to_station) {
                const fromTrack = patch.from_track ? ` (${patch.from_track})` : '';
                const toTrack = patch.to_track ? ` (${patch.to_track})` : '';
                return `${patch.from_station}${fromTrack} → ${patch.to_station}${toTrack}`;
            }
            return `Patch #${patchId}`;
        }

        // New patch with route info
        if (routeInfo) {
            const fromTrack = routeInfo.fromTrack ? ` (${routeInfo.fromTrack})` : '';
            const toTrack = routeInfo.toTrack ? ` (${routeInfo.toTrack})` : '';
            return `${routeInfo.fromStation}${fromTrack} → ${routeInfo.toStation}${toTrack}`;
        }

        return 'New Patch';
    };

    return (
        <div className={styles.overlay}>
            <div className={styles.modal}>
                <div className={styles.header}>
                    <h2 className={styles.title}>
                        {getTitle()}
                    </h2>
                    <button onClick={onClose} className={styles.closeButton}>
                        ✕
                    </button>
                </div>

                {loading ? (
                    <div className={styles.loading}>Loading patch...</div>
                ) : (
                    <>
                        {patch && (
                            <div className={styles.patchInfo}>
                                <div className={styles.infoGrid}>
                                    <div className={styles.infoItem}>
                                        <span className={styles.infoLabel}>Status:</span>
                                        <span
                                            className={styles.statusBadge}
                                            style={{ backgroundColor: getStatusColor(patch.status) }}
                                        >
                                            {patch.status.charAt(0).toUpperCase() + patch.status.slice(1)}
                                        </span>
                                    </div>
                                    <div className={styles.infoItem}>
                                        <span className={styles.infoLabel}>Created:</span>
                                        <span className={styles.infoValue}>{formatDate(patch.created_at)}</span>
                                    </div>
                                    {patch.reviewed_at && (
                                        <div className={styles.infoItem}>
                                            <span className={styles.infoLabel}>Reviewed:</span>
                                            <span className={styles.infoValue}>{formatDate(patch.reviewed_at)}</span>
                                        </div>
                                    )}
                                </div>

                                {patch.status === 'declined' && (
                                    <div className={styles.declinedNotice}>
                                        <strong>Patch Declined</strong>
                                        <p>This patch was not approved. You cannot edit declined patches.</p>
                                    </div>
                                )}

                                {patch.status === 'approved' && (
                                    <div className={styles.approvedNotice}>
                                        <strong>Patch Approved</strong>
                                        <p>This patch has been approved and applied. You cannot edit approved patches.</p>
                                    </div>
                                )}
                            </div>
                        )}

                        <div className={styles.content}>
                            <div className={styles.dataHeader}>
                                <h3 className={styles.dataTitle}>
                                    Patch Data ({patchData.length} points)
                                </h3>
                                {!canEdit && (
                                    <span className={styles.readOnlyBadge}>Read Only</span>
                                )}
                            </div>

                            <div className={styles.dataTable}>
                                <table className={styles.table}>
                                    <thead>
                                        <tr className={styles.tableHeaderRow}>
                                            <th className={styles.tableHeader}>Segment ID</th>
                                            <th className={styles.tableHeader}>Point Index</th>
                                            <th className={styles.tableHeader}>Height (m)</th>
                                            <th className={styles.tableHeader}>Lateral Offset (m)</th>
                                            <th className={styles.tableHeader}>Keynode</th>
                                        </tr>
                                    </thead>
                                    <tbody>
                                        {patchData.length === 0 ? (
                                            <tr>
                                                <td colSpan={5} className={styles.emptyCell}>
                                                    No data points yet
                                                </td>
                                            </tr>
                                        ) : (
                                            patchData.map((item, index) => (
                                                <tr key={index} className={styles.tableRow}>
                                                    <td className={styles.tableCell}>{item.segment_id}</td>
                                                    <td className={styles.tableCell}>{item.index}</td>
                                                    <td className={styles.tableCell}>{item.height.toFixed(2)}</td>
                                                    <td className={styles.tableCell}>{item.lateral_offset.toFixed(2)}</td>
                                                    <td className={styles.tableCell}>
                                                        {item.keynode ? '✓' : '—'}
                                                    </td>
                                                </tr>
                                            ))
                                        )}
                                    </tbody>
                                </table>
                            </div>
                        </div>

                        {error && <div className={styles.error}>{error}</div>}

                        <div className={styles.footer}>
                            <button onClick={onClose} className={styles.cancelButton}>
                                {canEdit ? 'Cancel' : 'Close'}
                            </button>
                            {canEdit && (
                                <button
                                    onClick={handleSave}
                                    disabled={saving || patchData.length === 0}
                                    className={styles.saveButton}
                                >
                                    {saving ? 'Saving...' : patchId ? 'Update Patch' : 'Create Patch'}
                                </button>
                            )}
                        </div>
                    </>
                )}
            </div>
        </div>
    );
}


export default PatchEditor;
