import {
    Scene,
    Camera,
    Mesh,
    Group,
    Vector3,
    Matrix4,
    Raycaster,
    CylinderGeometry,
    LineBasicMaterial,
    BufferGeometry,
    Line,
    LineSegments,
    Float32BufferAttribute,
    Color,
    MeshBasicMaterial,
    Quaternion,
    type ShaderMaterial,
} from 'three';
import { TransformControls } from 'three/addons/controls/TransformControls.js';
import type { RouteData } from '../api/navigation';
import type { MapViewer } from '../MapViewer';
import type { PatchData } from '../types/Patch';
import { Input } from '../utils/Input';
import { geoToENU, applyENUOffset, type GeoCoords } from '../utils/CoordinateHelpers';
import { NodeIndicator } from './NodeIndicator';
import { StationIndicator } from '../StationIndicator';

interface NodeSnapshot {
    position: Vector3;
    world_offset: Vector3;
    isKeyNode: boolean;
}

type UndoState = Map<string, NodeSnapshot>;

export interface NodeData {
    segment_id: number;
    index: number;
    world_offset: Vector3; // [x, y, z] offset in world space (East, Up, North)
    originalWorldOffset: Vector3; // Original offset from route data (East, Up, North)
    isKeyNode: boolean;
    isStationNode: boolean;
    position: Vector3;
    originalPosition: Vector3;
    originalGeoCoords?: { lat: number; lon: number; height: number }; // Cache to avoid repeated conversions
}

export interface NodeComparison {
    node: NodeData;
    original: {
        east: number;
        north: number;
        up: number;
    };
    current: {
        east: number;
        north: number;
        up: number;
    };
}

export class RouteEditor {
    private scene: Scene;
    private camera: Camera;
    private domElement: HTMLElement;
    private mapViewer: MapViewer;
    private routeGroup: Group;
    private nodes: Map<string, NodeData> = new Map();
    private nodeIndicators: Map<string, NodeIndicator> = new Map();
    private endpointPartner: Map<string, string> = new Map();
    private nodeChainId: Map<string, number> = new Map();
    private chainMaterials: Map<number, MeshBasicMaterial> = new Map();
    private chainLines: LineSegments | null = null;
    private transformControls: TransformControls;
    private selectedNodes: Set<string> = new Set();
    private selectionAnchor: Group;
    private lastAnchorPosition: Vector3 = new Vector3();
    private reviewMode: boolean = false;
    private offsetIndicators: Map<string, Mesh> = new Map();
    private stationBeamMaterials: ShaderMaterial[] = [];
    private stationTime = 0;

    // Undo system
    private undoStack: UndoState[] = [];
    private maxUndoStates = 50;
    private isDragging = false;

    // Callbacks
    public onNodeSelected: ((nodeData: NodeData | null) => void) | null = null;
    public onSelectionChanged: ((nodes: NodeData[]) => void) | null = null;
    public onNodesModified: ((nodes: NodeData[]) => void) | null = null;
    public onNodeIndexChanged: ((currentIndex: number, totalNodes: number) => void) | null = null;
    private removeReorientListener: (() => void) | null = null;

    constructor(scene: Scene, camera: Camera, domElement: HTMLElement, mapViewer: MapViewer, reviewMode: boolean = false) {
        this.scene = scene;
        this.camera = camera;
        this.domElement = domElement;
        this.mapViewer = mapViewer;
        this.reviewMode = reviewMode;

        this.routeGroup = new Group();
        this.routeGroup.name = 'RouteEditorGroup';
        this.scene.add(this.routeGroup);

        this.selectionAnchor = new Group();
        this.selectionAnchor.name = 'SelectionAnchor';
        this.scene.add(this.selectionAnchor);

        // Register for automatic reorientation
        this.removeReorientListener = this.mapViewer.addReorientListener((delta) => this.handleReorient(delta));

        // Setup TransformControls (disabled in review mode)
        this.transformControls = new TransformControls(camera, domElement);
        this.transformControls.enabled = !reviewMode;

        // Set to 'local' space so controls align with mesh rotation
        this.transformControls.setSpace('local');

        // Lock Z-axis - only allow X and Y translation (local Z now follows mesh orientation)
        this.transformControls.showZ = false;

        this.transformControls.addEventListener('dragging-changed', (event) => {
            // Disable camera controls while dragging
            this.domElement.dispatchEvent(new CustomEvent('transform-dragging', { detail: event.value, bubbles: true }));

            // Capture state at start of drag for undo
            if (event.value && !this.isDragging) {
                this.isDragging = true;
                this.pushUndoState();
                if (this.selectedNodes.size > 1) {
                    this.lastAnchorPosition.copy(this.selectionAnchor.position);
                }
            } else if (!event.value) {
                this.isDragging = false;
            }
        });

        this.transformControls.addEventListener('objectChange', () => {
            this.handleNodeTransform();
        });

        this.scene.add(this.transformControls.getHelper());
    }

