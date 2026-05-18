import {
    Scene,
    WebGLRenderer,
    PerspectiveCamera,
    Clock,
    Vector3,
    Fog,
    AmbientLight,
    DirectionalLight,
    DirectionalLightHelper,
    SpotLight,
    SpotLightHelper,
    SRGBColorSpace,
    NeutralToneMapping,
    Mesh,
    BoxGeometry,
    MeshStandardMaterial,
    InstancedMesh,
    Object3D,
    AudioListener,
    Color,
} from 'three';
import { Train } from './train/Train';
import Path from './utils/Path';
import { getCatalogEntry, getDefaultCatalogEntry, resolveTrainEntry } from './train/configs/TrainCatalog';
import { audioListener } from '../store/globals';
import { trainVelocityKmh, trainPower, trainTractiveEffort, trainDebugMode } from '../store/train';

const TWEEN_AUDIO_VELOCITY_KMH = 55;
const TWEEN_AUDIO_POWER = 0.45;
const TWEEN_TRACTIVE_EFFORT = 0.55;
const ENTER_VELOCITY_INHERIT = 0.3;

const PATH_TOTAL_LENGTH = 1000;
// Where the cab front nose comes to rest in world Z. Picked to match where
// NS-SGM (the original built-in) used to stop, so shorter trains line up at
// the same spot regardless of consist length.
const TARGET_CAB_NOSE_Z = 18;
const SPAWN_OFFSET = -240;
const EXIT_MARGIN = 6;
const EXIT_DURATION_MS = 650;
const ENTER_DURATION_MS = 950;
const SWAP_SPINNER_MIN_MS = 380;
const INITIAL_SPINNER_MIN_MS = 300;

const FOG_COLOR = 0x05080d;

const CAMERA_OFFSET_X = 6.0;
const CAMERA_OFFSET_Y = 1.5;
const CAMERA_OFFSET_Z = 13;
const BASE_ASPECT = 16 / 9;
const MIN_DIST_SCALE = 0.7;
const TARGET_CAB_NDC_X = -0.4;
const MAX_LOOKAT_SHIFT = 40;

type PickerPhase = 'pre-load' | 'idle' | 'exiting' | 'swapping' | 'entering';

function easeInCubic(t: number): number {
    return t * t * t;
}

function easeOutCubic(t: number): number {
    const u = 1 - t;
    return 1 - u * u * u;
}

export type LoadingChangeCallback = (loading: boolean) => void;

export class TrainPickerWorld {
    private scene!: Scene;
    private camera!: PerspectiveCamera;
    private renderer!: WebGLRenderer;
    private clock!: Clock;
    private listener!: AudioListener;

    private train!: Train;
    private ambient!: AmbientLight;
    private rim!: DirectionalLight;
    private key!: SpotLight;
    private rimHelper: DirectionalLightHelper | null = null;
    private keyHelper: SpotLightHelper | null = null;

    private showcaseTarget = new Vector3(0, 1.4, 0);

    private rafId: number | null = null;
    private mountElement: HTMLDivElement;
    private swapTimeoutId: number | null = null;
    private onLoadingChange: LoadingChangeCallback | null;
    private currentDispose: (() => void) | null = null;

    private currentTrainId: string;
    private pendingTrainId: string;
    private phase: PickerPhase = 'pre-load';
    private phaseStartMs = 0;
    private phaseDurationMs = 0;
    private distanceStart = 0;
    private distanceEnd = 0;

    constructor(
        mountElement: HTMLDivElement,
        initialTrainId: string,
        onLoadingChange: LoadingChangeCallback | null = null
    ) {
        this.mountElement = mountElement;
        this.currentTrainId = initialTrainId;
        this.pendingTrainId = initialTrainId;
        this.onLoadingChange = onLoadingChange;
        this.animate = this.animate.bind(this);
        this.onWindowResize = this.onWindowResize.bind(this);
    }

