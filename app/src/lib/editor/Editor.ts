import {
    Scene,
    WebGLRenderer,
    PerspectiveCamera,
    Clock,
    Raycaster,
    SRGBColorSpace,
    NeutralToneMapping,
    Group,
    Line,
    LineBasicMaterial,
    BufferGeometry,
    Vector3,
    Color,
    Mesh,
    SphereGeometry,
    MeshBasicMaterial,
} from 'three';
import { Line2 } from 'three/addons/lines/Line2.js';
import { LineMaterial } from 'three/addons/lines/LineMaterial.js';
import { LineGeometry } from 'three/addons/lines/LineGeometry.js';
import type { OverpassWay, OverpassStop } from '../api/overpass';
import { MapViewer } from '../MapViewer';
import { FlightControls } from '../utils/FlightControls';
import { Input } from '../utils/Input';
import { RouteEditor } from './RouteEditor';
import { fetchJourneyRoute, fetchAreaRoute, type RouteData, type JourneyStopInput, type JourneyRouteData } from '../api/navigation';
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
    private wayPreviewGroup: Group | null = null;
    private wayLines: Map<number, Line> = new Map();
    private stopMarkers: Map<number, Mesh> = new Map();
    private highlightGroup: Group | null = null;
    private committedLine: Line2 | null = null;
    private branchLines: Map<number, Line2> = new Map();
    private lineMaterials: Set<LineMaterial> = new Set();
    private chosenStopMarkers: Map<string, Mesh> = new Map();

    private rafId: number | null = null;
    private mountElement: HTMLDivElement;
    private setCreditsCallback: (credits: Tiles3DAttributionCredits) => void;

    // Callbacks for patch editing
    public onNodeSelected: ((nodeData: any) => void) | null = null;
    public onSelectionChanged: ((nodes: any[]) => void) | null = null;
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
                    const mode = Input.isShift ? 'toggle' : 'replace';
                    this.routeEditor.selectNodes([nodeKey], mode);
                    return;
                }

                // Check if we clicked on transform controls
                if (this.routeEditor.isTransformControlClicked(this.raycaster)) {
                    return; // Don't deselect if clicking on transform controls
                }

                // If we didn't click a node or transform controls, deselect (unless shift held — keeps selection so a marquee drag can extend it).
                if (!Input.isShift) this.routeEditor.selectNodes([], 'replace');
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
            const isArea = routeInfo.kind === 'area' && routeInfo.area;

            let journeyData: JourneyRouteData;
            if (isArea) {
                journeyData = await fetchAreaRoute(routeInfo.area!.lat, routeInfo.area!.lon, routeInfo.area!.radiusM);
            } else {
                // Build stops array for journey API using station codes
                const stops: JourneyStopInput[] = [
                    routeInfo.fromTrack ? { code: routeInfo.fromStationCode, track: routeInfo.fromTrack } : { code: routeInfo.fromStationCode },
                    ...(routeInfo.viaStops || []).map(v =>
                        v.track ? { code: v.stationCode, track: v.track } : { code: v.stationCode }
                    ),
                    routeInfo.toTrack ? { code: routeInfo.toStationCode, track: routeInfo.toTrack } : { code: routeInfo.toStationCode },
                ];
                journeyData = await fetchJourneyRoute(stops, true);
            }

            // Transform to RouteData format for compatibility. Area patches have
            // no station stops, so we use a single placeholder anchor at the
            // area center so RouteData's required `stops` array is non-empty.
            const stopsForRouteData = isArea
                ? [{ station: 'Area', code: '', track: null, arrivalTime: 0, departureTime: 0 }]
                : [
                    { station: routeInfo.fromStation, code: routeInfo.fromStationCode, track: routeInfo.fromTrack || null, arrivalTime: 0, departureTime: 0 },
                    ...(routeInfo.viaStops || []).map(v => ({ station: v.station, code: v.stationCode, track: v.track || null, arrivalTime: 0, departureTime: 0 })),
                    { station: routeInfo.toStation, code: routeInfo.toStationCode, track: routeInfo.toTrack || null, arrivalTime: 0, departureTime: 0 },
                ];
            const routeData: RouteData = {
                geometry: journeyData.geometry,
                properties: { stops: stopsForRouteData }
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

            // Relocate camera to the first station node (not route[0] which may be padding)
            if (routeData.geometry.route && routeData.geometry.route.length > 0) {
                const firstStopIdx = journeyData.geometry.stop_indices?.[0] ?? 0;
                const [lon, lat, , world_offset_y] = routeData.geometry.route[firstStopIdx];
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

                this.routeEditor.onSelectionChanged = (nodes) => {
                    if (this.onSelectionChanged) {
                        this.onSelectionChanged(nodes);
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

    public showWayPreview(ways: OverpassWay[], stops: OverpassStop[], hiddenWayIds: Set<number> = new Set()): void {
        if (ways.length === 0) return;

        if (!this.mapViewer.initialized) {
            const [lon, lat] = ways[0].geometry[0];
            this.mapViewer.init(this.scene, this.camera, this.renderer, lat, lon, 0);
        }

        const firstStop = stops[0] || { lat: ways[0].geometry[0][1], lon: ways[0].geometry[0][0] };
        this.relocateToPosition(firstStop.lat, firstStop.lon, 800);

        this.clearWayPreview();

        const group = new Group();
        group.name = 'WayPreviewGroup';
        group.renderOrder = 999;
        this.scene.add(group);
        this.wayPreviewGroup = group;

        const LINE_ALTITUDE_M = 30;

        for (let i = 0; i < ways.length; i++) {
            const way = ways[i];
            const positions: Vector3[] = [];
            for (const [lon, lat] of way.geometry) {
                const pos = this.mapViewer.latLonHeightToWorldPosition(lat, lon, LINE_ALTITUDE_M);
                if (pos) positions.push(pos);
            }
            if (positions.length < 2) continue;

            const geom = new BufferGeometry().setFromPoints(positions);
            const color = new Color().setHSL((i * 0.137) % 1, 0.7, 0.55);
            const material = new LineBasicMaterial({
                color,
                transparent: true,
                opacity: hiddenWayIds.has(way.id) ? 0.08 : 1.0,
                depthTest: false,
            });
            const line = new Line(geom, material);
            line.renderOrder = 999;
            line.userData.wayId = way.id;
            group.add(line);
            this.wayLines.set(way.id, line);
        }

        for (const stop of stops) {
            const pos = this.mapViewer.latLonHeightToWorldPosition(stop.lat, stop.lon, LINE_ALTITUDE_M);
            if (!pos) continue;
            const marker = new Mesh(
                new SphereGeometry(40, 16, 16),
                new MeshBasicMaterial({ color: 0xff3b7d, depthTest: false })
            );
            marker.renderOrder = 1000;
            marker.position.copy(pos);
            marker.userData.stopId = stop.osm_node_id;
            group.add(marker);
            this.stopMarkers.set(stop.osm_node_id, marker);
        }

    }

    // Dim instead of remove so the user still sees where the way was.
    public setWayVisible(wayId: number, visible: boolean): void {
        const line = this.wayLines.get(wayId);
        if (!line) return;
        const mat = line.material as LineBasicMaterial;
        mat.opacity = visible ? 1.0 : 0.08;
        mat.needsUpdate = true;
    }

    public clearWayPreview(): void {
        if (!this.wayPreviewGroup) return;
        this.wayPreviewGroup.traverse((obj) => {
            const anyObj = obj as any;
            if (anyObj.geometry?.dispose) anyObj.geometry.dispose();
            if (anyObj.material?.dispose) anyObj.material.dispose();
        });
        this.scene.remove(this.wayPreviewGroup);
        this.wayPreviewGroup = null;
        this.wayLines.clear();
        this.stopMarkers.clear();
        this.clearHighlights();
    }

    public dimBaseNetwork(opacity: number = 0.25): void {
        for (const line of this.wayLines.values()) {
            const mat = line.material as LineBasicMaterial;
            mat.opacity = opacity;
            mat.needsUpdate = true;
        }
    }

    public renderCommittedPath(coords: [number, number][]): void {
        this.ensureHighlightGroup();
        if (this.committedLine) {
            this.highlightGroup!.remove(this.committedLine);
            this.committedLine.geometry.dispose();
            this.lineMaterials.delete(this.committedLine.material);
            this.committedLine.material.dispose();
            this.committedLine = null;
        }
        if (coords.length < 2) return;

        const flat: number[] = [];
        for (const [lon, lat] of coords) {
            const p = this.mapViewer.latLonHeightToWorldPosition(lat, lon, 45);
            if (p) flat.push(p.x, p.y, p.z);
        }
        if (flat.length < 6) return;

        const geom = new LineGeometry();
        geom.setPositions(flat);
        const mat = new LineMaterial({
            color: 0x22c55e,
            linewidth: 6,
            depthTest: false,
            transparent: true,
            opacity: 1.0,
        });
        mat.resolution.set(this.mountElement.clientWidth, this.mountElement.clientHeight);
        this.lineMaterials.add(mat);

        const line = new Line2(geom, mat);
        line.computeLineDistances();
        line.renderOrder = 1001;
        this.highlightGroup!.add(line);
        this.committedLine = line;
    }

    public renderBranchOptions(branches: { wayId: number; geometry: [number, number][]; color: number }[]): void {
        this.ensureHighlightGroup();
        for (const line of this.branchLines.values()) {
            this.highlightGroup!.remove(line);
            line.geometry.dispose();
            this.lineMaterials.delete(line.material);
            line.material.dispose();
        }
        this.branchLines.clear();

        for (const b of branches) {
            if (b.geometry.length < 2) continue;
            const flat: number[] = [];
            for (const [lon, lat] of b.geometry) {
                const p = this.mapViewer.latLonHeightToWorldPosition(lat, lon, 55);
                if (p) flat.push(p.x, p.y, p.z);
            }
            if (flat.length < 6) continue;

            const geom = new LineGeometry();
            geom.setPositions(flat);
            const mat = new LineMaterial({
                color: b.color,
                linewidth: 8,
                depthTest: false,
                transparent: true,
                opacity: 1.0,
            });
            mat.resolution.set(this.mountElement.clientWidth, this.mountElement.clientHeight);
            this.lineMaterials.add(mat);

            const line = new Line2(geom, mat);
            line.computeLineDistances();
            line.renderOrder = 1002;
            line.userData.wayId = b.wayId;
            this.highlightGroup!.add(line);
            this.branchLines.set(b.wayId, line);
        }
    }

    public clearHighlights(): void {
        if (!this.highlightGroup) return;
        this.highlightGroup.traverse((obj) => {
            const anyObj = obj as any;
            if (anyObj.geometry?.dispose) anyObj.geometry.dispose();
            if (anyObj.material?.dispose) {
                if (anyObj.material instanceof LineMaterial) this.lineMaterials.delete(anyObj.material);
                anyObj.material.dispose();
            }
        });
        this.scene.remove(this.highlightGroup);
        this.highlightGroup = null;
        this.committedLine = null;
        this.branchLines.clear();
        this.chosenStopMarkers.clear();
    }

    public renderChosenStops(stops: { key: string; lat: number; lon: number }[]): void {
        this.ensureHighlightGroup();
        for (const m of this.chosenStopMarkers.values()) {
            this.highlightGroup!.remove(m);
            (m.geometry as any).dispose?.();
            (m.material as any).dispose?.();
        }
        this.chosenStopMarkers.clear();

        for (const s of stops) {
            const pos = this.mapViewer.latLonHeightToWorldPosition(s.lat, s.lon, 60);
            if (!pos) continue;
            const marker = new Mesh(
                new SphereGeometry(45, 20, 20),
                new MeshBasicMaterial({ color: 0x22c55e, depthTest: false })
            );
            marker.renderOrder = 1003;
            marker.position.copy(pos);
            marker.userData.stopKey = s.key;
            this.highlightGroup!.add(marker);
            this.chosenStopMarkers.set(s.key, marker);
        }
    }

    // Pure camera move — NOT reorient. Reorient would invalidate all cached
    // positions of the base network lines.
    public focusLatLon(lat: number, lon: number, altitude: number = 800): void {
        if (!this.mapViewer.initialized) return;
        const worldPos = this.mapViewer.latLonHeightToWorldPosition(lat, lon, altitude);
        if (!worldPos) return;
        this.camera.position.copy(worldPos);
        const lookAt = this.mapViewer.latLonHeightToWorldPosition(lat, lon, altitude - 50);
        if (lookAt) this.camera.lookAt(lookAt);
        this.camera.updateMatrixWorld();
    }

    private ensureHighlightGroup(): void {
        if (this.highlightGroup) return;
        const g = new Group();
        g.name = 'HighlightGroup';
        g.renderOrder = 1000;
        this.scene.add(g);
        this.highlightGroup = g;
    }

    public loadUserRoute(routeData: RouteData): void {
        if (!routeData.geometry.route || routeData.geometry.route.length === 0) {
            throw new Error('Route data has no geometry');
        }

        if (!this.mapViewer.initialized) {
            const [lon, lat] = routeData.geometry.route[0];
            this.mapViewer.init(this.scene, this.camera, this.renderer, lat, lon, 0);
        }

        const firstStopIdx = routeData.geometry.stop_indices?.[0] ?? 0;
        const [lon, lat, , world_offset_y] = routeData.geometry.route[firstStopIdx];
        const altitude = world_offset_y || 200;
        this.relocateToPosition(lat, lon, altitude + 100);

        if (!this.routeEditor) {
            this.routeEditor = new RouteEditor(this.scene, this.camera, this.renderer.domElement, this.mapViewer, false);

            this.routeEditor.onNodeSelected = (nodeData) => {
                if (this.onNodeSelected) this.onNodeSelected(nodeData);
            };
            this.routeEditor.onNodesModified = (nodes) => {
                if (this.onNodesModified) this.onNodesModified(nodes.length);
            };
            this.routeEditor.onNodeIndexChanged = (currentIndex, totalNodes) => {
                if (this.onNodeIndexChanged) this.onNodeIndexChanged(currentIndex, totalNodes);
            };
        }

        this.routeEditor.loadRoute(routeData);
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
        this.clearWayPreview();
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

        for (const mat of this.lineMaterials) {
            mat.resolution.set(width, height);
        }
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
            this.routeEditor?.update(dt);
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