    public loadRoute(routeData: RouteData): void {
        this.clear();

        if (!routeData.geometry.editor || !routeData.geometry.route) {
            console.error('Route data missing editor or route information');
            return;
        }

        // Build set of station node indices for quick lookup
        const stationIndices = new Set<number>(routeData.geometry.stop_indices || []);

        // Store meshes in order for orientation calculation
        const orderedMeshes: Mesh[] = [];

        // Process each point using both route and editor arrays
        routeData.geometry.route.forEach((routePoint: number[], idx: number) => {
            const editorPoint = routeData.geometry.editor![idx];

            // routePoint is [lon, lat, world_offset_x, world_offset_y, world_offset_z, keynode?]
            const [lon, lat, world_offset_x, world_offset_y, world_offset_z] = routePoint;
            const storedKeyNode = routePoint.length > 5 ? !!routePoint[5] : false;
            const { segment_id, index } = editorPoint;

            // Create unique key
            const nodeKey = `${segment_id}-${index}`;

            // Store world offset
            const worldOffset = new Vector3(world_offset_x, world_offset_y, world_offset_z);

            // Use original lat/lon directly as ENU reference
            // (avoids precision loss from round-tripping through world space)
            const origGeoCoords = { lat, lon, height: 0 };

            // Store original position at altitude 0
            const originalPosition = this.mapViewer.latLonHeightToWorldPosition(lat, lon, 0);

            if (!originalPosition) {
                console.warn(`Failed to convert coordinates for node ${nodeKey}`);
                return;
            }

            const position = applyENUOffset(origGeoCoords, worldOffset, this.mapViewer);
            if (!position) {
                console.warn(`Failed to apply offset for node ${nodeKey}`);
                return;
            }

            const isStation = stationIndices.has(idx);
            const nodeData: NodeData = {
                segment_id,
                index,
                world_offset: worldOffset.clone(),
                originalWorldOffset: worldOffset.clone(),
                isKeyNode: storedKeyNode,
                isStationNode: isStation,
                position: position.clone(),
                originalPosition: originalPosition.clone(),
                originalGeoCoords: origGeoCoords, // Cache to avoid repeated conversions
            };

            this.nodes.set(nodeKey, nodeData);

            // Create node indicator — station nodes are larger
            const nodeIndicator = new NodeIndicator(isStation ? 2.5 : 1);
            nodeIndicator.mesh.position.copy(position);
            nodeIndicator.mesh.name = nodeKey;
            nodeIndicator.mesh.userData.nodeKey = nodeKey;

            if (isStation) {
                nodeIndicator.setMode('station');
                this.addStationBeams(nodeIndicator.mesh);
            } else if (storedKeyNode) {
                nodeIndicator.setMode('keyNode');
            }

            this.nodeIndicators.set(nodeKey, nodeIndicator);
            this.routeGroup.add(nodeIndicator.mesh);
            orderedMeshes.push(nodeIndicator.mesh);

            // In review mode, add grey vertical line at original position
            if (this.reviewMode) {
                this.createOffsetIndicator(nodeKey, nodeData);
            }

            // Debug first and last node positions
            if (idx === 0) {
                console.log('First node position (world):', position);
                console.log('First node geo coords:', { lat, lon, world_offset: [world_offset_x, world_offset_y, world_offset_z] });
            }
            if (idx === routeData.geometry.route.length - 1) {
                console.log('Last node position (world):', position);
                console.log('Last node geo coords:', { lat, lon, world_offset: [world_offset_x, world_offset_y, world_offset_z] });
            }
        });

        // Orient each mesh so local Z-axis points towards the next node
        // The cone geometry itself is already pointing down, we just rotate the mesh.
        const MIN_DISTANCE_THRESHOLD = 0.1; // Minimum distance (in meters) to calculate orientation

        for (let i = 0; i < orderedMeshes.length; i++) {
            const mesh = orderedMeshes[i];

            if (i < orderedMeshes.length - 1) {
                // Walk forward through iteration order until we find a node
                // far enough to give a meaningful direction. Skips clustered
                // nodes that share a position at junctions.
                let nextMesh: Mesh | null = null;
                for (let j = i + 1; j < orderedMeshes.length; j++) {
                    if (orderedMeshes[j].position.distanceTo(mesh.position) >= MIN_DISTANCE_THRESHOLD) {
                        nextMesh = orderedMeshes[j];
                        break;
                    }
                }

                if (!nextMesh && i > 0) {
                    // Reached the end with only clustered neighbours — copy previous rotation.
                    mesh.rotation.copy(orderedMeshes[i - 1].rotation);
                } else if (nextMesh) {
                    // Calculate direction to next node
                    const direction = new Vector3()
                        .subVectors(nextMesh.position, mesh.position)
                        .normalize();

                    // We want local Z-axis to point in 'direction'
                    // Use lookAt to align the mesh, but we need to be careful:
                    // lookAt aligns -Z by default, but we want +Z
                    // So we look at the opposite direction
                    const targetPoint = new Vector3()
                        .copy(mesh.position)
                        .sub(direction); // Look at opposite direction so +Z points toward next

                    mesh.lookAt(targetPoint);
                }
            } else {
                // Last node: copy rotation from previous node
                if (i > 0) {
                    mesh.rotation.copy(orderedMeshes[i - 1].rotation);
                }
            }
        }

        this.buildEndpointPartners();
        this.assignChains();
        this.applyChainColors();
        this.buildChainLines();

        console.log(`Loaded ${this.nodes.size} nodes for route editing`);
        console.log('Route group position:', this.routeGroup.position);
        console.log('Route group world matrix:', this.routeGroup.matrixWorld);

        // Initialize slider with total node count (no selection yet)
        if (this.onNodeIndexChanged) {
            this.onNodeIndexChanged(-1, this.nodes.size);
        }
    }

