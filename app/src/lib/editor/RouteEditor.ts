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
    private transformControls: TransformControls;
    private selectedNode: string | null = null;
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
    public onNodesModified: ((nodes: NodeData[]) => void) | null = null;
    public onNodeIndexChanged: ((currentIndex: number, totalNodes: number) => void) | null = null;

    constructor(scene: Scene, camera: Camera, domElement: HTMLElement, mapViewer: MapViewer, reviewMode: boolean = false) {
        this.scene = scene;
        this.camera = camera;
        this.domElement = domElement;
        this.mapViewer = mapViewer;
        this.reviewMode = reviewMode;

        this.routeGroup = new Group();
        this.routeGroup.name = 'RouteEditorGroup';
        this.scene.add(this.routeGroup);

        // Register for automatic reorientation
        this.mapViewer.onReorient = (delta) => this.handleReorient(delta);

        // Setup TransformControls (disabled in review mode)
        this.transformControls = new TransformControls(camera, domElement);
        this.transformControls.enabled = !reviewMode;

        // Set to 'local' space so controls align with mesh rotation
        this.transformControls.setSpace('local');

        // Lock Z-axis - only allow X and Y translation (local Z now follows mesh orientation)
        this.transformControls.showZ = false;

        this.transformControls.addEventListener('dragging-changed', (event) => {
            // Disable camera controls while dragging
            this.domElement.dispatchEvent(new CustomEvent('transform-dragging', { detail: event.value }));

            // Capture state at start of drag for undo
            if (event.value && !this.isDragging) {
                this.isDragging = true;
                this.pushUndoState();
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
        // The cone geometry itself is already pointing down, we just rotate the mesh
        const MIN_DISTANCE_THRESHOLD = 0.1; // Minimum distance (in meters) to calculate orientation

        for (let i = 0; i < orderedMeshes.length; i++) {
            const mesh = orderedMeshes[i];

            if (i < orderedMeshes.length - 1) {
                const nextMesh = orderedMeshes[i + 1];
                const distance = mesh.position.distanceTo(nextMesh.position);

                // If nodes are too close together, copy rotation from previous node
                if (distance < MIN_DISTANCE_THRESHOLD && i > 0) {
                    mesh.rotation.copy(orderedMeshes[i - 1].rotation);
                } else if (distance >= MIN_DISTANCE_THRESHOLD) {
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
                } else {
                    // First node and too close to next - keep default orientation (pointing down)
                    // No rotation needed as geometry is already oriented correctly
                }
            } else {
                // Last node: copy rotation from previous node
                if (i > 0) {
                    mesh.rotation.copy(orderedMeshes[i - 1].rotation);
                }
            }
        }

        console.log(`Loaded ${this.nodes.size} nodes for route editing`);
        console.log('Route group position:', this.routeGroup.position);
        console.log('Route group world matrix:', this.routeGroup.matrixWorld);

        // Initialize slider with total node count (no selection yet)
        if (this.onNodeIndexChanged) {
            this.onNodeIndexChanged(-1, this.nodes.size);
        }
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
        if (nodeKey === this.selectedNode) return;

        // Deselect previous
        if (this.selectedNode) {
            const prevIndicator = this.nodeIndicators.get(this.selectedNode);
            const prevData = this.nodes.get(this.selectedNode);
            if (prevIndicator && prevData) {
                const mode = prevData.isKeyNode ? 'keyNode' : prevData.isStationNode ? 'station' : 'normal';
                prevIndicator.setMode(mode);
            }
        }

        this.selectedNode = nodeKey;

        if (nodeKey) {
            const nodeIndicator = this.nodeIndicators.get(nodeKey);
            const nodeData = this.nodes.get(nodeKey);

            if (nodeIndicator && nodeData) {
                // Highlight selected node
                nodeIndicator.setMode('selected');

                // Attach transform controls — show Z axis (along track) for station nodes
                this.transformControls.showZ = nodeData.isStationNode;
                this.transformControls.attach(nodeIndicator.mesh);

                // Notify callback
                if (this.onNodeSelected) {
                    this.onNodeSelected(nodeData);
                }

                // Notify node index changed
                if (this.onNodeIndexChanged) {
                    const nodeKeys = Array.from(this.nodes.keys());
                    const currentIndex = nodeKeys.indexOf(nodeKey);
                    this.onNodeIndexChanged(currentIndex, nodeKeys.length);
                }
            }
        } else {
            this.transformControls.showZ = false;
            this.transformControls.detach();
            if (this.onNodeSelected) {
                this.onNodeSelected(null);
            }
            if (this.onNodeIndexChanged) {
                this.onNodeIndexChanged(-1, this.nodes.size);
            }
        }
    }

    public toggleKeyNode(nodeKey: string): void {
        const nodeData = this.nodes.get(nodeKey);
        const nodeIndicator = this.nodeIndicators.get(nodeKey);

        if (nodeData && nodeIndicator) {
            nodeData.isKeyNode = !nodeData.isKeyNode;

            // Update mode - selected nodes stay selected
            if (nodeKey === this.selectedNode) {
                nodeIndicator.setMode('selected');
            } else {
                const mode = nodeData.isKeyNode ? 'keyNode' : nodeData.isStationNode ? 'station' : 'normal';
                nodeIndicator.setMode(mode);
            }

            this.rebuildSegmentsAroundNode(nodeKey);
            this.notifyModification();
        }
    }

    public autoHeightNode(nodeKey: string): boolean {
        const nodeData = this.nodes.get(nodeKey);
        const nodeIndicator = this.nodeIndicators.get(nodeKey);
        if (!nodeData || !nodeIndicator || !nodeData.originalGeoCoords) return false;

        const tilesGroup = (this.mapViewer as any).tiles?.group;
        if (!tilesGroup) return false;

        const origin = nodeData.position.clone();
        origin.y += 100;
        const direction = new Vector3(0, -1, 0);

        const raycaster = new Raycaster(origin, direction, 0, 500);
        const intersects = raycaster.intersectObject(tilesGroup, true);

        const terrainHit = intersects[0];
        if (!terrainHit) return false;

        this.pushUndoState();

        const dy = terrainHit.point.y - nodeData.originalPosition.y;
        nodeData.world_offset.y = dy;

        const newPos = applyENUOffset(nodeData.originalGeoCoords, nodeData.world_offset, this.mapViewer);
        if (newPos) {
            nodeData.position.copy(newPos);
            nodeIndicator.mesh.position.copy(newPos);
        }

        if (!nodeData.isKeyNode) {
            nodeData.isKeyNode = true;
            if (this.selectedNode === nodeKey) {
                nodeIndicator.setMode('selected');
            } else {
                nodeIndicator.setMode('keyNode');
            }
        }

        this.interpolateBetweenKeyNodes(nodeKey);

        if (this.onNodeSelected && nodeKey === this.selectedNode) {
            this.onNodeSelected({
                ...nodeData,
                world_offset: nodeData.world_offset.clone(),
            });
        }
        this.notifyModification();
        return true;
    }

    // Lerps only the segments adjacent to `nodeKey` and extends to the route
    // endpoints only when `nodeKey` is the first or last key — no full-route scan.
    private rebuildSegmentsAroundNode(nodeKey: string): void {
        const nodeKeys = Array.from(this.nodes.keys());
        const idx = nodeKeys.indexOf(nodeKey);
        if (idx === -1) return;

        let prev = -1;
        for (let i = idx - 1; i >= 0; i--) {
            if (this.nodes.get(nodeKeys[i])?.isKeyNode) { prev = i; break; }
        }
        let next = -1;
        for (let i = idx + 1; i < nodeKeys.length; i++) {
            if (this.nodes.get(nodeKeys[i])?.isKeyNode) { next = i; break; }
        }

        const node = this.nodes.get(nodeKey);
        if (!node) return;

        if (node.isKeyNode) {
            if (prev !== -1 && prev < idx - 1) this.lerpNodesBetween(prev, idx, nodeKeys);
            if (next !== -1 && next > idx + 1) this.lerpNodesBetween(idx, next, nodeKeys);

            if (prev === -1 && idx > 0) {
                for (let i = 0; i < idx; i++) this.applyOffsetToNode(nodeKeys[i], node.world_offset);
            }
            if (next === -1 && idx < nodeKeys.length - 1) {
                for (let i = idx + 1; i < nodeKeys.length; i++) this.applyOffsetToNode(nodeKeys[i], node.world_offset);
            }
            return;
        }

        if (prev !== -1 && next !== -1) {
            this.lerpNodesBetween(prev, next, nodeKeys);
        } else if (prev !== -1) {
            const prevOffset = this.nodes.get(nodeKeys[prev])!.world_offset;
            for (let i = prev + 1; i < nodeKeys.length; i++) this.applyOffsetToNode(nodeKeys[i], prevOffset);
        } else if (next !== -1) {
            const nextOffset = this.nodes.get(nodeKeys[next])!.world_offset;
            for (let i = 0; i < next; i++) this.applyOffsetToNode(nodeKeys[i], nextOffset);
        }
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
        // Raycast against the transform controls to see if they were clicked
        const helper = this.transformControls.getHelper();
        let intersects = raycaster.intersectObject(helper, true);

        intersects = intersects.filter(intersect => ((intersect.object as any).isMesh && !(intersect.object as any).isTransformControlsPlane));

        console.log('Transform control intersects:', intersects);

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
        if (!this.selectedNode) return -1;
        const nodeKeys = Array.from(this.nodes.keys());
        return nodeKeys.indexOf(this.selectedNode);
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
        if (!this.selectedNode) return;

        const nodeIndicator = this.nodeIndicators.get(this.selectedNode);
        const nodeData = this.nodes.get(this.selectedNode);

        if (nodeIndicator && nodeData) {
            // Update node data with new position
            nodeData.position.copy(nodeIndicator.mesh.position);

            // Convert world position back to geographic coordinates to update world_offset
            this.updateNodeWorldOffset(nodeData, nodeIndicator.mesh.position);

            // Auto-mark as key node when manually moved
            if (!nodeData.isKeyNode) {
                nodeData.isKeyNode = true;
                // Keep selected mode (yellow) since it's still selected
                nodeIndicator.setMode('selected');
            }

            // Interpolate nodes between key nodes
            this.interpolateBetweenKeyNodes(this.selectedNode);

            // Update UI in real-time by calling onNodeSelected
            // Create a shallow copy to trigger React state update (new reference)
            if (this.onNodeSelected) {
                this.onNodeSelected({
                    ...nodeData,
                    world_offset: nodeData.world_offset.clone(),
                    position: nodeData.position.clone(),
                    originalPosition: nodeData.originalPosition.clone(),
                });
            }

            this.notifyModification();
        }
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

    private lerpNodesBetween(startIndex: number, endIndex: number, nodeKeys: string[]): void {
        const startNode = this.nodes.get(nodeKeys[startIndex]);
        const endNode = this.nodes.get(nodeKeys[endIndex]);

        if (!startNode || !endNode) return;

        // Calculate cumulative distances from start node using original positions
        const distances: number[] = [0];
        let totalDistance = 0;

        for (let i = startIndex + 1; i <= endIndex; i++) {
            const prevNode = this.nodes.get(nodeKeys[i - 1]);
            const currNode = this.nodes.get(nodeKeys[i]);
            if (prevNode && currNode) {
                const dist = prevNode.originalPosition.distanceTo(currNode.originalPosition);
                totalDistance += dist;
                distances.push(totalDistance);
            }
        }

        // Interpolate each node based on its distance ratio
        for (let i = startIndex + 1; i < endIndex; i++) {
            const nodeKey = nodeKeys[i];
            const nodeData = this.nodes.get(nodeKey);
            const nodeIndicator = this.nodeIndicators.get(nodeKey);

            if (!nodeData || !nodeIndicator) continue;

            // Calculate t based on distance ratio
            const distanceIndex = i - startIndex;
            const t = totalDistance > 0 ? distances[distanceIndex] / totalDistance : 0;

            // Lerp the world_offset values
            const newOffset = new Vector3().lerpVectors(startNode.world_offset, endNode.world_offset, t);
            nodeData.world_offset.copy(newOffset);

            // Apply the interpolated offset using cached geo coords to avoid precision loss
            if (nodeData.originalGeoCoords) {
                const newPosition = applyENUOffset(nodeData.originalGeoCoords, newOffset, this.mapViewer);
                if (newPosition) {
                    nodeIndicator.mesh.position.copy(newPosition);
                    nodeData.position.copy(newPosition);
                }
            }
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

                const isSelected = key === this.selectedNode;
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

        if (this.selectedNode && this.onNodeSelected) {
            const nodeData = this.nodes.get(this.selectedNode);
            if (nodeData) {
                this.onNodeSelected({
                    ...nodeData,
                    world_offset: nodeData.world_offset.clone(),
                    position: nodeData.position.clone(),
                    originalPosition: nodeData.originalPosition.clone(),
                });
            }
        }

        this.notifyModification();
        return true;
    }

    public update(dt: number = 0): void {
        if (Input.isPressed('KeyZ') && Input.isControl) {
            this.undo();
        }

        // Press F to frame/focus the selected node (like Unity)
        if (Input.isPressed('KeyF') && this.selectedNode) {
            this.bringNodeIntoView(this.selectedNode);
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
        this.selectedNode = null;
    }

    public cleanup(): void {
        this.clear();
        this.scene.remove(this.routeGroup);
        this.scene.remove(this.transformControls.getHelper());
        this.transformControls.dispose();

        // Only dispose shared resources when completely done with ALL RouteEditor instances
        // NodeIndicator.disposeSharedResources();
    }
}
