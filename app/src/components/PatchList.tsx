import { useState, useEffect } from 'preact/hooks';
import type { Patch } from '../lib/types/Patch';
import { fetchPatches, deletePatch } from '../lib/api/patches';

import styles from './PatchList.module.css';

interface PatchListProps {
    onSelectPatch: (patchId: number) => void;
    onCreateNew: () => void;
    onEditPatch?: (patchId: number, patch: Patch) => void;
    activePatchId?: number | null;
}

function PatchList({ onSelectPatch, onCreateNew, onEditPatch, activePatchId }: PatchListProps) {
    const [patches, setPatches] = useState<Patch[]>([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const [deletingId, setDeletingId] = useState<number | null>(null);

    const loadPatches = async () => {
        try {
            setLoading(true);
            setError(null);
            const data = await fetchPatches();
            setPatches(data);
        } catch (err) {
            setError(err instanceof Error ? err.message : 'Failed to load patches');
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => {
        loadPatches();
    }, []);

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
            default:
                return '#f59e0b';
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
                <h2 className={styles.title}>My Patches</h2>
                <button onClick={onCreateNew} className={styles.createButton}>
                    + Create New Patch
                </button>
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
                            onClick={() => onSelectPatch(patch.id)}
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

                            <div className={styles.patchInfo}>
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

                            {patch.status === 'pending' && (
                                <div className={styles.actions}>
                                    {onEditPatch && activePatchId !== patch.id && (
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