    // Pair segment endpoints that share a position 1-to-1 (continuation).
    private buildEndpointPartners(): void {
        this.endpointPartner.clear();
        const nodeKeys = Array.from(this.nodes.keys());
        const endpoints: string[] = [];
        for (let i = 0; i < nodeKeys.length; i++) {
            const cur = this.nodes.get(nodeKeys[i])!;
            const prevSeg = i > 0 ? this.nodes.get(nodeKeys[i - 1])?.segment_id : undefined;
            const nextSeg = i < nodeKeys.length - 1 ? this.nodes.get(nodeKeys[i + 1])?.segment_id : undefined;
            if (prevSeg !== cur.segment_id || nextSeg !== cur.segment_id) endpoints.push(nodeKeys[i]);
        }
        const buckets = new Map<string, string[]>();
        for (const key of endpoints) {
            const c = this.nodes.get(key)?.originalGeoCoords;
            if (!c) continue;
            const k = `${Math.round(c.lat * 1e6)}_${Math.round(c.lon * 1e6)}`;
            const arr = buckets.get(k) ?? [];
            arr.push(key);
            buckets.set(k, arr);
        }
        for (const arr of buckets.values()) {
            if (arr.length !== 2) continue;
            const [a, b] = arr;
            const an = this.nodes.get(a)!;
            const bn = this.nodes.get(b)!;
            if (an.segment_id === bn.segment_id) continue;
            this.endpointPartner.set(a, b);
            this.endpointPartner.set(b, a);
        }
    }

    // BFS each connected chain, assigning a unique id; also builds chain materials.
    private assignChains(): void {
        this.nodeChainId.clear();
        for (const m of this.chainMaterials.values()) m.dispose();
        this.chainMaterials.clear();

        let nextId = 0;
        for (const startKey of this.nodes.keys()) {
            if (this.nodeChainId.has(startKey)) continue;
            const queue: string[] = [startKey];
            while (queue.length) {
                const k = queue.shift()!;
                if (this.nodeChainId.has(k)) continue;
                this.nodeChainId.set(k, nextId);
                const a = this.chainNeighbor(k, null);
                if (a && !this.nodeChainId.has(a)) queue.push(a);
                const b = a ? this.chainNeighbor(k, a) : null;
                if (b && !this.nodeChainId.has(b)) queue.push(b);
            }
            const hue = ((nextId * 137.508) % 360) / 360;
            const color = new Color().setHSL(hue, 0.65, 0.55);
            this.chainMaterials.set(nextId, new MeshBasicMaterial({ color }));
            nextId++;
        }
    }

    private applyChainColors(): void {
        for (const [key, indicator] of this.nodeIndicators) {
            const node = this.nodes.get(key);
            if (!node || node.isStationNode) continue;
            const cid = this.nodeChainId.get(key);
            if (cid === undefined) continue;
            const mat = this.chainMaterials.get(cid);
            if (mat) indicator.setBaseMaterial(mat);
        }
    }

    private buildChainLines(): void {
        if (this.chainLines) {
            this.routeGroup.remove(this.chainLines);
            this.chainLines.geometry.dispose();
            (this.chainLines.material as MeshBasicMaterial).dispose();
            this.chainLines = null;
        }

        const positions: number[] = [];
        const colors: number[] = [];
        const seen = new Set<string>();
        for (const key of this.nodes.keys()) {
            const node = this.nodes.get(key)!;
            const cid = this.nodeChainId.get(key);
            if (cid === undefined) continue;
            const mat = this.chainMaterials.get(cid);
            const c = mat?.color;
            if (!c) continue;
            const a = this.chainNeighbor(key, null);
            const b = a ? this.chainNeighbor(key, a) : null;
            for (const nb of [a, b]) {
                if (!nb) continue;
                const edgeKey = key < nb ? `${key}|${nb}` : `${nb}|${key}`;
                if (seen.has(edgeKey)) continue;
                seen.add(edgeKey);
                const other = this.nodes.get(nb);
                if (!other) continue;
                positions.push(node.position.x, node.position.y, node.position.z);
                positions.push(other.position.x, other.position.y, other.position.z);
                colors.push(c.r, c.g, c.b, c.r, c.g, c.b);
            }
        }
        if (positions.length === 0) return;

        const geom = new BufferGeometry();
        geom.setAttribute('position', new Float32BufferAttribute(positions, 3));
        geom.setAttribute('color', new Float32BufferAttribute(colors, 3));
        const mat = new LineBasicMaterial({ vertexColors: true, transparent: true, opacity: 0.6 });
        this.chainLines = new LineSegments(geom, mat);
        this.routeGroup.add(this.chainLines);
    }

    // Next chain node walking outward from `currentKey`, having come from `cameFrom`.
    private chainNeighbor(currentKey: string, cameFrom: string | null): string | null {
        const nodeKeys = Array.from(this.nodes.keys());
        const idx = nodeKeys.indexOf(currentKey);
        if (idx === -1) return null;
        const cur = this.nodes.get(currentKey)!;
        for (const off of [-1, 1] as const) {
            const cand = nodeKeys[idx + off];
            if (!cand || cand === cameFrom) continue;
            if (this.nodes.get(cand)?.segment_id === cur.segment_id) return cand;
        }
        const partner = this.endpointPartner.get(currentKey);
        if (partner && partner !== cameFrom) return partner;
        return null;
    }

