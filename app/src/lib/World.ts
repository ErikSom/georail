import {
    Scene,
    WebGLRenderer,
    PerspectiveCamera,
    Clock,
    Vector3,
    MathUtils,
    SRGBColorSpace,
    ACESFilmicToneMapping,
    NoToneMapping,
    LinearToneMapping,
    ReinhardToneMapping,
    CineonToneMapping,
    AgXToneMapping,
    NeutralToneMapping,
    LinearSRGBColorSpace,
    AudioListener,
} from 'three';
import { MapViewer } from './MapViewer';
import { GameCamera } from './GameCamera';
import { type RouteData } from './api/navigation';
import { routePointToWorldPosition } from './utils/CoordinateHelpers';
import { Sky } from './Sky';
import { Train } from './train/Train';
import { Input } from './utils/Input';
import { FlightControls } from './utils/FlightControls';
import Path from './utils/Path';
import { dummyVec3, dummyVec3B } from './utils/Helper';
import { StationIndicator } from './StationIndicator';
import { BoundaryWall } from './BoundaryWall';
import { getTrainConfiguration, nssgmTrainType } from './train/configs/TrainConfigurations.secure';
import Stats from 'stats-gl';
import { trainInstance, updateTrainState, trainDebugMode, trainLatE7, trainLonE7, trainFrontLatE7, trainFrontLonE7, trainBackLatE7, trainBackLonE7, cameraYawRelativeToTrain, trainMaxSpeedKmh } from '../store/train';
import { getPerformanceConfig, type PerformanceConfig } from './utils/PerformanceConfig';
import type { Tiles3DAttributionCredits } from '../components/HUD/Tiles3DAttribution';
import { Pane } from 'tweakpane';
import { audioListener, timeScale, scaledDeltaTime } from '../store/globals';
import { trainPath } from '../store/journey';

export class World {
    private scene!: Scene;
    private camera!: PerspectiveCamera;
    private renderer!: WebGLRenderer;
    private clock!: Clock;
    private audioListener!: AudioListener;

    private gameCamera!: GameCamera;
    private flightControls: FlightControls | null = null;
    private train!: Train;
    private mapViewer!: MapViewer;
    private sky!: Sky;
    private stats!: Stats;
    private perfConfig: PerformanceConfig;
    private rendererPane: Pane | null = null;
    private isRendererPaneVisible: boolean = false;

    private rafId: number | null = null;
    private mountElement: HTMLDivElement;
    private setCreditsCallback: (credits: Tiles3DAttributionCredits) => void;
    private routeData: RouteData | null = null;
    private freeFlyCameraMode: boolean = false;
    private stationIndicator: StationIndicator | null = null;
    private boundaryWall: BoundaryWall | null = null;


    constructor(mountElement: HTMLDivElement, setCreditsCallback: (credits: Tiles3DAttributionCredits) => void, routeData?: RouteData) {
        this.mountElement = mountElement;
        this.setCreditsCallback = setCreditsCallback;
        this.routeData = routeData || null;

        this.perfConfig = getPerformanceConfig();
        console.log('Performance preset:', this.perfConfig);

        this.animate = this.animate.bind(this);
        this.onWindowResize = this.onWindowResize.bind(this);
    }

