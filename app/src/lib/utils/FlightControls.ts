import { PerspectiveCamera, Vector3 } from 'three';
import { PointerLockControls } from 'three/examples/jsm/controls/PointerLockControls.js';
import { Input } from './Input';

export class FlightControls {
    public controls: PointerLockControls;
    private camera: PerspectiveCamera;
    private domElement: HTMLElement;

    private baseSpeed = 100;
    private fastMul = 5;
    private slowMul = 0.25;

    private velocity = new Vector3();
    private forward = new Vector3();
    private right = new Vector3();
    private up = new Vector3(0, 1, 0);

    constructor(camera: PerspectiveCamera, domElement: HTMLElement) {
        this.camera = camera;
        this.domElement = domElement;
        this.controls = new PointerLockControls(this.camera, this.domElement);
    }

    public init(): void {
        Input.onRightMouseDown = this.controls.lock;
        Input.onRightMouseUp = this.unlock.bind(this);
    }

    private unlock(): void {
        this.controls.isLocked = false;
        this.controls.unlock();
    }

    public cleanup(): void {
        this.controls.unlock();
        this.controls.dispose();

        if (Input.onRightMouseDown === this.controls.lock) {
            Input.onRightMouseDown = null;
        }
        if (Input.onRightMouseUp === this.unlock) {
            Input.onRightMouseUp = null;
        }
    }

    public update(dt: number): void {
        if (!this.controls.isLocked) {
            this.velocity.set(0, 0, 0);
            return;
        }

        let speed = this.baseSpeed;
        if (Input.isShift) speed *= this.fastMul;
        if (Input.isAlt) speed *= this.slowMul;
        const step = speed * dt;

        this.camera.getWorldDirection(this.forward).normalize();
        this.right.crossVectors(this.forward, this.camera.up).normalize();

        this.velocity.set(0, 0, 0);

        if (Input.isDown('KeyW') || Input.isDown('ArrowUp')) this.velocity.addScaledVector(this.forward, step);
        if (Input.isDown('KeyS') || Input.isDown('ArrowDown')) this.velocity.addScaledVector(this.forward, -step);
        if (Input.isDown('KeyA') || Input.isDown('ArrowLeft')) this.velocity.addScaledVector(this.right, -step);
        if (Input.isDown('KeyD') || Input.isDown('ArrowRight')) this.velocity.addScaledVector(this.right, step);
        if (Input.isDown('KeyQ')) this.velocity.addScaledVector(this.up, step);
        if (Input.isDown('KeyZ')) this.velocity.addScaledVector(this.up, -step);

        this.camera.position.add(this.velocity);
    }
}