    private addStationBeams(nodeMesh: Mesh): void {
        const { group, materials } = StationIndicator.createBeamGroup();
        nodeMesh.add(group);
        this.stationBeamMaterials.push(...materials);
    }

    private createOffsetIndicator(nodeKey: string, nodeData: NodeData): void {
        // Create a vertical line from original position pointing 100m up
        const points = [];
        points.push(nodeData.originalPosition.clone());
        points.push(nodeData.originalPosition.clone().add(new Vector3(0, 200, 0)));

        const geometry = new BufferGeometry().setFromPoints(points);
        const material = new LineBasicMaterial({ color: 0xBABABA });
        const line = new Line(geometry, material);
        line.name = `offset-indicator-${nodeKey}`;

        this.offsetIndicators.set(nodeKey, line as any); // Line can be stored as Mesh for simplicity
        this.routeGroup.add(line);
    }

    public selectNode(nodeKey: string | null): void {
        if (nodeKey == null) this.selectNodes([], 'replace');
        else this.selectNodes([nodeKey], 'replace');
    }

    public selectNodes(keys: string[], mode: 'replace' | 'add' | 'toggle' = 'replace'): void {
        const next = mode === 'replace' ? new Set<string>() : new Set(this.selectedNodes);
        if (mode === 'toggle') {
            for (const k of keys) {
                if (next.has(k)) next.delete(k);
                else next.add(k);
            }
        } else {
            for (const k of keys) next.add(k);
        }

        const removed = new Set<string>();
        for (const k of this.selectedNodes) if (!next.has(k)) removed.add(k);
        const added = new Set<string>();
        for (const k of next) if (!this.selectedNodes.has(k)) added.add(k);
        if (removed.size === 0 && added.size === 0) return;

        for (const k of removed) {
            const ind = this.nodeIndicators.get(k);
            const data = this.nodes.get(k);
            if (!ind || !data) continue;
            const m = data.isStationNode ? 'station' : data.isKeyNode ? 'keyNode' : 'normal';
            ind.setMode(m);
        }
        for (const k of added) {
            const ind = this.nodeIndicators.get(k);
            if (ind) ind.setMode('selected');
        }

        this.selectedNodes = next;
        this.attachTransformControls();
        this.emitSelection();
    }

    private attachTransformControls(): void {
        const size = this.selectedNodes.size;
        if (size === 0) {
            this.transformControls.showZ = false;
            this.transformControls.detach();
            return;
        }
        if (size === 1) {
            const key = this.selectedNodes.values().next().value!;
            const indicator = this.nodeIndicators.get(key);
            const data = this.nodes.get(key);
            if (!indicator || !data) return;
            this.transformControls.showZ = data.isStationNode;
            this.transformControls.attach(indicator.mesh);
            return;
        }
        const centroid = new Vector3();
        for (const k of this.selectedNodes) {
            const d = this.nodes.get(k);
            if (d) centroid.add(d.position);
        }
        centroid.multiplyScalar(1 / size);
        this.selectionAnchor.position.copy(centroid);
        this.selectionAnchor.quaternion.copy(this.averageNodeOrientation());
        this.selectionAnchor.updateMatrixWorld();
        this.lastAnchorPosition.copy(centroid);
        this.transformControls.showZ = true;
        this.transformControls.attach(this.selectionAnchor);
    }

    // Element-wise quaternion mean with antipodal-sign correction.
    private averageNodeOrientation(): Quaternion {
        let sx = 0, sy = 0, sz = 0, sw = 0;
        let ref: Quaternion | null = null;
        for (const k of this.selectedNodes) {
            const ind = this.nodeIndicators.get(k);
            if (!ind) continue;
            const q = ind.mesh.quaternion;
            let qx = q.x, qy = q.y, qz = q.z, qw = q.w;
            if (!ref) {
                ref = q.clone();
            } else {
                const dot = ref.x * qx + ref.y * qy + ref.z * qz + ref.w * qw;
                if (dot < 0) { qx = -qx; qy = -qy; qz = -qz; qw = -qw; }
            }
            sx += qx; sy += qy; sz += qz; sw += qw;
        }
        const len = Math.hypot(sx, sy, sz, sw);
        if (len < 1e-9) return new Quaternion();
        return new Quaternion(sx / len, sy / len, sz / len, sw / len);
    }

    private emitSelection(): void {
        const list: NodeData[] = [];
        for (const k of this.selectedNodes) {
            const d = this.nodes.get(k);
            if (d) list.push(d);
        }
        if (this.onSelectionChanged) this.onSelectionChanged(list);
        if (this.onNodeSelected) this.onNodeSelected(list.length === 1 ? list[0] : null);
        if (this.onNodeIndexChanged) {
            if (list.length === 1) {
                const nodeKeys = Array.from(this.nodes.keys());
                this.onNodeIndexChanged(nodeKeys.indexOf(list[0].segment_id + '-' + list[0].index), this.nodes.size);
            } else {
                this.onNodeIndexChanged(-1, this.nodes.size);
            }
        }
    }

    public getSelectedNodes(): NodeData[] {
        const out: NodeData[] = [];
        for (const k of this.selectedNodes) {
            const d = this.nodes.get(k);
            if (d) out.push(d);
        }
        return out;
    }

