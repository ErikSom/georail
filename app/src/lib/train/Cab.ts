import { Group, Mesh, Object3D, SphereGeometry, MeshBasicMaterial, Vector3 } from 'three';
import type { BogieConfig, CabConfig, TrainConfig } from './TrainConfig';
import { getGLTFLoader } from '../utils/ModelLoader';
import type Path from '../utils/Path';
import type { Pane } from 'tweakpane';
import { dummy } from '../utils/Helper';
import FilePicker from '../utils/FilePicker';

interface IRailPositions {
    center: Vector3;
    bogieFront: { point: Vector3; index: number };
    bogieFrontFront: { point: Vector3; index: number };
    bogieFrontBack: { point: Vector3; index: number };
    bogieRear: { point: Vector3; index: number };
    bogieRearFront: { point: Vector3; index: number };
    bogieRearBack: { point: Vector3; index: number };
}

export class Cab {
    public group: Group;
    public globalDebugGroup: Group;

    private config: CabConfig;
    private rearCab: boolean = false;
    private model: Group | null = null;

    private frontBogieEntity: Object3D | null = null;
    private rearBogieEntity: Object3D | null = null;

    // Global debug visualization (added directly to scene, not affected by hierarchy)
    private debug: boolean = false;
    private globalWheelSpheres: {
        center: Mesh | null;
        bogieFront: Mesh | null;
        bogieFrontFront: Mesh | null;
        bogieFrontBack: Mesh | null;
        bogieRear: Mesh | null;
        bogieRearFront: Mesh | null;
        bogieRearBack: Mesh | null;
    } = {
            center: null,
            bogieFront: null,
            bogieFrontFront: null,
            bogieFrontBack: null,
            bogieRear: null,
            bogieRearFront: null,
            bogieRearBack: null,
        };

    constructor(config: CabConfig, rearCab: boolean = false, debug: boolean = false) {
        this.config = config;
        this.debug = debug;
        this.rearCab = rearCab;

        this.group = new Group();
        this.group.name = rearCab ? 'RearCab' : 'FrontCab';

        this.globalDebugGroup = new Group();
        this.globalDebugGroup.name = 'CabGlobalDebug';

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
        this.globalWheelSpheres.bogieFrontFront = new Mesh(
            geometry,
            new MeshBasicMaterial({ color: 0x00ff00 })
        );

        // Front bogie center - Lesser Bright Green
        this.globalWheelSpheres.bogieFront = new Mesh(
            geometry,
            new MeshBasicMaterial({ color: 0x009b00 })
        );
        this.globalDebugGroup.add(this.globalWheelSpheres.bogieFront);

        this.globalDebugGroup.add(this.globalWheelSpheres.bogieFrontFront);

        // Front bogie back wheel - Dark Green
        this.globalWheelSpheres.bogieFrontBack = new Mesh(
            geometry,
            new MeshBasicMaterial({ color: 0x005f00 })
        );
        this.globalDebugGroup.add(this.globalWheelSpheres.bogieFrontBack);


        // Rear bogie front wheel - Bright Red
        this.globalWheelSpheres.bogieRearFront = new Mesh(
            geometry,
            new MeshBasicMaterial({ color: 0xff0000 })
        );
        this.globalDebugGroup.add(this.globalWheelSpheres.bogieRearFront);

        // Rear bogie center - Lesser Bright Red
        this.globalWheelSpheres.bogieRear = new Mesh(
            geometry,
            new MeshBasicMaterial({ color: 0x9b0000 })
        );
        this.globalDebugGroup.add(this.globalWheelSpheres.bogieRear);

        // Rear bogie back wheel - Dark Red
        this.globalWheelSpheres.bogieRearBack = new Mesh(
            geometry,
            new MeshBasicMaterial({ color: 0x5f0000 })
        );
        this.globalDebugGroup.add(this.globalWheelSpheres.bogieRearBack);

        // Cab center - Blue
        this.globalWheelSpheres.center = new Mesh(
            geometry,
            new MeshBasicMaterial({ color: 0x0000ff })
        );
        this.globalDebugGroup.add(this.globalWheelSpheres.center);

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

        const getWheelPoint = (config: BogieConfig, offset: number) => {
            const totalOffset = config.zOffset + offset;
            return path.getPointAtDistance(pathIndex, totalOffset);
        };

        const railPositions = {
            center: path.points[pathIndex].clone(),
            bogieFront: getWheelPoint(frontBogie, 0),
            bogieFrontFront: getWheelPoint(frontBogie, frontBogie.frontWheelOffset),
            bogieFrontBack: getWheelPoint(frontBogie, frontBogie.backWheelOffset),
            bogieRear: getWheelPoint(rearBogie, 0),
            bogieRearFront: getWheelPoint(rearBogie, rearBogie.frontWheelOffset),
            bogieRearBack: getWheelPoint(rearBogie, rearBogie.backWheelOffset),
        } as IRailPositions;

        if (!railPositions.center ||
            !railPositions.bogieFront || !railPositions.bogieFrontFront || !railPositions.bogieFrontBack ||
            !railPositions.bogieRear || !railPositions.bogieRearFront || !railPositions.bogieRearBack) {
            console.warn('Train: Could not find all wheel positions on path');
            return;
        }

        this.orientOnRails(railPositions);

        if (this.debug) this.updateDebugVisuals(railPositions);
    }

