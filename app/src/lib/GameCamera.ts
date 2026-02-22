import {
    PerspectiveCamera,
    Vector3,
    Quaternion,
} from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import type { Train } from './train/Train';

export type CameraMode = 'free' | 'side' | 'top' | 'cinematic';

const CAMERA_MODES: CameraMode[] = ['free', 'side', 'top', 'cinematic'];

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

    // Reusable temp vectors
    private _delta = new Vector3();
    private _trainPos = new Vector3();
    private _trainQuat = new Quaternion();
    private _localOffset = new Vector3();
    private _trainUp = new Vector3();

    constructor(camera: PerspectiveCamera, domElement: HTMLElement) {
        this.camera = camera;
        this.domElement = domElement;

        // Set up OrbitControls
        this.controls = new OrbitControls(this.camera, this.domElement);
        this.controls.minDistance = 10;
        this.controls.maxDistance = 500;
        this.controls.minPolarAngle = 0;
        this.controls.maxPolarAngle = Math.PI / 2 - 0.1;
        this.controls.enableDamping = true;
        this.controls.autoRotate = false;
        this.controls.enablePan = false;

        // Scroll wheel for non-free modes
        this.boundOnWheel = this.onWheel.bind(this);
        this.domElement.addEventListener('wheel', this.boundOnWheel, { passive: false });
    }

    private onWheel(event: WheelEvent): void {
        if (this.mode === 'free') return; // OrbitControls handles zoom in free mode

        event.preventDefault();
        event.stopPropagation();

        const zoomSpeed = 5;
        this.zoomDistance += event.deltaY * zoomSpeed * 0.01;
        this.zoomDistance = Math.max(20, Math.min(500, this.zoomDistance));
    }

    /** Cycle to the next camera mode. */
    public cycleMode(): void {
        const idx = CAMERA_MODES.indexOf(this.mode);
        const nextMode = CAMERA_MODES[(idx + 1) % CAMERA_MODES.length];
        this.setMode(nextMode);
    }

    /** Switch to a specific camera mode. */
    public setMode(mode: CameraMode): void {
        const prevMode = this.mode;
        this.mode = mode;

        if (mode === 'cinematic' && prevMode !== 'cinematic') {
            // Compute initial cinematic angle from current camera position
            // so the transition is seamless
            this._delta.copy(this.camera.position).sub(this.currentTarget);
            this._delta.y = 0;
            this.cinematicAngle = Math.atan2(this._delta.z, this._delta.x);
        }

        // Enable/disable OrbitControls
        this.controls.enabled = mode === 'free';
    }

    /**
     * Snap target to a position immediately (no lerp).
     * Used for initial camera positioning on route load.
     */
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

    /** Main update — call each frame. */
    public update(dt: number, train: Train): void {
        // Smooth target following (all modes)
        const desired = train.getActiveCabinWorldPosition();
        const t = 1 - Math.exp(-this.smoothing * dt);
        this.currentTarget.lerp(desired, t);

        switch (this.mode) {
            case 'free':
                this.updateFree();
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

    private updateFree(): void {
        // Translate the orbit rig to follow the smoothed target
        this._delta.copy(this.currentTarget).sub(this.controls.target);
        this.controls.target.add(this._delta);
        this.camera.position.add(this._delta);
        this.controls.update();
    }

    private updateSide(train: Train): void {
        const rollingStock = train.getRollingStockTransform(0);
        rollingStock.getWorldPosition(this._trainPos);
        rollingStock.getWorldQuaternion(this._trainQuat);

        // Snap camera to train position and rotation
        this.camera.position.copy(this._trainPos);
        this.camera.quaternion.copy(this._trainQuat);

        // Move to the right and slightly up
        this.camera.translateX(this.zoomDistance);
        this.camera.translateY(5);

        // Look left at the train
        this.camera.rotateY(Math.PI / 2);

        // Keep controls target in sync for smooth mode switching
        this.controls.target.copy(this.currentTarget);
    }

    private updateTop(train: Train): void {
        const rollingStock = train.getRollingStockTransform(0);
        rollingStock.getWorldPosition(this._trainPos);
        rollingStock.getWorldQuaternion(this._trainQuat);

        // Snap camera to train position and rotation
        this.camera.position.copy(this._trainPos);
        this.camera.quaternion.copy(this._trainQuat);

        // Move up
        this.camera.translateY(this.zoomDistance);

        // Look down
        this.camera.rotateX(-Math.PI / 2);

        // Rotate so train forward points up on screen
        this.camera.rotateZ(Math.PI);

        // Keep controls target in sync
        this.controls.target.copy(this.currentTarget);
    }

    private updateCinematic(dt: number, train: Train): void {
        const rollingStock = train.getRollingStockTransform(0);
        rollingStock.getWorldPosition(this._trainPos);
        rollingStock.getWorldQuaternion(this._trainQuat);

        // Increment orbit angle
        this.cinematicAngle += dt * 0.3;

        // Orbit radius and height with gentle sine wave variation
        const radius = this.zoomDistance;
        const baseHeight = radius * 0.4;
        const heightVariation = radius * 0.15 * Math.sin(this.cinematicAngle * 0.7);

        this._localOffset.set(
            Math.cos(this.cinematicAngle) * radius,
            baseHeight + heightVariation,
            Math.sin(this.cinematicAngle) * radius,
        );

        // Transform local offset to world space using train rotation
        const worldPos = this._localOffset.applyQuaternion(this._trainQuat).add(this._trainPos);
        this.camera.position.copy(worldPos);

        // Use train's up direction
        this._trainUp.set(0, 1, 0).applyQuaternion(this._trainQuat);
        this.camera.up.copy(this._trainUp);
        this.camera.lookAt(this.currentTarget);

        // Keep controls target in sync
        this.controls.target.copy(this.currentTarget);
    }

    public cleanup(): void {
        this.domElement.removeEventListener('wheel', this.boundOnWheel);
        this.controls.dispose();
    }
}
