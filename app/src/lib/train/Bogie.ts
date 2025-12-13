import { Vector3, Group, Mesh, SphereGeometry, MeshBasicMaterial, LineBasicMaterial, BufferGeometry, Line } from 'three';
import type { BogieConfig } from './TrainConfig';

export class Bogie {
    public group: Group;
    private config: BogieConfig;

    // Debug visualization
    private frontWheelMarker: Mesh | null = null;
    private backWheelMarker: Mesh | null = null;
    private axleLine: Line | null = null;

    // Positions on the rail (world space)
    public frontWheelPosition: Vector3 = new Vector3();
    public backWheelPosition: Vector3 = new Vector3();

    constructor(config: BogieConfig) {
        this.config = config;
        this.group = new Group();
        this.group.name = 'Bogie';

        if (config.showDebug) {
            this.createDebugVisualization();
        }
    }

    private createDebugVisualization(): void {
        // Create spheres for wheel positions
        const wheelGeometry = new SphereGeometry(0.3, 8, 8);
        const frontWheelMaterial = new MeshBasicMaterial({ color: 0x00ff00 }); // Green for front
        const backWheelMaterial = new MeshBasicMaterial({ color: 0xff0000 }); // Red for back

        this.frontWheelMarker = new Mesh(wheelGeometry, frontWheelMaterial);
        this.frontWheelMarker.position.z = this.config.frontWheelOffset;
        this.group.add(this.frontWheelMarker);

        this.backWheelMarker = new Mesh(wheelGeometry, backWheelMaterial);
        this.backWheelMarker.position.z = this.config.backWheelOffset;
        this.group.add(this.backWheelMarker);

        // Create line connecting the wheels (axle)
        const points = [
            new Vector3(0, 0, this.config.frontWheelOffset),
            new Vector3(0, 0, this.config.backWheelOffset)
        ];
        const lineGeometry = new BufferGeometry().setFromPoints(points);
        const lineMaterial = new LineBasicMaterial({ color: 0xffff00 }); // Yellow line
        this.axleLine = new Line(lineGeometry, lineMaterial);
        this.group.add(this.axleLine);
    }

    public updateConfig(config: BogieConfig): void {
        this.config = config;

        // Update debug visualization if it exists
        if (this.frontWheelMarker && this.backWheelMarker && this.axleLine) {
            this.frontWheelMarker.position.z = config.frontWheelOffset;
            this.backWheelMarker.position.z = config.backWheelOffset;

            // Update line
            const points = [
                new Vector3(0, 0, config.frontWheelOffset),
                new Vector3(0, 0, config.backWheelOffset)
            ];
            this.axleLine.geometry.setFromPoints(points);
        }

        // Show/hide debug visualization
        if (config.showDebug && !this.frontWheelMarker) {
            this.createDebugVisualization();
        } else if (!config.showDebug && this.frontWheelMarker) {
            if (this.frontWheelMarker) {
                this.group.remove(this.frontWheelMarker);
                this.frontWheelMarker = null;
            }
            if (this.backWheelMarker) {
                this.group.remove(this.backWheelMarker);
                this.backWheelMarker = null;
            }
            if (this.axleLine) {
                this.group.remove(this.axleLine);
                this.axleLine = null;
            }
        }
    }

    /**
     * Orient the bogie based on two rail positions (front and back wheel contact points)
     * The bogie stays at its local position but rotates to align with the rail
     */
    public orientOnRail(frontRailPos: Vector3, backRailPos: Vector3): void {
        // Store wheel positions for debugging
        this.frontWheelPosition.copy(frontRailPos);
        this.backWheelPosition.copy(backRailPos);

        // Calculate rotation quaternion to align bogie's local Z-axis with rail direction
        // Using lookAt with a temporary object to calculate the rotation
        const tempObject = new Group();
        tempObject.position.copy(backRailPos);
        tempObject.lookAt(frontRailPos);

        // Apply the rotation to this bogie
        // Note: Three.js lookAt makes -Z point at target, so we need to rotate 180°
        this.group.quaternion.copy(tempObject.quaternion);
        this.group.rotateY(Math.PI);
    }

    public cleanup(): void {
        if (this.frontWheelMarker) {
            this.frontWheelMarker.geometry.dispose();
            (this.frontWheelMarker.material as MeshBasicMaterial).dispose();
        }
        if (this.backWheelMarker) {
            this.backWheelMarker.geometry.dispose();
            (this.backWheelMarker.material as MeshBasicMaterial).dispose();
        }
        if (this.axleLine) {
            this.axleLine.geometry.dispose();
            (this.axleLine.material as LineBasicMaterial).dispose();
        }
    }
}
