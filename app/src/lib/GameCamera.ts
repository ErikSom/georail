import {
    PerspectiveCamera,
    Vector3,
    Quaternion,
    Box3,
    MOUSE,
    TOUCH,
} from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import type { Train } from './train/Train';

export type CameraMode = 'free' | 'cockpit' | 'side' | 'top' | 'cinematic';

const CAMERA_MODES: CameraMode[] = ['free', 'cockpit', 'side', 'top', 'cinematic'];

const COCKPIT_ORBIT_MAX_ANGLE = Math.PI / 3;
const COCKPIT_ORBIT_VERTICAL_MAX = Math.PI / 6;

// Free-mode zoom range. 200 km is enough to frame roughly half of the
// Netherlands from above.
const FREE_MIN_DISTANCE = 10;
const EXTERNAL_FOLLOW_MIN_DISTANCE = 22;
const FREE_MAX_DISTANCE = 200_000;
// Free-mode pitch clamp ramps from "almost horizontal" at close range to
// "near top-down" at far range. Ramp uses log-distance so the feel of zooming
// stays consistent across orders of magnitude.
const FREE_PITCH_NEAR_DIST = 80;
const FREE_PITCH_FAR_DIST = 40_000;
const FREE_PITCH_MAX_NEAR = Math.PI / 2 - 0.1; // ~89° from up = near-horizontal
const FREE_PITCH_MAX_FAR = 0.12;               // ~7° from up = nearly top-down
const FAR_MAP_EDGE_PAN_MARGIN_PX = 96;
const FAR_MAP_EDGE_PAN_MAX_SPEED_PX = 520;

export class GameCamera {
    public camera: PerspectiveCamera;
    public controls: OrbitControls;
    public mode: CameraMode = 'free';

    private smoothing = 3.0;
    private currentTarget = new Vector3();
    private cinematicAngle = 0;
    private zoomDistance = 200;

    private domElement: HTMLElement;
    private boundOnWheel: (e: WheelEvent) => void;

    private cockpitInitialized = false;

    private _delta = new Vector3();
    private _trainPos = new Vector3();
    private _trainQuat = new Quaternion();
    private _localOffset = new Vector3();
    private _trainUp = new Vector3();
    private _externalTarget = new Vector3();
    private _panClampDelta = new Vector3();
    private _panRight = new Vector3();
    private _panUp = new Vector3();
    private hasExternalTarget = false;
    private farMapDotViewActive = false;
    private farMapPanActive = false;
    private farMapPanBounds = new Box3();
    private hasFarMapPanBounds = false;
    private userPannedFarMap = false;
    private pointerInCanvas = false;
    private pointerButtons = 0;
    private pointerX = 0;
    private pointerY = 0;
    private boundOnPointerMove: (e: PointerEvent) => void;
    private boundOnPointerDown: (e: PointerEvent) => void;
    private boundOnPointerUp: () => void;
    private boundOnWindowBlur: () => void;

    constructor(camera: PerspectiveCamera, domElement: HTMLElement) {
        this.camera = camera;
        this.domElement = domElement;

        this.controls = new OrbitControls(this.camera, this.domElement);
        this.controls.minDistance = FREE_MIN_DISTANCE;
        this.controls.maxDistance = FREE_MAX_DISTANCE;
        this.controls.minPolarAngle = 0;
        this.controls.maxPolarAngle = FREE_PITCH_MAX_NEAR;
        this.controls.enableDamping = true;
        this.controls.autoRotate = false;
        this.controls.enablePan = false;
        this.controls.enableRotate = true;

        this.boundOnWheel = this.onWheel.bind(this);
        this.boundOnPointerMove = this.onPointerMove.bind(this);
        this.boundOnPointerDown = (event: PointerEvent) => { this.pointerButtons = event.buttons; };
        this.boundOnPointerUp = () => { this.pointerButtons = 0; };
        this.boundOnWindowBlur = () => {
            this.pointerInCanvas = false;
            this.pointerButtons = 0;
        };
        this.domElement.addEventListener('wheel', this.boundOnWheel, { passive: false });
        window.addEventListener('pointermove', this.boundOnPointerMove, { passive: true });
        window.addEventListener('pointerdown', this.boundOnPointerDown, { passive: true });
        window.addEventListener('pointerup', this.boundOnPointerUp, { passive: true });
        window.addEventListener('pointercancel', this.boundOnPointerUp, { passive: true });
        window.addEventListener('blur', this.boundOnWindowBlur);
    }

