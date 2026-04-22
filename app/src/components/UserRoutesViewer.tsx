import { useState, useEffect, useRef } from 'preact/hooks';
import { Editor } from '../lib/editor/Editor';
import { fetchOverpassRoute, type OverpassRouteResponse, type OverpassStop } from '../lib/api/overpass';
import { buildGraph, snapStopToNode, type RouteGraph, type NodeId, type WayId } from '../lib/editor/routeGraph';
import {
    createTraversal, pickBranch, undoLast, pathToCoords, snapStopToPath,
    type TraversalState, type PathSnap,
} from '../lib/editor/routeTraversal';
import {
    listMyUserRoutes, fetchUserRoute, createUserRoute, updateUserRoute, deleteUserRoute,
    type UserRouteSummary, type UserRouteCaps, type UserRouteFull,
} from '../lib/api/userRoutes';
import type { RouteData } from '../lib/api/navigation';

function parseMaxSpeedKmh(tag: string | null | undefined): number | null {
    if (!tag) return null;
    const m = String(tag).trim().match(/^(\d+)(?:\s*(km\/h|kmh|mph))?$/i);
    if (!m) return null;
    const n = parseInt(m[1], 10);
    if (m[2] && /mph/i.test(m[2])) return Math.round(n * 1.60934);
    return n;
}

function routeUrl(routeId: string): string {
    return `/?route=${encodeURIComponent(routeId)}`;
}

function shareUrl(routeId: string): string {
    const origin = typeof window !== 'undefined' ? window.location.origin : '';
    return `${origin}${routeUrl(routeId)}`;
}
import type { Tiles3DAttributionCredits } from './HUD/Tiles3DAttribution';

import styles from './EditorViewer.module.css';

type Phase = 'empty' | 'plan' | 'traverse' | 'done' | 'edit';

// Distinct colors for branch options (cycled if more than this count).
const BRANCH_COLORS = [0xef4444, 0x3b82f6, 0xeab308, 0xa855f7, 0xf97316, 0x14b8a6];

// A stop is auto-included if its nearest point on the path is within this many meters.
const STOP_ON_PATH_DEFAULT_M = 300;
// Beyond this, a stop is considered unreachable and excluded from the picker.
const STOP_MAX_SNAP_M = 1500;

interface StopCandidate {
    stop: OverpassStop;
    snap: PathSnap;
}

function computeStopCandidates(pathCoords: [number, number][], stops: OverpassStop[]): StopCandidate[] {
    if (pathCoords.length === 0) return [];
    const out: StopCandidate[] = [];
    for (const s of stops) {
        const snap = snapStopToPath(pathCoords, s.lon, s.lat);
        if (!snap) continue;
        if (snap.distanceM > STOP_MAX_SNAP_M) continue;
        out.push({ stop: s, snap });
    }
    // Order by position along the path so dropdowns read start → end.
    out.sort((a, b) => a.snap.pathIndex - b.snap.pathIndex);
    return out;
}

interface StopGroup {
    name: string;
    candidates: StopCandidate[];
}

function groupStopsByName(candidates: StopCandidate[]): StopGroup[] {
    const byName = new Map<string, StopCandidate[]>();
    for (const c of candidates) {
        const key = c.stop.name.trim();
        let list = byName.get(key);
        if (!list) {
            list = [];
            byName.set(key, list);
        }
        list.push(c);
    }
    // Sort groups by earliest pathIndex among their candidates.
    return [...byName.entries()]
        .map(([name, list]) => ({ name, candidates: list }))
        .sort((a, b) => a.candidates[0].snap.pathIndex - b.candidates[0].snap.pathIndex);
}

function buildRouteDataForSave(
    graph: RouteGraph,
    state: TraversalState,
    candidates: StopCandidate[],
    selectedStopIds: Set<number>,
): RouteData {
    const { coords, pointWayIds } = pathToCoords(graph, state);
    const route = coords.map(([lon, lat]) => [lon, lat, 0, 0, 0]);
    const metadata = pointWayIds.map(wid => {
        const way = graph.ways.get(wid);
        return { max_speed: parseMaxSpeedKmh(way?.maxspeed ?? null) ?? 120 };
    });
    const orderedStops = candidates
        .filter(c => selectedStopIds.has(c.stop.osm_node_id))
        .sort((a, b) => a.snap.pathIndex - b.snap.pathIndex);
    const stop_indices = orderedStops.map(c => c.snap.pathIndex);
    const editor = coords.map((_, i) => ({ segment_id: 0, index: i }));
    const stops = orderedStops.map(c => ({
        station: c.stop.name,
        code: String(c.stop.osm_node_id),
        track: c.stop.track,
        arrivalTime: 0,
        departureTime: 0,
    }));
    return {
        geometry: { route, metadata, stop_indices, editor },
        properties: { stops },
    };
}

