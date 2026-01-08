import {
    Scene,
    WebGLRenderer,
    PerspectiveCamera,
    Clock,
    Vector3,
    GridHelper,
    Mesh,
    PlaneGeometry,
    MeshStandardMaterial,
    AmbientLight,
    DirectionalLight,
} from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { Sky } from './Sky';
import { Train } from './train/Train';
import { getDefaultTrainConfig, type TrainConfig } from './train/TrainConfig';
import Path from './utils/Path';
import { Pane } from 'tweakpane';
import { dummyQuad, dummyVec3 } from './utils/Helper';
import { FlightControls } from './utils/FlightControls';
import { Input } from './utils/Input';
import { trainInstance, updateTrainState } from '../store/train';
import { getTrainConfiguration } from './train/configs/TrainConfigurations.secure';

export type PathType = 'straight' | 'circle' | 'oval' | 'figure8' | 'spiral';
export type CameraMode = 'free' | 'side' | 'top' | 'cinematic' | 'fly';

export class TrainEditorWorld {
    private scene!: Scene;
    private camera!: PerspectiveCamera;
    private renderer!: WebGLRenderer;
    private clock!: Clock;

    private controls!: OrbitControls;
    private flightControls: FlightControls | null = null;
    private train!: Train;
    private sky!: Sky;
    private gridHelper!: GridHelper;
    private groundPlane!: Mesh;

    private rafId: number | null = null;
    private mountElement: HTMLDivElement;
    private pane: Pane | null = null;
    private animParams = {
        isAnimating: false,
        animationSpeed: 20, // meters per second
        pathProgress: 0,
    };
    private trainControlParams = {
        usePhysics: true,
        power: 0,
        velocityKmh: 0,
    };
    private cameraParams = {
        mode: 'free' as CameraMode,
    };

    private currentPathType: PathType = 'circle';
    private cinematicAngle: number = 0; // For cinematic camera rotation
    private zoomDistance: number = 200; // Controlled by scroll wheel
    private boundOnWheel: (event: WheelEvent) => void;

    constructor(mountElement: HTMLDivElement) {
        this.mountElement = mountElement;
        this.animate = this.animate.bind(this);
        this.onWindowResize = this.onWindowResize.bind(this);
        this.boundOnWheel = this.onWheel.bind(this);
    }

    public init(): void {
        this.scene = new Scene();
        this.clock = new Clock();
        this.renderer = new WebGLRenderer({ antialias: true });
        this.renderer.setPixelRatio(window.devicePixelRatio);
        this.renderer.setSize(this.mountElement.clientWidth, this.mountElement.clientHeight);
        this.mountElement.appendChild(this.renderer.domElement);

        // Camera setup
        this.camera = new PerspectiveCamera(
            60,
            this.mountElement.clientWidth / this.mountElement.clientHeight,
            1,
            10000
        );
        this.camera.position.set(300, 200, 300);

        // Lighting
        const ambientLight = new AmbientLight(0xffffff, 0.6);
        this.scene.add(ambientLight);

        const directionalLight = new DirectionalLight(0xffffff, 0.8);
        directionalLight.position.set(100, 200, 100);
        this.scene.add(directionalLight);

        // Sky
        this.sky = new Sky(this.scene);

        // Ground plane with subtle color
        const planeGeometry = new PlaneGeometry(2000, 2000);
        const planeMaterial = new MeshStandardMaterial({
            color: 0x2a2a2a,
            roughness: 0.8,
            metalness: 0.2,
        });
        this.groundPlane = new Mesh(planeGeometry, planeMaterial);
        this.groundPlane.rotation.x = -Math.PI / 2;
        this.groundPlane.position.y = 0;
        this.groundPlane.receiveShadow = true;
        this.scene.add(this.groundPlane);

        // Grid helper
        this.gridHelper = new GridHelper(2000, 100, 0x444444, 0x333333);
        this.gridHelper.position.y = 0.1; // Slightly above ground to prevent z-fighting
        this.scene.add(this.gridHelper);

        // Debug UI
        this.createDebugUI();

        const urlParams = new URLSearchParams(window.location.search);
        const urlTrain = urlParams.get('train');

        let trainConfig: TrainConfig = getDefaultTrainConfig();
        if (urlTrain) {
            try {
                trainConfig = getTrainConfiguration(urlTrain);
            } catch (e) {
                console.error(`Failed to load train configuration for type "${urlTrain}". Using default configuration.`, e);
            }
        }

        // Initialize Train with debug mode enabled
        this.train = new Train(trainConfig, true);
        this.scene.add(this.train.group);
        this.scene.add(this.train.globalDebugGroup);

        // Set train instance in store for controls to use
        trainInstance.value = this.train;

        // Controls - initialize before setting path
        this.controls = new OrbitControls(this.camera, this.renderer.domElement);
        this.controls.minDistance = 10;
        this.controls.maxDistance = 1000;
        this.controls.enableDamping = true;
        this.controls.target.copy(this.train.group.position);
        this.controls.update();

        // Set initial path (after controls are initialized)
        this.setPath(this.currentPathType);

        // Initialize Input system (needed for FlightControls)
        Input.init(this.renderer.domElement);

        // Add scroll wheel zoom handler
        this.renderer.domElement.addEventListener('wheel', this.boundOnWheel, { passive: false });

        window.addEventListener('resize', this.onWindowResize, false);
        this.animate();
    }