    private onPointerMove(event: PointerEvent): void {
        if (event.pointerType && event.pointerType !== 'mouse') return;
        this.pointerButtons = event.buttons;
        const rect = this.domElement.getBoundingClientRect();
        this.pointerInCanvas =
            event.clientX >= rect.left &&
            event.clientX <= rect.right &&
            event.clientY >= rect.top &&
            event.clientY <= rect.bottom;
        this.pointerX = event.clientX - rect.left;
        this.pointerY = event.clientY - rect.top;
    }

    private onWheel(event: WheelEvent): void {
        if (this.mode === 'free' || this.mode === 'cockpit') return;

        event.preventDefault();
        event.stopPropagation();

        const zoomSpeed = 5;
        this.zoomDistance += event.deltaY * zoomSpeed * 0.01;
        this.zoomDistance = Math.max(20, Math.min(500, this.zoomDistance));
    }

    public cycleMode(): void {
        const idx = CAMERA_MODES.indexOf(this.mode);
        const nextMode = CAMERA_MODES[(idx + 1) % CAMERA_MODES.length];
        this.setMode(nextMode);
    }

    public setMode(mode: CameraMode): void {
        const prevMode = this.mode;
        this.mode = mode;

        if (mode === 'cinematic' && prevMode !== 'cinematic') {
            this._delta.copy(this.camera.position).sub(this.currentTarget);
            this._delta.y = 0;
            this.cinematicAngle = Math.atan2(this._delta.z, this._delta.x);
        }

        if (mode === 'cockpit') {
            this.setFarMapDotView(false);
            this.controls.enabled = true;
            this.controls.enableDamping = false;
            this.controls.enableZoom = false;
            this.controls.minDistance = 0;
            this.controls.maxDistance = 0.01;
            this.controls.minPolarAngle = Math.PI / 2 - COCKPIT_ORBIT_VERTICAL_MAX;
            this.controls.maxPolarAngle = Math.PI / 2 + COCKPIT_ORBIT_VERTICAL_MAX;
            this.controls.minAzimuthAngle = -COCKPIT_ORBIT_MAX_ANGLE;
            this.controls.maxAzimuthAngle = COCKPIT_ORBIT_MAX_ANGLE;
            this.cockpitInitialized = false;
        } else {
            this.controls.enableDamping = true;
            this.controls.enabled = mode === 'free';
            this.controls.enableZoom = true;
            this.controls.enableRotate = true;
            this.controls.enablePan = this.farMapPanActive;
            this.controls.minDistance = this.hasExternalTarget
                ? EXTERNAL_FOLLOW_MIN_DISTANCE
                : FREE_MIN_DISTANCE;
            this.controls.maxDistance = FREE_MAX_DISTANCE;
            this.controls.minPolarAngle = 0;
            this.controls.maxPolarAngle = FREE_PITCH_MAX_NEAR;
            this.controls.minAzimuthAngle = -Infinity;
            this.controls.maxAzimuthAngle = Infinity;
        }
    }

    public snapTo(position: Vector3): void {
        this.currentTarget.copy(position);
        this.controls.target.copy(position);
        this.camera.position.set(
            position.x + 50,
            position.y + 50,
            position.z + 50,
        );
        this.controls.update();
    }

