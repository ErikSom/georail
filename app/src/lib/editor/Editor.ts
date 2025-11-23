import {
    Scene,
    WebGLRenderer,
    PerspectiveCamera,
    Clock,
    Raycaster,
    Vector3,
    Quaternion,
} from 'three';
import { MapViewer } from '../MapViewer';
import { FlightControls } from '../utils/FlightControls';
import { Input } from '../utils/Input';
import { RouteEditor } from './RouteEditor';
import { fetchRouteByName, type RouteData } from '../Georail';
import { fetchPatchWithData } from '../api/patches';
import type { RouteInfo } from '../types/Patch';

export class Editor {
    private scene!: Scene;
    private camera!: PerspectiveCamera;
    private renderer!: WebGLRenderer;
    private clock!: Clock;

    private flightControls!: FlightControls;
    private mapViewer!: MapViewer;
    private routeEditor: RouteEditor | null = null;
    private raycaster = new Raycaster();

    private rafId: number | null = null;
    private mountElement: HTMLDivElement;
    private setCreditsCallback: (credits: string) => void;

    // Callbacks for patch editing
    public onNodeSelected: ((nodeData: any) => void) | null = null;
    public onNodesModified: ((count: number) => void) | null = null;

    constructor(mountElement: HTMLDivElement, setCreditsCallback: (credits: string) => void) {
        this.mountElement = mountElement;
        this.setCreditsCallback = setCreditsCallback;

        this.animate = this.animate.bind(this);
        this.onWindowResize = this.onWindowResize.bind(this);
    }

    public init(): void {
        this.scene = new Scene();
        this.clock = new Clock();
        this.renderer = new WebGLRenderer({ antialias: true });
        this.renderer.setClearColor(0x151c1f);
        this.renderer.setPixelRatio(window.devicePixelRatio);
        this.renderer.setSize(this.mountElement.clientWidth, this.mountElement.clientHeight);
        this.mountElement.appendChild(this.renderer.domElement);

        this.camera = new PerspectiveCamera(60, this.mountElement.clientWidth / this.mountElement.clientHeight, 1, 1e6);
        this.camera.position.set(1e3, 1e3, 1e3).multiplyScalar(0.5);

        Input.init(this.renderer.domElement);

        this.mapViewer = new MapViewer();
        this.mapViewer.init(this.scene, this.camera, this.renderer);

        this.flightControls = new FlightControls(this.camera, this.renderer.domElement);
        this.flightControls.init();

        window.addEventListener('resize', this.onWindowResize, false);

        this.animate();
    }

    private handleRaycasting(): void {
        // Check for a left-click (button 0) *only* when not in flight mode
        if (Input.isMousePressed(0) && !this.flightControls.controls.isLocked) {

            // 1. Update the raycaster
            this.raycaster.setFromCamera(Input.mouse, this.camera);

            if (this.routeEditor) {
                const nodeKey = this.routeEditor.raycastNodes(this.raycaster);
                if (nodeKey) {
                    this.routeEditor.selectNode(nodeKey);
                    return;
                }

                // Check if we clicked on transform controls
                if (this.routeEditor.isTransformControlClicked(this.raycaster)) {
                    console.log('Clicked on transform controls');
                    return; // Don't deselect if clicking on transform controls
                }

                // If we didn't click a node or transform controls, deselect
                this.routeEditor.selectNode(null);
                return;
            }

            const intersects = this.raycaster.intersectObject(this.scene, true);

            console.log(intersects);

            if (intersects.length) {

                const { face, object } = intersects[0];
                // @ts-ignore
                const batchidAttr = object.geometry.getAttribute('_batchid');

                if (batchidAttr) {

                    // Traverse the parents to find the batch table.
                    let batchTableObject = object;
                    // @ts-ignore
                    while (!batchTableObject.batchTable) {
                        // @ts-ignore
                        batchTableObject = batchTableObject.parent;

                    }

                    // Log the batch data
                    // @ts-ignore
                    const batchTable = batchTableObject.batchTable;
                    // @ts-ignore
                    const hoveredBatchid = batchidAttr.getX(face.a);
                    const batchData = batchTable.getDataFromId(hoveredBatchid);
                    console.log(batchData);

                }

            }

        }
    }


