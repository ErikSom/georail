import {
    PerspectiveCamera,
    Vector3,
    Quaternion,
} from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import type { Train } from './train/Train';

export type CameraMode = 'free' | 'cockpit' | 'side' | 'top' | 'cinematic';

const CAMERA_MODES: CameraMode[] = ['free', 'cockpit', 'side', 'top', 'cinematic'];

const COCKPIT_ORBIT_MAX_ANGLE = Math.PI / 3;
const COCKPIT_ORBIT_VERTICAL_MAX = Math.PI / 6;

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

    constructor(camera: PerspectiveCamera, domElement: HTMLElement) {
        this.camera = camera;
        this.domElement = domElement;

        this.controls = new OrbitControls(this.camera, this.domElement);
        this.controls.minDistance = 10;
        this.controls.maxDistance = 500;
        this.controls.minPolarAngle = 0;
        this.controls.maxPolarAngle = Math.PI / 2 - 0.1;
        this.controls.enableDamping = true;
        this.controls.autoRotate = false;
        this.controls.enablePan = false;

        this.boundOnWheel = this.onWheel.bind(this);
        this.domElement.addEventListener('wheel', this.boundOnWheel, { passive: false });
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
            this.controls.minDistance = 0.1;
            this.controls.maxDistance = 500;
            this.controls.minPolarAngle = 0;
            this.controls.maxPolarAngle = Math.PI / 2 - 0.1;
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

    public update(dt: number, train: Train): void {
        const desired = train.getActiveCabinWorldPosition();

        if (this.mode === 'cockpit') {
            this.currentTarget.copy(desired);
        } else {
            const t = 1 - Math.exp(-this.smoothing * dt);
            this.currentTarget.lerp(desired, t);
        }

        switch (this.mode) {
            case 'free':
                this.updateFree();
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

    private updateFree(): void {
        this._delta.copy(this.currentTarget).sub(this.controls.target);
        this.controls.target.add(this._delta);
        this.camera.position.add(this._delta);
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
        this.controls.update();
    }

    public cleanup(): void {
        this.domElement.removeEventListener('wheel', this.boundOnWheel);
        this.controls.dispose();
    }
}
