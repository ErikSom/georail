import { useState, useEffect, useRef } from 'preact/hooks';
import { Editor } from '../lib/editor/Editor';
import PatchManagement from './PatchManagement';
import ReviewModal from './ReviewModal';
import type { RouteInfo } from '../lib/types/Patch';

import styles from './EditorViewer.module.css';

function EditorViewer() {
    const mountRef = useRef<HTMLDivElement | null>(null);
    const editorRef = useRef<Editor | null>(null);
    const [credits, setCredits] = useState<string>('');
    const [showPatchManagement, setShowPatchManagement] = useState(false);
    const [activePatchId, setActivePatchId] = useState<number | null>(null);
    const [selectedNodeData, setSelectedNodeData] = useState<any>(null);
    const [modifiedNodesCount, setModifiedNodesCount] = useState(0);
    const [reviewMode, setReviewMode] = useState(false);
    const [currentPatchDeclineReason, setCurrentPatchDeclineReason] = useState<string | undefined>(undefined);
    const [currentNodeIndex, setCurrentNodeIndex] = useState(-1);
    const [totalNodes, setTotalNodes] = useState(0);

    useEffect(() => {
        if (mountRef.current && !editorRef.current) {
            const editor = new Editor(mountRef.current, setCredits);
            editor.init();

            // Wire up callbacks
            editor.onNodeSelected = (nodeData) => {
                setSelectedNodeData(nodeData);
            };

            editor.onNodesModified = (count) => {
                setModifiedNodesCount(count);
            };

            editor.onNodeIndexChanged = (index, total) => {
                setCurrentNodeIndex(index);
                setTotalNodes(total);
            };

            editorRef.current = editor;
        }

        return () => {
            editorRef.current?.cleanup();
            editorRef.current = null;
        };

    }, []);

    const handleStartEditingPatch = async (patchId: number, routeInfo: RouteInfo, isReviewMode: boolean = false, declineReason?: string) => {
        setActivePatchId(patchId);
        setReviewMode(isReviewMode);
        setCurrentPatchDeclineReason(declineReason);
        setShowPatchManagement(false);

        if (editorRef.current) {
            try {
                await editorRef.current.loadPatchRoute(routeInfo, patchId, isReviewMode);
            } catch (error) {
                console.error('Failed to load route:', error);
                alert('Failed to load route for editing. Please try again.');
                setActivePatchId(null);
                setReviewMode(false);
                setCurrentPatchDeclineReason(undefined);
            }
        }
    };

    const handleClosePatchEditor = () => {
        setActivePatchId(null);
        setReviewMode(false);
        setSelectedNodeData(null);
        setModifiedNodesCount(0);
        setCurrentPatchDeclineReason(undefined);

        // Clear the route from 3D viewer
        if (editorRef.current) {
            editorRef.current.clearPatchRoute();
        }
    };

    const handleSavePatch = async () => {
        if (!editorRef.current || !activePatchId) return;

        const routeEditor = editorRef.current.getRouteEditor();
        if (!routeEditor) return;

        const modifiedNodes = routeEditor.getModifiedNodes();

        try {
            // Convert NodeData to PatchDataInput format - only save modified nodes
            const patchData = modifiedNodes.map((node) => ({
                segment_id: node.segment_id,
                index: node.index,
                world_offset_x: node.world_offset.x,
                world_offset_y: node.world_offset.y,
                world_offset_z: node.world_offset.z,
                keynode: node.isKeyNode,
            }));

            // Save patch with all node data
            const { submitPatch } = await import('../lib/api/patches');
            await submitPatch({
                data: patchData,
                patchId: activePatchId,
            });

            setModifiedNodesCount(0);

            alert('Patch saved successfully!');
        } catch (error) {
            console.error('Failed to save patch:', error);
            alert('Failed to save patch. Please try again.');
        }
    };

    const handleToggleKeyNode = () => {
        if (!editorRef.current || !selectedNodeData) return;

        const routeEditor = editorRef.current.getRouteEditor();
        if (!routeEditor) return;

        const nodeKey = `${selectedNodeData.segment_id}-${selectedNodeData.index}`;
        routeEditor.toggleKeyNode(nodeKey);
    };

    const [showReviewModal, setShowReviewModal] = useState(false);

    const handleApprovePatch = async () => {
        if (!activePatchId) return;

        try {
            const { approvePatch } = await import('../lib/api/patches');
            await approvePatch(activePatchId);
            alert('Patch approved successfully!');
            setShowReviewModal(false);
            handleClosePatchEditor();
            setShowPatchManagement(true);
        } catch (error) {
            console.error('Failed to approve patch:', error);
            throw error;
        }
    };

    const handleDeclinePatch = async (feedback: string) => {
        if (!activePatchId) return;

        try {
            const { declinePatch } = await import('../lib/api/patches');
            await declinePatch(activePatchId, feedback);
            alert('Patch declined successfully!');
            setShowReviewModal(false);
            handleClosePatchEditor();
            setShowPatchManagement(true);
        } catch (error) {
            console.error('Failed to decline patch:', error);
            throw error;
        }
    };

    const handleSliderChange = (e: Event) => {
        const target = e.target as HTMLInputElement;
        const index = parseInt(target.value, 10);
        editorRef.current?.selectNodeByIndex(index);
        editorRef.current?.bringCurrentNodeIntoView();
    };

    return (
        <div style={{ position: 'relative', width: '100%', height: '100%' }}>
            <div ref={mountRef} style={{ width: '100%', height: '100%' }} />

            <div className={styles.credits}>
                {credits}
            </div>
            {showPatchManagement ? (
                <PatchManagement
                    onClose={() => setShowPatchManagement(false)}
                    onStartEditing={handleStartEditingPatch}
                    activePatchId={activePatchId}
                />
            ) : (
                <>
                    {!activePatchId && (
                        <button
                            onClick={() => setShowPatchManagement(true)}
                            className={styles.patchButton}
                        >
                            Manage Patches
                        </button>
                    )}

                    {activePatchId && (
                        <div className={styles.editorPanel}>
                            <div className={styles.editorHeader}>
                                <h3>{reviewMode ? `Reviewing Patch #${activePatchId}` : `Editing Patch #${activePatchId}`}</h3>
                                <button onClick={handleClosePatchEditor} className={styles.closeBtn}>
                                    ✕
                                </button>
                            </div>

                            {!reviewMode && selectedNodeData && (
                                <div className={styles.nodeInfo}>
                                    <h4>Selected Node</h4>
                                    <div className={styles.nodeDetails}>
                                        <div>Segment: {selectedNodeData.segment_id}</div>
                                        <div>Index: {selectedNodeData.index}</div>
                                        <div>East: {selectedNodeData.world_offset.x.toFixed(2)}m</div>
                                        <div>Up: {selectedNodeData.world_offset.y.toFixed(2)}m</div>
                                        <div>North: {selectedNodeData.world_offset.z.toFixed(2)}m</div>
                                        <div>
                                            <label>
                                                <input
                                                    type="checkbox"
                                                    checked={selectedNodeData.isKeyNode}
                                                    onChange={handleToggleKeyNode}
                                                />
                                                {' '}Key Node
                                            </label>
                                        </div>
                                    </div>
                                </div>
                            )}

                            {activePatchId && (
                                <div className={styles.nodeSliderContainer}>
                                    <div className={styles.sliderInfo}>
                                        <span>Node: {currentNodeIndex >= 0 ? currentNodeIndex + 1 : '-'} / {totalNodes}</span>
                                        {currentNodeIndex >= 0 && totalNodes > 1 && (
                                            <span className={styles.progressPercent}>
                                                ({Math.round((currentNodeIndex / (totalNodes - 1)) * 100)}%)
                                            </span>
                                        )}
                                    </div>
                                    <input
                                        type="range"
                                        min="0"
                                        max={Math.max(0, totalNodes - 1)}
                                        value={currentNodeIndex >= 0 ? currentNodeIndex : 0}
                                        onInput={handleSliderChange}
                                        className={styles.nodeSlider}
                                        disabled={totalNodes === 0}
                                    />
                                </div>
                            )}

                            <div className={styles.editorActions}>
                                <div className={styles.modificationInfo}>
                                    {reviewMode
                                        ? modifiedNodesCount > 0
                                            ? `${modifiedNodesCount} node(s) modified in this patch`
                                            : 'No modifications in this patch'
                                        : modifiedNodesCount > 0
                                            ? `${modifiedNodesCount} node(s) modified`
                                            : 'No modifications yet'}
                                </div>
                                <button
                                    onClick={() => setShowReviewModal(true)}
                                    className={styles.saveButton}
                                >
                                    {reviewMode ? 'Review' : 'Save & Review'}
                                </button>
                            </div>
                        </div>
                    )}

                    {showReviewModal && activePatchId && editorRef.current?.getRouteEditor() && (
                        <ReviewModal
                            patchId={activePatchId}
                            routeEditor={editorRef.current.getRouteEditor()!}
                            reviewMode={reviewMode}
                            previousDeclineReason={currentPatchDeclineReason}
                            onClose={() => setShowReviewModal(false)}
                            onSave={reviewMode ? undefined : async () => {
                                await handleSavePatch();
                                setShowReviewModal(false);
                            }}
                            onApprove={reviewMode ? handleApprovePatch : undefined}
                            onDecline={reviewMode ? handleDeclinePatch : undefined}
                        />
                    )}
                </>
            )}
        </div>
    );
}

export default EditorViewer;