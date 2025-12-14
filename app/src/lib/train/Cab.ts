import { Vector3, Group, Mesh, Quaternion, Object3D } from 'three';
import type { CabConfig } from './TrainConfig';
import { Bogie } from './Bogie';
import { getGLTFLoader } from '../utils/ModelLoader';

export class Cab {
    public group: Group;
    private config: CabConfig;
    private frontBogie: Bogie;
    private rearBogie: Bogie;
    private model: Group | null = null;

    private frontBogieEntity: Object3D | null = null;
    private rearBogieEntity: Object3D | null = null;
    private tempQuaternion: Quaternion = new Quaternion();

    constructor(config: CabConfig) {

        console.log('******** Creating Cab with config:', config);
        this.config = config;
        this.group = new Group();
        this.group.name = 'Cab';

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