    private onWheel(event: WheelEvent): void {
        event.preventDefault();

        // Adjust zoom distance based on scroll
        const zoomSpeed = 5;
        this.zoomDistance += event.deltaY * zoomSpeed * 0.01;

        // Clamp zoom distance
        this.zoomDistance = Math.max(50, Math.min(500, this.zoomDistance));
    }

    private createDebugUI(): void {
        if (this.pane) {
            this.pane.dispose();
        }

        const rootDomContainer = document.getElementById('tweakpane-container');

        this.pane = new Pane({ title: 'Train Editor Controls', container: rootDomContainer || undefined });

        // Path selection
        const pathFolder = this.pane.addFolder({ title: 'Path Selection' });

        pathFolder.addBinding({ pathType: this.currentPathType }, 'pathType', {
            label: 'Path Type',
            options: {
                'Straight Line': 'straight',
                'Circle': 'circle',
                'Oval': 'oval',
                'Figure 8': 'figure8',
                'Spiral': 'spiral',
            },
        }).on('change', (ev) => {
            this.currentPathType = ev.value as PathType;
            this.setPath(this.currentPathType);
            this.animParams.pathProgress = 0;
        });

        // Train Controls
        const trainFolder = this.pane.addFolder({ title: 'Train Controls' });

        trainFolder.addBinding(this.trainControlParams, 'usePhysics', {
            label: 'Use Physics',
        });

        trainFolder.addBinding(this.trainControlParams, 'power', {
            label: 'Power',
            min: -1,
            max: 1,
            step: 0.01,
        }).on('change', (ev) => {
            if (this.trainControlParams.usePhysics) {
                this.train.setPower(ev.value);
            }
        });

        trainFolder.addBinding(this.trainControlParams, 'velocityKmh', {
            label: 'Speed (km/h)',
            readonly: true,
        });

        trainFolder.addButton({ title: 'Reset Physics' }).on('click', () => {
            this.trainControlParams.power = 0;
            this.train.setPower(0);
        });

        trainFolder.addBlade({ view: 'separator' });

        // Animation controls (legacy)
        const animFolder = this.pane.addFolder({ title: 'Animation (Legacy)' });

        animFolder.addBinding(this.animParams, 'isAnimating', {
            label: 'Animate Train',
        });

        animFolder.addBinding(this.animParams, 'animationSpeed', {
            label: 'Speed (m/s)',
            min: 1,
            max: 100,
            step: 1,
        });

        animFolder.addBinding(this.animParams, 'pathProgress', {
            label: 'Position',
            min: 0,
            max: 1,
            step: 0.001,
        }).on('change', () => {
            if (!this.animParams.isAnimating) {
                this.updateTrainPosition();
            }
        });

        // Camera controls
        const cameraFolder = this.pane.addFolder({ title: 'Camera' });

        cameraFolder.addBinding(this.cameraParams, 'mode', {
            label: 'Camera Mode',
            options: {
                'Free': 'free',
                'Fly': 'fly',
                'Side View': 'side',
                'Top View': 'top',
                'Cinematic': 'cinematic',
            },
        }).on('change', (ev) => {
            this.updateCameraMode();
        });

    }

