import {
    Scene,
    Camera,
    Mesh,
    ConeGeometry,
    MeshBasicMaterial,
    Group,
    Vector3,
    Raycaster,
    GreaterDepth,
    CylinderGeometry,
    LineBasicMaterial,
    BufferGeometry,
    Line,
} from 'three';
import { TransformControls } from 'three/addons/controls/TransformControls.js';
import type { RouteData } from '../Georail';
import type { MapViewer } from '../MapViewer';
import type { PatchData } from '../types/Patch';
import { Input } from '../utils/Input';
import { DEG2RAD } from 'three/src/math/MathUtils.js';

// WGS84 ellipsoid constants for more accurate conversion
// These provide better precision than simple approximations
const METERS_PER_DEGREE_LAT = 111319.49079327358; // More precise value at equator

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
    private nodeMeshes: Map<string, Mesh> = new Map();
    private transformControls: TransformControls;
    private selectedNode: string | null = null;
    private reviewMode: boolean = false;
    private offsetIndicators: Map<string, Mesh> = new Map();

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

        // Create base geometry - cone pointing up along +Y
        const baseConeGeometry = new ConeGeometry(2, 4, 4);

        // Rotate geometry so cone points down (-Y) but local Z points forward (+Z)
        // This way the mesh's local coordinate system has Z pointing in the "forward" direction
        baseConeGeometry.rotateX(Math.PI); // Flip to point down
        baseConeGeometry.rotateY(Math.PI / 4); // Rotate to align with forward direction

        const normalMaterial = new MeshBasicMaterial({ color: 0x00ff00, wireframe: false });
        const keyNodeMaterial = new MeshBasicMaterial({ color: 0xff0000, wireframe: false });

        // Material for x-ray overlay - pink, 50% transparent, only renders when behind geometry
        const xrayMaterial = new MeshBasicMaterial({
            color: 0xff69b4,
            transparent: true,
            opacity: 0.8,
            depthFunc: GreaterDepth,
            depthWrite: false,
        });

        // Store meshes in order for orientation calculation
        const orderedMeshes: Mesh[] = [];

        // Process each point using both route and editor arrays
        routeData.geometry.route.forEach((routePoint: number[], idx: number) => {
            const editorPoint = routeData.geometry.editor![idx];

            // routePoint is [lon, lat, world_offset_x, world_offset_y, world_offset_z]
            const [lon, lat, world_offset_x, world_offset_y, world_offset_z] = routePoint;
            const { segment_id, index } = editorPoint;

            // Create unique key
            const nodeKey = `${segment_id}-${index}`;

            // Store original position at altitude 0
            const originalPosition = this.mapViewer.latLonHeightToWorldPosition(lat, lon, 0);

            if (!originalPosition) {
                console.warn(`Failed to convert coordinates for node ${nodeKey}`);
                return;
            }

            // Store world offset
            const worldOffset = new Vector3(world_offset_x, world_offset_y, world_offset_z);

            // Apply world offset to get actual position
            const origGeoCoords = this.mapViewer.getLatLonHeightFromWorldPosition(originalPosition);
            if (!origGeoCoords) {
                console.warn(`Failed to get geo coords for node ${nodeKey}`);
                return;
            }

            const position = this.applyENUOffset(origGeoCoords, worldOffset);
            if (!position) {
                console.warn(`Failed to apply offset for node ${nodeKey}`);
                return;
            }

            // Create node data with cached geo coordinates
            const nodeData: NodeData = {
                segment_id,
                index,
                world_offset: worldOffset.clone(),
                originalWorldOffset: worldOffset.clone(),
                isKeyNode: false, // Will be set by applyPatchData
                position: position.clone(),
                originalPosition: originalPosition.clone(),
                originalGeoCoords: origGeoCoords, // Cache to avoid repeated conversions
            };

            this.nodes.set(nodeKey, nodeData);

            // Create pyramid mesh - geometry is already rotated to point down
            const mesh = new Mesh(baseConeGeometry, normalMaterial);
            mesh.position.copy(position);
            mesh.name = nodeKey;
            mesh.userData.nodeKey = nodeKey;

            // Add x-ray overlay mesh as child (renders through geometry)
            const xrayMesh = new Mesh(baseConeGeometry, xrayMaterial);
            xrayMesh.renderOrder = -1; // Render before main mesh
            mesh.add(xrayMesh);

            this.nodeMeshes.set(nodeKey, mesh);
            this.routeGroup.add(mesh);
            orderedMeshes.push(mesh);

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
            const prevMesh = this.nodeMeshes.get(this.selectedNode);
            const prevData = this.nodes.get(this.selectedNode);
            if (prevMesh && prevData) {
                const mat = prevData.isKeyNode
                    ? new MeshBasicMaterial({ color: 0xff0000, wireframe: false })
                    : new MeshBasicMaterial({ color: 0x00ff00, wireframe: false });
                prevMesh.material = mat;
            }
        }

        this.selectedNode = nodeKey;

        if (nodeKey) {
            const mesh = this.nodeMeshes.get(nodeKey);
            const nodeData = this.nodes.get(nodeKey);

            if (mesh && nodeData) {
                // Highlight selected node
                mesh.material = new MeshBasicMaterial({ color: 0xffff00, wireframe: false });

                // Attach transform controls
                this.transformControls.attach(mesh);

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
        const mesh = this.nodeMeshes.get(nodeKey);

        if (nodeData && mesh) {
            nodeData.isKeyNode = !nodeData.isKeyNode;

            // Update material
            const mat = nodeData.isKeyNode
                ? new MeshBasicMaterial({ color: 0xff0000, wireframe: false })
                : new MeshBasicMaterial({ color: 0x00ff00, wireframe: false });

            if (nodeKey === this.selectedNode) {
                mat.color.setHex(0xffff00);
            }

            mesh.material = mat;

            this.notifyModification();
        }
    }

    public raycastNodes(raycaster: Raycaster): string | null {
        const meshArray = Array.from(this.nodeMeshes.values());

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

    public getAllNodes(): NodeData[] {
        return Array.from(this.nodes.values());
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
        const mesh = this.nodeMeshes.get(nodeKey);

        if (!nodeData || !mesh) return;

        // Get the node's world position
        const targetPosition = mesh.position.clone();

        // Calculate an offset position for the camera (angled view like Unity's F key)
        // Position camera at an angle: behind and above the node
        const heightOffset = 30; // meters above the node
        const backwardOffset = 40; // meters behind the node

        // Create camera position offset
        const cameraPosition = targetPosition.clone();
        cameraPosition.y += heightOffset;
        cameraPosition.z -= backwardOffset; // Move camera back (assuming Z is forward/backward)

        // Smoothly move camera to the new position
        this.camera.position.copy(cameraPosition);

        // Look at the node (slightly above it for better view)
        const lookAtTarget = targetPosition.clone();
        lookAtTarget.y += 5; // Look at a point slightly above the node
        this.camera.lookAt(lookAtTarget);

        // Update camera matrix
        this.camera.updateMatrixWorld();
    }

    public applyPatchData(patchData: PatchData[]): void {
        for (const patch of patchData) {
            const nodeKey = `${patch.segment_id}-${patch.point_index}`;
            const nodeData = this.nodes.get(nodeKey);
            const mesh = this.nodeMeshes.get(nodeKey);

            if (nodeData && mesh) {
                const [offsetX, offsetY, offsetZ] = patch.world_offset;

                // Apply the saved world offsets
                nodeData.world_offset.set(offsetX, offsetY, offsetZ);
                nodeData.isKeyNode = patch.keynode;

                // Use cached geo coordinates to avoid repeated conversions and precision loss
                const newPosition = this.applyENUOffset(nodeData.originalGeoCoords!, nodeData.world_offset);

                if (newPosition) {
                    nodeData.position.copy(newPosition);
                    mesh.position.copy(newPosition);

                    // Update material if it's a key node
                    if (nodeData.isKeyNode) {
                        mesh.material = new MeshBasicMaterial({ color: 0xff0000, wireframe: false });
                    }
                }
            }
        }

        console.log(`Applied ${patchData.length} patch offsets`);
    }

    private handleNodeTransform(): void {
        if (!this.selectedNode) return;

        const mesh = this.nodeMeshes.get(this.selectedNode);
        const nodeData = this.nodes.get(this.selectedNode);

        if (mesh && nodeData) {
            // Update node data with new position
            nodeData.position.copy(mesh.position);

            // Convert world position back to geographic coordinates to update world_offset
            this.updateNodeWorldOffset(nodeData, mesh.position);

            // Auto-mark as key node when manually moved
            if (!nodeData.isKeyNode) {
                nodeData.isKeyNode = true;
                // Update material to red (key node color)
                mesh.material = new MeshBasicMaterial({ color: 0xffff00, wireframe: false }); // Yellow for selected
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
            const offset = this.geoToENU(geoCoords, nodeData.originalGeoCoords);
            nodeData.world_offset.copy(offset);
        }
    }

    private geoToENU(geoCoords: { lat: number; lon: number; height: number }, origGeoCoords: { lat: number; lon: number; height: number }): Vector3 {
        const metersPerDegreeLon = METERS_PER_DEGREE_LAT * Math.cos(origGeoCoords.lat * DEG2RAD);

        const east = (geoCoords.lon - origGeoCoords.lon) * metersPerDegreeLon;
        const north = (geoCoords.lat - origGeoCoords.lat) * METERS_PER_DEGREE_LAT;
        const up = geoCoords.height - origGeoCoords.height;

        return new Vector3(east, up, north);
    }

    private applyENUOffset(origGeoCoords: { lat: number; lon: number; height: number }, offset: Vector3): Vector3 | null {
        const metersPerDegreeLon = METERS_PER_DEGREE_LAT * Math.cos(origGeoCoords.lat * DEG2RAD);

        const newLat = origGeoCoords.lat + (offset.z / METERS_PER_DEGREE_LAT);
        const newLon = origGeoCoords.lon + (offset.x / metersPerDegreeLon);
        const newHeight = origGeoCoords.height + offset.y;

        return this.mapViewer.latLonHeightToWorldPosition(newLat, newLon, newHeight);
    }

    private interpolateBetweenKeyNodes(changedNodeKey: string): void {
        // Get ordered list of node keys
        const nodeKeys = Array.from(this.nodes.keys());
        const changedIndex = nodeKeys.indexOf(changedNodeKey);

        if (changedIndex === -1) return;

        // Find previous key node
        let prevKeyIndex = -1;
        for (let i = changedIndex - 1; i >= 0; i--) {
            const node = this.nodes.get(nodeKeys[i]);
            if (node?.isKeyNode) {
                prevKeyIndex = i;
                break;
            }
        }

        // Find next key node
        let nextKeyIndex = -1;
        for (let i = changedIndex + 1; i < nodeKeys.length; i++) {
            const node = this.nodes.get(nodeKeys[i]);
            if (node?.isKeyNode) {
                nextKeyIndex = i;
                break;
            }
        }

        // Interpolate nodes between previous key node and this one
        if (prevKeyIndex !== -1 && prevKeyIndex < changedIndex - 1) {
            this.lerpNodesBetween(prevKeyIndex, changedIndex, nodeKeys);
        }

        // Interpolate nodes between this one and next key node
        if (nextKeyIndex !== -1 && nextKeyIndex > changedIndex + 1) {
            this.lerpNodesBetween(changedIndex, nextKeyIndex, nodeKeys);
        }
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
            const mesh = this.nodeMeshes.get(nodeKey);

            if (!nodeData || !mesh) continue;

            // Calculate t based on distance ratio
            const distanceIndex = i - startIndex;
            const t = totalDistance > 0 ? distances[distanceIndex] / totalDistance : 0;

            // Lerp the world_offset values
            const newOffset = new Vector3().lerpVectors(startNode.world_offset, endNode.world_offset, t);
            nodeData.world_offset.copy(newOffset);

            // Apply the interpolated offset using cached geo coords to avoid precision loss
            if (nodeData.originalGeoCoords) {
                const newPosition = this.applyENUOffset(nodeData.originalGeoCoords, newOffset);
                if (newPosition) {
                    mesh.position.copy(newPosition);
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
            const mesh = this.nodeMeshes.get(key);

            if (nodeData && mesh) {
                nodeData.position.copy(snapshot.position);
                nodeData.world_offset.copy(snapshot.world_offset);
                nodeData.isKeyNode = snapshot.isKeyNode;

                mesh.position.copy(snapshot.position);

                const isSelected = key === this.selectedNode;
                if (isSelected) {
                    mesh.material = new MeshBasicMaterial({ color: 0xffff00, wireframe: false });
                } else if (nodeData.isKeyNode) {
                    mesh.material = new MeshBasicMaterial({ color: 0xff0000, wireframe: false });
                } else {
                    mesh.material = new MeshBasicMaterial({ color: 0x00ff00, wireframe: false });
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

    public update(): void {
        if (Input.isPressed('KeyZ') && Input.isControl) {
            this.undo();
        }
    }

    public clear(): void {
        this.nodes.clear();
        this.nodeMeshes.clear();
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
    }
}