    public async init(): Promise<void> {
        this.scene = new Scene();
        this.scene.background = new Color(FOG_COLOR);
        this.scene.fog = new Fog(FOG_COLOR, 14, 160);

        this.clock = new Clock();

        this.renderer = new WebGLRenderer({ antialias: true });
        this.renderer.outputColorSpace = SRGBColorSpace;
        this.renderer.toneMapping = NeutralToneMapping;
        this.renderer.toneMappingExposure = 1.0;
        this.renderer.setClearColor(FOG_COLOR, 1);
        this.renderer.setPixelRatio(window.devicePixelRatio);
        this.renderer.setSize(this.mountElement.clientWidth, this.mountElement.clientHeight);
        this.mountElement.appendChild(this.renderer.domElement);

        this.camera = new PerspectiveCamera(
            40,
            this.mountElement.clientWidth / this.mountElement.clientHeight,
            0.5,
            500
        );

        this.listener = new AudioListener();
        this.camera.add(this.listener);
        audioListener.value = this.listener;

        this.ambient = new AmbientLight(0x6080a0, 0.35);
        this.scene.add(this.ambient);

        this.rim = new DirectionalLight(0x6688aa, 0.7);
        this.scene.add(this.rim);
        this.scene.add(this.rim.target);

        this.key = new SpotLight(0xfff0d0, 80, 90, Math.PI / 2.4, 0.7, 0.8);
        this.scene.add(this.key);
        this.scene.add(this.key.target);

        if (trainDebugMode.value) {
            this.rimHelper = new DirectionalLightHelper(this.rim, 2, 0x66ccff);
            this.keyHelper = new SpotLightHelper(this.key, 0xffcc44);
            this.scene.add(this.rimHelper);
            this.scene.add(this.keyHelper);
        }

        this.buildRail();

        this.onLoadingChange?.(true);
        const initial = await this.resolveByCatalogId(this.currentTrainId);
        this.currentDispose = initial.dispose;
        this.train = new Train(initial.config, false);
        this.scene.add(this.train.group);
        this.train.setScene(this.scene);

        const path = new Path(this.buildStraightPath());
        this.train.setPath(path);

        const showcase = this.showcaseDistance();
        this.train.distanceTraveled = showcase;
        this.train.positionOnPath();
        this.train.group.updateMatrixWorld(true);
        this.showcaseTarget.copy(this.train.getCabinWorldPosition());

        this.train.distanceTraveled = showcase + SPAWN_OFFSET;
        this.train.positionOnPath();
        this.train.setPower(0);

        this.applyFraming();

        window.addEventListener('resize', this.onWindowResize);
        this.animate();

        const minDelay = new Promise<void>(resolve => setTimeout(resolve, INITIAL_SPINNER_MIN_MS));
        Promise.all([this.train.ready, minDelay]).then(async () => {
            if (this.rafId === null) return;
            await this.applyPendingConfig();
            this.onLoadingChange?.(false);
            this.startEnter();
        });
    }

    private async resolveByCatalogId(trainId: string) {
        const entry = getCatalogEntry(trainId) ?? getDefaultCatalogEntry();
        if (!entry) throw new Error(`TrainPickerWorld: unknown catalog id "${trainId}"`);
        return resolveTrainEntry(entry);
    }

    private buildStraightPath(): Vector3[] {
        const points: Vector3[] = [];
        const half = PATH_TOTAL_LENGTH / 2;
        const numPoints = 64;
        for (let i = 0; i < numPoints; i++) {
            const t = i / (numPoints - 1);
            const z = -half + PATH_TOTAL_LENGTH * t;
            points.push(new Vector3(0, 0, z));
        }
        return points;
    }

    private buildRail(): void {
        const gauge = 1.435;
        const railLength = 260;
        const railGeom = new BoxGeometry(0.1, 0.12, railLength);
        const railMat = new MeshStandardMaterial({
            color: 0x6a6c70,
            roughness: 0.4,
            metalness: 0.85,
        });
        const leftRail = new Mesh(railGeom, railMat);
        leftRail.position.set(-gauge / 2, 0.06, 0);
        const rightRail = new Mesh(railGeom, railMat);
        rightRail.position.set(gauge / 2, 0.06, 0);
        this.scene.add(leftRail);
        this.scene.add(rightRail);

        const sleeperGeom = new BoxGeometry(2.6, 0.08, 0.22);
        const sleeperMat = new MeshStandardMaterial({
            color: 0x2a2522,
            roughness: 0.9,
            metalness: 0.05,
        });
        const sleeperSpacing = 0.6;
        const sleeperCount = Math.floor(railLength / sleeperSpacing);
        const sleepers = new InstancedMesh(sleeperGeom, sleeperMat, sleeperCount);
        const dummy = new Object3D();
        const startZ = -railLength / 2;
        for (let i = 0; i < sleeperCount; i++) {
            dummy.position.set(0, -0.02, startZ + i * sleeperSpacing);
            dummy.updateMatrix();
            sleepers.setMatrixAt(i, dummy.matrix);
        }
        sleepers.instanceMatrix.needsUpdate = true;
        this.scene.add(sleepers);
    }

