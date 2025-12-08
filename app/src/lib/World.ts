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
import { Drone } from './Drone';
import { fetchRouteByName, type RouteData } from './Georail';
import { routePointToWorldPosition } from './utils/CoordinateHelpers';
import { Sky } from './Sky';

export class World {
    private scene!: Scene;
    private camera!: PerspectiveCamera;
    private renderer!: WebGLRenderer;
    private clock!: Clock;

    private controls!: OrbitControls;
    private drone!: Drone;
    private mapViewer!: MapViewer;
    private sky!: Sky;
    private tmp = new Vector3();

    private rafId: number | null = null;
    private mountElement: HTMLDivElement;
    private setCreditsCallback: (credits: string) => void;
    private keysPressed: { [key: string]: boolean } = {};
    private routeData: RouteData | null = null;


    constructor(mountElement: HTMLDivElement, setCreditsCallback: (credits: string) => void, routeData?: RouteData) {
        this.mountElement = mountElement;
        this.setCreditsCallback = setCreditsCallback;
        this.routeData = routeData || null;

        this.animate = this.animate.bind(this);
        this.onWindowResize = this.onWindowResize.bind(this);
        this.onKeyDown = this.onKeyDown.bind(this);
        this.onKeyUp = this.onKeyUp.bind(this);
    }

    public init(): void {
        this.scene = new Scene();
        this.clock = new Clock();
        this.renderer = new WebGLRenderer({ antialias: true });
        this.renderer.setPixelRatio(window.devicePixelRatio);
        this.renderer.setSize(this.mountElement.clientWidth, this.mountElement.clientHeight);
        this.mountElement.appendChild(this.renderer.domElement);

        this.camera = new PerspectiveCamera(60, this.mountElement.clientWidth / this.mountElement.clientHeight, 1, 1e7);
        this.camera.position.set(1e3, 1e3, 1e3).multiplyScalar(0.5);

        // Initialize MapViewer but don't call init() yet - wait for route data
        this.mapViewer = new MapViewer();

        this.sky = new Sky(this.scene);

        this.drone = new Drone();
        this.scene.add(this.drone);

        this.controls = new OrbitControls(this.camera, this.renderer.domElement);
        this.controls.minDistance = 100;
        this.controls.maxDistance = 500;
        this.controls.minPolarAngle = 0;
        this.controls.maxPolarAngle = 3 * Math.PI / 8;
        this.controls.enableDamping = true;
        this.controls.autoRotate = false;
        this.controls.enablePan = false;
        this.controls.target.copy(this.drone.position);
        this.controls.update();

        window.addEventListener('resize', this.onWindowResize, false);
        window.addEventListener('keydown', this.onKeyDown, false);
        window.addEventListener('keyup', this.onKeyUp, false);

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
        window.removeEventListener('keydown', this.onKeyDown);
        window.removeEventListener('keyup', this.onKeyUp);

        this.sky.cleanup();
        this.mapViewer.cleanup();
        this.drone.dispose();
        this.controls.dispose();
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

    private onKeyDown(event: KeyboardEvent): void {
        const key = event.key.toLowerCase();
        this.keysPressed[key] = true;

        console.log('Key down:', key);

        switch (key) {
            case '1':
                // Eiffel Tower
                this.teleportDroneTo(48.8584, 2.2945, 300);
                break;
            case '2':
                // Mt Fuji
                this.teleportDroneTo(35.3606, 138.7274, 5000);
                break;
            case '3':
                // Colosseum
                this.teleportDroneTo(41.8902, 12.4922);
                break;
            case '4':
                // Grand Canyon
                this.teleportDroneTo(36.2679, -112.3535);
                break;

            case ' ':
                this.startPathFollowing();
                break;
        }
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
            const droneHeight = world_offset_y || 200;
            console.log('Starting location:', { lat: startLat, lon: startLon, offset_y: world_offset_y });

            // Initialize MapViewer at the starting location (ground level - height 0)
            // The offsets will be applied when converting route points
            this.mapViewer.init(this.scene, this.camera, this.renderer, startLat, startLon, 0);

            // Teleport the drone to the start position with offset applied
            this.teleportDroneTo(startLat, startLon, droneHeight);

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

            this.drone.startFollowing(pathPoints, 0);
        } catch (error) {
            console.error('Failed to start path following:', error);
        }
    }

    private onKeyUp(event: KeyboardEvent): void {
        this.keysPressed[event.key.toLowerCase()] = false;
    }

    private teleportDroneTo(lat: number, lon: number, height: number = 1000): void {
        // Reorient to ground level (height 0) to keep coordinate system consistent
        // This ensures all ENU offsets are relative to ground level, not to the drone height
        this.mapViewer.reorient(lat, lon, 0);

        // Position drone at the specified height
        const droneWorldPos = this.mapViewer.latLonHeightToWorldPosition(lat, lon, height);
        if (droneWorldPos) {
            this.drone.position.copy(droneWorldPos);
        } else {
            // Fallback to origin if conversion fails
            this.drone.position.set(0, 0, 0);
        }

        this.drone.rotation.set(0, 0, 0);
    }

    private animate(): void {
        this.rafId = requestAnimationFrame(this.animate);
        const deltaTime = this.clock.getDelta();

        // 1. Update Sky
        this.sky.update(deltaTime, this.camera);

        // 2. Update Drone position (only if initialized)
        if (this.mapViewer.initialized) {
            this.drone.update(deltaTime, this.keysPressed);
        }

        // 3. Update MapViewer (tiles) - always update to allow tiles to load
        this.mapViewer.update();

        // 4–6. Follow the drone without fighting controls (only if initialized)
        if (this.mapViewer.initialized) {
            this.tmp.copy(this.drone.position).sub(this.controls.target); // delta the drone moved
            this.controls.target.add(this.tmp);
            this.camera.position.add(this.tmp);
        }

        // 7. Let controls handle damping/zoom/orbit
        this.controls.update();

        // 8. Update Camera
        this.camera.updateMatrixWorld();

        // 9. Render
        this.renderer.render(this.scene, this.camera);

        // 10. Update UI - only if MapViewer is initialized
        if (this.mapViewer.initialized) {
            const cameraCredits = this.mapViewer.getCredits();
            const droneCoords = this.mapViewer.getLatLonHeightFromWorldPosition(this.drone.position);

            if (droneCoords) {
                const droneLat = (droneCoords.lat * MathUtils.RAD2DEG).toFixed(5);
                const droneLon = (droneCoords.lon * MathUtils.RAD2DEG).toFixed(5);
                const droneHeight = droneCoords.height.toFixed(1);

                const fullCredits = `${cameraCredits}\nDrone: ${droneLat}°, ${droneLon}° | Height: ${droneHeight}m`;

                this.setCreditsCallback(fullCredits);
            }
        } else {
            this.setCreditsCallback('Loading route...');
        }
    }
}