// Preserves explicit user choices; auto-adds only stops within STOP_ON_PATH_DEFAULT_M on first encounter.
function mergeSelection(prev: Set<number>, candidates: StopCandidate[]): Set<number> {
    const next = new Set<number>();
    for (const c of candidates) {
        const id = c.stop.osm_node_id;
        if (prev.has(id)) {
            next.add(id);
            continue;
        }
        if (c.snap.distanceM <= STOP_ON_PATH_DEFAULT_M) {
            next.add(id);
        }
    }
    return next;
}

function UserRoutesViewer() {
    const mountRef = useRef<HTMLDivElement | null>(null);
    const editorRef = useRef<Editor | null>(null);
    const graphRef = useRef<RouteGraph | null>(null);
    const traversalRef = useRef<TraversalState | null>(null);

    const [credits, setCredits] = useState<Tiles3DAttributionCredits>(null);
    const [phase, setPhase] = useState<Phase>('empty');
    const [refInput, setRefInput] = useState('ICE 26');
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);

    const [rawRoute, setRawRoute] = useState<OverpassRouteResponse | null>(null);
    const [stopsForPlanning, setStopsForPlanning] = useState<OverpassStop[]>([]);
    const [stopNodeIds, setStopNodeIds] = useState<Map<number, NodeId>>(new Map());
    const [startStopId, setStartStopId] = useState<number | null>(null);
    const [endStopId, setEndStopId] = useState<number | null>(null);

    const [stopCandidates, setStopCandidates] = useState<StopCandidate[]>([]);
    const [selectedStopIds, setSelectedStopIds] = useState<Set<number>>(new Set());

    // Saved-routes state
    const [mySaved, setMySaved] = useState<UserRouteSummary[]>([]);
    const [caps, setCaps] = useState<UserRouteCaps | null>(null);
    const [savedLoading, setSavedLoading] = useState(false);
    const [saving, setSaving] = useState(false);
    const [saveName, setSaveName] = useState('');
    const [editingRouteId, setEditingRouteId] = useState<string | null>(null);
    const [editingRouteMeta, setEditingRouteMeta] = useState<UserRouteFull | null>(null);

    // Editor-feedback state (wired to the full RouteEditor while in 'edit' phase)
    const [selectedNodeData, setSelectedNodeData] = useState<any>(null);
    const [modifiedNodesCount, setModifiedNodesCount] = useState(0);
    const [currentNodeIndex, setCurrentNodeIndex] = useState(-1);
    const [totalNodes, setTotalNodes] = useState(0);

    // Transient "Copied!" feedback on the share-link buttons.
    const [copiedRouteId, setCopiedRouteId] = useState<string | null>(null);

    // Force re-render when traversal state mutates internally.
    const [, setTick] = useState(0);
    const forceRender = () => setTick(t => t + 1);

    useEffect(() => {
        if (mountRef.current && !editorRef.current) {
            const editor = new Editor(mountRef.current, setCredits);
            editor.init();
            editor.onNodeSelected = (nodeData) => setSelectedNodeData(nodeData);
            editor.onNodesModified = (count) => setModifiedNodesCount(count);
            editor.onNodeIndexChanged = (idx, total) => {
                setCurrentNodeIndex(idx);
                setTotalNodes(total);
            };
            editorRef.current = editor;
        }
        return () => {
            editorRef.current?.cleanup();
            editorRef.current = null;
        };
    }, []);

    // Re-render green stop markers whenever the selection or candidates change.
    useEffect(() => {
        if (!editorRef.current) return;
        const chosen = stopCandidates
            .filter(c => selectedStopIds.has(c.stop.osm_node_id))
            .map(c => ({ key: String(c.stop.osm_node_id), lat: c.snap.lat, lon: c.snap.lon }));
        editorRef.current.renderChosenStops(chosen);
    }, [stopCandidates, selectedStopIds]);

    // Load saved routes when entering empty phase.
    useEffect(() => {
        if (phase !== 'empty') return;
        refreshSavedList();
    }, [phase]);

    const refreshSavedList = async () => {
        setSavedLoading(true);
        try {
            const resp = await listMyUserRoutes();
            setMySaved(resp.routes);
            setCaps(resp.caps);
        } catch (err) {
            console.warn('[UserRoutes] failed to load saved list', err);
        } finally {
            setSavedLoading(false);
        }
    };

    const handleSaveNewRoute = async () => {
        if (!graphRef.current || !traversalRef.current || !rawRoute) return;
        const name = saveName.trim();
        if (!name) {
            setError('Please enter a name for the route.');
            return;
        }
        if (selectedStopIds.size < 2) {
            setError('Pick at least 2 stops before saving.');
            return;
        }

        const routeData = buildRouteDataForSave(
            graphRef.current,
            traversalRef.current,
            stopCandidates,
            selectedStopIds,
        );

        setSaving(true);
        setError(null);
        try {
            const saved = await createUserRoute({
                name,
                osm_ref: rawRoute.osm_ref,
                osm_relation_id: rawRoute.osm_relation_id,
                geometry: routeData.geometry,
                stops: routeData.properties.stops,
            });
            await enterEditPhase(saved);
            setSaveName('');
        } catch (err) {
            setError(err instanceof Error ? err.message : 'Save failed');
        } finally {
            setSaving(false);
        }
    };

    const enterEditPhase = async (route: UserRouteFull) => {
        if (!editorRef.current) return;
        editorRef.current.clearHighlights();
        editorRef.current.clearWayPreview();
        const routeData: RouteData = {
            geometry: route.geometry,
            properties: { stops: route.stops },
        };
        editorRef.current.loadUserRoute(routeData);

        setEditingRouteId(route.id);
        setEditingRouteMeta(route);
        setPhase('edit');
    };

    const handleOpenSaved = async (id: string) => {
        setError(null);
        try {
            const full = await fetchUserRoute(id);
            await enterEditPhase(full);
        } catch (err) {
            setError(err instanceof Error ? err.message : 'Load failed');
        }
    };

    const handleDeleteSaved = async (id: string) => {
        if (!confirm('Delete this route?')) return;
        try {
            await deleteUserRoute(id);
            await refreshSavedList();
        } catch (err) {
            setError(err instanceof Error ? err.message : 'Delete failed');
        }
    };

    const handleDriveSaved = (id: string) => {
        window.location.href = routeUrl(id);
    };

    const handleDriveEditing = () => {
        if (!editingRouteMeta) return;
        window.location.href = routeUrl(editingRouteMeta.id);
    };

    const handleCopyShareUrl = (id: string) => {
        const url = shareUrl(id);
        const markCopied = () => {
            setCopiedRouteId(id);
            setTimeout(() => setCopiedRouteId(curr => curr === id ? null : curr), 1800);
        };
        navigator.clipboard.writeText(url)
            .then(markCopied)
            .catch(() => {
                prompt('Copy this URL:', url);
                markCopied();
            });
    };

    const handleSaveEdits = async () => {
        if (!editorRef.current || !editingRouteId || !editingRouteMeta) return;
        const routeEditor = editorRef.current.getRouteEditor();
        if (!routeEditor) {
            setError('Editor not ready.');
            return;
        }

        const allNodes = routeEditor.getAllNodes();
        const byKey = new Map<string, typeof allNodes[number]>();
        for (const n of allNodes) byKey.set(`${n.segment_id}-${n.index}`, n);

        const orig = editingRouteMeta.geometry;
        const newRoute = orig.route.map((point, i) => {
            const e = orig.editor![i];
            const node = byKey.get(`${e.segment_id}-${e.index}`);
            if (!node) return point;
            return [
                point[0], point[1],
                node.world_offset.x, node.world_offset.y, node.world_offset.z,
                node.isKeyNode ? 1 : 0,
            ];
        });

        const newGeometry: RouteData['geometry'] = {
            route: newRoute,
            metadata: orig.metadata,
            stop_indices: orig.stop_indices,
            editor: orig.editor,
        };

        setSaving(true);
        setError(null);
        try {
            const updated = await updateUserRoute(editingRouteId, { geometry: newGeometry });
            setEditingRouteMeta(updated);
            alert('Saved.');
        } catch (err) {
            setError(err instanceof Error ? err.message : 'Save failed');
        } finally {
            setSaving(false);
        }
    };

    const handleExitEdit = () => {
        editorRef.current?.clearPatchRoute();
        setEditingRouteId(null);
        setEditingRouteMeta(null);
        setSelectedNodeData(null);
        setModifiedNodesCount(0);
        setCurrentNodeIndex(-1);
        setTotalNodes(0);
        setPhase('empty');
    };

    const handleSliderChange = (e: Event) => {
        const target = e.target as HTMLInputElement;
        const index = parseInt(target.value, 10);
        editorRef.current?.selectNodeByIndex(index);
        editorRef.current?.bringCurrentNodeIntoView();
    };

    const handleToggleKeyNode = () => {
        if (!editorRef.current || !selectedNodeData) return;
        const routeEditor = editorRef.current.getRouteEditor();
        if (!routeEditor) return;
        const nodeKey = `${selectedNodeData.segment_id}-${selectedNodeData.index}`;
        routeEditor.toggleKeyNode(nodeKey);
    };

    const handleAutoHeight = () => {
        if (!editorRef.current || !selectedNodeData) return;
        const routeEditor = editorRef.current.getRouteEditor();
        if (!routeEditor) return;
        const nodeKey = `${selectedNodeData.segment_id}-${selectedNodeData.index}`;
        const ok = routeEditor.autoHeightNode(nodeKey);
        if (!ok) setError('Auto-height: no terrain found under the node.');
        else setError(null);
    };

    const handleFetch = async () => {
        if (!editorRef.current) return;
        setLoading(true);
        setError(null);
        try {
            const resp = await fetchOverpassRoute(refInput.trim());

            const seenStopIds = new Set<number>();
            const uniqueStops = resp.stops.filter(s => {
                if (seenStopIds.has(s.osm_node_id)) return false;
                seenStopIds.add(s.osm_node_id);
                return true;
            });
            const seenWayIds = new Set<number>();
            const uniqueWays = resp.ways.filter(w => {
                if (seenWayIds.has(w.id)) return false;
                seenWayIds.add(w.id);
                return true;
            });
            const cleaned: OverpassRouteResponse = { ...resp, ways: uniqueWays, stops: uniqueStops };
            setRawRoute(cleaned);

            const graph = buildGraph(cleaned.ways);
            graphRef.current = graph;

            const snapped = new Map<number, NodeId>();
            const planningStops: OverpassStop[] = [];
            const seenSnapped = new Set<NodeId>();
            for (const s of cleaned.stops) {
                const nid = snapStopToNode(graph, s);
                if (nid == null) continue;
                if (seenSnapped.has(nid)) continue;
                seenSnapped.add(nid);
                snapped.set(s.osm_node_id, nid);
                planningStops.push(s);
            }

            setStopNodeIds(snapped);
            setStopsForPlanning(planningStops);

            setStartStopId(planningStops[0]?.osm_node_id ?? null);
            setEndStopId(planningStops[planningStops.length - 1]?.osm_node_id ?? null);

            if (!editorRef.current) return;
            editorRef.current.clearPatchRoute();
            editorRef.current.showWayPreview(cleaned.ways, cleaned.stops, new Set());
            editorRef.current.dimBaseNetwork(0.25);

            setPhase('plan');
        } catch (err) {
            setError(err instanceof Error ? err.message : 'Failed to fetch route');
        } finally {
            setLoading(false);
        }
    };

    const renderTraversal = (state: TraversalState) => {
        if (!graphRef.current || !editorRef.current || !rawRoute) return;
        const graph = graphRef.current;

        const { coords } = pathToCoords(graph, state);
        editorRef.current.renderCommittedPath(coords);

        const branches = state.branchOptions.map((opt, i) => {
            const way = graph.ways.get(opt.wayId);
            return {
                wayId: opt.wayId,
                geometry: way ? way.geometry : [],
                color: BRANCH_COLORS[i % BRANCH_COLORS.length],
            };
        });
        editorRef.current.renderBranchOptions(branches);

        const curNode = graph.nodes.get(state.currentNode);
        if (curNode) editorRef.current.focusLatLon(curNode.lat, curNode.lon, 600);

        const candidates = computeStopCandidates(coords, rawRoute.stops);
        setStopCandidates(candidates);
        setSelectedStopIds(prev => mergeSelection(prev, candidates));
    };

    const handleBegin = () => {
        if (!graphRef.current || !editorRef.current) return;
        if (startStopId == null || endStopId == null) return;
        const startNode = stopNodeIds.get(startStopId);
        const endNode = stopNodeIds.get(endStopId);
        if (startNode == null || endNode == null) {
            setError('Failed to locate stops in the graph.');
            return;
        }
        const state = createTraversal(graphRef.current, startNode, endNode);
        traversalRef.current = state;
        renderTraversal(state);
        setPhase(state.status === 'completed' ? 'done' : 'traverse');
        forceRender();
    };

    const handlePick = (wayId: WayId) => {
        if (!graphRef.current || !traversalRef.current) return;
        pickBranch(graphRef.current, traversalRef.current, wayId);
        renderTraversal(traversalRef.current);
        if (traversalRef.current.status === 'completed') setPhase('done');
        else if (traversalRef.current.status === 'dead_end') setPhase('done');
        forceRender();
    };

    const handleUndo = () => {
        if (!graphRef.current || !traversalRef.current) return;
        undoLast(graphRef.current, traversalRef.current);
        renderTraversal(traversalRef.current);
        setPhase(traversalRef.current.status === 'completed' ? 'done' : 'traverse');
        forceRender();
    };

    const handleReset = () => {
        editorRef.current?.clearPatchRoute();
        editorRef.current?.clearWayPreview();
        graphRef.current = null;
        traversalRef.current = null;
        setRawRoute(null);
        setStopsForPlanning([]);
        setStopNodeIds(new Map());
        setStartStopId(null);
        setEndStopId(null);
        setStopCandidates([]);
        setSelectedStopIds(new Set());
        setEditingRouteId(null);
        setEditingRouteMeta(null);
        setSaveName('');
        setPhase('empty');
        setError(null);
    };

    const traversal = traversalRef.current;

    return (
        <div style={{ position: 'relative', width: '100%', height: '100%' }}>
            <div ref={mountRef} style={{ width: '100%', height: '100%' }} />
            <div className={styles.credits}>
                {credits ? credits.latLonStr : 'No coordinates available'}
            </div>

            <div className={styles.editorPanel} style={{ width: 360, maxHeight: '92vh', display: 'flex', flexDirection: 'column' }}>
                <div className={styles.editorHeader}>
                    <h3>
                        {phase === 'empty' && 'User Routes'}
                        {phase === 'plan' && 'Plan route'}
                        {phase === 'traverse' && 'Pick a branch'}
                        {phase === 'done' && (traversal?.status === 'completed' ? 'Route complete' : 'Traversal ended')}
                        {phase === 'edit' && 'Edit route'}
                    </h3>
                    {phase !== 'empty' && (
                        <button onClick={handleReset} className={styles.closeBtn}>✕</button>
                    )}
                </div>

                {phase === 'empty' && (
                    <div style={{ padding: '16px 20px', display: 'flex', flexDirection: 'column', gap: 14, overflowY: 'auto' }}>
                        <div>
                            <label style={{ fontSize: 13, color: '#ccc' }}>
                                OSM route ref
                                <input
                                    type="text"
                                    value={refInput}
                                    onInput={(e) => setRefInput((e.target as HTMLInputElement).value)}
                                    placeholder="e.g. ICE 26"
                                    style={{
                                        width: '100%', marginTop: 6, padding: 8,
                                        background: '#222', color: '#fff',
                                        border: '1px solid #3a3a3a', borderRadius: 6,
                                    }}
                                />
                            </label>
                            <button
                                onClick={handleFetch}
                                disabled={loading || !refInput.trim()}
                                className={styles.saveButton}
                                style={{ width: '100%', marginTop: 10 }}
                            >
                                {loading ? 'Fetching…' : 'Fetch new route from OSM'}
                            </button>
                            {error && <div style={{ color: '#f87171', fontSize: 13, marginTop: 6 }}>{error}</div>}
                        </div>

                        <div style={{ borderTop: '1px solid #3a3a3a', paddingTop: 12 }}>
                            <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between' }}>
                                <div style={{ fontSize: 13, color: '#fff', fontWeight: 600 }}>My routes</div>
                                {caps && (
                                    <div style={{ fontSize: 11, color: '#888' }}>
                                        {mySaved.length}/{caps.maxRoutes} routes · {caps.usedPoints.toLocaleString()}/{caps.maxPoints.toLocaleString()} pts
                                    </div>
                                )}
                            </div>
                            {savedLoading && <div style={{ fontSize: 12, color: '#888', marginTop: 6 }}>Loading…</div>}
                            {!savedLoading && mySaved.length === 0 && (
                                <div style={{ fontSize: 12, color: '#888', marginTop: 6 }}>No saved routes yet.</div>
                            )}
                            {mySaved.map(r => {
                                const ym = new Date().toISOString().slice(0, 7);
                                const monthPlays = r.monthly_plays?.[ym] ?? 0;
                                return (
                                    <div key={r.id} style={{
                                        padding: 8, marginTop: 6,
                                        background: '#1f2937', border: '1px solid #3a3a3a', borderRadius: 6,
                                        display: 'flex', flexDirection: 'column', gap: 6,
                                    }}>
                                        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                                            <div style={{ flex: 1, minWidth: 0 }}>
                                                <div style={{ fontSize: 13, color: '#fff', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                                                    {r.name}
                                                </div>
                                                <div style={{ fontSize: 11, color: '#888' }}>
                                                    {r.osm_ref || '—'} · {r.point_count.toLocaleString()} pts · {r.total_plays} plays ({monthPlays} this month)
                                                </div>
                                            </div>
                                        </div>
                                        <div style={{ display: 'flex', gap: 6 }}>
                                            <button
                                                onClick={() => handleDriveSaved(r.id)}
                                                style={{ flex: 1, padding: '4px 8px', fontSize: 12, background: '#22c55e', color: '#fff', border: 'none', borderRadius: 4, cursor: 'pointer' }}
                                            >Drive</button>
                                            <button
                                                onClick={() => handleOpenSaved(r.id)}
                                                style={{ flex: 1, padding: '4px 8px', fontSize: 12, background: '#3b82f6', color: '#fff', border: 'none', borderRadius: 4, cursor: 'pointer' }}
                                            >Edit</button>
                                            <button
                                                onClick={() => handleCopyShareUrl(r.id)}
                                                style={{ flex: 1, padding: '4px 8px', fontSize: 12, background: copiedRouteId === r.id ? '#22c55e' : '#6b7280', color: '#fff', border: 'none', borderRadius: 4, cursor: 'pointer', transition: 'background 0.15s' }}
                                            >{copiedRouteId === r.id ? 'Copied!' : 'Copy link'}</button>
                                            <button
                                                onClick={() => handleDeleteSaved(r.id)}
                                                style={{ padding: '4px 8px', fontSize: 12, background: '#374151', color: '#fff', border: 'none', borderRadius: 4, cursor: 'pointer' }}
                                            >✕</button>
                                        </div>
                                    </div>
                                );
                            })}
                        </div>
                    </div>
                )}

                {phase === 'plan' && rawRoute && (
                    <div style={{ padding: '16px 20px', display: 'flex', flexDirection: 'column', gap: 10 }}>
                        <div style={{ fontSize: 13, color: '#ccc' }}>
                            {rawRoute.relation_tags.name || rawRoute.osm_ref} · {rawRoute.ways.length} ways · {stopsForPlanning.length} routable stops
                        </div>
                        <label style={{ fontSize: 12, color: '#aaa' }}>
                            Start
                            <select
                                value={startStopId ?? ''}
                                onChange={(e) => setStartStopId(Number((e.target as HTMLSelectElement).value))}
                                style={{ width: '100%', marginTop: 4, padding: 8, background: '#222', color: '#fff', border: '1px solid #3a3a3a', borderRadius: 6 }}
                            >
                                {stopsForPlanning.map(s => (
                                    <option key={s.osm_node_id} value={s.osm_node_id}>{s.name}</option>
                                ))}
                            </select>
                        </label>
                        <label style={{ fontSize: 12, color: '#aaa' }}>
                            End
                            <select
                                value={endStopId ?? ''}
                                onChange={(e) => setEndStopId(Number((e.target as HTMLSelectElement).value))}
                                style={{ width: '100%', marginTop: 4, padding: 8, background: '#222', color: '#fff', border: '1px solid #3a3a3a', borderRadius: 6 }}
                            >
                                {stopsForPlanning.map(s => (
                                    <option key={s.osm_node_id} value={s.osm_node_id}>{s.name}</option>
                                ))}
                            </select>
                        </label>
                        <button onClick={handleBegin} className={styles.saveButton} disabled={startStopId === endStopId}>
                            Begin traversal
                        </button>
                        {error && <div style={{ color: '#f87171', fontSize: 13 }}>{error}</div>}
                    </div>
                )}

                {phase === 'traverse' && traversal && (
                    <>
                        <div style={{ padding: '12px 20px', borderBottom: '1px solid #3a3a3a', fontSize: 12, color: '#aaa' }}>
                            <div>{traversal.path.length} ways · {traversal.branchOptions.length} branches ahead</div>
                            <div>{selectedStopIds.size} stops on path so far</div>
                        </div>
                        <div style={{ padding: '12px 20px', overflowY: 'auto', flex: 1 }}>
                            {traversal.branchOptions.map((opt, i) => {
                                const way = graphRef.current?.ways.get(opt.wayId);
                                const color = BRANCH_COLORS[i % BRANCH_COLORS.length];
                                const label = way?.name || `Way ${opt.wayId}`;
                                return (
                                    <button
                                        key={opt.wayId}
                                        onClick={() => handlePick(opt.wayId)}
                                        style={{
                                            width: '100%', padding: '10px 12px', margin: '4px 0',
                                            background: '#1f2937', color: '#fff',
                                            border: `2px solid #${color.toString(16).padStart(6, '0')}`,
                                            borderRadius: 6, cursor: 'pointer', textAlign: 'left',
                                            fontSize: 13,
                                        }}
                                    >
                                        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                                            <span style={{
                                                width: 14, height: 14, borderRadius: 3,
                                                background: `#${color.toString(16).padStart(6, '0')}`,
                                            }} />
                                            <span style={{ flex: 1 }}>{label}</span>
                                            {way?.maxspeed && <span style={{ color: '#888' }}>{way.maxspeed}</span>}
                                        </div>
                                    </button>
                                );
                            })}
                        </div>
                        <div style={{ padding: '12px 20px', borderTop: '1px solid #3a3a3a', display: 'flex', gap: 8 }}>
                            <button onClick={handleUndo} className={styles.saveButton} style={{ flex: 1, background: '#374151' }}>
                                Undo
                            </button>
                        </div>
                    </>
                )}

                {phase === 'done' && traversal && (
                    <>
                        <div style={{ padding: '12px 20px', borderBottom: '1px solid #3a3a3a', fontSize: 12, color: '#aaa' }}>
                            <div style={{ color: '#fff', fontSize: 14, marginBottom: 4 }}>
                                {traversal.status === 'completed' ? 'Reached destination' : 'Traversal ended'}
                            </div>
                            <div>{traversal.path.length} ways · {selectedStopIds.size} of {stopCandidates.length} stops picked</div>
                        </div>
                        <StopPicker
                            candidates={stopCandidates}
                            selected={selectedStopIds}
                            onToggle={(id) => setSelectedStopIds(prev => {
                                const next = new Set(prev);
                                if (next.has(id)) next.delete(id); else next.add(id);
                                return next;
                            })}
                        />
                        <div style={{ padding: '12px 20px', borderTop: '1px solid #3a3a3a', display: 'flex', flexDirection: 'column', gap: 8 }}>
                            <input
                                type="text"
                                value={saveName}
                                onInput={(e) => setSaveName((e.target as HTMLInputElement).value)}
                                placeholder="Route name"
                                style={{
                                    padding: 8, background: '#222', color: '#fff',
                                    border: '1px solid #3a3a3a', borderRadius: 6, fontSize: 13,
                                }}
                            />
                            <button
                                onClick={handleSaveNewRoute}
                                className={styles.saveButton}
                                disabled={saving || !saveName.trim() || selectedStopIds.size < 2}
                            >
                                {saving ? 'Saving…' : 'Save route'}
                            </button>
                            <div style={{ display: 'flex', gap: 8 }}>
                                <button onClick={handleUndo} className={styles.saveButton} style={{ flex: 1, background: '#374151' }}>
                                    Undo last
                                </button>
                                <button onClick={handleReset} className={styles.saveButton} style={{ flex: 1, background: '#374151' }}>
                                    Start over
                                </button>
                            </div>
                            {error && <div style={{ color: '#f87171', fontSize: 13 }}>{error}</div>}
                        </div>
                    </>
                )}

                {phase === 'edit' && editingRouteMeta && (
                    <>
                        <div style={{ padding: '12px 20px', borderBottom: '1px solid #3a3a3a' }}>
                            <div style={{ color: '#fff', fontSize: 14 }}>{editingRouteMeta.name}</div>
                            <div style={{ color: '#888', fontSize: 12, marginBottom: 6 }}>
                                {editingRouteMeta.point_count.toLocaleString()} points · {editingRouteMeta.stops.length} stops · {editingRouteMeta.total_plays} plays ({editingRouteMeta.monthly_plays?.[new Date().toISOString().slice(0, 7)] ?? 0} this month)
                            </div>
                            <div style={{ display: 'flex', gap: 6, marginBottom: 6 }}>
                                <button
                                    onClick={handleDriveEditing}
                                    style={{ flex: 1, padding: '6px 8px', fontSize: 12, background: '#22c55e', color: '#fff', border: 'none', borderRadius: 4, cursor: 'pointer' }}
                                >Drive this route</button>
                                <button
                                    onClick={() => handleCopyShareUrl(editingRouteMeta.id)}
                                    style={{ flex: 1, padding: '6px 8px', fontSize: 12, background: copiedRouteId === editingRouteMeta.id ? '#22c55e' : '#6b7280', color: '#fff', border: 'none', borderRadius: 4, cursor: 'pointer', transition: 'background 0.15s' }}
                                >{copiedRouteId === editingRouteMeta.id ? 'Copied!' : 'Copy share link'}</button>
                            </div>
                            <div style={{ fontSize: 11, color: '#666', wordBreak: 'break-all' }}>
                                {shareUrl(editingRouteMeta.id)}
                            </div>
                            <div style={{ fontSize: 10, color: '#666', marginTop: 2 }}>
                                Anyone with this link can drive your route.
                            </div>
                        </div>

                        {selectedNodeData && (
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
                                            />{' '}
                                            Key Node
                                        </label>
                                    </div>
                                    <button
                                        onClick={handleAutoHeight}
                                        className={styles.autoHeightButton}
                                    >
                                        Auto Height
                                    </button>
                                </div>
                            </div>
                        )}

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

                        <div className={styles.editorActions}>
                            <div className={styles.modificationInfo}>
                                {modifiedNodesCount > 0
                                    ? `${modifiedNodesCount} node(s) modified`
                                    : 'No modifications yet'}
                            </div>
                            <button
                                onClick={handleSaveEdits}
                                className={styles.saveButton}
                                disabled={saving}
                            >
                                {saving ? 'Saving…' : 'Save edits'}
                            </button>
                            <button
                                onClick={handleExitEdit}
                                className={styles.saveButton}
                                style={{ background: '#374151' }}
                            >
                                Back to my routes
                            </button>
                            {error && <div style={{ color: '#f87171', fontSize: 13 }}>{error}</div>}
                        </div>
                    </>
                )}
            </div>
        </div>
    );
}

function StopPicker({ candidates, selected, onToggle }: {
    candidates: StopCandidate[];
    selected: Set<number>;
    onToggle: (osmNodeId: number) => void;
}) {
    const groups = groupStopsByName(candidates);
    return (
        <div style={{ padding: '8px 20px', overflowY: 'auto', flex: 1 }}>
            {groups.length === 0 && (
                <div style={{ fontSize: 13, color: '#888' }}>No stops found near the committed path.</div>
            )}
            {groups.map(group => (
                <div key={group.name} style={{ marginBottom: 10 }}>
                    <div style={{ fontSize: 13, color: '#fff', fontWeight: 600 }}>{group.name}</div>
                    {group.candidates.map(c => {
                        const id = c.stop.osm_node_id;
                        const isOn = selected.has(id);
                        const offPath = c.snap.distanceM > STOP_ON_PATH_DEFAULT_M;
                        return (
                            <label
                                key={id}
                                style={{
                                    display: 'flex', alignItems: 'center', gap: 8,
                                    padding: '4px 0', paddingLeft: 8,
                                    fontSize: 12, color: isOn ? '#fff' : '#888',
                                    cursor: 'pointer',
                                }}
                            >
                                <input type="checkbox" checked={isOn} onChange={() => onToggle(id)} />
                                <span style={{ flex: 1 }}>
                                    {c.stop.track ? `Track ${c.stop.track}` : `Platform @ node ${id}`}
                                </span>
                                <span style={{ color: offPath ? '#f87171' : '#666' }}>
                                    {Math.round(c.snap.distanceM)}m
                                </span>
                            </label>
                        );
                    })}
                </div>
            ))}
        </div>
    );
}

export default UserRoutesViewer;
