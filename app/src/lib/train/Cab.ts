import { Group, Mesh, Quaternion, Object3D, SphereGeometry, MeshBasicMaterial, Vector3 } from 'three';
import type { CabConfig } from './TrainConfig';
import { Bogie } from './Bogie';
import { getGLTFLoader } from '../utils/ModelLoader';
import type Path from '../utils/Path';

export class Cab {
    public group: Group;
    public globalDebugGroup: Group;

    private config: CabConfig;
    private frontBogie: Bogie;
    private rearBogie: Bogie;
    private model: Group | null = null;

    private frontBogieEntity: Object3D | null = null;
    private rearBogieEntity: Object3D | null = null;
    private tempQuaternion: Quaternion = new Quaternion();


    // Global debug visualization (added directly to scene, not affected by hierarchy)
    private debug: boolean = false;
    private globalWheelSpheres: {
        frontBogieFront: Mesh | null;
        frontBogieBack: Mesh | null;
        rearBogieFront: Mesh | null;
        rearBogieBack: Mesh | null;
        cabCenter: Mesh | null;
    } = {
            frontBogieFront: null,
            frontBogieBack: null,
            rearBogieFront: null,
            rearBogieBack: null,
            cabCenter: null
        };

    constructor(config: CabConfig, debug: boolean = false) {
        this.config = config;
        this.debug = debug;

        this.group = new Group();
        this.group.name = 'Cab';

        this.globalDebugGroup = new Group();
        this.globalDebugGroup.name = 'CabGlobalDebug';

        // Create bogies
        this.frontBogie = new Bogie();
        this.frontBogie.group.position.z = config.frontBogie.zOffset;
        this.group.add(this.frontBogie.group);

        this.rearBogie = new Bogie();
        this.rearBogie.group.position.z = config.rearBogie.zOffset;
        this.group.add(this.rearBogie.group);

        // Load model if path is provided
        if (config.modelPath) {
            this.loadModel(config.modelPath);
        }

        if (debug) {
            this.createGlobalDebugSpheres();
        }
    }

    private createGlobalDebugSpheres(): void {
        const geometry = new SphereGeometry(0.5, 16, 16);

        // Front bogie front wheel - Bright Green
        this.globalWheelSpheres.frontBogieFront = new Mesh(
            geometry,
            new MeshBasicMaterial({ color: 0x00ff00 })
        );
        this.globalDebugGroup.add(this.globalWheelSpheres.frontBogieFront);

        // Front bogie back wheel - Dark Green
        this.globalWheelSpheres.frontBogieBack = new Mesh(
            geometry,
            new MeshBasicMaterial({ color: 0x00aa00 })
        );
        this.globalDebugGroup.add(this.globalWheelSpheres.frontBogieBack);

        // Rear bogie front wheel - Bright Red
        this.globalWheelSpheres.rearBogieFront = new Mesh(
            geometry,
            new MeshBasicMaterial({ color: 0xff0000 })
        );
        this.globalDebugGroup.add(this.globalWheelSpheres.rearBogieFront);

        // Rear bogie back wheel - Dark Red
        this.globalWheelSpheres.rearBogieBack = new Mesh(
            geometry,
            new MeshBasicMaterial({ color: 0xaa0000 })
        );
        this.globalDebugGroup.add(this.globalWheelSpheres.rearBogieBack);

        // Cab center - Blue
        this.globalWheelSpheres.cabCenter = new Mesh(
            geometry,
            new MeshBasicMaterial({ color: 0x0000ff })
        );
        this.globalDebugGroup.add(this.globalWheelSpheres.cabCenter);

        this.globalDebugGroup.name = 'TrainGlobalDebug';
        console.log('Created global debug spheres for train');
    }

