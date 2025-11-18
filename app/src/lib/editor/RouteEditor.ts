import {
    Scene,
    Camera,
    Mesh,
    ConeGeometry,
    MeshBasicMaterial,
    Group,
    Vector3,
    Raycaster,
} from 'three';
import { TransformControls, TransformControlsPlane } from 'three/addons/controls/TransformControls.js';
import type { RouteData, EditorPoint } from '../Georail';
import type { MapViewer } from '../MapViewer';

export interface NodeData {
    segment_id: number;
    index: number;
    height: number;
    lateral_offset: number;
    is_reversed: boolean;
    isKeyNode: boolean;
    position: Vector3;
    originalPosition: Vector3;
    isDirty: boolean;
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

    // Callbacks
    public onNodeSelected: ((nodeData: NodeData | null) => void) | null = null;
    public onNodesModified: ((nodes: NodeData[]) => void) | null = null;

    constructor(scene: Scene, camera: Camera, domElement: HTMLElement, mapViewer: MapViewer) {
        this.scene = scene;
        this.camera = camera;
        this.domElement = domElement;
        this.mapViewer = mapViewer;

        this.routeGroup = new Group();
        this.routeGroup.name = 'RouteEditorGroup';
        this.scene.add(this.routeGroup);

        // Setup TransformControls
        this.transformControls = new TransformControls(camera, domElement);
        this.transformControls.addEventListener('dragging-changed', (event) => {
            // Disable camera controls while dragging
            this.domElement.dispatchEvent(new CustomEvent('transform-dragging', { detail: event.value }));
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

        const pyramidGeometry = new ConeGeometry(2, 4, 4); // Larger: 2m radius, 4m height
        const normalMaterial = new MeshBasicMaterial({ color: 0x00ff00, wireframe: false });
        const keyNodeMaterial = new MeshBasicMaterial({ color: 0xff0000, wireframe: false });

        // Process each point using both route and editor arrays
        routeData.geometry.route.forEach((routePoint: number[], idx: number) => {
            const editorPoint = routeData.geometry.editor![idx];

            // routePoint is [lon, lat, height, lateral_offset]
            const [lon, lat, height, lateral_offset] = routePoint;
            const { segment_id, index, is_reversed } = editorPoint;

            // Create unique key
            const nodeKey = `${segment_id}-${index}`;

            // Convert geographic coordinates to 3D world position
            const position = this.mapViewer.latLonHeightToWorldPosition(lat, lon, height);

            if (!position) {
                console.warn(`Failed to convert coordinates for node ${nodeKey}`);
                return;
            }

            // Create node data
            const nodeData: NodeData = {
                segment_id,
                index,
                height,
                lateral_offset,
                is_reversed,
                isKeyNode: false, // TODO: Load from patch data
                position: position.clone(),
                originalPosition: position.clone(),
                isDirty: false,
            };

            this.nodes.set(nodeKey, nodeData);

            // Create pyramid mesh (upside down)
            const mesh = new Mesh(pyramidGeometry, normalMaterial);
            mesh.position.copy(position);
            mesh.rotation.x = Math.PI; // Flip upside down
            mesh.name = nodeKey;
            mesh.userData.nodeKey = nodeKey;

            this.nodeMeshes.set(nodeKey, mesh);
            this.routeGroup.add(mesh);

            // Debug first and last node positions
            if (idx === 0) {
                console.log('First node position (world):', position);
                console.log('First node geo coords:', { lat, lon, height });
            }
            if (idx === routeData.geometry.route.length - 1) {
                console.log('Last node position (world):', position);
                console.log('Last node geo coords:', { lat, lon, height });
            }
        });

        console.log(`Loaded ${this.nodes.size} nodes for route editing`);
        console.log('Route group position:', this.routeGroup.position);
        console.log('Route group world matrix:', this.routeGroup.matrixWorld);
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
            }
        } else {
            this.transformControls.detach();
            if (this.onNodeSelected) {
                this.onNodeSelected(null);
            }
        }
    }

    public toggleKeyNode(nodeKey: string): void {
        const nodeData = this.nodes.get(nodeKey);
        const mesh = this.nodeMeshes.get(nodeKey);

        if (nodeData && mesh) {
            nodeData.isKeyNode = !nodeData.isKeyNode;
            nodeData.isDirty = true;

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
        return Array.from(this.nodes.values()).filter(node => node.isDirty);
    }

    public getAllNodes(): NodeData[] {
        return Array.from(this.nodes.values());
    }

    private handleNodeTransform(): void {
        if (!this.selectedNode) return;

        const mesh = this.nodeMeshes.get(this.selectedNode);
        const nodeData = this.nodes.get(this.selectedNode);

        if (mesh && nodeData) {
            // Update node data with new position
            nodeData.position.copy(mesh.position);

            // Convert world position back to geographic coordinates
            const geoCoords = this.mapViewer.getLatLonHeightFromWorldPosition(mesh.position);
            if (geoCoords) {
                nodeData.height = geoCoords.height;
            }

            nodeData.isDirty = true;

            this.notifyModification();
        }
    }

    private notifyModification(): void {
        if (this.onNodesModified) {
            const modifiedNodes = this.getModifiedNodes();
            this.onNodesModified(modifiedNodes);
        }
    }

    public clear(): void {
        this.nodes.clear();
        this.nodeMeshes.clear();
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