    public selectNodesInScreenRect(
        rect: { left: number; top: number; right: number; bottom: number },
        mode: 'replace' | 'add' = 'replace'
    ): void {
        const w = this.domElement.clientWidth;
        const h = this.domElement.clientHeight;
        if (w <= 0 || h <= 0) return;
        const tmp = new Vector3();
        const keys: string[] = [];
        for (const [key, node] of this.nodes) {
            tmp.copy(node.position).project(this.camera);
            if (tmp.z < -1 || tmp.z > 1) continue;
            const x = (tmp.x * 0.5 + 0.5) * w;
            const y = (1 - (tmp.y * 0.5 + 0.5)) * h;
            if (x >= rect.left && x <= rect.right && y >= rect.top && y <= rect.bottom) keys.push(key);
        }
        this.selectNodes(keys, mode);
    }

    public toggleKeyNode(nodeKey: string): void {
        const nodeData = this.nodes.get(nodeKey);
        const nodeIndicator = this.nodeIndicators.get(nodeKey);

        if (nodeData && nodeIndicator) {
            nodeData.isKeyNode = !nodeData.isKeyNode;

            // Update mode - selected nodes stay selected
            if (this.selectedNodes.has(nodeKey)) {
                nodeIndicator.setMode('selected');
            } else {
                const mode = nodeData.isKeyNode ? 'keyNode' : nodeData.isStationNode ? 'station' : 'normal';
                nodeIndicator.setMode(mode);
            }

            this.rebuildSegmentsAroundNode(nodeKey);
            this.notifyModification();
        }
    }

    public setKeyNodeForSelection(value: boolean): void {
        if (this.selectedNodes.size === 0) return;
        const touched: string[] = [];
        for (const key of this.selectedNodes) {
            const nodeData = this.nodes.get(key);
            const nodeIndicator = this.nodeIndicators.get(key);
            if (!nodeData || !nodeIndicator) continue;
            if (nodeData.isKeyNode === value) continue;
            nodeData.isKeyNode = value;
            nodeIndicator.setMode('selected');
            touched.push(key);
        }
        for (const k of touched) this.rebuildSegmentsAroundNode(k);
        if (touched.length > 0) {
            this.notifyModification();
            this.emitSelection();
        }
    }

    public setOffsetForSelection(axis: 'east' | 'up' | 'north', value: number): void {
        if (this.selectedNodes.size === 0 || !Number.isFinite(value)) return;
        for (const key of this.selectedNodes) {
            const nodeData = this.nodes.get(key);
            if (!nodeData) continue;
            const next = nodeData.world_offset.clone();
            if (axis === 'east') next.x = value;
            else if (axis === 'up') next.y = value;
            else next.z = value;
            this.applyOffsetToNode(key, next);
        }
        for (const key of this.selectedNodes) this.interpolateBetweenKeyNodes(key);
        this.attachTransformControls();
        this.notifyModification();
        this.emitSelection();
    }

    public autoHeightNode(nodeKey: string): boolean {
        if (!this.snapNodeToTerrain(nodeKey, true)) return false;
        this.interpolateBetweenKeyNodes(nodeKey);
        if (this.selectedNodes.has(nodeKey)) this.emitSelection();
        this.notifyModification();
        return true;
    }

    public autoHeightSelection(): boolean {
        if (this.selectedNodes.size === 0) return false;
        let any = false;
        let pushedUndo = false;
        for (const key of this.selectedNodes) {
            if (this.snapNodeToTerrain(key, !pushedUndo)) {
                any = any || true;
                pushedUndo = true;
            }
        }
        if (!any) return false;
        for (const key of this.selectedNodes) this.interpolateBetweenKeyNodes(key);
        this.attachTransformControls();
        this.emitSelection();
        this.notifyModification();
        return true;
    }

    private snapNodeToTerrain(nodeKey: string, pushUndo: boolean): boolean {
        const nodeData = this.nodes.get(nodeKey);
        const nodeIndicator = this.nodeIndicators.get(nodeKey);
        if (!nodeData || !nodeIndicator || !nodeData.originalGeoCoords) return false;

        const tilesGroup = (this.mapViewer as any).tiles?.group;
        if (!tilesGroup) return false;

        // Sample three points along the rail (centre, +50cm forward, -50cm)
        // and take the lowest hit so a high outlier (canopy/wire/sign) doesn't
        // pull the rail above ground.
        const SAMPLE_OFFSET_M = 0.5;
        const forward = new Vector3(0, 0, 1).applyQuaternion(nodeIndicator.mesh.quaternion);
        forward.y = 0;
        const horizLen = forward.length();
        if (horizLen > 1e-6) forward.multiplyScalar(SAMPLE_OFFSET_M / horizLen);
        else forward.set(0, 0, 0);

        const samplePositions = [
            nodeData.position.clone(),
            nodeData.position.clone().add(forward),
            nodeData.position.clone().sub(forward),
        ];
        const direction = new Vector3(0, -1, 0);
        let lowestY: number | null = null;
        for (const sample of samplePositions) {
            const origin = sample.clone();
            origin.y += 100;
            const raycaster = new Raycaster(origin, direction, 0, 500);
            const intersects = raycaster.intersectObject(tilesGroup, true);
            const hit = intersects[0];
            if (!hit) continue;
            if (lowestY === null || hit.point.y < lowestY) lowestY = hit.point.y;
        }
        if (lowestY === null) return false;

        if (pushUndo) this.pushUndoState();

        const dy = lowestY - nodeData.originalPosition.y;
        nodeData.world_offset.y = dy;

        const newPos = applyENUOffset(nodeData.originalGeoCoords, nodeData.world_offset, this.mapViewer);
        if (newPos) {
            nodeData.position.copy(newPos);
            nodeIndicator.mesh.position.copy(newPos);
        }
        return true;
    }