    public setExternalFollowTarget(position: Vector3 | null): void {
        if (!position) {
            this.hasExternalTarget = false;
            if (this.mode === 'free') {
                this.controls.minDistance = FREE_MIN_DISTANCE;
            }
            return;
        }
        if (!this.hasExternalTarget && this.farMapPanActive) {
            this.currentTarget.copy(this.controls.target);
            this.farMapPanActive = false;
            this.hasFarMapPanBounds = false;
            this.userPannedFarMap = false;
            this.applyFarMapPanControlState();
        }
        this._externalTarget.copy(position);
        this.hasExternalTarget = true;
        this.controls.minDistance = EXTERNAL_FOLLOW_MIN_DISTANCE;
        if (this.mode !== 'free') {
            this.setMode('free');
        }
    }

    public setFarMapDotView(enabled: boolean, bounds?: Box3 | null): void {
        const nextDotViewActive = enabled && this.mode === 'free';
        const nextPanActive = nextDotViewActive && !this.hasExternalTarget && bounds?.isEmpty() === false;

        if (this.farMapPanActive && !nextPanActive) {
            this.currentTarget.copy(this.controls.target);
        }

        if (nextPanActive) {
            this.hasFarMapPanBounds = bounds?.isEmpty() === false;
            if (this.hasFarMapPanBounds && bounds) {
                this.farMapPanBounds.copy(bounds);
            }
        } else {
            this.hasFarMapPanBounds = false;
        }

        if (this.farMapDotViewActive === nextDotViewActive && this.farMapPanActive === nextPanActive) {
            this.applyFarMapPanControlState();
            return;
        }

        this.farMapDotViewActive = nextDotViewActive;
        this.farMapPanActive = nextPanActive;
        this.userPannedFarMap = false;
        this.applyFarMapPanControlState();
    }

    public shouldFreezeFarMapYaw(): boolean {
        return this.farMapDotViewActive && this.pointerButtons === 0;
    }

    private applyFarMapPanControlState(): void {
        if (!this.farMapDotViewActive) {
            this.controls.enablePan = false;
            this.controls.enableRotate = true;
            this.controls.screenSpacePanning = true;
            this.controls.mouseButtons.LEFT = MOUSE.ROTATE;
            this.controls.touches.ONE = TOUCH.ROTATE;
            return;
        }

        this.controls.enabled = this.mode === 'free';
        this.controls.enablePan = this.farMapPanActive;
        this.controls.enableRotate = true;
        this.controls.screenSpacePanning = false;
        this.controls.mouseButtons.LEFT = MOUSE.ROTATE;
        this.controls.touches.ONE = TOUCH.ROTATE;
        this.controls.touches.TWO = TOUCH.DOLLY_PAN;
    }

    public update(dt: number, train: Train): void {
        if (this.hasExternalTarget) {
            const t = 1 - Math.exp(-this.smoothing * dt);
            this.currentTarget.lerp(this._externalTarget, t);
            this.updateFree(dt);
            return;
        }

        const desired = train.getActiveCabinWorldPosition();

        if (this.mode === 'cockpit') {
            this.currentTarget.copy(desired);
        } else {
            const t = 1 - Math.exp(-this.smoothing * dt);
            this.currentTarget.lerp(desired, t);
        }

        switch (this.mode) {
            case 'free':
                this.updateFree(dt);
                break;
            case 'cockpit':
                this.updateCockpit(train);
                break;
            case 'side':
                this.updateSide(train);
                break;
            case 'top':
                this.updateTop(train);
                break;
            case 'cinematic':
                this.updateCinematic(dt, train);
                break;
        }
    }

    private updateCockpit(train: Train): void {
        if (!this.cockpitInitialized) {
            this.camera.position.copy(this.currentTarget);

            const rollingStock = train.getRollingStockTransform(0);
            rollingStock.getWorldQuaternion(this._trainQuat);
            this._delta.set(0, 0, 1).applyQuaternion(this._trainQuat);
            this._delta.multiplyScalar(train.getEffectiveDirection());

            this.controls.target.copy(this.camera.position).addScaledVector(this._delta, 0.01);

            // Center azimuth limits around train's current forward direction
            this._localOffset.copy(this.camera.position).sub(this.controls.target);
            const currentAzimuth = Math.atan2(this._localOffset.x, this._localOffset.z);
            this.controls.minAzimuthAngle = currentAzimuth - COCKPIT_ORBIT_MAX_ANGLE;
            this.controls.maxAzimuthAngle = currentAzimuth + COCKPIT_ORBIT_MAX_ANGLE;

            this.controls.update();
            this.cockpitInitialized = true;
            return;
        }

        // Translate both camera and target to follow train, preserving user's look direction
        this._delta.copy(this.currentTarget).sub(this.camera.position);
        this.camera.position.add(this._delta);
        this.controls.target.add(this._delta);
        this.controls.update();
    }