    public init(): void {
        this.scene = new Scene();
        this.clock = new Clock();

        this.renderer = new WebGLRenderer({
            antialias: this.perfConfig.antialias,
            powerPreference: 'high-performance'
        });
        this.renderer.outputColorSpace = SRGBColorSpace;
        this.renderer.toneMapping = NeutralToneMapping;
        this.renderer.toneMappingExposure = 1.08;
        this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, this.perfConfig.pixelRatio));
        this.renderer.setSize(this.mountElement.clientWidth, this.mountElement.clientHeight);
        this.mountElement.appendChild(this.renderer.domElement);

        this.camera = new PerspectiveCamera(
            60,
            this.mountElement.clientWidth / this.mountElement.clientHeight,
            0.1,
            this.perfConfig.farPlane
        );
        this.camera.position.set(1e3, 1e3, 1e3).multiplyScalar(0.5);

        this.audioListener = new AudioListener();
        this.camera.add(this.audioListener);
        audioListener.value = this.audioListener;

        this.mapViewer = new MapViewer();

        this.sky = new Sky(this.scene);

        const trainConfig = getTrainConfiguration(nssgmTrainType);
        this.train = new Train(trainConfig, trainDebugMode.value);
        this.scene.add(this.train.group);

        if (trainDebugMode.value) {
            this.scene.add(this.train.globalDebugGroup);
        }

        trainInstance.value = this.train;
        trainMaxSpeedKmh.value = trainConfig.general?.maxSpeed ?? 120;

        this.gameCamera = new GameCamera(this.camera, this.renderer.domElement);
        this.gameCamera.snapTo(this.train.group.position);

        Input.init(this.renderer.domElement);

        this.stats = new Stats({
            trackGPU: true,
            trackHz: true,
            logsPerSecond: 20,
            graphsPerSecond: 30,
            samplesLog: 100,
            samplesGraph: 10,
            precision: 2,
            horizontal: true,
            minimal: false,
        });
        this.stats.init(this.renderer);
        this.mountElement.appendChild(this.stats.dom);
        this.stats.dom.style.display = 'none';

        const urlParams = new URLSearchParams(window.location.search);
        const urlStats = urlParams.get('stats');
        if (urlStats !== null) {
            this.toggleRendererUI();
        }

        window.addEventListener('resize', this.onWindowResize, false);

        this.animate();

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

        trainInstance.value = null;

        this.sky.cleanup();
        this.mapViewer.cleanup();
        this.train.cleanup();
        this.gameCamera.cleanup();

        if (this.flightControls) {
            this.flightControls.cleanup();
        }

        if (this.boundaryWall) {
            this.boundaryWall.dispose();
            this.boundaryWall = null;
        }

        if (this.stationIndicator) {
            this.stationIndicator.dispose();
            this.stationIndicator = null;
        }

        if (this.stats) {
            this.stats.dom.remove();
        }
        if (this.rendererPane) {
            this.rendererPane.dispose();
            this.rendererPane = null;
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

            if (!routeData) {
                console.warn('No route data provided');
                return;
            }
            console.log('Using provided route:', routeData.properties);

            if (!routeData?.geometry?.route || routeData.geometry.route.length < 2) {
                console.warn("No valid path found. Check the route data structure.");
                return;
            }

            // Route point format: [lon, lat, world_offset_x, world_offset_y, world_offset_z]
            const pathCoordinates = routeData.geometry.route;
            const [startLon, startLat] = pathCoordinates[0];

            if (!this.mapViewer.initialized) {
                this.mapViewer.init(this.scene, this.camera, this.renderer, startLat, startLon, 0, this.perfConfig);
            }
            this.mapViewer.reorient(startLat, startLon, 0);

            const pathPoints = pathCoordinates
                .map((routePoint: number[]) => {
                    return routePointToWorldPosition(routePoint, this.mapViewer);
                })
                .filter((p: Vector3 | null): p is Vector3 => p !== null);

            if (pathPoints.length < 2) {
                console.error('Not enough valid coordinates for path.');
                return;
            }

            const path = new Path(pathPoints);
            this.train.setPath(path);
            this.train.positionOnPath();

            // Store path so journey store can reactively compute stop distances
            trainPath.value = path;

            this.boundaryWall = new BoundaryWall(
                path.getStartPoint(),
                path.getEndPoint(),
                path.getStartDirection(),
                path.getEndDirection(),
                path.getTotalLength(),
                this.train.getTotalLength(),
            );
            this.scene.add(this.boundaryWall.group);

            updateTrainState();
            this.stationIndicator = new StationIndicator();
            this.stationIndicator.createIndicators(path);
            this.scene.add(this.stationIndicator.group);

            this.gameCamera.snapTo(this.train.group.position);
        } catch (error) {
            console.error('Failed to start path following:', error);
        }
    }

    private handleInput(): void {
        if (Input.isPressed('KeyC')) {
            this.gameCamera.cycleMode();
        }

        if (Input.isPressed('Backquote') && Input.isShift) {
            this.freeFlyCameraMode = !this.freeFlyCameraMode;

            if (this.freeFlyCameraMode) {
                if (!this.flightControls) {
                    this.flightControls = new FlightControls(this.camera, this.renderer.domElement);
                    this.flightControls.init();
                }
                console.log('Free-fly camera mode enabled (right-click to move camera)');
            }
        }

        if (Input.isPressed('F1')) this.sky.toggleUI();
        if (Input.isPressed('F2')) this.toggleRendererUI();

        Input.update();
    }


    private animate(): void {
        this.rafId = requestAnimationFrame(this.animate);
        const rawDeltaTime = this.clock.getDelta();
        const deltaTime = rawDeltaTime * timeScale.value;

        scaledDeltaTime.value = deltaTime;

        this.handleInput();
        updateTrainState();

        this.sky.update(deltaTime, this.camera);
        this.mapViewer.update();
        this.train.update(deltaTime);

        if (this.freeFlyCameraMode && this.flightControls) {
            this.flightControls.update(deltaTime);
        } else {
            this.gameCamera.update(deltaTime, this.train);
        }

        if (this.boundaryWall) {
            this.boundaryWall.update(
                this.train.distanceTraveled,
                this.train.getPower(),
                this.train.getVelocity(),
                deltaTime,
            );
        }

        if (this.stationIndicator) {
            this.stationIndicator.update(deltaTime);
        }

        this.camera.updateMatrixWorld();

        this.stats.begin();
        this.renderer.render(this.scene, this.camera);
        this.stats.end();
        this.stats.update();

        const trainCoords = this.mapViewer.getLatLonHeightFromWorldPosition(this.train.group.position);
        if (trainCoords) {
            trainLatE7.value = Math.round(trainCoords.lat * 1e7);
            trainLonE7.value = Math.round(trainCoords.lon * 1e7);

            // getLatLonHeightFromWorldPosition returns a reusable object — consume each result before the next call
            const cabRailPositions = this.train.getCabRailPositions();
            const frontCoords = this.mapViewer.getLatLonHeightFromWorldPosition(cabRailPositions.bogieFront);
            if (frontCoords) {
                trainFrontLatE7.value = Math.round(frontCoords.lat * 1e7);
                trainFrontLonE7.value = Math.round(frontCoords.lon * 1e7);
            }
            const backCoords = this.mapViewer.getLatLonHeightFromWorldPosition(cabRailPositions.bogieRear);
            if (backCoords) {
                trainBackLatE7.value = Math.round(backCoords.lat * 1e7);
                trainBackLonE7.value = Math.round(backCoords.lon * 1e7);
            }

            // Camera yaw relative to train (projected onto horizontal plane)
            dummyVec3.copy(this.camera.position).sub(this.train.group.position);
            dummyVec3.y = 0;
            const cameraAngle = Math.atan2(dummyVec3.x, dummyVec3.z) * MathUtils.RAD2DEG;

            dummyVec3B.set(0, 0, 1).applyQuaternion(this.train.group.quaternion);
            dummyVec3B.y = 0;
            const trainAngle = Math.atan2(dummyVec3B.x, dummyVec3B.z) * MathUtils.RAD2DEG;

            // +180 because camera looks at train, not from train
            let relativeYaw = cameraAngle - trainAngle + 180;
            if (relativeYaw < 0) relativeYaw += 360;
            if (relativeYaw >= 360) relativeYaw -= 360;
            cameraYawRelativeToTrain.value = relativeYaw;
        }
        if (this.mapViewer.initialized) {
            if (trainCoords) {
                const attribution = this.mapViewer.getCredits();
                this.setCreditsCallback(attribution);
            }
        }
    }

    private createRendererUI(): void {
        if (this.rendererPane) return;

        const rootDomContainer = document.getElementById('tweakpane-container');
        this.rendererPane = new Pane({ title: 'Renderer', container: rootDomContainer || undefined });

        this.rendererPane.addBinding(this.renderer, 'outputColorSpace', {
            options: {
                SRGB: SRGBColorSpace,
                Linear: LinearSRGBColorSpace,
            },
            label: 'output',
        });
        this.rendererPane.addBinding(this.renderer, 'toneMapping', {
            options: {
                None: NoToneMapping,
                Linear: LinearToneMapping,
                Reinhard: ReinhardToneMapping,
                Cineon: CineonToneMapping,
                ACES: ACESFilmicToneMapping,
                AgX: AgXToneMapping,
                Neutral: NeutralToneMapping,
            },
            label: 'toneMap',
        });
        this.rendererPane.addBinding(this.renderer, 'toneMappingExposure', {
            min: 0,
            max: 3,
            step: 0.01,
            label: 'exposure',
        });

        const infoFolder = this.rendererPane.addFolder({ title: 'Render Info' });
        infoFolder.addBinding(this.renderer.info.render, 'calls', { readonly: true, label: 'Draw Calls' });
        infoFolder.addBinding(this.renderer.info.render, 'triangles', { readonly: true, label: 'Triangles' });
        infoFolder.addBinding(this.renderer.info.render, 'lines', { readonly: true, label: 'Lines' });
        infoFolder.addBinding(this.renderer.info.render, 'points', { readonly: true, label: 'Points' });

        const memoryFolder = this.rendererPane.addFolder({ title: 'Memory' });
        memoryFolder.addBinding(this.renderer.info.memory, 'geometries', { readonly: true, label: 'Geometries' });
        memoryFolder.addBinding(this.renderer.info.memory, 'textures', { readonly: true, label: 'Textures' });

        if (!this.isRendererPaneVisible) {
            this.rendererPane.element.style.display = 'none';
        }
    }

    private toggleRendererUI(): void {
        if (!this.rendererPane) {
            this.createRendererUI();
        }

        this.isRendererPaneVisible = !this.isRendererPaneVisible;

        if (this.stats) {
            this.stats.dom.style.display = this.isRendererPaneVisible ? 'block' : 'none';
        }

        if (this.rendererPane) {
            this.rendererPane.element.style.display = this.isRendererPaneVisible ? 'block' : 'none';
        }
    }
}