    // Propagate `nodeKey`'s edit along its chain. Only interpolates *between* keynodes.
    private rebuildSegmentsAroundNode(nodeKey: string): void {
        const node = this.nodes.get(nodeKey);
        if (!node) return;

        const seeds = this.collectChainSeeds(nodeKey);
        const dirs = seeds.map(seed => this.walkChainUntilKeyNode(seed, nodeKey));

        if (node.isKeyNode) {
            for (const dir of dirs) {
                if (dir.keyNode) this.lerpAlongChain(nodeKey, dir.keyNode, dir.intermediates);
            }
            return;
        }

        const found = dirs.filter(d => d.keyNode);
        if (found.length === 2) {
            const inters = [...dirs[0].intermediates.slice().reverse(), nodeKey, ...dirs[1].intermediates];
            this.lerpAlongChain(found[0].keyNode!, found[1].keyNode!, inters);
        }
    }

    private collectChainSeeds(nodeKey: string): string[] {
        const seeds: string[] = [];
        const a = this.chainNeighbor(nodeKey, null);
        if (a) seeds.push(a);
        const b = this.chainNeighbor(nodeKey, a);
        if (b) seeds.push(b);
        return seeds;
    }

    private walkChainUntilKeyNode(seed: string, origin: string): { keyNode: string | null; intermediates: string[] } {
        const intermediates: string[] = [];
        let from: string | null = origin;
        let current: string | null = seed;
        while (current) {
            const cn = this.nodes.get(current);
            if (!cn) break;
            if (cn.isKeyNode) return { keyNode: current, intermediates };
            intermediates.push(current);
            const nxt: string | null = this.chainNeighbor(current, from);
            from = current;
            current = nxt;
        }
        return { keyNode: null, intermediates };
    }

    private applyOffsetToNode(nodeKey: string, offset: Vector3): void {
        const nodeData = this.nodes.get(nodeKey);
        const nodeIndicator = this.nodeIndicators.get(nodeKey);
        if (!nodeData || !nodeIndicator || !nodeData.originalGeoCoords) return;
        nodeData.world_offset.copy(offset);
        const newPos = applyENUOffset(nodeData.originalGeoCoords, nodeData.world_offset, this.mapViewer);
        if (newPos) {
            nodeData.position.copy(newPos);
            nodeIndicator.mesh.position.copy(newPos);
        }
    }

    public raycastNodes(raycaster: Raycaster): string | null {
        const meshArray = Array.from(this.nodeIndicators.values()).map(indicator => indicator.mesh);

        const intersects = raycaster.intersectObjects(meshArray, true);

        console.log('Raycast intersects:', intersects);

        if (intersects.length > 0) {
            const mesh = intersects[0].object as Mesh;
            return mesh.userData.nodeKey as string;
        }

        return null;
    }

    public isTransformControlClicked(raycaster: Raycaster): boolean {
        // If TC is already dragging, treat the click as belonging to the gizmo
        // (covers the case where the raycast misses a thin handle by a pixel
        // or fires before the helper updates).
        if ((this.transformControls as any).dragging) return true;
        // Raycast against the transform controls to see if they were clicked
        const helper = this.transformControls.getHelper();
        let intersects = raycaster.intersectObject(helper, true);

        intersects = intersects.filter(intersect => ((intersect.object as any).isMesh && !(intersect.object as any).isTransformControlsPlane));

        return intersects.length > 0;
    }

    public getModifiedNodes(): NodeData[] {
        return Array.from(this.nodes.values()).filter(node => {
            // Compare current world_offset with original
            return !node.world_offset.equals(node.originalWorldOffset);
        });
    }

    public getAllNodes(): NodeData[] {
        return Array.from(this.nodes.values());
    }

    public getNodeComparisons(): NodeComparison[] {
        const comparisons: NodeComparison[] = [];

        for (const node of this.nodes.values()) {
            if (!node.world_offset.equals(node.originalWorldOffset)) {
                comparisons.push({
                    node,
                    original: {
                        east: node.originalWorldOffset.x,
                        north: node.originalWorldOffset.z,
                        up: node.originalWorldOffset.y,
                    },
                    current: {
                        east: node.world_offset.x,
                        north: node.world_offset.z,
                        up: node.world_offset.y,
                    },
                });
            }
        }

        return comparisons;
    }

    public selectNodeByIndex(index: number): void {
        const nodeKeys = Array.from(this.nodes.keys());
        if (index >= 0 && index < nodeKeys.length) {
            this.selectNode(nodeKeys[index]);
        }
    }

    public getTotalNodeCount(): number {
        return this.nodes.size;
    }

    public getCurrentNodeIndex(): number {
        if (this.selectedNodes.size !== 1) return -1;
        const key = this.selectedNodes.values().next().value!;
        const nodeKeys = Array.from(this.nodes.keys());
        return nodeKeys.indexOf(key);
    }