    private updateFree(dt = 0): void {
        if (!this.farMapPanActive) {
            this._delta.copy(this.currentTarget).sub(this.controls.target);
            this.controls.target.add(this._delta);
            this.camera.position.add(this._delta);
        }

        const distance = this.camera.position.distanceTo(this.controls.target);
        const logNear = Math.log(FREE_PITCH_NEAR_DIST);
        const logFar = Math.log(FREE_PITCH_FAR_DIST);
        const t = Math.max(0, Math.min(1,
            (Math.log(Math.max(distance, FREE_PITCH_NEAR_DIST)) - logNear) / (logFar - logNear)
        ));
        this.controls.maxPolarAngle =
            FREE_PITCH_MAX_NEAR + (FREE_PITCH_MAX_FAR - FREE_PITCH_MAX_NEAR) * t;

        this.applyFarMapEdgePan(dt);
        this.controls.update();
        this.clampFarMapPan();

        if (this.farMapPanActive && this.controls.target.distanceToSquared(this.currentTarget) > 0.01) {
            this.userPannedFarMap = true;
        }
        if (!this.farMapPanActive || !this.userPannedFarMap) {
            this.currentTarget.copy(this.controls.target);
        }
    }

    private applyFarMapEdgePan(dt: number): void {
        if (!this.farMapPanActive || !this.pointerInCanvas || this.pointerButtons !== 0 || dt <= 0) return;

        const width = this.domElement.clientWidth;
        const height = this.domElement.clientHeight;
        if (width <= 0 || height <= 0) return;

        let edgeX = 0;
        let edgeY = 0;
        if (this.pointerX < FAR_MAP_EDGE_PAN_MARGIN_PX) {
            edgeX = -(1 - Math.max(0, this.pointerX) / FAR_MAP_EDGE_PAN_MARGIN_PX);
        } else if (this.pointerX > width - FAR_MAP_EDGE_PAN_MARGIN_PX) {
            edgeX = (this.pointerX - (width - FAR_MAP_EDGE_PAN_MARGIN_PX)) / FAR_MAP_EDGE_PAN_MARGIN_PX;
        }
        if (this.pointerY < FAR_MAP_EDGE_PAN_MARGIN_PX) {
            edgeY = -(1 - Math.max(0, this.pointerY) / FAR_MAP_EDGE_PAN_MARGIN_PX);
        } else if (this.pointerY > height - FAR_MAP_EDGE_PAN_MARGIN_PX) {
            edgeY = (this.pointerY - (height - FAR_MAP_EDGE_PAN_MARGIN_PX)) / FAR_MAP_EDGE_PAN_MARGIN_PX;
        }

        if (edgeX === 0 && edgeY === 0) return;

        const targetDistance = this.camera.position.distanceTo(this.controls.target);
        const worldUnitsPerPixel =
            (2 * targetDistance * Math.tan((this.camera.fov / 2) * Math.PI / 180)) /
            Math.max(1, height);
        const panDistance = FAR_MAP_EDGE_PAN_MAX_SPEED_PX * Math.min(dt, 0.05) * worldUnitsPerPixel;

        this._panRight.setFromMatrixColumn(this.camera.matrixWorld, 0);
        this._panRight.y = 0;
        this._panUp.setFromMatrixColumn(this.camera.matrixWorld, 1);
        this._panUp.y = 0;
        if (this._panRight.lengthSq() < 0.0001 || this._panUp.lengthSq() < 0.0001) return;

        this._panClampDelta
            .copy(this._panRight.normalize())
            .multiplyScalar(edgeX * panDistance)
            .addScaledVector(this._panUp.normalize(), -edgeY * panDistance);
        this.controls.target.add(this._panClampDelta);
        this.camera.position.add(this._panClampDelta);
    }