    private updateModelTransform(): void {
        if (!this.model) return;

        this.model.scale.setScalar(this.config.scale);

        this.model.position.set(
            this.config.modelOffset.x,
            this.config.modelOffset.y,
            this.config.modelOffset.z
        );
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

                this.updateModelTransform();

                this.group.add(this.model!);

                if (this.model) {
                    this.logModelHierarchy(this.model, 0);
                }

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

    public positionOnPath(pathIndex: number, path: Path): void {
        // Get cab center position (approximately at pathIndex)
        const cabCenterPos = path.points[pathIndex].clone();

        // Calculate where each wheel should be on the path
        // Front bogie, front wheel
        const frontBogieConfig = this.config.frontBogie;
        const frontBogieOffset = frontBogieConfig.zOffset;
        const frontBogieWheelFrontOffset = frontBogieOffset + frontBogieConfig.frontWheelOffset;
        const frontBogieWheelBackOffset = frontBogieOffset + frontBogieConfig.backWheelOffset;

        // Rear bogie, front wheel
        const rearBogieConfig = this.config.rearBogie;
        const rearBogieOffset = rearBogieConfig.zOffset;
        const rearBogieWheelFrontOffset = rearBogieOffset + rearBogieConfig.frontWheelOffset;
        const rearBogieWheelBackOffset = rearBogieOffset + rearBogieConfig.backWheelOffset;

        // Find positions on path for each wheel
        const frontBogieFrontWheel = path.getPointAtDistance(pathIndex, frontBogieWheelFrontOffset);
        const frontBogieBackWheel = path.getPointAtDistance(pathIndex, frontBogieWheelBackOffset);
        const rearBogieFrontWheel = path.getPointAtDistance(pathIndex, rearBogieWheelFrontOffset);
        const rearBogieBackWheel = path.getPointAtDistance(pathIndex, rearBogieWheelBackOffset);

        if (!frontBogieFrontWheel || !frontBogieBackWheel || !rearBogieFrontWheel || !rearBogieBackWheel) {
            console.warn('Train: Could not find all wheel positions on path');
            return;
        }

        const globalPositions = {
            frontBogieFrontWheel: frontBogieFrontWheel.point.clone(),
            frontBogieBackWheel: frontBogieBackWheel.point.clone(),
            rearBogieFrontWheel: rearBogieFrontWheel.point.clone(),
            rearBogieBackWheel: rearBogieBackWheel.point.clone(),
            cabCenter: cabCenterPos.clone()
        };

        this.group.position.copy(globalPositions.cabCenter);

        const rearPoint = globalPositions.rearBogieBackWheel;
        const frontPoint = globalPositions.frontBogieFrontWheel;
        const overallDirection = new Vector3().subVectors(frontPoint, rearPoint);

        if (overallDirection.length() > 0.001) {
            const tempObj = new Group();
            tempObj.position.copy(rearPoint);
            tempObj.up.set(0, 1, 0);
            tempObj.lookAt(frontPoint);
            this.group.quaternion.copy(tempObj.quaternion);
        }

        // Step 3: Orient bogies relative to the train's local space
        // Convert global wheel positions to local space of the train group
        const frontBogie = this.getFrontBogie();
        const rearBogie = this.getRearBogie();

        const localFrontFront = globalPositions.frontBogieFrontWheel.clone();
        const localFrontBack = globalPositions.frontBogieBackWheel.clone();
        const localRearFront = globalPositions.rearBogieFrontWheel.clone();
        const localRearBack = globalPositions.rearBogieBackWheel.clone();

        this.group.worldToLocal(localFrontFront);
        this.group.worldToLocal(localFrontBack);
        this.group.worldToLocal(localRearFront);
        this.group.worldToLocal(localRearBack);

        // Orient bogies based on their local wheel positions
        frontBogie.orientOnRail(localFrontFront, localFrontBack);
        rearBogie.orientOnRail(localRearFront, localRearBack);

        // Orient cab model between the bogies (optional, for visual smoothness)
        this.orientOnBogies();

        // Update global debug spheres with world positions
        if (this.debug) {
            if (this.globalWheelSpheres.frontBogieFront) {
                this.globalWheelSpheres.frontBogieFront.position.copy(frontBogieFrontWheel.point);
            }
            if (this.globalWheelSpheres.frontBogieBack) {
                this.globalWheelSpheres.frontBogieBack.position.copy(frontBogieBackWheel.point);
            }
            if (this.globalWheelSpheres.rearBogieFront) {
                this.globalWheelSpheres.rearBogieFront.position.copy(rearBogieFrontWheel.point);
            }
            if (this.globalWheelSpheres.rearBogieBack) {
                this.globalWheelSpheres.rearBogieBack.position.copy(rearBogieBackWheel.point);
            }
            if (this.globalWheelSpheres.cabCenter) {
                this.globalWheelSpheres.cabCenter.position.copy(cabCenterPos);
            }
        }
    }

    public updateConfig(config: CabConfig): void {
        const modelChanged = config.modelPath !== this.config.modelPath;
        const bogieNamesChanged =
            config.frontBogie.entityName !== this.config.frontBogie.entityName ||
            config.rearBogie.entityName !== this.config.rearBogie.entityName;

        this.config = config;

        this.frontBogie.group.position.z = config.frontBogie.zOffset;
        this.rearBogie.group.position.z = config.rearBogie.zOffset;

        this.updateModelTransform();

        if (bogieNamesChanged && this.model) {
            this.findBogieEntities();
        }

        if (modelChanged && config.modelPath) {
            this.loadModel(config.modelPath);
        }
    }

    public orientOnBogies(): void {
        const frontBogieQuat = this.frontBogie.group.quaternion.clone();
        const rearBogieQuat = this.rearBogie.group.quaternion.clone();

        const cabQuat = this.tempQuaternion;
        cabQuat.slerpQuaternions(frontBogieQuat, rearBogieQuat, 0.5);

        if (this.model) {
            this.model.quaternion.copy(cabQuat);
        }

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