    public bringNodeIntoView(nodeKey: string): void {
        const nodeData = this.nodes.get(nodeKey);
        const nodeIndicator = this.nodeIndicators.get(nodeKey);

        if (!nodeData || !nodeIndicator) return;

        const CAM_HEIGHT = 120; // meters above the node
        const LOOK_AT_HEIGHT = 0; // node's ground level

        // Use geo coords to place camera correctly on the globe
        // MapViewer.update() handles reorientation automatically
        const geo = nodeData.originalGeoCoords;
        if (geo) {
            const camPos = this.mapViewer.latLonHeightToWorldPosition(geo.lat, geo.lon, CAM_HEIGHT);
            const lookAtPos = this.mapViewer.latLonHeightToWorldPosition(geo.lat, geo.lon, LOOK_AT_HEIGHT);

            if (camPos && lookAtPos) {
                this.camera.position.copy(camPos);
                this.camera.lookAt(lookAtPos);
                this.camera.updateMatrixWorld();
                return;
            }
        }

        // Fallback
        const targetPosition = nodeIndicator.mesh.position.clone();
        this.camera.position.copy(targetPosition.clone().setY(targetPosition.y + CAM_HEIGHT));
        this.camera.lookAt(targetPosition);
        this.camera.updateMatrixWorld();
    }

    private handleReorient(deltaMatrix: Matrix4): void {
        // Transform camera so it stays in the correct position after reorientation
        this.camera.position.applyMatrix4(deltaMatrix);
        this.camera.updateMatrixWorld();

        // Recalculate all node positions from geo coords (authoritative source)
        // This is more reliable than delta matrix transform for editor nodes
        for (const [nodeKey, nodeData] of this.nodes) {
            if (nodeData.originalGeoCoords) {
                const newOrigPos = this.mapViewer.latLonHeightToWorldPosition(
                    nodeData.originalGeoCoords.lat, nodeData.originalGeoCoords.lon, 0
                );
                if (newOrigPos) {
                    nodeData.originalPosition.copy(newOrigPos);
                }

                const newPos = applyENUOffset(nodeData.originalGeoCoords, nodeData.world_offset, this.mapViewer);
                if (newPos) {
                    nodeData.position.copy(newPos);
                    const indicator = this.nodeIndicators.get(nodeKey);
                    if (indicator) {
                        indicator.mesh.position.copy(newPos);
                    }
                }
            }
        }
    }

    public applyPatchData(patchData: PatchData[]): void {
        for (const patch of patchData) {
            const nodeKey = `${patch.segment_id}-${patch.point_index}`;
            const nodeData = this.nodes.get(nodeKey);
            const nodeIndicator = this.nodeIndicators.get(nodeKey);

            if (nodeData && nodeIndicator) {
                const [offsetX, offsetY, offsetZ] = patch.world_offset;

                // Apply the saved world offsets
                nodeData.world_offset.set(offsetX, offsetY, offsetZ);
                nodeData.isKeyNode = patch.keynode;

                // Use cached geo coordinates to avoid repeated conversions and precision loss
                const newPosition = applyENUOffset(nodeData.originalGeoCoords!, nodeData.world_offset, this.mapViewer);

                if (newPosition) {
                    nodeData.position.copy(newPosition);
                    nodeIndicator.mesh.position.copy(newPosition);

                    // Update mode if it's a key node
                    if (nodeData.isKeyNode) {
                        nodeIndicator.setMode('keyNode');
                    }
                }
            }
        }

        console.log(`Applied ${patchData.length} patch offsets`);
    }

    private handleNodeTransform(): void {
        if (this.selectedNodes.size === 0) return;

        if (this.selectedNodes.size === 1) {
            const key = this.selectedNodes.values().next().value!;
            const nodeIndicator = this.nodeIndicators.get(key);
            const nodeData = this.nodes.get(key);
            if (!nodeIndicator || !nodeData) return;
            nodeData.position.copy(nodeIndicator.mesh.position);
            this.updateNodeWorldOffset(nodeData, nodeIndicator.mesh.position);
            this.interpolateBetweenKeyNodes(key);
            this.emitSelection();
            this.notifyModification();
            return;
        }

        // Multi-select: read the drag in the gizmo's local handle frame, then
        // re-orient that delta into each node's own rotation before applying.
        // Pulling the red handle by 5 m means "move each node 5 m along its
        // own +X (rail-perpendicular)" — exactly what the single-node gizmo
        // does. Different rail orientations therefore yield different world
        // displacements per node, all from the same gizmo drag.
        const worldDelta = new Vector3().subVectors(this.selectionAnchor.position, this.lastAnchorPosition);
        if (worldDelta.lengthSq() === 0) return;
        const gizmoLocalDelta = worldDelta.clone().applyQuaternion(this.selectionAnchor.quaternion.clone().invert());
        for (const key of this.selectedNodes) {
            const nodeData = this.nodes.get(key);
            const nodeIndicator = this.nodeIndicators.get(key);
            if (!nodeData || !nodeIndicator || !nodeData.originalGeoCoords) continue;
            const worldDeltaForNode = gizmoLocalDelta.clone().applyQuaternion(nodeIndicator.mesh.quaternion);
            const newPos = nodeData.position.clone().add(worldDeltaForNode);
            nodeData.position.copy(newPos);
            nodeIndicator.mesh.position.copy(newPos);
            this.updateNodeWorldOffset(nodeData, newPos);
        }
        this.lastAnchorPosition.copy(this.selectionAnchor.position);
        for (const key of this.selectedNodes) this.interpolateBetweenKeyNodes(key);
        this.emitSelection();
        this.notifyModification();
    }