    public selectTrain(id: string): void {
        if (!getCatalogEntry(id)) return;
        this.pendingTrainId = id;

        if (id === this.currentTrainId) return;

        if (this.phase === 'idle' || this.phase === 'entering') {
            this.startExit();
        }
    }

    private setAudioMoving(moving: boolean): void {
        trainVelocityKmh.value = moving ? TWEEN_AUDIO_VELOCITY_KMH : 0;
        trainPower.value = moving ? TWEEN_AUDIO_POWER : 0;
        trainTractiveEffort.value = moving ? TWEEN_TRACTIVE_EFFORT : 0;
    }

    private startExit(): void {
        this.phase = 'exiting';
        this.phaseStartMs = performance.now();
        this.phaseDurationMs = EXIT_DURATION_MS;
        this.distanceStart = this.train.distanceTraveled;
        const cameraZRelative = this.camera.position.z - this.showcaseTarget.z;
        const trainLength = this.train.getTotalLength();
        this.distanceEnd = this.showcaseDistance() + cameraZRelative + trainLength + EXIT_MARGIN;
        this.train.setVelocityInheritOverride(null);
        this.setAudioMoving(true);
    }

    // Per-train showcase distance: anchors the cab nose at TARGET_CAB_NOSE_Z in
    // world space, so a 2-car cab + a 3-car consist both stop at the same spot.
    private showcaseDistance(): number {
        return TARGET_CAB_NOSE_Z + PATH_TOTAL_LENGTH / 2 - this.train.getTotalLength() / 2;
    }

    private startSwap(): void {
        this.phase = 'swapping';
        this.setAudioMoving(false);
        this.onLoadingChange?.(true);
        // Hide while we swap configs. updateConfig() repositions kept-over
        // rolling stock with the new train's offsets, which can land their
        // (still-old) GLBs in the visible area before the new models load in.
        this.train.group.visible = false;
        this.swapTimeoutId = window.setTimeout(async () => {
            this.swapTimeoutId = null;
            await this.applyPendingConfig();
            this.onLoadingChange?.(false);
            this.startEnter();
        }, SWAP_SPINNER_MIN_MS);
    }

    private async applyPendingConfig(): Promise<void> {
        if (this.pendingTrainId === this.currentTrainId) return;
        const next = getCatalogEntry(this.pendingTrainId);
        if (!next) {
            this.currentTrainId = this.pendingTrainId;
            return;
        }
        const resolved = await resolveTrainEntry(next);
        this.train.updateConfig(resolved.config);
        // Wait for every rolling stock's new GLB to be parsed and swapped in
        // before allowing the enter tween — otherwise the old meshes drive on
        // and pop into the new ones mid-animation.
        await this.train.assetsReady();
        this.currentDispose?.();
        this.currentDispose = resolved.dispose;
        this.currentTrainId = this.pendingTrainId;
    }

    private startEnter(): void {
        const showcase = this.showcaseDistance();
        this.train.distanceTraveled = showcase + SPAWN_OFFSET;
        this.train.positionOnPath();
        this.train.group.visible = true;
        this.train.setVelocityInheritOverride(ENTER_VELOCITY_INHERIT);

        this.phase = 'entering';
        this.phaseStartMs = performance.now();
        this.phaseDurationMs = ENTER_DURATION_MS;
        this.distanceStart = showcase + SPAWN_OFFSET;
        this.distanceEnd = showcase;
        this.setAudioMoving(true);
    }

    private finishEnter(): void {
        this.train.distanceTraveled = this.showcaseDistance();
        this.train.positionOnPath();
        this.phase = 'idle';
        this.setAudioMoving(false);
        this.train.flashFrontCabLights();

        if (this.pendingTrainId !== this.currentTrainId) {
            this.startExit();
        }
    }

