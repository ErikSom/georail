import { useState, useEffect } from 'preact/hooks';
import type { RouteEditor, NodeComparison } from '../lib/editor/RouteEditor';
import styles from './ReviewModal.module.css';

interface ReviewModalProps {
    patchId: number;
    routeEditor: RouteEditor;
    onClose: () => void;
    onSave?: () => Promise<void>;
    onApprove?: () => Promise<void>;
    onDecline?: (feedback: string) => Promise<void>;
    reviewMode?: boolean;
    previousDeclineReason?: string;
}

function ReviewModal({ patchId, routeEditor, onClose, onSave, onApprove, onDecline, reviewMode = false, previousDeclineReason }: ReviewModalProps) {
    const [comparisons, setComparisons] = useState<NodeComparison[]>([]);
    const [saving, setSaving] = useState(false);
    const [showDeclineInput, setShowDeclineInput] = useState(false);
    const [declineFeedback, setDeclineFeedback] = useState('');

    useEffect(() => {
        const nodeComparisons = routeEditor.getNodeComparisons();
        setComparisons(nodeComparisons);
    }, [routeEditor]);

    // Prefill decline feedback with previous decline reason
    useEffect(() => {
        if (previousDeclineReason) {
            setDeclineFeedback(previousDeclineReason);
        }
    }, [previousDeclineReason]);

    const handleSave = async () => {
        if (!onSave) return;
        try {
            setSaving(true);
            await onSave();
        } catch (error) {
            console.error('Failed to save:', error);
        } finally {
            setSaving(false);
        }
    };

    const handleApprove = async () => {
        if (!onApprove) return;
        if (!confirm('Are you sure you want to approve this patch?')) return;

        try {
            setSaving(true);
            await onApprove();
        } catch (error) {
            console.error('Failed to approve:', error);
            alert('Failed to approve patch. Please try again.');
        } finally {
            setSaving(false);
        }
    };

    const handleDecline = async () => {
        if (!onDecline) return;
        if (!confirm('Are you sure you want to decline this patch?')) return;

        try {
            setSaving(true);
            await onDecline(declineFeedback);
        } catch (error) {
            console.error('Failed to decline:', error);
            alert('Failed to decline patch. Please try again.');
        } finally {
            setSaving(false);
            setShowDeclineInput(false);
            setDeclineFeedback('');
        }
    };

    return (
        <div className={styles.overlay} onClick={onClose}>
            <div className={styles.modal} onClick={(e) => e.stopPropagation()}>
                <div className={styles.header}>
                    <h2 className={styles.title}>
                        {reviewMode ? `Review Patch #${patchId}` : `Review & Save Patch #${patchId}`}
                    </h2>
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
                    {reviewMode ? (
                        <>
                            {showDeclineInput && (
                                <textarea
                                    value={declineFeedback}
                                    onInput={(e) => setDeclineFeedback((e.target as HTMLTextAreaElement).value)}
                                    placeholder="Reason for declining (optional)"
                                    className={styles.feedbackInput}
                                    rows={3}
                                />
                            )}
                            <div className={styles.reviewActions}>
                                <button onClick={onClose} className={styles.cancelButton}>
                                    Close
                                </button>
                                {showDeclineInput ? (
                                    <>
                                        <button
                                            onClick={() => {
                                                setShowDeclineInput(false);
                                                setDeclineFeedback('');
                                            }}
                                            className={styles.cancelButton}
                                        >
                                            Cancel Decline
                                        </button>
                                        <button
                                            onClick={handleDecline}
                                            disabled={saving}
                                            className={styles.declineButton}
                                        >
                                            {saving ? 'Declining...' : 'Confirm Decline'}
                                        </button>
                                    </>
                                ) : (
                                    <>
                                        <button
                                            onClick={() => setShowDeclineInput(true)}
                                            disabled={saving}
                                            className={styles.declineButton}
                                        >
                                            Decline
                                        </button>
                                        <button
                                            onClick={handleApprove}
                                            disabled={saving}
                                            className={styles.approveButton}
                                        >
                                            {saving ? 'Approving...' : 'Approve'}
                                        </button>
                                    </>
                                )}
                            </div>
                        </>
                    ) : (
                        <>
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
                        </>
                    )}
                </div>
            </div>
        </div>
    );
}

export default ReviewModal;
