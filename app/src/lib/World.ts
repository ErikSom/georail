import {
    Scene,
    WebGLRenderer,
    PerspectiveCamera,
    Clock,
    Vector3,
    Matrix4,
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
import { type RouteData, type RoutePointMetadata } from './api/navigation';
import { routePointToWorldPosition } from './utils/CoordinateHelpers';
import { Sky } from './Sky';
import { Train } from './train/Train';
import { RailCorrector } from './train/RailCorrector';
import { Input } from './utils/Input';
import { FlightControls } from './utils/FlightControls';
import Path from './utils/Path';
import { dummyVec3, dummyVec3B } from './utils/Helper';
import { StationIndicator } from './StationIndicator';
import { BoundaryWall } from './BoundaryWall';
import { getCatalogEntry, getDefaultCatalogEntry, resolveTrainEntry } from './train/configs/TrainCatalog';
import Stats from 'stats-gl';
import { trainInstance, updateTrainState, trainDebugMode, trainLatE7, trainLonE7, trainFrontLatE7, trainFrontLonE7, trainBackLatE7, trainBackLonE7, cameraYawRelativeToTrain, trainMaxSpeedKmh, selectedTrainId } from '../store/train';
import { getPerformanceConfig, type PerformanceConfig } from './utils/PerformanceConfig';
import type { Tiles3DAttributionCredits } from '../components/HUD/Tiles3DAttribution';
import { Pane } from 'tweakpane';
import { audioListener, timeScale, scaledDeltaTime, gameConditions, ATMOSPHERE_COLOR } from '../store/globals';
import { trainPath, resumeCheckpointStopIndex } from '../store/journey';
import { gameReady } from '../store/app';
import { DitherOverlay } from './train/DitherOverlay';

export class World {
    private scene!: Scene;
    private camera!: PerspectiveCamera;
    private renderer!: WebGLRenderer;
    private clock!: Clock;
    private audioListener!: AudioListener;

    private gameCamera!: GameCamera;
    private flightControls: FlightControls | null = null;
    private train!: Train;
    private railCorrector: RailCorrector | null = null;
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

    // Look-ahead camera tuning. Tiles in front of the train must be high-LOD
    // by the time we get there, so we run a second virtual camera positioned
    // ~LOOKAHEAD_SECONDS of travel ahead on the path, capped by LOOKAHEAD_MAX_M.
    private static readonly LOOKAHEAD_SECONDS = 4;
    private static readonly LOOKAHEAD_MAX_M = 300;
    private static readonly LOOKAHEAD_MIN_VELOCITY_MS = 1;
    private static readonly LOOKAHEAD_AIM_OFFSET_M = 50;
    private static readonly LOOKAHEAD_HEIGHT_OFFSET_M = 30;
    private _lookaheadPos = new Vector3();
    private _lookaheadAim = new Vector3();


    constructor(mountElement: HTMLDivElement, setCreditsCallback: (credits: Tiles3DAttributionCredits) => void, routeData?: RouteData) {
        this.mountElement = mountElement;
        this.setCreditsCallback = setCreditsCallback;
        this.routeData = routeData || null;

        this.perfConfig = getPerformanceConfig();
        console.log('Performance preset:', this.perfConfig);

        this.animate = this.animate.bind(this);
        this.onWindowResize = this.onWindowResize.bind(this);
    }

    private trainDispose: (() => void) | null = null;

    public async init(): Promise<void> {
        this.scene = new Scene();
        this.clock = new Clock();

        this.renderer = new WebGLRenderer({
            antialias: this.perfConfig.antialias,
            powerPreference: 'high-performance',
            stencil: true,
        });
        this.renderer.outputColorSpace = SRGBColorSpace;
        this.renderer.toneMapping = NeutralToneMapping;
        this.renderer.toneMappingExposure = 1.08;
        this.renderer.setClearColor(ATMOSPHERE_COLOR, 1);
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
        this.mapViewer.onInitialized = () => { gameReady.value = true; };

        this.sky = new Sky(this.scene);

        // Apply game conditions from TravelPicker
        const conditions = gameConditions.value;
        if (conditions.timeOfDay >= 0) {
            this.sky.timeOfDay = conditions.timeOfDay;
            this.sky.simulateTime = false;
        }
        switch (conditions.weather) {
            case 'cloudy':
                this.sky.cloudCoverage = 0.7;
                break;
            case 'overcast':
                this.sky.cloudCoverage = 0.9;
                break;
            case 'rain':
                this.sky.cloudCoverage = 0.85;
                this.sky.rain.intensity = 0.6;
                this.sky.rain.fogDensity = 0.015;
                this.sky.sceneFogDensity = 0.00025;
                break;
            case 'heavy-rain':
                this.sky.cloudCoverage = 0.95;
                this.sky.rain.intensity = 0.9;
                this.sky.rain.fogDensity = 0.035;
                this.sky.sceneFogDensity = 0.0007;
                break;
        }

        const catalogEntry = getCatalogEntry(selectedTrainId.value) ?? getDefaultCatalogEntry();
        const resolved = await resolveTrainEntry(catalogEntry);
        const trainConfig = resolved.config;
        this.trainDispose = resolved.dispose;
        this.train = new Train(trainConfig, trainDebugMode.value);
        this.scene.add(this.train.group);

        const ditherOverlay = new DitherOverlay();
        ditherOverlay.setPixelRatio(this.renderer.getPixelRatio());
        this.scene.add(ditherOverlay.mesh);

        if (trainDebugMode.value) {
            this.scene.add(this.train.globalDebugGroup);
        }

        trainInstance.value = this.train;
        trainMaxSpeedKmh.value = trainConfig.display.topSpeedKmh;

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
        gameReady.value = false;

        this.sky.cleanup();
        this.mapViewer.cleanup();
        this.railCorrector?.dispose();
        this.railCorrector = null;
        this.train.cleanup();
        this.trainDispose?.();
        this.trainDispose = null;
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

            // Build pathPoints + aligned metadata in one pass so indices stay 1-to-1.
            const pathPoints: Vector3[] = [];
            const alignedMetadata: (RoutePointMetadata | null | undefined)[] = [];
            for (let idx = 0; idx < pathCoordinates.length; idx++) {
                const wp = routePointToWorldPosition(pathCoordinates[idx], this.mapViewer);
                if (wp === null) continue;
                pathPoints.push(wp);
                alignedMetadata.push(routeData.geometry.metadata?.[idx]);
            }

            if (pathPoints.length < 2) {
                console.error('Not enough valid coordinates for path.');
                return;
            }

            const path = new Path(pathPoints);
            if (routeData.geometry.turnaround_indices?.length) {
                path.setSegmentBoundaries(routeData.geometry.turnaround_indices);
            }
            this.train.setPath(path);

            this.railCorrector = new RailCorrector(path, alignedMetadata, this.mapViewer, this.train);

            // Position train at first station (or at resume checkpoint, if any).
            // The path may have extra nodes before the first station as padding.
            const stopIndices = routeData.geometry.stop_indices;
            const resumeIdx = resumeCheckpointStopIndex.value;
            const startStopIdx = (resumeIdx !== null && resumeIdx >= 0 && resumeIdx < (stopIndices?.length ?? 0))
                ? resumeIdx
                : 0;
            if (stopIndices && stopIndices.length > 0 && stopIndices[startStopIdx] > 0) {
                this.train.distanceTraveled = path.getDistanceAtPointIndex(stopIndices[startStopIdx]);
            }
            // Consume the checkpoint so a subsequent fresh journey starts at stop 0.
            if (resumeIdx !== null) resumeCheckpointStopIndex.value = null;

            this.train.positionOnPath();

            // Store path so journey store can reactively compute stop distances
            trainPath.value = path;

            this.rebuildBoundaryWall(path);

            updateTrainState();
            this.stationIndicator = new StationIndicator();
            this.stationIndicator.createIndicators(path);
            this.scene.add(this.stationIndicator.group);

            this.gameCamera.snapTo(this.train.group.position);

            // Register for automatic reorientation
            this.mapViewer.onReorient = (delta) => this.handleReorient(delta);
        } catch (error) {
            console.error('Failed to start path following:', error);
        }
    }

    private handleReorient(deltaMatrix: Matrix4): void {
        const path = this.train.getPath();
        if (!path) return;

        // Transform path points in-place (preserves distances — rigid transform)
        path.applyTransform(deltaMatrix);

        // Transform camera and its internal state so it follows smoothly
        this.gameCamera.applyTransform(deltaMatrix);

        // Rebuild boundary walls (cheap — just 2 meshes from path endpoints)
        if (this.boundaryWall) this.rebuildBoundaryWall(path);

        // Rebuild station indicator for current stop
        if (this.stationIndicator) {
            this.stationIndicator.group.parent?.remove(this.stationIndicator.group);
            this.stationIndicator = new StationIndicator();
            this.stationIndicator.createIndicators(path);
            this.scene.add(this.stationIndicator.group);
        }
    }

    private activeWallSegmentIndex = -1;

    private rebuildBoundaryWall(path: Path): void {
        if (this.boundaryWall) {
            this.boundaryWall.group.parent?.remove(this.boundaryWall.group);
            this.boundaryWall.dispose();
            this.boundaryWall = null;
        }

        const segIdx = this.train.getCurrentSegmentIndex();
        const bounds = path.getSegmentBounds(segIdx);
        const halfTrain = this.train.getTotalLength() / 2;
        const lastSeg = path.getSegmentCount() - 1;

        // First/last sub-paths overshoot at the route extremes; mid-route boundaries are hard stops.
        const minBound = segIdx === 0 ? bounds.startGlobal - halfTrain : bounds.startGlobal + halfTrain;
        const maxBound = segIdx === lastSeg ? bounds.endGlobal + halfTrain : bounds.endGlobal - halfTrain;

        const eps = 0.1;
        const rawStart = path.getPointAtDistance(bounds.startGlobal).clone();
        const startAhead = path.getPointAtDistance(bounds.startGlobal + eps);
        const startDir = startAhead.clone().sub(rawStart).normalize();
        const rawEnd = path.getPointAtDistance(bounds.endGlobal).clone();
        const endBehind = path.getPointAtDistance(bounds.endGlobal - eps);
        const endDir = rawEnd.clone().sub(endBehind).normalize();

        // BoundaryWall offsets by halfTrain on soft ends; counter-offset for hard mid-route boundaries.
        const hardStart = segIdx !== 0;
        const hardEnd = segIdx !== lastSeg;
        const startPoint = hardStart ? rawStart.clone().addScaledVector(startDir, halfTrain) : rawStart;
        const endPoint = hardEnd ? rawEnd.clone().addScaledVector(endDir, -halfTrain) : rawEnd;

        this.boundaryWall = new BoundaryWall(
            startPoint,
            endPoint,
            startDir,
            endDir,
            bounds.endGlobal - bounds.startGlobal,
            this.train.getTotalLength(),
            minBound,
            maxBound,
        );
        this.scene.add(this.boundaryWall.group);
        this.activeWallSegmentIndex = segIdx;
    }

    private updateLookaheadCamera(): void {
        const path = this.train?.getPath();
        if (!path || this.freeFlyCameraMode) {
            this.mapViewer.setLookahead(null, null);
            return;
        }

        const velocity = Math.abs(this.train.getVelocity());
        if (velocity < World.LOOKAHEAD_MIN_VELOCITY_MS) {
            // Stationary or near-stop — no extra refinement budget needed.
            this.mapViewer.setLookahead(null, null);
            return;
        }

        const lookahead = Math.min(velocity * World.LOOKAHEAD_SECONDS, World.LOOKAHEAD_MAX_M);
        const totalLen = path.getTotalLength();
        const aheadDist = Math.min(this.train.distanceTraveled + lookahead, totalLen);

        path.getPointAtDistance(aheadDist, this._lookaheadPos);
        path.getPointAtDistance(aheadDist + World.LOOKAHEAD_AIM_OFFSET_M, this._lookaheadAim);

        // Lift slightly so the frustum picks up tiles around train height + above.
        this._lookaheadPos.y += World.LOOKAHEAD_HEIGHT_OFFSET_M;

        this.mapViewer.setLookahead(this._lookaheadPos, this._lookaheadAim);
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
        this.railCorrector?.tick(performance.now());
        this.train.update(deltaTime);

        if (this.freeFlyCameraMode && this.flightControls) {
            this.flightControls.update(deltaTime);
        } else {
            this.gameCamera.update(deltaTime, this.train);
        }

        this.updateLookaheadCamera();

        if (this.boundaryWall && trainPath.value) {
            if (this.train.getCurrentSegmentIndex() !== this.activeWallSegmentIndex) {
                this.rebuildBoundaryWall(trainPath.value);
            }
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

            // Camera look direction on ground plane — use forward vector,
            // fall back to camera up vector when looking nearly straight down
            dummyVec3.set(0, 0, -1).applyQuaternion(this.camera.quaternion);
            const fwdX = dummyVec3.x, fwdZ = dummyVec3.z;
            const fwdHorizSq = fwdX * fwdX + fwdZ * fwdZ;

            let camBearingX: number, camBearingZ: number;
            if (fwdHorizSq > 0.01) {
                camBearingX = fwdX;
                camBearingZ = fwdZ;
            } else {
                // Nearly vertical view — screen "up" direction on the ground
                dummyVec3.set(0, 1, 0).applyQuaternion(this.camera.quaternion);
                camBearingX = dummyVec3.x;
                camBearingZ = dummyVec3.z;
            }

            const cameraLookAngle = Math.atan2(camBearingX, camBearingZ) * MathUtils.RAD2DEG;

            dummyVec3B.set(0, 0, 1).applyQuaternion(this.train.group.quaternion);
            dummyVec3B.y = 0;
            const trainAngle = Math.atan2(dummyVec3B.x, dummyVec3B.z) * MathUtils.RAD2DEG;

            let relativeYaw = cameraLookAngle - trainAngle;
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
