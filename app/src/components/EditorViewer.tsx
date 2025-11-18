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

            editorRef.current = editor;
        }

        return () => {
            editorRef.current?.cleanup();
            editorRef.current = null;
        };

    }, []);

    const handleStartEditingPatch = async (patchId: number, routeInfo: RouteInfo) => {
        setActivePatchId(patchId);
        setShowPatchManagement(false);

        if (editorRef.current) {
            try {
                await editorRef.current.loadPatchRoute(routeInfo);
            } catch (error) {
                console.error('Failed to load route:', error);
                alert('Failed to load route for editing. Please try again.');
                setActivePatchId(null);
            }
        }
    };

    const handleClosePatchEditor = () => {
        setActivePatchId(null);
        setSelectedNodeData(null);
        setModifiedNodesCount(0);

        // Clear the route from 3D viewer
        if (editorRef.current) {
            editorRef.current.clearPatchRoute();
        }
    };

    const handleSavePatch = async () => {
        if (!editorRef.current || !activePatchId) return;

        const routeEditor = editorRef.current.getRouteEditor();
        if (!routeEditor) return;

        const allNodes = routeEditor.getAllNodes();

        try {
            // Convert NodeData to PatchDataInput format
            const patchData = allNodes.map((node) => ({
                segment_id: node.segment_id,
                index: node.index,
                height: node.height,
                lateral_offset: node.lateral_offset,
                keynode: node.isKeyNode,
            }));

            // Save patch with all node data
            const { submitPatch } = await import('../lib/api/patches');
            await submitPatch({
                data: patchData,
                patchId: activePatchId,
            });

            alert('Patch saved successfully!');
            handleClosePatchEditor();
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
                                <h3>Editing Patch #{activePatchId}</h3>
                                <button onClick={handleClosePatchEditor} className={styles.closeBtn}>
                                    ✕
                                </button>
                            </div>

                            {selectedNodeData && (
                                <div className={styles.nodeInfo}>
                                    <h4>Selected Node</h4>
                                    <div className={styles.nodeDetails}>
                                        <div>Segment: {selectedNodeData.segment_id}</div>
                                        <div>Index: {selectedNodeData.index}</div>
                                        <div>Height: {selectedNodeData.height.toFixed(2)}m</div>
                                        <div>Offset: {selectedNodeData.lateral_offset.toFixed(2)}m</div>
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

                            <div className={styles.editorActions}>
                                <div className={styles.modificationInfo}>
                                    {modifiedNodesCount > 0
                                        ? `${modifiedNodesCount} node(s) modified`
                                        : 'No modifications yet'}
                                </div>
                                <button
                                    onClick={() => setShowReviewModal(true)}
                                    className={styles.saveButton}
                                >
                                    Save & Review
                                </button>
                            </div>
                        </div>
                    )}

                    {showReviewModal && activePatchId && editorRef.current?.getRouteEditor() && (
                        <ReviewModal
                            patchId={activePatchId}
                            routeEditor={editorRef.current.getRouteEditor()!}
                            onClose={() => setShowReviewModal(false)}
                            onSave={async () => {
                                await handleSavePatch();
                                setShowReviewModal(false);
                            }}
                        />
                    )}
                </>
            )}
        </div>
    );
}

export default EditorViewer;