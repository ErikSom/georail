import type { OverpassWay, OverpassStop } from '../api/overpass';

export type NodeId = number;
export type WayId = number;

export interface GraphNode {
    id: NodeId;
    lat: number;
    lon: number;
    wayIds: Set<WayId>;
}

export interface GraphWay {
    id: WayId;
    nodes: NodeId[];
    geometry: [number, number][]; // [lon, lat]
    name: string | null;
    maxspeed: string | null;
}

export interface RouteGraph {
    nodes: Map<NodeId, GraphNode>;
    ways: Map<WayId, GraphWay>;
}

// ways.nodes[i] aligns with ways.geometry[i]; a node shared by ≥2 ways is a junction.
export function buildGraph(ways: OverpassWay[]): RouteGraph {
    const nodes = new Map<NodeId, GraphNode>();
    const graphWays = new Map<WayId, GraphWay>();

    for (const way of ways) {
        if (way.nodes.length < 2 || way.geometry.length !== way.nodes.length) continue;

        for (let i = 0; i < way.nodes.length; i++) {
            const nid = way.nodes[i];
            const [lon, lat] = way.geometry[i];
            let node = nodes.get(nid);
            if (!node) {
                node = { id: nid, lat, lon, wayIds: new Set() };
                nodes.set(nid, node);
            }
            node.wayIds.add(way.id);
        }

        graphWays.set(way.id, {
            id: way.id,
            nodes: way.nodes,
            geometry: way.geometry,
            name: way.tags.name,
            maxspeed: way.tags.maxspeed,
        });
    }

    return { nodes, ways: graphWays };
}

function haversine(lon1: number, lat1: number, lon2: number, lat2: number): number {
    const R = 6371000;
    const dLat = (lat2 - lat1) * Math.PI / 180;
    const dLon = (lon2 - lon1) * Math.PI / 180;
    const a = Math.sin(dLat / 2) ** 2 +
        Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
        Math.sin(dLon / 2) ** 2;
    return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

export function snapStopToNode(graph: RouteGraph, stop: OverpassStop): NodeId | null {
    let bestId: NodeId | null = null;
    let bestD = Infinity;
    for (const node of graph.nodes.values()) {
        const d = haversine(stop.lon, stop.lat, node.lon, node.lat);
        if (d < bestD) {
            bestD = d;
            bestId = node.id;
        }
    }
    return bestId;
}

export function neighborsAt(graph: RouteGraph, nodeId: NodeId, comingFromWayId: WayId | null): WayId[] {
    const node = graph.nodes.get(nodeId);
    if (!node) return [];
    const out: WayId[] = [];
    for (const wid of node.wayIds) {
        if (wid !== comingFromWayId) out.push(wid);
    }
    return out;
}

// Returns null for self-loops or inconsistent graphs.
export function otherEndOfWay(graph: RouteGraph, wayId: WayId, fromNodeId: NodeId): NodeId | null {
    const way = graph.ways.get(wayId);
    if (!way) return null;
    const first = way.nodes[0];
    const last = way.nodes[way.nodes.length - 1];
    if (first === fromNodeId && last !== fromNodeId) return last;
    if (last === fromNodeId && first !== fromNodeId) return first;
    return null;
}

export function isImmediateDeadEnd(graph: RouteGraph, wayId: WayId, fromNodeId: NodeId): boolean {
    const other = otherEndOfWay(graph, wayId, fromNodeId);
    if (other == null) return true;
    const otherNode = graph.nodes.get(other);
    if (!otherNode) return true;
    let onward = 0;
    for (const wid of otherNode.wayIds) if (wid !== wayId) onward++;
    return onward === 0;
}
