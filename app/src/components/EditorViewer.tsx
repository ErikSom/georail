import { useState, useEffect, useRef } from 'preact/hooks';
import { Editor } from '../lib/editor/Editor';
import PatchManagement from './PatchManagement';
import ReviewModal from './ReviewModal';
import type { RouteInfo } from '../lib/types/Patch';
import type { Tiles3DAttributionCredits } from './HUD/Tiles3DAttribution';
import type { NodeData } from '../lib/editor/RouteEditor';

import styles from './EditorViewer.module.css';

const MARQUEE_THRESHOLD_PX = 6;

function EditorViewer() {
    const mountRef = useRef<HTMLDivElement | null>(null);
    const editorRef = useRef<Editor | null>(null);
    const [credits, setCredits] = useState<Tiles3DAttributionCredits>(null);
    const [showPatchManagement, setShowPatchManagement] = useState(true);
    const [activePatchId, setActivePatchId] = useState<number | null>(null);
    const [selectedNodes, setSelectedNodes] = useState<NodeData[]>([]);
    const [modifiedNodesCount, setModifiedNodesCount] = useState(0);
    const [reviewMode, setReviewMode] = useState(false);
    const [currentPatchDeclineReason, setCurrentPatchDeclineReason] = useState<string | undefined>(undefined);
    const [currentNodeIndex, setCurrentNodeIndex] = useState(-1);
    const [totalNodes, setTotalNodes] = useState(0);
    const [marquee, setMarquee] = useState<{ x: number; y: number; w: number; h: number } | null>(null);
    const marqueeRef = useRef<{
        startX: number; startY: number; active: boolean; gizmoDragging: boolean; shiftHeld: boolean;
    } | null>(null);

    useEffect(() => {
        if (mountRef.current && !editorRef.current) {
            const editor = new Editor(mountRef.current, setCredits);
            editor.init();

            const routeEditor = editor.getRouteEditor();

            editor.onSelectionChanged = (nodes: NodeData[]) => {
                setSelectedNodes(nodes);
            };

            editor.onNodesModified = (count) => {
                setModifiedNodesCount(count);
            };

            editor.onNodeIndexChanged = (index, total) => {
                setCurrentNodeIndex(index);
                setTotalNodes(total);
            };
            void routeEditor;

            editorRef.current = editor;
        }

        return () => {
            editorRef.current?.cleanup();
            editorRef.current = null;
        };

    }, []);

    // Marquee drag handling — listens on the canvas wrapper.
    useEffect(() => {
        const wrapper = mountRef.current;
        if (!wrapper) return;

        // Effect-scoped so the flag is honoured regardless of whether
        // 'transform-dragging' (pointer events) fires before or after the
        // first 'mousedown' (mouse events).
        let gizmoDragging = false;
        let lastRect: { left: number; top: number; right: number; bottom: number } | null = null;

        const onTransformDragging = (e: Event) => {
            gizmoDragging = (e as CustomEvent).detail === true;
            if (gizmoDragging) {
                marqueeRef.current = null;
                setMarquee(null);
                lastRect = null;
            }
        };

        const onMouseDown = (e: MouseEvent) => {
            if (e.button !== 0) return;
            if (gizmoDragging) return; // Don't start a marquee on top of a gizmo drag.
            const rect = wrapper.getBoundingClientRect();
            marqueeRef.current = {
                startX: e.clientX - rect.left,
                startY: e.clientY - rect.top,
                active: false,
                gizmoDragging: false,
                shiftHeld: e.shiftKey,
            };
            lastRect = null;
        };

        const onMouseMove = (e: MouseEvent) => {
            const m = marqueeRef.current;
            if (!m || gizmoDragging) return;
            const rect = wrapper.getBoundingClientRect();
            const x = e.clientX - rect.left;
            const y = e.clientY - rect.top;
            const dx = Math.abs(x - m.startX);
            const dy = Math.abs(y - m.startY);
            if (!m.active && (dx > MARQUEE_THRESHOLD_PX || dy > MARQUEE_THRESHOLD_PX)) m.active = true;
            if (!m.active) return;
            lastRect = {
                left: Math.min(m.startX, x), top: Math.min(m.startY, y),
                right: Math.max(m.startX, x), bottom: Math.max(m.startY, y),
            };
            setMarquee({ x: lastRect.left, y: lastRect.top, w: lastRect.right - lastRect.left, h: lastRect.bottom - lastRect.top });
        };

        const onMouseUp = () => {
            const m = marqueeRef.current;
            marqueeRef.current = null;
            setMarquee(null);
            if (gizmoDragging || !m || !m.active || !lastRect) {
                lastRect = null;
                return;
            }
            const re = editorRef.current?.getRouteEditor();
            re?.selectNodesInScreenRect(lastRect, m.shiftHeld ? 'add' : 'replace');
            lastRect = null;
        };

        wrapper.addEventListener('transform-dragging', onTransformDragging);
        wrapper.addEventListener('mousedown', onMouseDown);
        wrapper.addEventListener('mousemove', onMouseMove);
        document.addEventListener('mouseup', onMouseUp);

        return () => {
            wrapper.removeEventListener('transform-dragging', onTransformDragging);
            wrapper.removeEventListener('mousedown', onMouseDown);
            wrapper.removeEventListener('mousemove', onMouseMove);
            document.removeEventListener('mouseup', onMouseUp);
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
        setSelectedNodes([]);
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

    // Bulk-edit helpers — operate on the entire current selection.
    const handleToggleKeyNode = (e: Event) => {
        if (!editorRef.current) return;
        const re = editorRef.current.getRouteEditor();
        if (!re) return;
        const checked = (e.target as HTMLInputElement).checked;
        re.setKeyNodeForSelection(checked);
    };

    const commitOffset = (axis: 'east' | 'up' | 'north', raw: string) => {
        if (!editorRef.current) return;
        const re = editorRef.current.getRouteEditor();
        if (!re) return;
        const v = parseFloat(raw);
        if (!Number.isFinite(v)) return;
        re.setOffsetForSelection(axis, v);
    };

    const sharedAxisValue = (axis: 'x' | 'y' | 'z'): { value: string; mixed: boolean } => {
        if (selectedNodes.length === 0) return { value: '', mixed: false };
        const first = selectedNodes[0].world_offset[axis];
        for (const n of selectedNodes) {
            if (Math.abs(n.world_offset[axis] - first) > 1e-6) return { value: '', mixed: true };
        }
        return { value: first.toFixed(4), mixed: false };
    };

    const keynodeState = (): { checked: boolean; indeterminate: boolean } => {
        if (selectedNodes.length === 0) return { checked: false, indeterminate: false };
        const allKey = selectedNodes.every(n => n.isKeyNode);
        const noneKey = selectedNodes.every(n => !n.isKeyNode);
        return { checked: allKey, indeterminate: !allKey && !noneKey };
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

            {marquee && (
                <div
                    className={styles.marquee}
                    style={{
                        position: 'absolute',
                        left: marquee.x,
                        top: marquee.y,
                        width: marquee.w,
                        height: marquee.h,
                        pointerEvents: 'none',
                    }}
                />
            )}

            <div className={styles.credits}>
                {credits ? credits.latLonStr : 'No coordinates available'}
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

                            {!reviewMode && selectedNodes.length > 0 && (() => {
                                const east = sharedAxisValue('x');
                                const up = sharedAxisValue('y');
                                const north = sharedAxisValue('z');
                                const ks = keynodeState();
                                const onAxisChange = (axis: 'east' | 'up' | 'north') => (e: Event) => {
                                    const t = e.target as HTMLInputElement;
                                    if ((e as KeyboardEvent).type === 'keydown' && (e as KeyboardEvent).key !== 'Enter') return;
                                    commitOffset(axis, t.value);
                                };
                                return (
                                    <div className={styles.nodeInfo}>
                                        <h4>{selectedNodes.length === 1 ? 'Selected Node' : `${selectedNodes.length} Nodes Selected`}</h4>
                                        <div className={styles.nodeDetails}>
                                            {selectedNodes.length === 1 && (
                                                <>
                                                    <div>Segment: {selectedNodes[0].segment_id}</div>
                                                    <div>Index: {selectedNodes[0].index}</div>
                                                </>
                                            )}
                                            <label>
                                                East (m)
                                                <input
                                                    type="number"
                                                    step="0.01"
                                                    value={east.value}
                                                    placeholder={east.mixed ? 'mixed' : ''}
                                                    onBlur={onAxisChange('east')}
                                                    onKeyDown={onAxisChange('east')}
                                                />
                                            </label>
                                            <label>
                                                Up (m)
                                                <input
                                                    type="number"
                                                    step="0.01"
                                                    value={up.value}
                                                    placeholder={up.mixed ? 'mixed' : ''}
                                                    onBlur={onAxisChange('up')}
                                                    onKeyDown={onAxisChange('up')}
                                                />
                                            </label>
                                            <label>
                                                North (m)
                                                <input
                                                    type="number"
                                                    step="0.01"
                                                    value={north.value}
                                                    placeholder={north.mixed ? 'mixed' : ''}
                                                    onBlur={onAxisChange('north')}
                                                    onKeyDown={onAxisChange('north')}
                                                />
                                            </label>
                                            <div>
                                                <label>
                                                    <input
                                                        type="checkbox"
                                                        checked={ks.checked}
                                                        ref={(el) => { if (el) el.indeterminate = ks.indeterminate; }}
                                                        onChange={handleToggleKeyNode}
                                                    />
                                                    {' '}Key Node{selectedNodes.length > 1 ? ' (whole selection)' : ''}
                                                </label>
                                            </div>
                                        </div>
                                    </div>
                                );
                            })()}

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