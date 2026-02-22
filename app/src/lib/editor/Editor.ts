import {
    Scene,
    WebGLRenderer,
    PerspectiveCamera,
    Clock,
    Raycaster,
    SRGBColorSpace,
    NeutralToneMapping,
} from 'three';
import { MapViewer } from '../MapViewer';
import { FlightControls } from '../utils/FlightControls';
import { Input } from '../utils/Input';
import { RouteEditor } from './RouteEditor';
import { fetchJourneyRoute, type RouteData, type JourneyStopInput } from '../api/navigation';
import type { RouteInfo } from '../types/Patch';
import { Sky } from '../Sky';
import type { Tiles3DAttributionCredits } from '../../components/HUD/Tiles3DAttribution';

export class Editor {
    private scene!: Scene;
    private camera!: PerspectiveCamera;
    private renderer!: WebGLRenderer;
    private clock!: Clock;

    private flightControls!: FlightControls;
    private mapViewer!: MapViewer;
    private sky!: Sky;
    private routeEditor: RouteEditor | null = null;
    private raycaster = new Raycaster();

    private rafId: number | null = null;
    private mountElement: HTMLDivElement;
    private setCreditsCallback: (credits: Tiles3DAttributionCredits) => void;

    // Callbacks for patch editing
    public onNodeSelected: ((nodeData: any) => void) | null = null;
    public onNodesModified: ((count: number) => void) | null = null;
    public onNodeIndexChanged: ((currentIndex: number, totalNodes: number) => void) | null = null;

    constructor(mountElement: HTMLDivElement, setCreditsCallback: (credits: Tiles3DAttributionCredits) => void) {
        this.mountElement = mountElement;
        this.setCreditsCallback = setCreditsCallback;

        this.animate = this.animate.bind(this);
        this.onWindowResize = this.onWindowResize.bind(this);
    }

    public init(): void {
        this.scene = new Scene();
        this.clock = new Clock();
        this.renderer = new WebGLRenderer({ antialias: true });
        // Ensure correct color output and a brighter, filmic response.
        this.renderer.outputColorSpace = SRGBColorSpace;
        this.renderer.toneMapping = NeutralToneMapping;
        this.renderer.toneMappingExposure = 1.08;
        this.renderer.setPixelRatio(window.devicePixelRatio);
        this.renderer.setSize(this.mountElement.clientWidth, this.mountElement.clientHeight);
        this.mountElement.appendChild(this.renderer.domElement);

        this.camera = new PerspectiveCamera(60, this.mountElement.clientWidth / this.mountElement.clientHeight, 1, 1e6);
        this.camera.position.set(1e3, 1e3, 1e3).multiplyScalar(0.5);

        Input.init(this.renderer.domElement);

        // Initialize MapViewer but don't call init() yet - wait for patch to load
        this.mapViewer = new MapViewer();

        this.sky = new Sky(this.scene);

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
                    return; // Don't deselect if clicking on transform controls
                }