    private setPath(pathType: PathType): void {
        let pathPoints: Vector3[];

        switch (pathType) {
            case 'straight':
                pathPoints = this.generateStraightPath();
                break;
            case 'circle':
                pathPoints = this.generateCirclePath();
                break;
            case 'oval':
                pathPoints = this.generateOvalPath();
                break;
            case 'figure8':
                pathPoints = this.generateFigure8Path();
                break;
            case 'spiral':
                pathPoints = this.generateSpiralPath();
                break;
            default:
                pathPoints = this.generateCirclePath();
        }

        const path = new Path(pathPoints);
        this.train.setPath(path);
        this.train.positionOnPath();
        this.updateCameraMode();
    }

    private generateStraightPath(): Vector3[] {
        const points: Vector3[] = [];
        const length = 500;
        const numPoints = 100;

        for (let i = 0; i < numPoints; i++) {
            const t = i / (numPoints - 1);
            const z = -length / 2 + length * t;
            points.push(new Vector3(0, 0, z));
        }

        return points;
    }

    private generateCirclePath(): Vector3[] {
        const points: Vector3[] = [];
        const radius = 200;
        const numPoints = 100;

        for (let i = 0; i <= numPoints; i++) {
            const angle = (i / numPoints) * Math.PI * 2;
            const x = Math.cos(angle) * radius;
            const z = Math.sin(angle) * radius;
            points.push(new Vector3(x, 0, z));
        }

        return points;
    }

    private generateOvalPath(): Vector3[] {
        const points: Vector3[] = [];
        const radiusX = 300;
        const radiusZ = 150;
        const numPoints = 120;

        for (let i = 0; i <= numPoints; i++) {
            const angle = (i / numPoints) * Math.PI * 2;
            const x = Math.cos(angle) * radiusX;
            const z = Math.sin(angle) * radiusZ;
            points.push(new Vector3(x, 0, z));
        }

        return points;
    }

    private generateFigure8Path(): Vector3[] {
        const points: Vector3[] = [];
        const radius = 150;
        const numPoints = 200;

        for (let i = 0; i <= numPoints; i++) {
            const t = (i / numPoints) * Math.PI * 2;
            // Lemniscate of Gerono (figure-8 shape)
            const scale = radius;
            const x = scale * Math.cos(t);
            const z = scale * Math.sin(t) * Math.cos(t);
            points.push(new Vector3(x, 0, z));
        }

        return points;
    }

    private generateSpiralPath(): Vector3[] {
        const points: Vector3[] = [];
        const numPoints = 150;
        const maxRadius = 200;
        const heightGain = 100;

        for (let i = 0; i <= numPoints; i++) {
            const t = i / (numPoints - 1);
            const angle = t * Math.PI * 4; // 2 full rotations
            const radius = t * maxRadius;
            const x = Math.cos(angle) * radius;
            const z = Math.sin(angle) * radius;
            const y = t * heightGain;
            points.push(new Vector3(x, y, z));
        }

        return points;
    }

    private updateTrainPosition(): void {
        const path = this.train['path']; // Access private property for this specific case
        if (!path) return;

        const totalLength = path.getTotalLength();
        const distance = this.animParams.pathProgress * totalLength;

        // Update distance traveled on train (accessing private property)
        (this.train as any).distanceTraveled = distance;
        this.train.positionOnPath();
    }