    public async loadPatchRoute(routeInfo: RouteInfo, patchId: number): Promise<void> {
        try {
            // Fetch route data with editor=true to get all points
            const routeData = await fetchRouteByName(
                routeInfo.fromStation,
                routeInfo.fromTrack || null,
                routeInfo.toStation,
                routeInfo.toTrack || null,
                true // editor mode
            );

            // Fetch existing patch data to apply saved offsets
            const patchWithData = await fetchPatchWithData(patchId);

            // Relocate camera to the start of the route before loading nodes
            if (routeData.geometry.route && routeData.geometry.route.length > 0) {
                const [lon, lat, height] = routeData.geometry.route[0];
                this.relocateToPosition(lat, lon, height + 100); // 100m above the start point
            }

            // Create route editor if not exists
            if (!this.routeEditor) {
                this.routeEditor = new RouteEditor(this.scene, this.camera, this.renderer.domElement, this.mapViewer);

                // Wire up callbacks
                this.routeEditor.onNodeSelected = (nodeData) => {
                    if (this.onNodeSelected) {
                        this.onNodeSelected(nodeData);
                    }
                };

                this.routeEditor.onNodesModified = (nodes) => {
                    if (this.onNodesModified) {
                        this.onNodesModified(nodes.length);
                    }
                };
            }

            // Load the route
            this.routeEditor.loadRoute(routeData);

            // Apply saved patch offsets if they exist
            if (patchWithData && patchWithData.data && patchWithData.data.length > 0) {
                this.routeEditor.applyPatchData(patchWithData.data);
            }

            console.log('Route loaded for editing');
        } catch (error) {
            console.error('Failed to load route for editing:', error);
            throw error;
        }
    }

    public clearPatchRoute(): void {
        if (this.routeEditor) {
            this.routeEditor.cleanup();
            this.routeEditor = null;
        }
    }

    public getRouteEditor(): RouteEditor | null {
        return this.routeEditor;
    }

    public relocateToPosition(lat: number, lon: number, height: number): void {
        // Reorient the map to the new location
        this.mapViewer.reorient(lat, lon, height);

        // Convert geographic coordinates to world position for camera placement
        const worldPos = this.mapViewer.latLonHeightToWorldPosition(lat, lon, height);

        if (worldPos) {
            // Position camera at the location
            this.camera.position.copy(worldPos);

            // Look down at the route (point camera down)
            const lookAtPos = this.mapViewer.latLonHeightToWorldPosition(lat, lon, height - 50);
            if (lookAtPos) {
                this.camera.lookAt(lookAtPos);
            }

            this.camera.updateMatrixWorld();
            console.log(`Camera relocated to Lat: ${lat}, Lon: ${lon}, Height: ${height}m`);
        }
    }

    public cleanup(): void {
        if (this.rafId) {
            cancelAnimationFrame(this.rafId);
        }

        window.removeEventListener('resize', this.onWindowResize);

        this.flightControls.cleanup();
        this.mapViewer.cleanup();
        this.clearPatchRoute();
        Input.cleanup();

        this.renderer.dispose();

        if (this.mountElement) {
            this.mountElement.removeChild(this.renderer.domElement);
        }
    }

    private onWindowResize(): void {
        const width = this.mountElement.clientWidth;
        const height = this.mountElement.clientHeight;

        this.camera.aspect = width / height;
        this.renderer.setSize(width, height);
        this.camera.updateProjectionMatrix();
        this.renderer.setPixelRatio(window.devicePixelRatio);
    }

    private animate(): void {
        this.rafId = requestAnimationFrame(this.animate);
        const dt = this.clock.getDelta();

        this.flightControls.update(dt);
        this.camera.updateMatrixWorld();
        this.mapViewer.update();
        this.renderer.render(this.scene, this.camera);

        this.handleRaycasting();

        if (Input.isPressed('KeyT')) {
            // log long lat alt and camera matrix
            const camera = this.camera;
            const wPos = new Vector3();
            const wQuat = new Quaternion();
            camera.getWorldPosition(wPos);
            camera.getWorldQuaternion(wQuat);

            console.log('worldPos', wPos.toArray());
            console.log('worldQuat', [wQuat.x, wQuat.y, wQuat.z, wQuat.w].join(','));
            console.log('order', camera.rotation.order); // e.g. XYZ
        }

        this.setCreditsCallback(this.mapViewer.getCredits());

        Input.update();
    }
}