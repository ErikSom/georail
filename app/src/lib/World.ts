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
import { fetchRouteByName } from './Georail';
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


    constructor(mountElement: HTMLDivElement, setCreditsCallback: (credits: string) => void) {
        this.mountElement = mountElement;
        this.setCreditsCallback = setCreditsCallback;

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

        this.mapViewer = new MapViewer();
        this.mapViewer.init(this.scene, this.camera, this.renderer);

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
                break
        }
    }

    private async startPathFollowing(): Promise<void> {
        console.log('Fetching route from Amsterdam Centraal to Utrecht Centraal...');
        try {
            const routeData = await fetchRouteByName(
                'Hoorn Kersenboogerd', '1',
                'Amsterdam Centraal', '4b'
            );

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

            // Teleport the world origin to the start of the path
            // Route point format: [lon, lat, world_offset_x, world_offset_y, world_offset_z]
            // world_offset_y is the height/altitude offset
            const [startLon, startLat, , world_offset_y] = pathCoordinates[0];
            const droneHeight = world_offset_y || 200;
            console.log('Starting drone at height:', droneHeight);
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
        this.mapViewer.reorient(lat, lon, height);

        this.drone.position.set(0, 0, 0);
        this.drone.rotation.set(0, 0, 0);
    }

    private animate(): void {
        this.rafId = requestAnimationFrame(this.animate);
        const deltaTime = this.clock.getDelta();

        // 1. Update Sky
        this.sky.update(deltaTime, this.camera);

        // 2. Update Drone position
        this.drone.update(deltaTime, this.keysPressed);

        // 3. Update MapViewer (tiles)
        this.mapViewer.update();

        // --- MODIFIED ---

        // 4–6. Follow the drone without fighting controls
        this.tmp.copy(this.drone.position).sub(this.controls.target); // delta the drone moved
        this.controls.target.add(this.tmp);
        this.camera.position.add(this.tmp);

        // 7. Let controls handle damping/zoom/orbit
        this.controls.update();

        // 8. Update Camera
        this.camera.updateMatrixWorld();

        // 9. Render
        this.renderer.render(this.scene, this.camera);

        // 10. Update UI
        const cameraCredits = this.mapViewer.getCredits();
        const droneCoords = this.mapViewer.getLatLonHeightFromWorldPosition(this.drone.position);

        const droneLat = (droneCoords!.lat * MathUtils.RAD2DEG).toFixed(5);
        const droneLon = (droneCoords!.lon * MathUtils.RAD2DEG).toFixed(5);
        const droneHeight = droneCoords!.height.toFixed(1);

        const fullCredits = `${cameraCredits}\nDrone: ${droneLat}°, ${droneLon}° | Height: ${droneHeight}m`;

        this.setCreditsCallback(fullCredits);
    }
}