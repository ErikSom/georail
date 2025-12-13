import { Vector3, Group, Mesh, SphereGeometry, MeshBasicMaterial, LineBasicMaterial, BufferGeometry, Line, Quaternion, Object3D } from 'three';
import type { CabConfig } from './TrainConfig';
import { Bogie } from './Bogie';
import { getGLTFLoader } from '../utils/ModelLoader';

export class Cab {
    public group: Group;
    private config: CabConfig;
    private frontBogie: Bogie;
    private rearBogie: Bogie;
    private model: Group | null = null;

    // Bogie entities from the loaded GLB model
    private frontBogieEntity: Object3D | null = null;
    private rearBogieEntity: Object3D | null = null;

    // Debug visualization
    private centerMarker: Mesh | null = null;
    private frontBogieConnector: Line | null = null;
    private rearBogieConnector: Line | null = null;

    constructor(config: CabConfig) {
        this.config = config;
        this.group = new Group();
        this.group.name = 'Cab';

        // Create bogies
        this.frontBogie = new Bogie(config.frontBogie);
        this.frontBogie.group.position.z = config.frontBogie.zOffset;
        this.group.add(this.frontBogie.group);

        this.rearBogie = new Bogie(config.rearBogie);
        this.rearBogie.group.position.z = config.rearBogie.zOffset;
        this.group.add(this.rearBogie.group);

        if (config.showDebug) {
            this.createDebugVisualization();
        }

        // Load model if path is provided
        if (config.modelPath) {
            this.loadModel(config.modelPath);
        }
    }

    private createDebugVisualization(): void {
        // Create sphere at cab center
        const centerGeometry = new SphereGeometry(0.5, 8, 8);
        const centerMaterial = new MeshBasicMaterial({ color: 0x0000ff }); // Blue for cab center
        this.centerMarker = new Mesh(centerGeometry, centerMaterial);
        this.group.add(this.centerMarker);

        // Create lines from cab center to bogies
        const lineMaterial = new LineBasicMaterial({ color: 0x00ffff }); // Cyan lines

        let points = [
            new Vector3(0, 0, 0),
            new Vector3(0, 0, this.config.frontBogie.zOffset)
        ];
        let lineGeometry = new BufferGeometry().setFromPoints(points);
        this.frontBogieConnector = new Line(lineGeometry, lineMaterial);
        this.group.add(this.frontBogieConnector);

        points = [
            new Vector3(0, 0, 0),
            new Vector3(0, 0, this.config.rearBogie.zOffset)
        ];
        lineGeometry = new BufferGeometry().setFromPoints(points);
        this.rearBogieConnector = new Line(lineGeometry, lineMaterial);
        this.group.add(this.rearBogieConnector);
    }

    private loadModel(path: string): void {
        const loader = getGLTFLoader();
        loader.load(
            path,
            (gltf: any) => {
                if (this.model) {
                    this.group.remove(this.model);
                }

                this.model = gltf.scene!;
                this.model!.scale.setScalar(this.config.scale);
                this.model!.position.y = this.config.altitudeOffset;

                // Debug: Log model info
                console.log('Cab model loaded:', path);
                console.log('Model bounding box before adding:');
                this.model!.traverse((child) => {
                    if (child instanceof Mesh) {
                        child.geometry.computeBoundingBox();
                        console.log(`  Mesh "${child.name}":`, child.geometry.boundingBox);
                        console.log(`  Material:`, child.material);

                        // Ensure materials are visible
                        if (Array.isArray(child.material)) {
                            child.material.forEach(mat => {
                                mat.visible = true;
                                mat.needsUpdate = true;
                            });
                        } else {
                            child.material.visible = true;
                            child.material.needsUpdate = true;
                        }
                    }
                });

                this.group.add(this.model!);

                console.log('Train group position:', this.group.position);
                console.log('Model scale:', this.model?.scale);
                console.log('Model hierarchy:');
                if (this.model) {
                    this.logModelHierarchy(this.model, 0);
                }

                // Find bogie entities in the model
                this.findBogieEntities();
            },
            undefined,
            (error: any) => {
                console.warn('Failed to load cab model:', path, error);
            }
        );
    }

    private logModelHierarchy(object: Object3D, depth: number = 0): void {
        const indent = '  '.repeat(depth);
        console.log(`${indent}- ${object.name || '(unnamed)'} [${object.type}]`);
        object.children.forEach(child => this.logModelHierarchy(child, depth + 1));
    }

    private findBogieEntities(): void {
        if (!this.model) return;

        // Reset bogie entities
        this.frontBogieEntity = null;
        this.rearBogieEntity = null;

        // Find front bogie
        if (this.config.frontBogie.entityName) {
            const found = this.model.getObjectByName(this.config.frontBogie.entityName);
            this.frontBogieEntity = found || null;
            if (this.frontBogieEntity) {
                console.log('Found front bogie entity:', this.config.frontBogie.entityName);
            } else {
                console.warn('Front bogie entity not found:', this.config.frontBogie.entityName);
            }
        }

        // Find rear bogie
        if (this.config.rearBogie.entityName) {
            const found = this.model.getObjectByName(this.config.rearBogie.entityName);
            this.rearBogieEntity = found || null;
            if (this.rearBogieEntity) {
                console.log('Found rear bogie entity:', this.config.rearBogie.entityName);
            } else {
                console.warn('Rear bogie entity not found:', this.config.rearBogie.entityName);
            }
        }
    }

