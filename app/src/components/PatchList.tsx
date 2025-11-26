import { useState, useEffect } from 'preact/hooks';
import type { Patch } from '../lib/types/Patch';
import { fetchPatches, fetchAllPatches, deletePatch, type PatchWithProfile } from '../lib/api/patches';

import styles from './PatchList.module.css';

type StatusFilter = Patch['status'] | 'all';

interface PatchListProps {
    onCreateNew: () => void;
    onEditPatch?: (patchId: number, patch: Patch) => void;
    onReviewPatch?: (patchId: number, patch: Patch) => void;
    onReopenPatch?: (patchId: number) => void;
    onCancelPatch: (patchId: number) => void;
    onSubmitPatch: (patchId: number) => void;
    activePatchId?: number | null;
    moderatorMode?: boolean;
}

function PatchList({ onCreateNew, onEditPatch, onReviewPatch, onReopenPatch, onCancelPatch, onSubmitPatch, activePatchId, moderatorMode = false }: PatchListProps) {
    const [patches, setPatches] = useState<(Patch | PatchWithProfile)[]>([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const [deletingId, setDeletingId] = useState<number | null>(null);
    const [statusFilter, setStatusFilter] = useState<StatusFilter>(moderatorMode ? 'pending' : 'all');

    const getUsername = (patch: Patch | PatchWithProfile): string => {
        if ('profiles' in patch && patch.profiles?.username) {
            return patch.profiles.username;
        }
        return patch.user_id.slice(0, 8) + '...';
    };

    const loadPatches = async () => {
        try {
            setLoading(true);
            setError(null);
            const filter = statusFilter === 'all' ? undefined : statusFilter;
            const data = moderatorMode
                ? await fetchAllPatches(filter)
                : await fetchPatches(filter);
            setPatches(data);
        } catch (err) {
            setError(err instanceof Error ? err.message : 'Failed to load patches');
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => {
        loadPatches();
    }, [statusFilter, moderatorMode]);

    const handleDelete = async (patchId: number, e: Event) => {
        e.stopPropagation();

        if (!confirm('Are you sure you want to delete this patch? This action cannot be undone.')) {
            return;
        }

        try {
            setDeletingId(patchId);
            await deletePatch(patchId);
            await loadPatches();
        } catch (err) {
            alert(err instanceof Error ? err.message : 'Failed to delete patch');
        } finally {
            setDeletingId(null);
        }
    };

    const getStatusColor = (status: Patch['status']) => {
        switch (status) {
            case 'approved':
                return '#22c55e';
            case 'declined':
                return '#ef4444';
            case 'pending':
                return '#f59e0b';
            case 'editing':
            default:
                return '#6b7280';
        }
    };

    const getStatusLabel = (status: Patch['status']) => {
        return status.charAt(0).toUpperCase() + status.slice(1);
    };

    const getPatchTitle = (patch: Patch) => {
        if (patch.from_station && patch.to_station) {
            const fromTrack = patch.from_track ? ` (${patch.from_track})` : '';
            const toTrack = patch.to_track ? ` (${patch.to_track})` : '';
            return `${patch.from_station}${fromTrack} → ${patch.to_station}${toTrack}`;
        }
        return `Patch #${patch.id}`;
    };

    const formatDate = (dateString: string) => {
        const date = new Date(dateString);
        return date.toLocaleDateString('en-US', {
            year: 'numeric',
            month: 'short',
            day: 'numeric',
            hour: '2-digit',
            minute: '2-digit'
        });
    };

    if (loading) {
        return (
            <div className={styles.container}>
                <div className={styles.loading}>Loading patches...</div>
            </div>
        );
    }

    if (error) {
        return (
            <div className={styles.container}>
                <div className={styles.error}>{error}</div>
                <button onClick={loadPatches} className={styles.retryButton}>
                    Retry
                </button>
            </div>
        );
    }

    return (
        <div className={styles.container}>
            <div className={styles.header}>
                <h2 className={styles.title}>{moderatorMode ? 'All Patches' : 'My Patches'}</h2>
                <div className={styles.headerActions}>
                    <select
                        value={statusFilter}
                        onChange={(e) => setStatusFilter((e.target as HTMLSelectElement).value as StatusFilter)}
                        className={styles.filterSelect}
                    >
                        {moderatorMode ? (
                            <>
                                <option value="pending">Pending</option>
                                <option value="approved">Approved</option>
                                <option value="declined">Declined</option>
                                <option value="all">All Statuses</option>
                            </>
                        ) : (
                            <>
                                <option value="all">All Statuses</option>
                                <option value="editing">Editing</option>
                                <option value="pending">Pending</option>
                                <option value="approved">Approved</option>
                                <option value="declined">Declined</option>
                            </>
                        )}
                    </select>
                    {!moderatorMode && (
                        <button onClick={onCreateNew} className={styles.createButton}>
                            + Create New Patch
                        </button>
                    )}
                </div>
            </div>

            {patches.length === 0 ? (
                <div className={styles.emptyState}>
                    <p>No patches yet</p>
                    <p className={styles.emptyHint}>Create your first patch to get started</p>
                </div>
            ) : (
                <div className={styles.patchGrid}>
                    {patches.map((patch) => (
                        <div
                            key={patch.id}
                            className={styles.patchCard}
                        >
                            <div className={styles.patchHeader}>
                                <div className={styles.patchTitleContainer}>
                                    <div className={styles.patchTitle}>{getPatchTitle(patch)}</div>
                                    <div className={styles.patchId}>#{patch.id}</div>
                                </div>
                                <span
                                    className={styles.statusBadge}
                                    style={{ backgroundColor: getStatusColor(patch.status) }}
                                >
                                    {getStatusLabel(patch.status)}
                                </span>
                            </div>

                            {patch.description && (
                                <div className={styles.patchDescription}>
                                    {patch.description}
                                </div>
                            )}

                            {patch.decline_reason && (patch.status === 'declined' || (patch.status === 'pending' && moderatorMode)) && (
                                <div className={styles.declineReason}>
                                    <strong>Previous Decline Reason:</strong> {patch.decline_reason}
                                </div>
                            )}

                            <div className={styles.patchInfo}>
                                {moderatorMode && (
                                    <div className={styles.infoRow}>
                                        <span className={styles.infoLabel}>Created by:</span>
                                        <span className={styles.infoValue}>
                                            {getUsername(patch)}
                                        </span>
                                    </div>
                                )}
                                <div className={styles.infoRow}>
                                    <span className={styles.infoLabel}>Created:</span>
                                    <span className={styles.infoValue}>
                                        {formatDate(patch.created_at)}
                                    </span>
                                </div>

                                {patch.reviewed_at && (
                                    <div className={styles.infoRow}>
                                        <span className={styles.infoLabel}>Reviewed:</span>
                                        <span className={styles.infoValue}>
                                            {formatDate(patch.reviewed_at)}
                                        </span>
                                    </div>
                                )}
                            </div>

                            {patch.status === 'editing' && (
                                <div className={styles.actions}>
                                    {activePatchId !== patch.id && onEditPatch && (
                                        <button
                                            onClick={(e) => {
                                                e.stopPropagation();
                                                onEditPatch(patch.id, patch);
                                            }}
                                            className={styles.editButton}
                                        >
                                            Edit
                                        </button>
                                    )}
                                    <button
                                        onClick={(e) => handleDelete(patch.id, e)}
                                        disabled={deletingId === patch.id}
                                        className={styles.deleteButton}
                                    >
                                        {deletingId === patch.id ? 'Deleting...' : 'Delete'}
                                    </button>
                                    <button
                                        onClick={(e) => {
                                            e.stopPropagation();
                                            onSubmitPatch(patch.id);
                                        }}
                                        className={styles.submitButton}
                                    >
                                        Submit
                                    </button>
                                </div>
                            )}

                            {patch.status === 'pending' && !moderatorMode && (
                                <div className={styles.actions}>
                                    <button
                                        onClick={(e) => {
                                            e.stopPropagation();
                                            onCancelPatch(patch.id);
                                        }}
                                        className={styles.cancelButton}
                                    >
                                        Cancel
                                    </button>
                                </div>
                            )}

                            {patch.status === 'pending' && moderatorMode && (
                                <div className={styles.actions}>
                                    {onReviewPatch && (
                                        <button
                                            onClick={() => onReviewPatch(patch.id, patch)}
                                            className={styles.approveButton}
                                        >
                                            Review
                                        </button>
                                    )}
                                </div>
                            )}

                            {patch.status === 'declined' && !moderatorMode && (
                                <div className={styles.actions}>
                                    {onReopenPatch && (
                                        <button
                                            onClick={() => onReopenPatch(patch.id)}
                                            className={styles.editButton}
                                        >
                                            Edit
                                        </button>
                                    )}
                                </div>
                            )}
                        </div>
                    ))}
                </div>
            )}
        </div>
    );
}

export default PatchList;