    private updateNodeWorldOffset(nodeData: NodeData, position: Vector3): void {
        const geoCoords = this.mapViewer.getLatLonHeightFromWorldPosition(position);

        // Use cached original geo coords to avoid repeated conversions and precision loss
        if (geoCoords && nodeData.originalGeoCoords) {
            const offset = geoToENU(geoCoords, nodeData.originalGeoCoords);
            nodeData.world_offset.copy(offset);
        }
    }

    private interpolateBetweenKeyNodes(changedNodeKey: string): void {
        this.rebuildSegmentsAroundNode(changedNodeKey);
    }

    // Lerp `world_offset` across `intermediates` between `startKey` and `endKey`, weighted by arc length.
    private lerpAlongChain(startKey: string, endKey: string, intermediates: string[]): void {
        const startNode = this.nodes.get(startKey);
        const endNode = this.nodes.get(endKey);
        if (!startNode || !endNode || intermediates.length === 0) return;

        const seq = [startKey, ...intermediates, endKey];
        const distances: number[] = [0];
        let total = 0;
        for (let i = 1; i < seq.length; i++) {
            const a = this.nodes.get(seq[i - 1])?.originalPosition;
            const b = this.nodes.get(seq[i])?.originalPosition;
            if (!a || !b) return;
            total += a.distanceTo(b);
            distances.push(total);
        }
        if (total <= 0) return;

        for (let i = 1; i < seq.length - 1; i++) {
            const t = distances[i] / total;
            const newOffset = new Vector3().lerpVectors(startNode.world_offset, endNode.world_offset, t);
            this.applyOffsetToNode(seq[i], newOffset);
        }
    }

    private notifyModification(): void {
        if (this.onNodesModified) {
            const modifiedNodes = this.getModifiedNodes();
            this.onNodesModified(modifiedNodes);
        }
    }

    private pushUndoState(): void {
        const state: UndoState = new Map();

        for (const [key, nodeData] of this.nodes) {
            state.set(key, {
                position: nodeData.position.clone(),
                world_offset: nodeData.world_offset.clone(),
                isKeyNode: nodeData.isKeyNode,
            });
        }

        this.undoStack.push(state);

        // Limit stack size
        if (this.undoStack.length > this.maxUndoStates) {
            this.undoStack.shift();
        }
    }

    public undo(): boolean {
        if (this.undoStack.length === 0) return false;

        const state = this.undoStack.pop()!;

        for (const [key, snapshot] of state) {
            const nodeData = this.nodes.get(key);
            const nodeIndicator = this.nodeIndicators.get(key);

            if (nodeData && nodeIndicator) {
                nodeData.position.copy(snapshot.position);
                nodeData.world_offset.copy(snapshot.world_offset);
                nodeData.isKeyNode = snapshot.isKeyNode;

                nodeIndicator.mesh.position.copy(snapshot.position);

                const isSelected = this.selectedNodes.has(key);
                if (isSelected) {
                    nodeIndicator.setMode('selected');
                } else if (nodeData.isKeyNode) {
                    nodeIndicator.setMode('keyNode');
                } else if (nodeData.isStationNode) {
                    nodeIndicator.setMode('station');
                } else {
                    nodeIndicator.setMode('normal');
                }
            }
        }

        if (this.selectedNodes.size > 0) {
            this.attachTransformControls();
            this.emitSelection();
        }

        this.notifyModification();
        return true;
    }

    public update(dt: number = 0): void {
        if (Input.isPressed('KeyZ') && Input.isControl) {
            this.undo();
        }

        // Press F to frame/focus the (single) selected node (like Unity)
        if (Input.isPressed('KeyF') && this.selectedNodes.size === 1) {
            const key = this.selectedNodes.values().next().value!;
            this.bringNodeIntoView(key);
        }

        // Press K to toggle keynode for the entire selection.
        if (Input.isPressed('KeyK') && this.selectedNodes.size > 0) {
            const allKey = this.getSelectedNodes().every(n => n.isKeyNode);
            this.setKeyNodeForSelection(!allKey);
        }

        // Press R to snap every selected node to the terrain underneath.
        if (Input.isPressed('KeyR') && this.selectedNodes.size > 0) {
            this.autoHeightSelection();
        }

        // Animate station beams
        this.stationTime += dt;
        for (const mat of this.stationBeamMaterials) {
            mat.uniforms.uTime.value = this.stationTime;
        }
    }

    public clear(): void {
        // Dispose node indicators
        for (const indicator of this.nodeIndicators.values()) {
            indicator.dispose();
        }

        for (const mat of this.stationBeamMaterials) {
            mat.dispose();
        }
        this.stationBeamMaterials = [];
        this.stationTime = 0;

        this.nodes.clear();
        this.nodeIndicators.clear();
        this.offsetIndicators.clear();
        this.routeGroup.clear();
        this.transformControls.detach();
        this.selectedNodes.clear();
    }

    public cleanup(): void {
        this.clear();
        this.scene.remove(this.routeGroup);
        this.scene.remove(this.selectionAnchor);
        this.scene.remove(this.transformControls.getHelper());
        this.transformControls.dispose();
        this.removeReorientListener?.();
        this.removeReorientListener = null;

        // Only dispose shared resources when completely done with ALL RouteEditor instances
        // NodeIndicator.disposeSharedResources();
    }
}