    private clampFarMapPan(): void {
        if (!this.farMapPanActive || !this.hasFarMapPanBounds) return;

        const x = Math.max(this.farMapPanBounds.min.x, Math.min(this.farMapPanBounds.max.x, this.controls.target.x));
        const z = Math.max(this.farMapPanBounds.min.z, Math.min(this.farMapPanBounds.max.z, this.controls.target.z));
        if (x === this.controls.target.x && z === this.controls.target.z) return;

        this._panClampDelta.set(x - this.controls.target.x, 0, z - this.controls.target.z);
        this.controls.target.add(this._panClampDelta);
        this.camera.position.add(this._panClampDelta);
        this.controls.update();
    }

    private updateSide(train: Train): void {
        const rollingStock = train.getRollingStockTransform(0);
        rollingStock.getWorldPosition(this._trainPos);
        rollingStock.getWorldQuaternion(this._trainQuat);

        this.camera.position.copy(this._trainPos);
        this.camera.quaternion.copy(this._trainQuat);
        this.camera.translateX(this.zoomDistance);
        this.camera.translateY(5);
        this.camera.rotateY(Math.PI / 2);

        this.controls.target.copy(this.currentTarget);
    }

    private updateTop(train: Train): void {
        const rollingStock = train.getRollingStockTransform(0);
        rollingStock.getWorldPosition(this._trainPos);
        rollingStock.getWorldQuaternion(this._trainQuat);

        this.camera.position.copy(this._trainPos);
        this.camera.quaternion.copy(this._trainQuat);
        this.camera.translateY(this.zoomDistance);
        this.camera.rotateX(-Math.PI / 2);
        this.camera.rotateZ(Math.PI);

        this.controls.target.copy(this.currentTarget);
    }

    private updateCinematic(dt: number, train: Train): void {
        const rollingStock = train.getRollingStockTransform(0);
        rollingStock.getWorldPosition(this._trainPos);
        rollingStock.getWorldQuaternion(this._trainQuat);

        this.cinematicAngle += dt * 0.3;

        const radius = this.zoomDistance;
        const baseHeight = radius * 0.4;
        const heightVariation = radius * 0.15 * Math.sin(this.cinematicAngle * 0.7);

        this._localOffset.set(
            Math.cos(this.cinematicAngle) * radius,
            baseHeight + heightVariation,
            Math.sin(this.cinematicAngle) * radius,
        );

        const worldPos = this._localOffset.applyQuaternion(this._trainQuat).add(this._trainPos);
        this.camera.position.copy(worldPos);

        this._trainUp.set(0, 1, 0).applyQuaternion(this._trainQuat);
        this.camera.up.copy(this._trainUp);
        this.camera.lookAt(this.currentTarget);

        this.controls.target.copy(this.currentTarget);
    }

    public applyTransform(matrix: import('three').Matrix4): void {
        this.camera.position.applyMatrix4(matrix);
        this.controls.target.applyMatrix4(matrix);
        this.currentTarget.applyMatrix4(matrix);
        if (this.hasExternalTarget) {
            this._externalTarget.applyMatrix4(matrix);
        }
        if (this.hasFarMapPanBounds) {
            this.farMapPanBounds.applyMatrix4(matrix);
        }
        this.controls.update();
    }

    public cleanup(): void {
        this.domElement.removeEventListener('wheel', this.boundOnWheel);
        window.removeEventListener('pointermove', this.boundOnPointerMove);
        window.removeEventListener('pointerdown', this.boundOnPointerDown);
        window.removeEventListener('pointerup', this.boundOnPointerUp);
        window.removeEventListener('pointercancel', this.boundOnPointerUp);
        window.removeEventListener('blur', this.boundOnWindowBlur);
        this.controls.dispose();
    }
}