    private updateCameraMode(): void {
        // Blur any active element to prevent Tweakpane inputs from capturing keyboard events
        if (document.activeElement instanceof HTMLElement) {
            document.activeElement.blur();
        }

        // Enable OrbitControls only in 'free' mode
        this.controls.enabled = this.cameraParams.mode === 'free';

        if (this.cameraParams.mode === 'fly') {
            // Initialize FlightControls if not already created
            if (!this.flightControls) {
                this.flightControls = new FlightControls(this.camera, this.renderer.domElement);
                this.flightControls.init();
            }
            // Disable OrbitControls when in fly mode
            this.controls.enabled = false;
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
        const deltaTime = this.clock.getDelta();

        // Update train state and trigger React component updates
        updateTrainState();

        // Update train physics or legacy animation
        if (this.trainControlParams.usePhysics) {
            // Physics mode - train updates itself via store
            // Update display values for debug pane
            this.trainControlParams.velocityKmh = this.train.getVelocityKmh();
            this.trainControlParams.power = this.train.getPower();
            this.pane?.refresh();
        } else if (this.animParams.isAnimating) {
            // Legacy animation mode
            const path = this.train['path'];
            if (path) {
                const totalLength = path.getTotalLength();
                const distanceIncrement = this.animParams.animationSpeed * deltaTime;
                const progressIncrement = distanceIncrement / totalLength;

                this.animParams.pathProgress = (this.animParams.pathProgress + progressIncrement) % 1;
                this.updateTrainPosition();
                this.pane?.refresh();
            }
        }

        // Update camera based on mode
        const targetRollingStock = this.train.getRollingStockTransform();
        const trainPos = targetRollingStock.getWorldPosition(dummyVec3);
        const trainRotation = targetRollingStock.getWorldQuaternion(dummyQuad);

        switch (this.cameraParams.mode) {
            case 'free':
                // Orbit controls handle camera updates
                dummyVec3.copy(this.train.group.position).sub(this.controls.target);
                this.controls.target.add(dummyVec3);
                this.camera.position.add(dummyVec3);
                this.controls.update();
                break;

            case 'fly':
                // Flight controls handle camera updates
                if (this.flightControls) {
                    this.flightControls.update(deltaTime);
                }
                break;

            case 'side':
                {
                    // 1. Snap Camera to Train's position and Rotation
                    this.camera.position.copy(trainPos);
                    this.camera.quaternion.copy(trainRotation);

                    // 2. Move Camera relative to the Train (Local Space)
                    // Move to the right (X), and slightly up (Y)
                    this.camera.translateX(this.zoomDistance);
                    this.camera.translateY(5); // Slight elevation offset

                    // 3. Turn the camera to look at the train
                    // Since we are on the Right (+X), we look Left (+90 deg on Y axis)
                    this.camera.rotateY(Math.PI / 2);
                }
                break;

            case 'top':
                {
                    // 1. Snap Camera to Train
                    this.camera.position.copy(trainPos);
                    this.camera.quaternion.copy(trainRotation);

                    // 2. Move Camera Up (Local Y)
                    this.camera.translateY(this.zoomDistance);

                    // 3. Rotate Camera to look down
                    this.camera.rotateX(-Math.PI / 2);

                    // 4. Point the train upwards
                    this.camera.rotateZ(Math.PI);
                }
                break;

            case 'cinematic':
                {
                    this.controls.enabled = false;

                    // 1. Increment Angle
                    this.cinematicAngle += deltaTime * 0.3;

                    // 2. Calculate Orbit in LOCAL Space
                    // We orbit around the Y-axis relative to the train body
                    const radius = this.zoomDistance;
                    const height = radius * 0.5;

                    const localOffset = new Vector3(
                        Math.cos(this.cinematicAngle) * radius,
                        height,
                        Math.sin(this.cinematicAngle) * radius
                    );

                    // 3. Transform to WORLD Space
                    // Rotate the orbit by the train's rotation, then move to train's location
                    const worldPos = localOffset.applyQuaternion(trainRotation).add(trainPos);
                    this.camera.position.copy(worldPos);

                    // 4. Align Orientation
                    // Calculate the Train's "Up" direction in World Space
                    const trainUp = new Vector3(0, 1, 0).applyQuaternion(trainRotation);

                    // Tell camera that "Up" is whichever way the train roof is pointing
                    this.camera.up.copy(trainUp);
                    this.camera.lookAt(trainPos);
                }
                break;
        }

        // Update Sky
        this.sky.update(deltaTime, this.camera);
        this.train?.update(deltaTime);

        // Update Camera
        this.camera.updateMatrixWorld();

        // Render
        this.renderer.render(this.scene, this.camera);

        // Update Input system for pressed/released detection
        Input.update();

    }

    public cleanup(): void {
        if (this.rafId) {
            cancelAnimationFrame(this.rafId);
        }

        window.removeEventListener('resize', this.onWindowResize);
        this.renderer.domElement.removeEventListener('wheel', this.boundOnWheel);

        // Clear train instance from store
        trainInstance.value = null;

        this.sky.cleanup();
        this.train.cleanup();
        this.controls.dispose();

        if (this.flightControls) {
            this.flightControls.cleanup();
            this.flightControls = null;
        }

        if (this.pane) {
            this.pane.dispose();
            this.pane = null;
        }

        this.renderer.dispose();

        if (this.mountElement) {
            this.mountElement.removeChild(this.renderer.domElement);
        }
    }
}
