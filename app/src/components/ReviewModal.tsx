import { useState, useEffect } from 'preact/hooks';
import type { RouteEditor, NodeData } from '../lib/editor/RouteEditor';
import styles from './ReviewModal.module.css';

interface ReviewModalProps {
    patchId: number;
    routeEditor: RouteEditor;
    onClose: () => void;
    onSave: () => Promise<void>;
}

function ReviewModal({ patchId, routeEditor, onClose, onSave }: ReviewModalProps) {
    const [allNodes, setAllNodes] = useState<NodeData[]>([]);
    const [saving, setSaving] = useState(false);

    useEffect(() => {
        const nodes = routeEditor.getModifiedNodes();
        setAllNodes(nodes);
    }, [routeEditor]);

    const handleSave = async () => {
        try {
            setSaving(true);
            await onSave();
        } catch (error) {
            console.error('Failed to save:', error);
        } finally {
            setSaving(false);
        }
    };

    return (
        <div className={styles.overlay} onClick={onClose}>
            <div className={styles.modal} onClick={(e) => e.stopPropagation()}>
                <div className={styles.header}>
                    <h2 className={styles.title}>Review & Save Patch #{patchId}</h2>
                    <button onClick={onClose} className={styles.closeButton}>
                        ✕
                    </button>
                </div>

                <div className={styles.content}>
                    <div className={styles.summary}>
                        <div className={styles.summaryItem}>
                            <span className={styles.summaryLabel}>Modified Nodes:</span>
                            <span className={styles.summaryValue}>{allNodes.length}</span>
                        </div>
                        <div className={styles.summaryItem}>
                            <span className={styles.summaryLabel}>Key Nodes:</span>
                            <span className={styles.summaryValue}>
                                {allNodes.filter(n => n.isKeyNode).length}
                            </span>
                        </div>
                    </div>

                    <div className={styles.tableContainer}>
                        <h3 className={styles.sectionTitle}>Modified Nodes ({allNodes.length} points)</h3>
                        {allNodes.length === 0 ? (
                            <div className={styles.emptyState}>No modifications made</div>
                        ) : (
                            <table className={styles.table}>
                                <thead>
                                    <tr>
                                        <th>Segment ID</th>
                                        <th>Point Index</th>
                                        <th>Offset X (m)</th>
                                        <th>Offset Y (m)</th>
                                        <th>Offset Z (m)</th>
                                        <th>Keynode</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {allNodes.map((node) => (
                                        <tr
                                            key={`${node.segment_id}-${node.index}`}
                                            className={styles.modifiedRow}
                                        >
                                            <td>{node.segment_id}</td>
                                            <td>{node.index}</td>
                                            <td>{node.world_offset.x.toFixed(2)}</td>
                                            <td>{node.world_offset.y.toFixed(2)}</td>
                                            <td>{node.world_offset.z.toFixed(2)}</td>
                                            <td>
                                                {node.isKeyNode ? (
                                                    <span className={styles.keyNodeBadge}>Yes</span>
                                                ) : (
                                                    <span className={styles.normalNodeBadge}>No</span>
                                                )}
                                            </td>
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                        )}
                    </div>
                </div>

                <div className={styles.footer}>
                    <button onClick={onClose} className={styles.cancelButton}>
                        Cancel
                    </button>
                    <button
                        onClick={handleSave}
                        disabled={saving}
                        className={styles.saveButton}
                    >
                        {saving ? 'Saving...' : 'Save Patch'}
                    </button>
                </div>
            </div>
        </div>
    );
}

export default ReviewModal;
