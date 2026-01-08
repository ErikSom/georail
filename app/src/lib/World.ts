import {
    Scene,
    WebGLRenderer,
    PerspectiveCamera,
    Clock,
    MathUtils,
    Vector3,
} from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { MapViewer } from './MapViewer';
import { fetchRouteByName, type RouteData } from './Georail';
import { routePointToWorldPosition } from './utils/CoordinateHelpers';
import { Sky } from './Sky';
import { Train } from './train/Train';
import { getDefaultTrainConfig } from './train/TrainConfig';
import { Input } from './utils/Input';
import { FlightControls } from './utils/FlightControls';
import Path from './utils/Path';
import { getTrainConfiguration, nssgmTrainType } from './train/configs/TrainConfigurations.secure';
import { ThreePerf } from 'three-perf';
import { trainInstance, updateTrainState, trainDebugMode } from '../store/train';
import { getPerformanceConfig, type PerformanceConfig } from './utils/PerformanceConfig';

export class World {
    private scene!: Scene;
    private camera!: PerspectiveCamera;
    private renderer!: WebGLRenderer;
    private clock!: Clock;

    private controls!: OrbitControls;
    private flightControls: FlightControls | null = null;
    private train!: Train;
    private mapViewer!: MapViewer;
    private sky!: Sky;
    private perf!: any;
    private tmp = new Vector3();
    private perfConfig: PerformanceConfig;

    private rafId: number | null = null;
    private mountElement: HTMLDivElement;
    private setCreditsCallback: (credits: string) => void;
    private routeData: RouteData | null = null;
    private freeFlyCameraMode: boolean = false;


    constructor(mountElement: HTMLDivElement, setCreditsCallback: (credits: string) => void, routeData?: RouteData) {
        this.mountElement = mountElement;
        this.setCreditsCallback = setCreditsCallback;
        this.routeData = routeData || null;

        // Get performance config (defaults to MEDIUM, can override with ?perf=low/high/etc)
        this.perfConfig = getPerformanceConfig();
        console.log('Performance preset:', this.perfConfig);

        this.animate = this.animate.bind(this);
        this.onWindowResize = this.onWindowResize.bind(this);
    }