    private updateTween(nowMs: number): void {
        if (this.phase !== 'exiting' && this.phase !== 'entering') return;
        const elapsed = nowMs - this.phaseStartMs;
        const t = Math.min(1, elapsed / this.phaseDurationMs);
        const eased = this.phase === 'exiting' ? easeInCubic(t) : easeOutCubic(t);
        this.train.distanceTraveled = this.distanceStart + (this.distanceEnd - this.distanceStart) * eased;
        this.train.positionOnPath();

        if (t >= 1) {
            if (this.phase === 'exiting') {
                this.startSwap();
            } else {
                this.finishEnter();
            }
        }
    }

    private onWindowResize(): void {
        const width = this.mountElement.clientWidth;
        const height = this.mountElement.clientHeight;
        this.camera.aspect = width / height;
        this.renderer.setSize(width, height);
        this.camera.updateProjectionMatrix();
        this.renderer.setPixelRatio(window.devicePixelRatio);
        this.applyFraming();
    }

    private applyFraming(): void {
        const target = this.showcaseTarget;
        const aspect = this.camera.aspect;
        const distScale = aspect > BASE_ASPECT
            ? Math.max(MIN_DIST_SCALE, BASE_ASPECT / aspect)
            : 1.0;
        const offsetX = CAMERA_OFFSET_X * distScale;
        const offsetY = CAMERA_OFFSET_Y * distScale;
        const offsetZ = CAMERA_OFFSET_Z * distScale;

        const lookAtYBias = aspect > 1.5 ? -1.0 : 0;

        const lookAtShift = this.solveLookAtShift(offsetX, offsetY, offsetZ);
        const lookAtX = target.x;
        const lookAtY = target.y + lookAtYBias;
        const lookAtZ = target.z - lookAtShift;

        this.camera.position.set(
            target.x + offsetX,
            target.y + offsetY,
            target.z + offsetZ
        );
        this.camera.lookAt(lookAtX, lookAtY, lookAtZ);

        this.key.position.set(target.x + 2, target.y + 14, target.z + 12);
        this.key.target.position.set(lookAtX, lookAtY - 0.2, lookAtZ);
        this.rim.position.set(lookAtX + 6, lookAtY + 6.6, lookAtZ - 12);
        this.rim.target.position.set(lookAtX, lookAtY - 0.4, lookAtZ);

        this.key.target.updateMatrixWorld();
        this.rim.target.updateMatrixWorld();
        this.keyHelper?.update();
        this.rimHelper?.update();
    }

    // With camera offset (X,Y,Z) from showcaseTarget and lookAt at (0,0,-s)
    // relative, the cab front projects to tangent_x = -X·s / (X² + Y² + Z² + Z·s)
    // and NDC_x = tangent_x / (tan(fov_v/2) · aspect). Solve for s so the cab
    // lands at NDC_x = TARGET_CAB_NDC_X for the current aspect.
    private solveLookAtShift(X: number, Y: number, Z: number): number {
        const fovV = (this.camera.fov * Math.PI) / 180;
        const tanFovH = Math.tan(fovV / 2) * this.camera.aspect;
        const k = -TARGET_CAB_NDC_X * tanFovH;
        const denom = X - k * Z;
        if (denom <= 0.001) return 0;
        const s = (k * (X * X + Y * Y + Z * Z)) / denom;
        return Math.max(0, Math.min(MAX_LOOKAT_SHIFT, s));
    }

    private animate(): void {
        this.rafId = requestAnimationFrame(this.animate);
        const deltaTime = this.clock.getDelta();

        this.updateTween(performance.now());

        this.train.update(deltaTime);

        this.renderer.render(this.scene, this.camera);
    }

    public cleanup(): void {
        if (this.rafId) {
            cancelAnimationFrame(this.rafId);
            this.rafId = null;
        }
        if (this.swapTimeoutId !== null) {
            window.clearTimeout(this.swapTimeoutId);
            this.swapTimeoutId = null;
        }
        window.removeEventListener('resize', this.onWindowResize);

        this.setAudioMoving(false);
        this.train.cleanup();
        this.currentDispose?.();
        this.currentDispose = null;

        if (this.rimHelper) {
            this.scene.remove(this.rimHelper);
            this.rimHelper.dispose();
            this.rimHelper = null;
        }
        if (this.keyHelper) {
            this.scene.remove(this.keyHelper);
            this.keyHelper.dispose();
            this.keyHelper = null;
        }

        this.renderer.dispose();

        if (this.mountElement && this.renderer.domElement.parentElement === this.mountElement) {
            this.mountElement.removeChild(this.renderer.domElement);
        }
    }
}
