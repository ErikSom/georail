import { useState, useEffect } from 'preact/hooks';
import type { RouteEditor, NodeComparison } from '../lib/editor/RouteEditor';
import styles from './ReviewModal.module.css';

interface ReviewModalProps {
    patchId: number;
    routeEditor: RouteEditor;
    onClose: () => void;
    onSave: () => Promise<void>;
}

function ReviewModal({ patchId, routeEditor, onClose, onSave }: ReviewModalProps) {
    const [comparisons, setComparisons] = useState<NodeComparison[]>([]);
    const [saving, setSaving] = useState(false);

    useEffect(() => {
        const nodeComparisons = routeEditor.getNodeComparisons();
        setComparisons(nodeComparisons);
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
                            <span className={styles.summaryValue}>{comparisons.length}</span>
                        </div>
                        <div className={styles.summaryItem}>
                            <span className={styles.summaryLabel}>Key Nodes:</span>
                            <span className={styles.summaryValue}>
                                {comparisons.filter(c => c.node.isKeyNode).length}
                            </span>
                        </div>
                    </div>

                    <div className={styles.tableContainer}>
                        <h3 className={styles.sectionTitle}>Modified Nodes ({comparisons.length} points)</h3>
                        {comparisons.length === 0 ? (
                            <div className={styles.emptyState}>No modifications made</div>
                        ) : (
                            <table className={styles.table}>
                                <thead>
                                    <tr>
                                        <th>Segment</th>
                                        <th>Index</th>
                                        <th>East (m)</th>
                                        <th>North (m)</th>
                                        <th>Up (m)</th>
                                        <th>Key</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {comparisons.map((comp) => (
                                        <tr
                                            key={`${comp.node.segment_id}-${comp.node.index}`}
                                            className={styles.modifiedRow}
                                        >
                                            <td>{comp.node.segment_id}</td>
                                            <td>{comp.node.index}</td>
                                            <td>
                                                <div className={styles.comparison}>
                                                    <span className={styles.oldValue}>{comp.original.east.toFixed(2)}</span>
                                                    <span className={styles.arrow}>→</span>
                                                    <span className={styles.newValue}>{comp.current.east.toFixed(2)}</span>
                                                </div>
                                            </td>
                                            <td>
                                                <div className={styles.comparison}>
                                                    <span className={styles.oldValue}>{comp.original.north.toFixed(2)}</span>
                                                    <span className={styles.arrow}>→</span>
                                                    <span className={styles.newValue}>{comp.current.north.toFixed(2)}</span>
                                                </div>
                                            </td>
                                            <td>
                                                <div className={styles.comparison}>
                                                    <span className={styles.oldValue}>{comp.original.up.toFixed(2)}</span>
                                                    <span className={styles.arrow}>→</span>
                                                    <span className={styles.newValue}>{comp.current.up.toFixed(2)}</span>
                                                </div>
                                            </td>
                                            <td>
                                                {comp.node.isKeyNode ? (
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
