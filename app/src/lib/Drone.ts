import {
    Group,
    Mesh,
    BoxGeometry,
    MeshBasicMaterial,
} from 'three';

export class Drone extends Group {
    public moveSpeed = 50;
    private mesh: Mesh;

    constructor() {
        super();

        const droneGeo = new BoxGeometry(5, 2, 10); // A simple drone shape
        const droneMat = new MeshBasicMaterial({ color: 0x00ff00 }); // Make it bright green
        this.mesh = new Mesh(droneGeo, droneMat);
        
        // Start 10m above its local origin
        this.mesh.position.set(0, 10, 0); 
        this.add(this.mesh);
    }

    public update(deltaTime: number, keysPressed: { [key: string]: boolean }): void {
        const moveDistance = this.moveSpeed * deltaTime;

        // W/S: Move forward/backward (local Z-axis)
        if (keysPressed['w']) {
            this.translateZ(-moveDistance);
        }
        if (keysPressed['s']) {
            this.translateZ(moveDistance);
        }

        // A/D: Strafe left/right (local X-axis)
        if (keysPressed['a']) {
            this.translateX(-moveDistance);
        }
        if (keysPressed['d']) {
            this.translateX(moveDistance);
        }

        // Q/Z: Move up/down (local Y-axis)
        if (keysPressed['q']) {
            this.translateY(moveDistance);
        }
        if (keysPressed['z']) {
            this.translateY(-moveDistance);
        }
    }

    public dispose(): void {
        this.mesh.geometry.dispose();
        (this.mesh.material as MeshBasicMaterial).dispose();
    }
}