    public init(): void {
        this.scene = new Scene();
        this.clock = new Clock();

        // Apply performance config
        this.renderer = new WebGLRenderer({
            antialias: this.perfConfig.antialias,
            powerPreference: 'high-performance'
        });
        this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, this.perfConfig.pixelRatio));
        this.renderer.setSize(this.mountElement.clientWidth, this.mountElement.clientHeight);
        this.mountElement.appendChild(this.renderer.domElement);

        this.camera = new PerspectiveCamera(
            60,
            this.mountElement.clientWidth / this.mountElement.clientHeight,
            1,
            this.perfConfig.farPlane
        );
        this.camera.position.set(1e3, 1e3, 1e3).multiplyScalar(0.5);

        // Initialize MapViewer but don't call init() yet - wait for route data
        this.mapViewer = new MapViewer();

        this.sky = new Sky(this.scene);

        // Initialize Train
        const trainConfig = getTrainConfiguration(nssgmTrainType);
        this.train = new Train(trainConfig, trainDebugMode.value);
        this.scene.add(this.train.group);

        // Only add debug group if debug mode is enabled
        if (trainDebugMode.value) {
            this.scene.add(this.train.globalDebugGroup);
        }

        // Set train instance in store for controls to use
        trainInstance.value = this.train;

        this.controls = new OrbitControls(this.camera, this.renderer.domElement);
        this.controls.minDistance = 100;
        this.controls.maxDistance = 500;
        this.controls.minPolarAngle = 0;
        this.controls.maxPolarAngle = 3 * Math.PI / 8;
        this.controls.enableDamping = true;
        this.controls.autoRotate = false;
        this.controls.enablePan = false;
        this.controls.target.copy(this.train.group.position);
        this.controls.update();

        // Initialize Input system
        Input.init(this.renderer.domElement);

        // Initialize three-perf
        this.perf = new ThreePerf({
            anchorX: 'left',
            anchorY: 'top',
            domElement: this.mountElement,
            renderer: this.renderer,
        });

        window.addEventListener('resize', this.onWindowResize, false);

        this.animate();

        // Automatically start following the route if provided
        if (this.routeData) {
            this.startPathFollowing();
        }
    }

    public cleanup(): void {
        if (this.rafId) {
            cancelAnimationFrame(this.rafId);
        }

        window.removeEventListener('resize', this.onWindowResize);
        Input.cleanup();

        // Clear train instance from store
        trainInstance.value = null;

        this.sky.cleanup();
        this.mapViewer.cleanup();
        this.train.cleanup();
        this.controls.dispose();

        if (this.flightControls) {
            this.flightControls.cleanup();
        }

        if (this.perf) {
            this.perf.destroy();
        }

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


    private async startPathFollowing(): Promise<void> {
        try {
            let routeData = this.routeData;

            // If no route data was provided in constructor, fetch hardcoded route (for backwards compatibility)
            if (!routeData) {
                console.log('Fetching hardcoded route from Hoorn Kersenboogerd to Amsterdam Centraal...');
                routeData = await fetchRouteByName(
                    'Hoorn Kersenboogerd', '1',
                    'Amsterdam Centraal', '4b'
                );
            } else {
                console.log('Using provided route:', routeData.properties);
            }

            // More detailed logging to inspect the incoming data structure
            console.log('--- Raw Route Data Received ---');
            console.log(JSON.stringify(routeData, null, 2));
            console.log('---------------------------------');

            // Use the definitive 'node_coords' array from the new function
            if (!routeData?.geometry?.route || routeData.geometry.route.length < 2) {
                console.warn("No valid path found. Check the route data structure.");
                return;
            }

            // Route data is: [lon, lat, world_offset_x, world_offset_y, world_offset_z]
            const pathCoordinates = routeData.geometry.route;

            console.log(pathCoordinates)

            console.log(`Processed into a single path with ${pathCoordinates.length} total coordinates.`);

            // Extract starting coordinates from route
            // Route point format: [lon, lat, world_offset_x, world_offset_y, world_offset_z]
            // world_offset_y is the vertical offset (altitude)
            const [startLon, startLat, , world_offset_y] = pathCoordinates[0];
            console.log('Starting location:', { lat: startLat, lon: startLon, offset_y: world_offset_y });

            // Initialize or reorient MapViewer at the starting location (ground level - height 0)
            // Always reorient to ground level to keep coordinate system consistent
            if (!this.mapViewer.initialized) {
                // First time: initialize MapViewer with performance config
                this.mapViewer.init(this.scene, this.camera, this.renderer, startLat, startLon, 0, this.perfConfig);
            }
            this.mapViewer.reorient(startLat, startLon, 0);

            // Now, convert all geographic coordinates with offsets applied to world positions
            const pathPoints = pathCoordinates
                .map((routePoint: number[]) => {
                    return routePointToWorldPosition(routePoint, this.mapViewer);
                })
                .filter((p: Vector3 | null): p is Vector3 => p !== null); // Filter out any null results

            console.log(`Successfully converted to ${pathPoints.length} world coordinate points.`);

            if (pathPoints.length < 2) {
                console.error('Could not convert enough coordinates to form a valid path.');
                return;
            }

            const path = new Path(pathPoints);
            this.train.setPath(path);
            this.train.positionOnPath();

            // Focus camera on train
            this.camera.position.set(
                this.train.group.position.x + 50,
                this.train.group.position.y + 50,
                this.train.group.position.z + 50
            );
            this.controls.target.copy(this.train.group.position);
            this.controls.update();
        } catch (error) {
            console.error('Failed to start path following:', error);
        }
    }

    private handleInput(): void {
        // Check for camera mode toggle (Shift + ~)
        if (Input.isPressed('Backquote') && Input.isShift) {
            this.freeFlyCameraMode = !this.freeFlyCameraMode;

            if (this.freeFlyCameraMode) {
                // Initialize FlightControls if not already created
                if (!this.flightControls) {
                    this.flightControls = new FlightControls(this.camera, this.renderer.domElement);
                    this.flightControls.init();
                }
                console.log('Free-fly camera mode enabled (right-click to move camera)');
            }
        }

        if (Input.isPressed('F1')) {
            // Toggle Sky UI
            this.sky.toggleUI();
        }

        Input.update();
    }


    private animate(): void {
        this.rafId = requestAnimationFrame(this.animate);
        const deltaTime = this.clock.getDelta();

        // Update Input
        this.handleInput();

        // Update train state and trigger React component updates
        updateTrainState();

        // 1. Update Sky
        this.sky.update(deltaTime, this.camera);

        // 2. Update MapViewer (tiles) - always update to allow tiles to load
        this.mapViewer.update();

        // 3. Follow the train without fighting controls (not in free-fly mode)
        if (!this.freeFlyCameraMode) {
            this.tmp.copy(this.train.group.position).sub(this.controls.target);
            this.controls.target.add(this.tmp);
            this.camera.position.add(this.tmp);
        }

        // 4. Update controls based on mode
        if (this.freeFlyCameraMode && this.flightControls) {
            this.flightControls.update(deltaTime);
        } else {
            this.controls.update();
        }

        // 5. Update Train
        this.train.update(deltaTime);

        // 6. Update Camera
        this.camera.updateMatrixWorld();

        // 6. Render
        this.perf.begin();
        this.renderer.render(this.scene, this.camera);
        this.perf.end();

        // 7. Update UI - only if MapViewer is initialized
        if (this.mapViewer.initialized) {
            const cameraCredits = this.mapViewer.getCredits();
            const trainCoords = this.mapViewer.getLatLonHeightFromWorldPosition(this.train.group.position);

            if (trainCoords) {
                const trainLat = (trainCoords.lat * MathUtils.RAD2DEG).toFixed(5);
                const trainLon = (trainCoords.lon * MathUtils.RAD2DEG).toFixed(5);
                const trainHeight = trainCoords.height.toFixed(1);

                const fullCredits = `${cameraCredits}\nTrain: ${trainLat}°, ${trainLon}° | Height: ${trainHeight}m`;

                this.setCreditsCallback(fullCredits);
            }
        } else {
            this.setCreditsCallback('Loading route...');
        }
    }
}