                // If we didn't click a node or transform controls, deselect
                this.routeEditor.selectNode(null);
                return;
            }

            const intersects = this.raycaster.intersectObject(this.scene, true);

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


    public async loadPatchRoute(routeInfo: RouteInfo, patchId: number, reviewMode: boolean = false): Promise<void> {
        try {
            // Build stops array for journey API using station codes
            const stops: JourneyStopInput[] = [
                routeInfo.fromTrack ? { code: routeInfo.fromStationCode, track: routeInfo.fromTrack } : { code: routeInfo.fromStationCode },
                routeInfo.toTrack ? { code: routeInfo.toStationCode, track: routeInfo.toTrack } : { code: routeInfo.toStationCode }
            ];

            // Fetch route data with editor=true to get all points
            const journeyData = await fetchJourneyRoute(stops, true);

            // Transform to RouteData format for compatibility
            const routeData: RouteData = {
                geometry: journeyData.geometry,
                properties: {
                    stops: [
                        { station: routeInfo.fromStation, code: '', track: routeInfo.fromTrack || null, arrivalTime: 0, departureTime: 0 },
                        { station: routeInfo.toStation, code: '', track: routeInfo.toTrack || null, arrivalTime: 0, departureTime: 0 }
                    ]
                }
            };

            // Fetch existing patch data to apply saved offsets
            // In review mode, bypass owner check to allow moderators to view any patch
            const { fetchPatchWithData } = await import('../api/patches');
            const patchWithData = await fetchPatchWithData(patchId, reviewMode);

            // Initialize MapViewer at the start of the route (only once)
            if (!this.mapViewer.initialized && routeData.geometry.route && routeData.geometry.route.length > 0) {
                // Route format: [lon, lat, world_offset_x, world_offset_y, world_offset_z]
                const [lon, lat] = routeData.geometry.route[0];
                console.log('Initializing MapViewer at route start:', { lat, lon });
                // Initialize at ground level (height 0) to keep coordinate system consistent
                this.mapViewer.init(this.scene, this.camera, this.renderer, lat, lon, 0);
            }

            // Relocate camera to the start of the route before loading nodes
            if (routeData.geometry.route && routeData.geometry.route.length > 0) {
                // Route format: [lon, lat, world_offset_x, world_offset_y, world_offset_z]
                const [lon, lat, , world_offset_y] = routeData.geometry.route[0];
                const altitude = world_offset_y || 200;
                this.relocateToPosition(lat, lon, altitude + 100); // 100m above the start point
            }

            // Create route editor if not exists
            if (!this.routeEditor) {
                this.routeEditor = new RouteEditor(this.scene, this.camera, this.renderer.domElement, this.mapViewer, reviewMode);

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

                this.routeEditor.onNodeIndexChanged = (currentIndex, totalNodes) => {
                    if (this.onNodeIndexChanged) {
                        this.onNodeIndexChanged(currentIndex, totalNodes);
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
        // Reorient the map to ground level (height 0) to keep coordinate system consistent
        // This ensures all ENU offsets are relative to ground level, not to the camera height
        this.mapViewer.reorient(lat, lon, 0);

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
        }
    }

    public selectNodeByIndex(index: number): void {
        if (this.routeEditor) {
            this.routeEditor.selectNodeByIndex(index);
        }
    }

    public bringCurrentNodeIntoView(): void {
        if (this.routeEditor) {
            const nodeKeys = Array.from(this.routeEditor['nodes'].keys());
            const currentIndex = this.routeEditor.getCurrentNodeIndex();
            if (currentIndex >= 0 && currentIndex < nodeKeys.length) {
                this.routeEditor.bringNodeIntoView(nodeKeys[currentIndex]);
            }
        }
    }

    public cleanup(): void {
        if (this.rafId) {
            cancelAnimationFrame(this.rafId);
        }

        window.removeEventListener('resize', this.onWindowResize);

        this.sky.cleanup();
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

    private editorInputs(): void {
        if (Input.isPressed('F1')) {
            // Toggle Sky UI
            this.sky.toggleUI();
        }
    }

    private animate(): void {
        this.rafId = requestAnimationFrame(this.animate);
        const dt = this.clock.getDelta();


        this.editorInputs();

        this.sky.update(dt, this.camera);
        this.flightControls.update(dt);
        this.camera.updateMatrixWorld();

        // Always update mapViewer to allow tiles to load (even before initialized)
        this.mapViewer.update();

        // Only update route editor if mapViewer is initialized
        if (this.mapViewer.initialized) {
            this.routeEditor?.update();
        }

        this.renderer.render(this.scene, this.camera);

        // Only handle raycasting if mapViewer is initialized
        if (this.mapViewer.initialized) {
            this.handleRaycasting();
        }

        // Show credits only if mapViewer is initialized
        if (this.mapViewer.initialized) {
            this.setCreditsCallback(this.mapViewer.getCredits());
        } else {
            const message = 'Select or create a patch to begin editing';
            this.setCreditsCallback({
                latLonStr: '',
                source: message,
            });
        }

        Input.update();
    }
}