    private updateDebugVisuals(railPositions: IRailPositions): void {
        const map = {
            bogieFront: railPositions.bogieFront.point,
            bogieFrontFront: railPositions.bogieFrontFront.point,
            bogieFrontBack: railPositions.bogieFrontBack.point,
            bogieRear: railPositions.bogieRear.point,
            bogieRearFront: railPositions.bogieRearFront.point,
            bogieRearBack: railPositions.bogieRearBack.point,
            center: railPositions.center
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

        this.updateModelTransform();

        if (bogieNamesChanged && this.model) {
            this.findBogieEntities();
        }

        if (modelChanged && config.modelPath) {
            this.loadModel(config.modelPath);
        }
    }

    public orientOnRails(railPositions: IRailPositions): void {
        this.group.position.copy(railPositions.center);


        const frontPoint = railPositions.bogieFront.point;
        const rearPoint = railPositions.bogieRear.point;

        dummy.position.copy(rearPoint);
        dummy.lookAt(frontPoint);
        this.group.quaternion.copy(dummy.quaternion);
    }

    public createDebugUI(pane: Pane, config: TrainConfig, updateConfig: (config: TrainConfig) => void): void {
        const cabFolder = pane.addFolder({ title: this.rearCab ? 'Rear Cab' : 'Front Cab', expanded: true });

        cabFolder.addBinding(config.cab, 'modelPath', {
            label: 'Model Path'
        }).on('change', () => updateConfig(config));

        // Add file picker button for GLB model
        cabFolder.addButton({ title: 'Load GLB File...' }).on('click', () => {
            FilePicker((url: string) => {
                if (this.rearCab) {
                    config.rearCab!.modelPath = url;
                } else {
                    config.cab.modelPath = url;
                }

                updateConfig(config);
            }, '.glb,.gltf');
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
            min: 0.0,
            max: 20.0,
            step: 0.1
        }).on('change', () => updateConfig(config));

        frontBogieFolder.addBinding(config.cab.frontBogie, 'frontWheelOffset', {
            label: 'Front Wheel Offset',
            min: 0.0,
            max: 10.0,
            step: 0.1
        }).on('change', () => updateConfig(config));

        frontBogieFolder.addBinding(config.cab.frontBogie, 'backWheelOffset', {
            label: 'Back Wheel Offset',
            min: -10.0,
            max: 0.0,
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
            max: 0.0,
            step: 0.1
        }).on('change', () => updateConfig(config));

        rearBogieFolder.addBinding(config.cab.rearBogie, 'frontWheelOffset', {
            label: 'Front Wheel Offset',
            min: 0.0,
            max: 10.0,
            step: 0.1
        }).on('change', () => updateConfig(config));

        rearBogieFolder.addBinding(config.cab.rearBogie, 'backWheelOffset', {
            label: 'Back Wheel Offset',
            min: -10.0,
            max: 0.0,
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
