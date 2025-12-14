import { Group, Mesh, Quaternion, Object3D, SphereGeometry, MeshBasicMaterial, Vector3 } from 'three';
import type { BogieConfig, CabConfig, TrainConfig } from './TrainConfig';
import { Bogie } from './Bogie';
import { getGLTFLoader } from '../utils/ModelLoader';
import type Path from '../utils/Path';
import type { Pane } from 'tweakpane';
import { dummy } from '../utils/Helper';

export class Cab {
    public group: Group;
    public globalDebugGroup: Group;

    private config: CabConfig;
    private rearCab: boolean = false;
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

    constructor(config: CabConfig, rearCab: boolean = false, debug: boolean = false) {
        this.config = config;
        this.debug = debug;
        this.rearCab = rearCab;

        this.group = new Group();
        this.group.name = rearCab ? 'RearCab' : 'FrontCab';

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

    public positionOnPath(pathIndex: number, path: Path): void {
        const { frontBogie, rearBogie } = this.config;

        // 1. Calculate Global Wheel Positions
        // Helper to calculate offset and fetch point
        const getWheelPoint = (config: BogieConfig, offset: number) => {
            const totalOffset = config.zOffset + offset;
            return path.getPointAtDistance(pathIndex, totalOffset);
        };

        const wheels = {
            frontFront: getWheelPoint(frontBogie, frontBogie.frontWheelOffset),
            frontBack: getWheelPoint(frontBogie, frontBogie.backWheelOffset),
            rearFront: getWheelPoint(rearBogie, rearBogie.frontWheelOffset),
            rearBack: getWheelPoint(rearBogie, rearBogie.backWheelOffset),
        };

        // 2. Validation
        if (!wheels.frontFront || !wheels.frontBack || !wheels.rearFront || !wheels.rearBack) {
            console.warn('Train: Could not find all wheel positions on path');
            return;
        }

        // 3. Position the Main Train Body
        const cabCenterPos = path.points[pathIndex].clone(); // Or calculate geometrically between bogies if preferred
        this.group.position.copy(cabCenterPos);

        // 4. Orient the Main Train Body
        // We align the train based on the vector from the very last wheel to the very first wheel
        const frontPoint = wheels.frontFront.point;
        const rearPoint = wheels.rearBack.point;

        // Optimization: Use a class-level dummy object to avoid creating 'new Group()' every frame
        // If you don't have this._dummy, create it once in the constructor: this._dummy = new Object3D();
        dummy.position.copy(rearPoint);
        dummy.lookAt(frontPoint);
        this.group.quaternion.copy(dummy.quaternion);

        // 5. Orient Individual Bogies
        this.updateBogie(this.getFrontBogie(), wheels.frontFront.point, wheels.frontBack.point);
        this.updateBogie(this.getRearBogie(), wheels.rearFront.point, wheels.rearBack.point);

        // 6. Optional: Orient Cab & Debug
        this.orientOnBogies();
        if (this.debug) this.updateDebugVisuals(cabCenterPos, wheels);
    }

    private updateBogie(bogieModel: Bogie, globalFront: Vector3, globalBack: Vector3): void {
        const localFront = globalFront.clone();
        const localBack = globalBack.clone();

        this.group.worldToLocal(localFront);
        this.group.worldToLocal(localBack);

        bogieModel.orientOnRail(localFront, localBack);
    }

    private updateDebugVisuals(cabCenter: Vector3, wheels: any): void {
        const map = {
            frontBogieFront: wheels.frontFront.point,
            frontBogieBack: wheels.frontBack.point,
            rearBogieFront: wheels.rearFront.point,
            rearBogieBack: wheels.rearBack.point,
            cabCenter: cabCenter
        };

        type WheelSphereKey = keyof typeof map;

        for (const [key, pos] of Object.entries(map)) {
            const typedKey = key as WheelSphereKey;
            if (this.globalWheelSpheres[typedKey]) {
                this.globalWheelSpheres[typedKey]!.position.copy(pos);
            }
        }
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

    public createDebugUI(pane: Pane, config: TrainConfig, updateConfig: (config: TrainConfig) => void): void {
        const cabFolder = pane.addFolder({ title: this.rearCab ? 'Rear Cab' : 'Front Cab', expanded: true });

        cabFolder.addBinding(config.cab, 'modelPath', {
            label: 'Model Path'
        }).on('change', () => updateConfig(config));

        // Add file picker button for GLB model
        cabFolder.addButton({ title: 'Load GLB File...' }).on('click', () => {
            // this.openGLBFilePicker();
        });

        cabFolder.addBinding(config.cab, 'scale', {
            label: 'Scale',
            min: 0.1,
            max: 5.0,
            step: 0.1
        }).on('change', () => updateConfig(config));

        // 3d point model offset bindings
        cabFolder.addBinding(config.cab, 'modelOffset', {
            label: 'Model Offset'
        }).on('change', () => updateConfig(config));

        // Front Bogie folder
        const frontBogieFolder = cabFolder.addFolder({ title: 'Front Bogie', expanded: true });

        frontBogieFolder.addBinding(config.cab.frontBogie, 'zOffset', {
            label: 'Z Offset',
            min: -20.0,
            max: 20.0,
            step: 0.1
        }).on('change', () => updateConfig(config));

        frontBogieFolder.addBinding(config.cab.frontBogie, 'frontWheelOffset', {
            label: 'Front Wheel Offset',
            min: -5.0,
            max: 5.0,
            step: 0.1
        }).on('change', () => updateConfig(config));

        frontBogieFolder.addBinding(config.cab.frontBogie, 'backWheelOffset', {
            label: 'Back Wheel Offset',
            min: -5.0,
            max: 5.0,
            step: 0.1
        }).on('change', () => updateConfig(config));

        frontBogieFolder.addBinding(config.cab.frontBogie, 'entityName', {
            label: 'Entity Name (GLB)'
        }).on('change', () => updateConfig(config));

        // Rear Bogie folder
        const rearBogieFolder = cabFolder.addFolder({ title: 'Rear Bogie', expanded: true });

        rearBogieFolder.addBinding(config.cab.rearBogie, 'zOffset', {
            label: 'Z Offset',
            min: -20.0,
            max: 20.0,
            step: 0.1
        }).on('change', () => updateConfig(config));

        rearBogieFolder.addBinding(config.cab.rearBogie, 'frontWheelOffset', {
            label: 'Front Wheel Offset',
            min: -5.0,
            max: 5.0,
            step: 0.1
        }).on('change', () => updateConfig(config));

        rearBogieFolder.addBinding(config.cab.rearBogie, 'backWheelOffset', {
            label: 'Back Wheel Offset',
            min: -5.0,
            max: 5.0,
            step: 0.1
        }).on('change', () => updateConfig(config));

        rearBogieFolder.addBinding(config.cab.rearBogie, 'entityName', {
            label: 'Entity Name (GLB)'
        }).on('change', () => updateConfig(config));
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
