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
    status: TraversalStatus;
    branchOptions: BranchOption[];
}

export function createTraversal(graph: RouteGraph, startNode: NodeId, endNode: NodeId): TraversalState {
    const state: TraversalState = {
        startNode,
        endNode,
        currentNode: startNode,
        path: [],
        status: 'awaiting_pick',
        branchOptions: [],
    };
    advance(graph, state);
    return state;
}

// Walks through single-connection nodes; stops at destination, junction, or dead end.
export function advance(graph: RouteGraph, state: TraversalState): void {
    const MAX_AUTO_STEPS = 50000;
    let steps = 0;

    while (steps++ < MAX_AUTO_STEPS) {
        if (state.currentNode === state.endNode) {
            state.status = 'completed';
            state.branchOptions = [];
            return;
        }

        const lastWayId = state.path.length > 0 ? state.path[state.path.length - 1].wayId : null;
        const candidates = neighborsAt(graph, state.currentNode, lastWayId);
        const viable = candidates.filter(wid => !isImmediateDeadEnd(graph, wid, state.currentNode));

        if (viable.length === 0) {
            state.status = 'dead_end';
            state.branchOptions = [];
            return;
        }

        if (viable.length === 1) {
            commitWay(graph, state, viable[0]);
            continue;
        }

        state.status = 'awaiting_pick';
        state.branchOptions = viable.map(wid => ({
            wayId: wid,
            otherEnd: otherEndOfWay(graph, wid, state.currentNode) ?? state.currentNode,
        }));
        return;
    }
}

export function pickBranch(graph: RouteGraph, state: TraversalState, wayId: WayId): void {
    if (state.status !== 'awaiting_pick') return;
    if (!state.branchOptions.some(o => o.wayId === wayId)) return;
    commitWay(graph, state, wayId);
    advance(graph, state);
}

// Pops committed steps until we're back at a junction (the previous user decision).
export function undoLast(graph: RouteGraph, state: TraversalState): void {
    if (state.path.length === 0) return;

    while (state.path.length > 0) {
        state.path.pop();
        state.currentNode = state.path.length > 0
            ? state.path[state.path.length - 1].toNode
            : state.startNode;

        const lastWayId = state.path.length > 0 ? state.path[state.path.length - 1].wayId : null;
        const candidates = neighborsAt(graph, state.currentNode, lastWayId);
        const viable = candidates.filter(wid => !isImmediateDeadEnd(graph, wid, state.currentNode));
        if (viable.length > 1) {
            state.status = 'awaiting_pick';
            state.branchOptions = viable.map(wid => ({
                wayId: wid,
                otherEnd: otherEndOfWay(graph, wid, state.currentNode) ?? state.currentNode,
            }));
            return;
        }
    }

    state.status = 'awaiting_pick';
    state.branchOptions = [];
    state.currentNode = state.startNode;
    advance(graph, state);
}

function commitWay(graph: RouteGraph, state: TraversalState, wayId: WayId): void {
    const other = otherEndOfWay(graph, wayId, state.currentNode);
    if (other == null) return;
    state.path.push({ wayId, fromNode: state.currentNode, toNode: other });
    state.currentNode = other;
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
