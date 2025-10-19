import {
    Group,
    Mesh,
    BoxGeometry,
    MeshBasicMaterial,
    Vector3,
    Quaternion,
    Matrix4
} from 'three';

export class Drone extends Group {
    public moveSpeed = 80; // meters per second (~288 km/h)
    public turnSpeed = Math.PI; // radians per second for smooth turning

    private mesh: Mesh;

    // --- Path Following State ---
    private path: Vector3[] | null = null;
    private targetIndex: number = 0;
    private isFollowing: boolean = false;
    private readonly REACH_THRESHOLD = 5.0; // How close to a point to consider it "reached"

    // --- Temporary variables for calculations ---
    private tempDirection = new Vector3();
    private upVector = new Vector3(0, 1, 0);
    private targetQuaternion = new Quaternion();
    private tempMatrix = new Matrix4();


    constructor() {
        super();

        const droneGeo = new BoxGeometry(5, 2, 10);
        const droneMat = new MeshBasicMaterial({ color: 0x00ff00 });
        this.mesh = new Mesh(droneGeo, droneMat);
        this.add(this.mesh);
    }

    /**
     * Starts the drone's autopilot along a given path of world coordinates.
     * @param worldPath An array of Vector3 points representing the path.
     * @param altitude The desired flying altitude above the path points.
     */
    public startFollowing(worldPath: Vector3[], altitude: number = 20): void {
        if (worldPath.length < 2) {
            console.warn("Path requires at least 2 points to follow.");
            return;
        }

        this.path = worldPath.map(p => p.clone().setY(p.y + altitude));
        this.targetIndex = 1; // Start at point 0, aim for point 1
        this.isFollowing = true;

        // --- Initial Teleport and Orientation ---
        // Instantly move to the start of the path
        this.position.copy(this.path[0]);
        // Instantly look at the second point
        this.lookAt(this.path[1]);

        console.log(`Drone autopilot started. Path has ${this.path.length} points.`);
    }

    /**
     * Stops the drone's autopilot.
     */
    public stopFollowing(): void {
        this.isFollowing = false;
        this.path = null;
        this.targetIndex = 0;
        console.log("Drone autopilot stopped.");
    }

    /**
     * The main update loop, called every frame.
     * @param deltaTime Time since the last frame.
     * @param keysPressed Keyboard state for manual control.
     */
    public update(deltaTime: number, keysPressed: { [key: string]: boolean }): void {
        if (this.isFollowing) {
            this.updateAutopilot(deltaTime, keysPressed);
        } else {
            this.updateManual(deltaTime, keysPressed);
        }
    }

    /**
     * Handles the drone's movement when following a path.
     */
    private updateAutopilot(deltaTime: number, keysPressed: { [key: string]: boolean }): void {
        if (!this.path || this.targetIndex >= this.path.length) {
            this.stopFollowing();
            console.log("Journey finished!");
            return;
        }

        const targetPosition = this.path[this.targetIndex];
        const distanceToTarget = this.position.distanceTo(targetPosition);
        let moveDistance = this.moveSpeed * deltaTime;

        if (keysPressed['v']) {
            moveDistance *= 100; // Increase the speed significantly when 'v' is pressed
        }

        // --- Check if we've reached the current target ---
        if (distanceToTarget < this.REACH_THRESHOLD || distanceToTarget < moveDistance) {
            this.targetIndex++; // Aim for the next point
            if (this.targetIndex >= this.path.length) {
                // We've passed the final point
                this.position.copy(targetPosition); // Snap to the end
                this.stopFollowing();
                console.log("Journey finished!");
                return;
            }
        }

        // --- Movement and Rotation ---
        // Get the direction to the *new* target
        const newTargetPosition = this.path[this.targetIndex];
        this.tempDirection.subVectors(newTargetPosition, this.position).normalize();

        // Move the drone
        this.position.addScaledVector(this.tempDirection, moveDistance);

        // Smoothly rotate to face the target
        this.tempMatrix.lookAt(this.position, newTargetPosition, this.upVector);
        this.targetQuaternion.setFromRotationMatrix(this.tempMatrix);
        this.quaternion.slerp(this.targetQuaternion, this.turnSpeed * deltaTime);
    }

    /**
     * Handles the drone's movement based on keyboard input.
     */
    private updateManual(deltaTime: number, keysPressed: { [key: string]: boolean }): void {
        const moveDistance = this.moveSpeed * deltaTime;

        if (keysPressed['w']) this.translateZ(-moveDistance);
        if (keysPressed['s']) this.translateZ(moveDistance);
        if (keysPressed['a']) this.translateX(-moveDistance);
        if (keysPressed['d']) this.translateX(moveDistance);
        if (keysPressed['q']) this.translateY(moveDistance);
        if (keysPressed['z']) this.translateY(-moveDistance);
    }


    public dispose(): void {
        this.mesh.geometry.dispose();
        (this.mesh.material as MeshBasicMaterial).dispose();
    }
}