    public updateConfig(config: CabConfig): void {
        console.log('Cab.updateConfig called with:', {
            scale: config.scale,
            altitude: config.altitudeOffset,
            configIsSameReference: config === this.config
        });

        // Check what changed BEFORE updating this.config
        const modelChanged = config.modelPath !== this.config.modelPath;
        const bogieNamesChanged =
            config.frontBogie.entityName !== this.config.frontBogie.entityName ||
            config.rearBogie.entityName !== this.config.rearBogie.entityName;

        this.config = config;

        // Update bogies
        this.frontBogie.updateConfig(config.frontBogie);
        this.frontBogie.group.position.z = config.frontBogie.zOffset;

        this.rearBogie.updateConfig(config.rearBogie);
        this.rearBogie.group.position.z = config.rearBogie.zOffset;

        // Update debug visualization
        if (config.showDebug && !this.centerMarker) {
            this.createDebugVisualization();
        } else if (!config.showDebug && this.centerMarker) {
            if (this.centerMarker) {
                this.group.remove(this.centerMarker);
                this.centerMarker = null;
            }
            if (this.frontBogieConnector) {
                this.group.remove(this.frontBogieConnector);
                this.frontBogieConnector = null;
            }
            if (this.rearBogieConnector) {
                this.group.remove(this.rearBogieConnector);
                this.rearBogieConnector = null;
            }
        }

        // Update connector lines if they exist
        if (this.frontBogieConnector && this.rearBogieConnector) {
            let points = [
                new Vector3(0, 0, 0),
                new Vector3(0, 0, config.frontBogie.zOffset)
            ];
            this.frontBogieConnector.geometry.setFromPoints(points);

            points = [
                new Vector3(0, 0, 0),
                new Vector3(0, 0, config.rearBogie.zOffset)
            ];
            this.rearBogieConnector.geometry.setFromPoints(points);
        }

        // Update model properties (always update since Tweakpane modifies config directly)
        if (this.model) {
            this.model.scale.setScalar(config.scale);
            this.model.position.y = config.altitudeOffset;
            console.log('Updated model: scale =', config.scale, 'altitude =', config.altitudeOffset);
        }

        // Re-find bogie entities if names changed
        if (bogieNamesChanged && this.model) {
            this.findBogieEntities();
        }

        if (modelChanged && config.modelPath) {
            this.loadModel(config.modelPath);
        }
    }

    /**
     * Get the world position where a bogie's wheel should be on the rail
     * @param bogieZOffset - Z offset of the bogie from cab center
     * @param wheelZOffset - Z offset of the wheel from bogie center
     */
    public getBogieWheelWorldPosition(bogieZOffset: number, wheelZOffset: number): Vector3 {
        const localPos = new Vector3(0, 0, bogieZOffset + wheelZOffset);
        return localPos.applyMatrix4(this.group.matrixWorld);
    }

    /**
     * Orient the cab based on bogie positions on the rail
     * The cab will position and rotate itself based on where the bogies are
     */
    public orientOnBogies(): void {
        // Get bogie orientations
        const frontBogieQuat = this.frontBogie.group.quaternion.clone();
        const rearBogieQuat = this.rearBogie.group.quaternion.clone();

        // Slerp between the two quaternions for smooth interpolation
        const cabQuat = new Quaternion();
        cabQuat.slerpQuaternions(frontBogieQuat, rearBogieQuat, 0.5);

        // Apply rotation to cab model (not to group, as bogies are children)
        // We only want to rotate the cab body, not move the bogies
        if (this.model) {
            this.model.quaternion.copy(cabQuat);
        }

        // Apply rotation to bogie entities within the GLB model
        if (this.frontBogieEntity) {
            this.frontBogieEntity.quaternion.copy(frontBogieQuat);
        }
        if (this.rearBogieEntity) {
            this.rearBogieEntity.quaternion.copy(rearBogieQuat);
        }
    }

    public getFrontBogie(): Bogie {
        return this.frontBogie;
    }

    public getRearBogie(): Bogie {
        return this.rearBogie;
    }

    public cleanup(): void {
        this.frontBogie.cleanup();
        this.rearBogie.cleanup();

        if (this.centerMarker) {
            this.centerMarker.geometry.dispose();
            (this.centerMarker.material as MeshBasicMaterial).dispose();
        }
        if (this.frontBogieConnector) {
            this.frontBogieConnector.geometry.dispose();
            (this.frontBogieConnector.material as LineBasicMaterial).dispose();
        }
        if (this.rearBogieConnector) {
            this.rearBogieConnector.geometry.dispose();
            (this.rearBogieConnector.material as LineBasicMaterial).dispose();
        }

        if (this.model) {
            this.model.traverse((child) => {
                if (child instanceof Mesh) {
                    child.geometry.dispose();
                    if (Array.isArray(child.material)) {
                        child.material.forEach(mat => mat.dispose());
                    } else {
                        child.material.dispose();
                    }
                }
            });
        }
    }
}
