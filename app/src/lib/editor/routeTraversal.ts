import type { RouteGraph, NodeId, WayId } from './routeGraph';
import { neighborsAt, otherEndOfWay, isImmediateDeadEnd } from './routeGraph';

function haversine(lon1: number, lat1: number, lon2: number, lat2: number): number {
    const R = 6371000;
    const dLat = (lat2 - lat1) * Math.PI / 180;
    const dLon = (lon2 - lon1) * Math.PI / 180;
    const a = Math.sin(dLat / 2) ** 2 +
        Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
        Math.sin(dLon / 2) ** 2;
    return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

export interface PathStep {
    wayId: WayId;
    fromNode: NodeId;
    toNode: NodeId;
    // Position in graph.itinerary when this step was auto-followed; -1 if
    // the step came from the user-pick / heuristic fallback.
    itineraryIndex: number;
}

export interface BranchOption {
    wayId: WayId;
    otherEnd: NodeId;
}

export type TraversalStatus = 'awaiting_pick' | 'completed' | 'dead_end';

export interface TraversalState {
    startNode: NodeId;
    endNode: NodeId;
    currentNode: NodeId;
    path: PathStep[];
    // Last consumed index in graph.itinerary; -1 before the first auto-step.
    itineraryIndex: number;
    status: TraversalStatus;
    branchOptions: BranchOption[];
}

export function createTraversal(graph: RouteGraph, startNode: NodeId, endNode: NodeId): TraversalState {
    const state: TraversalState = {
        startNode,
        endNode,
        currentNode: startNode,
        path: [],
        itineraryIndex: firstItineraryIndexAtNode(graph, startNode) - 1,
        status: 'awaiting_pick',
        branchOptions: [],
    };
    advance(graph, state);
    return state;
}

function firstItineraryIndexAtNode(graph: RouteGraph, node: NodeId): number {
    for (let i = 0; i < graph.itinerary.length; i++) {
        const way = graph.ways.get(graph.itinerary[i]);
        if (!way) continue;
        if (way.nodes[0] === node || way.nodes[way.nodes.length - 1] === node) return i;
    }
    return 0;
}

const BRIDGE_MAX_METERS = 50;

// Walks the itinerary; handles reversals (same way id twice) and bridges small
// geographic gaps. Falls back to a user-pick prompt when the itinerary is
// exhausted but multiple heuristic branches remain.
export function advance(graph: RouteGraph, state: TraversalState): void {
    const MAX_AUTO_STEPS = 50000;
    let steps = 0;

    while (steps++ < MAX_AUTO_STEPS) {
        if (state.currentNode === state.endNode) {
            console.log(`[traverse] completed after ${state.path.length} ways`);
            state.status = 'completed';
            state.branchOptions = [];
            return;
        }

        if (tryFollowItinerary(graph, state)) continue;

        const lastWayId = state.path.length > 0 ? state.path[state.path.length - 1].wayId : null;
        const candidates = neighborsAt(graph, state.currentNode, lastWayId);

        if (candidates.length === 0) {
            console.log(`[traverse] dead end at node ${state.currentNode} after ${state.path.length} ways (no candidates, lastWay=${lastWayId})`);
            state.status = 'dead_end';
            state.branchOptions = [];
            return;
        }

        const viable = candidates.filter(wid => !isImmediateDeadEnd(graph, wid, state.currentNode));

        if (viable.length === 0) {
            console.log(`[traverse] dead end at node ${state.currentNode} after ${state.path.length} ways (candidates=${candidates.length}, all dead-ends)`, candidates);
            state.status = 'dead_end';
            state.branchOptions = [];
            return;
        }

        if (viable.length === 1) {
            if (commitWay(graph, state, viable[0], -1)) continue;
            state.status = 'dead_end';
            state.branchOptions = [];
            return;
        }

        console.log(`[traverse] junction at node ${state.currentNode} after ${state.path.length} ways: ${viable.length} branches`);
        state.status = 'awaiting_pick';
        state.branchOptions = viable.map(wid => ({
            wayId: wid,
            otherEnd: otherEndOfWay(graph, wid, state.currentNode) ?? state.currentNode,
        }));
        return;
    }

    console.warn(`[traverse] hit MAX_AUTO_STEPS (path=${state.path.length})`);
}

function tryFollowItinerary(graph: RouteGraph, state: TraversalState): boolean {
    const nextIdx = state.itineraryIndex + 1;
    if (nextIdx >= graph.itinerary.length) return false;

    const nextWayId = graph.itinerary[nextIdx];
    const way = graph.ways.get(nextWayId);
    if (!way) {
        // Missing way (filtered out server-side); skip the slot.
        state.itineraryIndex = nextIdx;
        return true;
    }

    const other = otherEndOfWay(graph, nextWayId, state.currentNode);
    if (other !== null) {
        return commitWay(graph, state, nextWayId, nextIdx);
    }

    // Gap: itinerary's next way doesn't touch currentNode but an endpoint is
    // nearby (OSM terminal-station track-switch, parallel platforms with
    // distinct node ids at the same coords, etc.). Hop to the closer endpoint.
    const here = graph.nodes.get(state.currentNode);
    if (!here) return false;

    let bestEndpoint: NodeId | null = null;
    let bestDist = Infinity;
    for (const endpointId of [way.nodes[0], way.nodes[way.nodes.length - 1]]) {
        if (endpointId === state.currentNode) continue;
        const endpoint = graph.nodes.get(endpointId);
        if (!endpoint) continue;
        const d = haversine(here.lon, here.lat, endpoint.lon, endpoint.lat);
        if (d < BRIDGE_MAX_METERS && d < bestDist) {
            bestEndpoint = endpointId;
            bestDist = d;
        }
    }
    if (bestEndpoint !== null) {
        console.log(`[traverse] bridge ${Math.round(bestDist)}m to way ${nextWayId} @ node ${bestEndpoint} (itinerary ${nextIdx})`);
        state.currentNode = bestEndpoint;
        return commitWay(graph, state, nextWayId, nextIdx);
    }

    return false;
}

export function pickBranch(graph: RouteGraph, state: TraversalState, wayId: WayId): void {
    if (state.status !== 'awaiting_pick') return;
    if (!state.branchOptions.some(o => o.wayId === wayId)) return;
    commitWay(graph, state, wayId, -1);
    advance(graph, state);
}

// Pops back to the previous user-pick junction, using the itineraryIndex = -1
// marker to distinguish heuristic steps from auto-follow steps.
export function undoLast(graph: RouteGraph, state: TraversalState): void {
    if (state.path.length === 0) return;

    state.path.pop();
    applyPopSideEffects(graph, state);

    while (state.path.length > 0) {
        const top = state.path[state.path.length - 1];
        if (top.itineraryIndex === -1) break;
        state.path.pop();
        applyPopSideEffects(graph, state);
    }

    advance(graph, state);
}

function applyPopSideEffects(_graph: RouteGraph, state: TraversalState): void {
    state.currentNode = state.path.length > 0
        ? state.path[state.path.length - 1].toNode
        : state.startNode;
    state.itineraryIndex = state.path.length > 0
        ? Math.max(state.itineraryIndex, state.path[state.path.length - 1].itineraryIndex)
        : -1;
    // Heuristic steps carry itineraryIndex = -1; scan back to the last real one.
    if (state.path.length > 0 && state.path[state.path.length - 1].itineraryIndex === -1) {
        let idx = -1;
        for (let i = state.path.length - 1; i >= 0; i--) {
            if (state.path[i].itineraryIndex !== -1) { idx = state.path[i].itineraryIndex; break; }
        }
        state.itineraryIndex = idx;
    }
}

function commitWay(graph: RouteGraph, state: TraversalState, wayId: WayId, itineraryIndex: number): boolean {
    const other = otherEndOfWay(graph, wayId, state.currentNode);
    if (other == null) return false;
    state.path.push({ wayId, fromNode: state.currentNode, toNode: other, itineraryIndex });
    state.currentNode = other;
    if (itineraryIndex >= 0) state.itineraryIndex = itineraryIndex;
    return true;
}

export function pathToCoords(graph: RouteGraph, state: TraversalState): { coords: [number, number][]; pointWayIds: WayId[] } {
    const coords: [number, number][] = [];
    const pointWayIds: WayId[] = [];
    for (const step of state.path) {
        const way = graph.ways.get(step.wayId);
        if (!way) continue;
        const forward = way.nodes[0] === step.fromNode;
        const geom = forward ? way.geometry : [...way.geometry].reverse();
        const start = coords.length === 0 ? 0 : 1; // skip duplicate junction point
        for (let i = start; i < geom.length; i++) {
            coords.push(geom[i]);
            pointWayIds.push(way.id);
        }
    }
    return { coords, pointWayIds };
}

export interface PathSnap {
    pathIndex: number;
    lat: number;
    lon: number;
    distanceM: number;
}

export function snapStopToPath(
    pathCoords: [number, number][],
    stopLon: number,
    stopLat: number
): PathSnap | null {
    if (pathCoords.length === 0) return null;
    let bestIdx = 0;
    let bestD = Infinity;
    for (let i = 0; i < pathCoords.length; i++) {
        const [lon, lat] = pathCoords[i];
        const d = haversine(lon, lat, stopLon, stopLat);
        if (d < bestD) {
            bestD = d;
            bestIdx = i;
        }
    }
    return {
        pathIndex: bestIdx,
        lat: pathCoords[bestIdx][1],
        lon: pathCoords[bestIdx][0],
        distanceM: bestD,
    };
}
