import { Group, Mesh, Object3D, SphereGeometry, BoxGeometry, MeshBasicMaterial, Vector3, MeshStandardMaterial, CylinderGeometry, Quaternion, Color, AlwaysStencilFunc, ZeroStencilOp, IncrementStencilOp, KeepStencilOp } from 'three';
import type { BogieConfig, RollingStockConfig, TrainConfig, WheelConfig } from './TrainConfig';
import { getGLTFLoader } from '../utils/ModelLoader';
import type Path from '../utils/Path';
import type { FolderApi, Pane } from 'tweakpane';
import { dummy, dummyForward, dummyQuad, dummyUp, dummyVec3, dummyVec3B } from '../utils/Helper';
import FilePicker from '../utils/FilePicker';
import { applyDeobfuscation, isDebugAdmin, loadEncryptedAsset, getProtectedAssetPath, blobString } from '../utils/Security.secure';
import { glassMaterial } from './Materials';
import { RollingStockAnimator } from './RollingStockAnimator';
import { trainAssetsPath } from './configs/TrainConfigurations.secure';
import { getFolderKey } from './TrainUiUtils';

export class RollingStock {
    public group: Group;
    public globalDebugGroup: Group;

    protected config: RollingStockConfig;
    private _targetRotation = new Quaternion();
    private model: Group | null = null;

    private animator: RollingStockAnimator | null = null;

    private frontBogieEntity: Object3D | null = null;
    private rearBogieEntity: Object3D | null = null;

    private wheels: { mesh: Object3D; radius: number; rotationAxis: Vector3; debugMesh?: Mesh }[] = [];

    private railPositions = {
        center: new Vector3(),
        bodyFront: new Vector3(),
        bodyRear: new Vector3(),
        bogieFront: new Vector3(),
        bogieFrontFront: new Vector3(),
        bogieFrontBack: new Vector3(),
        bogieRear: new Vector3(),
        bogieRearFront: new Vector3(),
        bogieRearBack: new Vector3(),
    }

    private debug: boolean = false;
    protected debugPaneName: string = 'RollingStock Debug';
    private paneFolder: FolderApi | null = null;

    private debugAnchor: Group | null = null;

    private debugMeshes: {
        center: Mesh | null;
        bogieFront: Mesh | null;
        bogieFrontFront: Mesh | null;
        bogieFrontBack: Mesh | null;
        bogieRear: Mesh | null;
        bogieRearFront: Mesh | null;
        bogieRearBack: Mesh | null;
        body: Mesh | null;
        couplerFront: Mesh | null;
        couplerRear: Mesh | null;
    } = {
            center: null,
            bogieFront: null,
            bogieFrontFront: null,
            bogieFrontBack: null,
            bogieRear: null,
            bogieRearFront: null,
            bogieRearBack: null,
            body: null,
            couplerFront: null,
            couplerRear: null,
        };

    constructor(config: RollingStockConfig, debug: boolean = false) {
        this.config = config;
        this.debug = debug;

        this.group = new Group();
        this.group.name = 'RollingStock';

        this.globalDebugGroup = new Group();
        this.globalDebugGroup.name = 'RollingStockGlobalDebug';

        if (config.modelPath) {
            this.loadModel(config.modelPath, config.internal);
        }

        if (debug) {
            this.createDebugVisuals();
        }
    }

    private createDebugVisuals(): void {
        const sphereGeo = new SphereGeometry(0.5, 16, 16);
        const boxGeo = new BoxGeometry(1, 1, 1);

        this.debugMeshes.bogieFrontFront = new Mesh(sphereGeo, new MeshBasicMaterial({ color: 0x00ff00 }));
        this.debugMeshes.bogieFront = new Mesh(sphereGeo, new MeshBasicMaterial({ color: 0x009b00 }));
        this.debugMeshes.bogieFrontBack = new Mesh(sphereGeo, new MeshBasicMaterial({ color: 0x005f00 }));
        this.debugMeshes.bogieRearFront = new Mesh(sphereGeo, new MeshBasicMaterial({ color: 0xff0000 }));
        this.debugMeshes.bogieRear = new Mesh(sphereGeo, new MeshBasicMaterial({ color: 0x9b0000 }));
        this.debugMeshes.bogieRearBack = new Mesh(sphereGeo, new MeshBasicMaterial({ color: 0x5f0000 }));
        this.debugMeshes.center = new Mesh(sphereGeo, new MeshBasicMaterial({ color: 0x0000ff }));

        this.globalDebugGroup.add(
            this.debugMeshes.bogieFrontFront, this.debugMeshes.bogieFront, this.debugMeshes.bogieFrontBack,
            this.debugMeshes.bogieRearFront, this.debugMeshes.bogieRear, this.debugMeshes.bogieRearBack,
            this.debugMeshes.center
        );

        this.debugAnchor = new Group();
        this.globalDebugGroup.add(this.debugAnchor);

        this.debugMeshes.body = new Mesh(
            boxGeo,
            new MeshBasicMaterial({ color: 0x00ffff, wireframe: true })
        );
        this.debugAnchor.add(this.debugMeshes.body);

        const couplerMat = new MeshBasicMaterial({ color: 0xffffff, wireframe: true });

        this.debugMeshes.couplerFront = new Mesh(boxGeo, couplerMat);
        this.debugAnchor.add(this.debugMeshes.couplerFront);

        this.debugMeshes.couplerRear = new Mesh(boxGeo, couplerMat);
        this.debugAnchor.add(this.debugMeshes.couplerRear);
    }

    private updateModelTransform(): void {
        if (!this.model) return;

        this.model.scale.setScalar(this.config.scale);
        this.model.position.set(
            this.config.modelOffset.x,
            this.config.modelOffset.y,
            this.config.modelOffset.z
        );

        if (this.config.modelForwardAxis) {
            const modelForward = new Vector3(
                this.config.modelForwardAxis.x,
                this.config.modelForwardAxis.y,
                this.config.modelForwardAxis.z
            ).normalize();

            const targetForward = new Vector3(0, 0, 1);
            this.model.quaternion.setFromUnitVectors(modelForward, targetForward);
        }
    }

    private setModelMaterials(scene: Group): void {
        scene.traverse((child) => {
            if (child instanceof Mesh) {
                const materials = Array.isArray(child.material) ? child.material : [child.material];

                materials.forEach((mat) => {
                    const name = mat.name?.toLowerCase() || '';

                    if (name.includes('glass') || name.includes('window') && !name.includes('frame')) {
                        child.material = glassMaterial;
                    }
                    else if (name.includes('frame') || name.includes('symbols')) {
                        const standardMat = mat as MeshStandardMaterial;

                        standardMat.alphaTest = 0.5;
                        standardMat.transparent = false;

                        standardMat.needsUpdate = true;
                    }
                    else if (this.config.interiorMaterial.pattern) {
                        const regex = new RegExp(this.config.interiorMaterial.pattern);
                        if (regex.test(name)) {
                            const standardMat = mat as MeshStandardMaterial;
                            standardMat.emissive = new Color(this.config.interiorMaterial.emissiveColor);
                            standardMat.emissiveIntensity = 0;
                            if (standardMat.map) {
                                standardMat.emissiveMap = standardMat.map;
                            }
                            standardMat.needsUpdate = true;
                        }
                    }
                    // disable receiving and casting shadows for performance
                    child.castShadow = false;
                    child.receiveShadow = false;

                });

                child.renderOrder = 1;
                const activeMat = child.material;
                const matArr = Array.isArray(activeMat) ? activeMat : [activeMat];
                for (const m of matArr) {
                    m.stencilWrite = true;
                    m.stencilFunc = AlwaysStencilFunc;
                    m.stencilRef = 0;
                    m.stencilZPass = ZeroStencilOp;
                    m.stencilZFail = IncrementStencilOp;
                    m.stencilFail = KeepStencilOp;
                }
            }
        });
    };

    private setupLoadedModel(gltf: any, isInternal: boolean): void {
        if (this.model) this.group.remove(this.model);
        if (this.animator) this.animator.cleanup();

        this.model = gltf.scene!;

        this.setModelMaterials(this.model!);

        const animations = gltf.animations || [];
        this.animator = new RollingStockAnimator(this.model!, animations);

        if (this.config.animationGroups.length > 0) {
            this.animator.importGroups(this.config.animationGroups);
        }

        if (this.paneFolder) this.animator.createDebugUI(this.paneFolder);

        if (isInternal) {
            applyDeobfuscation(this.model!);
        }

        this.updateModelTransform();
        this.group.add(this.model!);
        this.findBogieEntities();
        this.onModelLoaded();
    }

    protected onModelLoaded(): void { }

    private async loadModel(path: string, isInternal: boolean = false): Promise<void> {
        const loader = getGLTFLoader();

        if (isInternal && !path.startsWith(blobString)) {
            try {
                const mangledFileName = getProtectedAssetPath(path);
                const fetchUrl = `${trainAssetsPath}/${mangledFileName}`;

                console.log(`[RollingStock] Fetching secure buffer: ${fetchUrl}`);

                const buffer = await loadEncryptedAsset(fetchUrl, path);
                loader.parse(
                    buffer,
                    './',
                    (gltf) => {
                        this.setupLoadedModel(gltf, true);
                    },
                    (error) => {
                        console.error('[RollingStock] Parse error:', error);
                    }
                );

            } catch (err) {
                console.error(`[RollingStock] Failed to load secure asset: ${path}`, err);
            }
        }

        else {
            loader.load(
                path,
                (gltf) => {
                    this.setupLoadedModel(gltf, isInternal);
                },
                undefined,
                (error) => {
                    console.warn('Failed to load model:', path, error);
                }
            );
        }
    }

    private setDebugVisibility(visible: boolean): void {
        if (this.debugAnchor) {
            this.debugAnchor.visible = visible;
        }

        this.globalDebugGroup.visible = visible;
    }

    private getDebugVisibility(): boolean {
        if (this.debugAnchor) {
            return this.debugAnchor.visible;
        }
        return this.globalDebugGroup.visible;
    }

    public positionOnPath(distance: number, path: Path): void {
        const { frontBogie, rearBogie } = this.config;
        const directionMultiplier = this.config.reverseOnTrack ? -1 : 1;

        const getWheelPoint = (config: BogieConfig, offset: number, out: Vector3) => {
            const totalOffset = (config.zOffset + offset) * directionMultiplier;
            return path.getPointAtDistance(distance + totalOffset, out);
        };

        getWheelPoint(frontBogie, 0, this.railPositions.bogieFront);
        getWheelPoint(frontBogie, frontBogie.wheelOffsetFront, this.railPositions.bogieFrontFront);
        getWheelPoint(frontBogie, frontBogie.wheelOffsetRear, this.railPositions.bogieFrontBack);

        getWheelPoint(rearBogie, 0, this.railPositions.bogieRear);
        getWheelPoint(rearBogie, rearBogie.wheelOffsetFront, this.railPositions.bogieRearFront);
        getWheelPoint(rearBogie, rearBogie.wheelOffsetRear, this.railPositions.bogieRearBack);

        path.getPointAtDistance(distance, this.railPositions.center);

        this.railPositions.bodyFront.copy(this.railPositions.bogieFront);
        this.railPositions.bodyRear.copy(this.railPositions.bogieRear);

        this.orientOnRails();

        if (this.debug) this.updateDebugVisuals();
    }

    private updateDebugVisuals(): void {
        const frontPoint = this.railPositions.bogieFront;
        const rearPoint = this.railPositions.bogieRear;
        const bogieMidpoint = new Vector3().addVectors(frontPoint, rearPoint).multiplyScalar(0.5);

        const trackDirection = new Vector3().subVectors(frontPoint, rearPoint).normalize();
        const offset = new Vector3().subVectors(bogieMidpoint, this.railPositions.center);
        const longitudinalComponent = offset.dot(trackDirection);
        offset.addScaledVector(trackDirection, -longitudinalComponent);

        const trainPosition = new Vector3().copy(this.railPositions.center).add(offset);

        const map = {
            bogieFront: this.railPositions.bogieFront,
            bogieFrontFront: this.railPositions.bogieFrontFront,
            bogieFrontBack: this.railPositions.bogieFrontBack,
            bogieRear: this.railPositions.bogieRear,
            bogieRearFront: this.railPositions.bogieRearFront,
            bogieRearBack: this.railPositions.bogieRearBack,
            center: this.railPositions.center
        };

        type DebugKey = keyof typeof map;
        for (const [key, pos] of Object.entries(map)) {
            const mesh = this.debugMeshes[key as DebugKey];
            if (mesh) mesh.position.copy(pos);
        }

        if (this.debugAnchor && this.debugMeshes.body) {
            this.debugAnchor.position.copy(trainPosition);
            this.debugAnchor.quaternion.copy(this.group.quaternion);

            const c = this.config;

            this.debugMeshes.body.scale.set(c.width, c.height, c.length);
            this.debugMeshes.body.position.set(0, c.height / 2, 0);

            const cw = c.width * 0.2;
            const ch = c.height * 0.2;

            if (this.debugMeshes.couplerFront) {
                const len = Math.max(0.1, c.couplerLengthFront);
                this.debugMeshes.couplerFront.scale.set(cw, ch, len);
                this.debugMeshes.couplerFront.position.set(0, c.height / 2, (c.length / 2) + (len / 2));
                this.debugMeshes.couplerFront.visible = c.couplerLengthFront > 0;
            }

            if (this.debugMeshes.couplerRear) {
                const len = Math.max(0.1, c.couplerLengthRear);
                this.debugMeshes.couplerRear.scale.set(cw, ch, len);
                this.debugMeshes.couplerRear.position.set(0, c.height / 2, -(c.length / 2) - (len / 2));
                this.debugMeshes.couplerRear.visible = c.couplerLengthRear > 0;
            }
        }

        for (const wheel of this.wheels) {
            if (wheel.debugMesh) {
                wheel.mesh.getWorldPosition(wheel.debugMesh.position);
                wheel.mesh.getWorldQuaternion(wheel.debugMesh.quaternion);
            }
        }
    }

    private findBogieEntities(): void {
        if (!this.model) return;
        this.frontBogieEntity = null;
        this.rearBogieEntity = null;

        if (this.config.frontBogie.entityName) {
            this.frontBogieEntity = this.model.getObjectByName(this.config.frontBogie.entityName) || null;
        }
        if (this.config.rearBogie.entityName) {
            this.rearBogieEntity = this.model.getObjectByName(this.config.rearBogie.entityName) || null;
        }

        console.log(`[RollingStock] Front Bogie Entity: ${this.frontBogieEntity ? 'Found' : 'Not Found'} (${this.config.frontBogie.entityName})`);
        console.log(`[RollingStock] Rear Bogie Entity: ${this.rearBogieEntity ? 'Found' : 'Not Found'} (${this.config.rearBogie.entityName})`);

        this.findWheels();
    }

    private findWheels(): void {
        if (!this.model) return;

        for (const wheel of this.wheels) {
            if (wheel.debugMesh) {
                this.globalDebugGroup.remove(wheel.debugMesh);
                wheel.debugMesh.geometry.dispose();
                (wheel.debugMesh.material as MeshBasicMaterial).dispose();
            }
        }

        this.wheels = [];

        for (const wheelConfig of this.config.wheels || []) {
            if (!wheelConfig.pattern) continue;

            try {
                const regex = new RegExp(wheelConfig.pattern);
                const rotationAxis = dummyVec3.set(
                    wheelConfig.rotationAxis.x,
                    wheelConfig.rotationAxis.y,
                    wheelConfig.rotationAxis.z
                ).normalize();

                const wheelDebugMat = new MeshBasicMaterial({ color: 0xff00ff, wireframe: true });

                this.model!.traverse((child) => {
                    if (regex.test(child.name) && !this.wheels.some(w => w.mesh === child)) {
                        const radius = wheelConfig.radius;
                        let debugMesh: Mesh | undefined;

                        if (this.debug) {
                            // CylinderGeometry is Y-up by default — orient it to the wheel's rotation axis
                            const wheelDebugGeo = new CylinderGeometry(radius, radius, 1.5, 16);

                            const alignQuat = dummyQuad.setFromUnitVectors(dummyUp, rotationAxis);
                            wheelDebugGeo.applyQuaternion(alignQuat);

                            debugMesh = new Mesh(wheelDebugGeo, wheelDebugMat);
                            debugMesh.name = `wheel-debug-${child.name}`;
                            this.globalDebugGroup.add(debugMesh);
                        }

                        this.wheels.push({ mesh: child, radius, rotationAxis: rotationAxis.clone(), debugMesh });
                        console.log(`[RollingStock] Found wheel: ${child.name}, radius: ${radius}m`);
                    }
                });
            } catch (e) {
                console.warn(`[RollingStock] Invalid wheel pattern regex: ${wheelConfig.pattern}`, e);
            }
        }

        console.log(`[RollingStock] Found ${this.wheels.length} wheels total`);
    }

    public updateConfig(config: RollingStockConfig): void {
        const modelChanged = config.modelPath !== this.config.modelPath;
        const bogieNamesChanged =
            config.frontBogie.entityName !== this.config.frontBogie.entityName ||
            config.rearBogie.entityName !== this.config.rearBogie.entityName;

        const wheelsChanged = JSON.stringify(config.wheels) !== JSON.stringify(this.config.wheels);
        const interiorMaterialChanged = JSON.stringify(config.interiorMaterial) !== JSON.stringify(this.config.interiorMaterial);

        this.config = config;
        this.updateModelTransform();

        if (bogieNamesChanged && this.model) this.findBogieEntities();
        if (wheelsChanged && this.model) this.findWheels();
        if (interiorMaterialChanged && this.model) this.setModelMaterials(this.model);
        if (modelChanged && config.modelPath) this.loadModel(config.modelPath, config.internal);
    }

    public orientOnRails(): void {
        const frontPoint = this.railPositions.bodyFront;
        const rearPoint = this.railPositions.bodyRear;

        const bogieMidpoint = dummyVec3.addVectors(frontPoint, rearPoint).multiplyScalar(0.5);

        dummy.position.copy(rearPoint);
        dummy.lookAt(frontPoint);
        this.group.quaternion.copy(dummy.quaternion);

        // Use path center for longitudinal position, apply lateral offset from bogie midpoint
        dummy.position.copy(this.railPositions.center);

        const trackDirection = dummyVec3B.subVectors(frontPoint, rearPoint).normalize();
        const offset = dummyVec3.subVectors(bogieMidpoint, this.railPositions.center);

        // Remove longitudinal component, keep only lateral offset
        const longitudinalComponent = offset.dot(trackDirection);
        offset.addScaledVector(trackDirection, -longitudinalComponent);
        dummy.position.add(offset);

        this.group.parent!.worldToLocal(dummy.position);
        this.group.position.copy(dummy.position);

        const updateBogieRotation = (
            entity: Object3D,
            config: BogieConfig,
            posFront: Vector3,
            posBack: Vector3
        ) => {
            // Direction vector in local space
            const worldDirection = dummyVec3.subVectors(posFront, posBack).normalize();
            const parentQuat = entity.parent!.getWorldQuaternion(dummyQuad);
            const localDirection = worldDirection.applyQuaternion(parentQuat.invert());

            // LookAt enforces Y-Up constraint, preventing sideways roll
            dummy.position.set(0, 0, 0);
            dummy.lookAt(localDirection);
            const targetRotation = this._targetRotation.copy(dummy.quaternion);

            // Axis correction: align bone forward axis to +Z
            const boneAxis = config.boneForwardAxis;
            const boneForward = dummyVec3.set(boneAxis.x, boneAxis.y, boneAxis.z).normalize();
            const correctionQuat = dummyQuad.setFromUnitVectors(boneForward, dummyForward);

            // Final = LookAt * Correction
            entity.quaternion.copy(targetRotation.multiply(correctionQuat));
        };

        if (this.frontBogieEntity && this.model) {
            updateBogieRotation(
                this.frontBogieEntity,
                this.config.frontBogie,
                this.railPositions.bogieFrontFront,
                this.railPositions.bogieFrontBack
            );
        }

        if (this.rearBogieEntity && this.model) {
            updateBogieRotation(
                this.rearBogieEntity,
                this.config.rearBogie,
                this.railPositions.bogieRearFront,
                this.railPositions.bogieRearBack
            );
        }
    }

    protected getConfigTarget(config: TrainConfig): RollingStockConfig {
        return {} as RollingStockConfig; // Placeholder, to be overridden in subclasses
    }

    public getRailPositions() {
        return this.railPositions;
    }

    public createDebugUI(
        pane: Pane | FolderApi,
        config: TrainConfig,
        updateConfig: (config: TrainConfig) => void,
        _onDelete: (() => void) | null,
        _onDuplicate: (() => void) | null,
        registerFolder: (folder: FolderApi, key: string) => void,
        folderPath: string[],
        getFolderExpanded: (key: string, fallback: boolean) => boolean
    ): FolderApi {
        const basePath = [...folderPath, this.debugPaneName];

        const baseKey = getFolderKey(basePath);
        this.paneFolder = pane.addFolder({
            title: this.debugPaneName,
            expanded: getFolderExpanded(baseKey, false)
        });
        registerFolder(this.paneFolder, baseKey);

        const targetConfig = this.getConfigTarget(config);

        const debugParams = {
            showDebugVisuals: this.getDebugVisibility()
        };

        this.paneFolder.addBinding(debugParams, 'showDebugVisuals', {
            label: 'Show Debug Visuals'
        }).on('change', (ev) => {
            this.setDebugVisibility(ev.value);
        });

        const maxModelOffset = 50.0;
        const maxBogieZOffset = 20;
        const maxWheelToBogieOffset = 4.0; // Reduced: wheels are rarely >4m from bogie center

        const physKey = getFolderKey([...basePath, 'Dimensions & Physics']);
        const physFolder = this.paneFolder.addFolder({
            title: 'Dimensions & Physics',
            expanded: getFolderExpanded(physKey, false)
        });
        registerFolder(physFolder, physKey);

        physFolder.addBinding(targetConfig, 'length', {
            label: 'Length (m)',
            min: 5.0,
            max: 30.0,
            step: 0.1
        }).on('change', () => updateConfig(config));

        physFolder.addBinding(targetConfig, 'width', {
            label: 'Width (m)',
            min: 1.5, // Narrow gauge
            max: 4.5, // Wide cargo
            step: 0.05
        }).on('change', () => updateConfig(config));

        physFolder.addBinding(targetConfig, 'height', {
            label: 'Height (m)',
            min: 2.0,
            max: 6.5, // Double-decker height
            step: 0.05
        }).on('change', () => updateConfig(config));

        physFolder.addBinding(targetConfig, 'weight', {
            label: 'Weight (Tons)',
            min: 10.0,
            max: 200.0, // Heavy locomotives can reach ~150-180t
            step: 0.5
        }).on('change', () => updateConfig(config));

        const connKey = getFolderKey([...basePath, 'Connections']);
        const connFolder = this.paneFolder.addFolder({
            title: 'Connections',
            expanded: getFolderExpanded(connKey, false)
        });
        registerFolder(connFolder, connKey);

        connFolder.addBinding(targetConfig, 'couplerLengthFront', {
            label: 'Coupler Front (m)',
            min: 0.0, // Buffers touching
            max: 2.5, // Long drawbar
            step: 0.05
        }).on('change', () => updateConfig(config));

        connFolder.addBinding(targetConfig, 'couplerLengthRear', {
            label: 'Coupler Rear (m)',
            min: 0.0,
            max: 2.5,
            step: 0.05
        }).on('change', () => updateConfig(config));

        const engineToggle = this.paneFolder.addBinding(targetConfig, 'engine', {
            label: 'Is Engine'
        });

        const engKey = getFolderKey([...basePath, 'Engine Specs']);
        const engFolder = this.paneFolder.addFolder({
            title: 'Engine Specs',
            expanded: getFolderExpanded(engKey, true)
        });
        registerFolder(engFolder, engKey);
        engFolder.hidden = !targetConfig.engine;

        engineToggle.on('change', (ev) => {
            engFolder.hidden = !ev.value;
            updateConfig(config);
        });

        engFolder.addBinding(targetConfig, 'enginePower', {
            label: 'Power (kW)',
            min: 0,
            max: 12000, // Modern heavy electric locos can hit 8-10MW
            step: 10
        }).on('change', () => updateConfig(config));

        engFolder.addBinding(targetConfig, 'brakingPower', {
            label: 'Brakes (kN)',
            min: 0,
            max: 500,
            step: 1
        }).on('change', () => updateConfig(config));

        const visKey = getFolderKey([...basePath, 'Visuals']);
        const visFolder = this.paneFolder.addFolder({
            title: 'Visuals',
            expanded: getFolderExpanded(visKey, false)
        });
        registerFolder(visFolder, visKey);

        visFolder.addBinding(targetConfig, 'modelPath', {
            label: 'Model Path'
        }).on('change', () => updateConfig(config));

        if (isDebugAdmin()) {
            targetConfig.internal = targetConfig.internal || false;
            visFolder.addBinding(targetConfig, 'internal', {
                label: 'Is Obfuscated',
            }).on('change', () => {
                if (targetConfig.modelPath) this.loadModel(targetConfig.modelPath);
                updateConfig(config);
            });
        }

        visFolder.addButton({ title: 'Load GLB File...' }).on('click', () => {
            FilePicker((url: string) => {
                targetConfig.modelPath = url;
                updateConfig(config);
            }, '.glb,.gltf');
        });

        visFolder.addBinding(targetConfig, 'scale', {
            label: 'Scale',
            min: 0.1,
            max: 20.0,
            step: 0.01 // Finer step for precision scaling
        }).on('change', () => updateConfig(config));

        visFolder.addBinding(targetConfig, 'modelOffset', {
            label: 'Model Offset',
            x: { min: -maxModelOffset, max: maxModelOffset },
            y: { min: -maxModelOffset, max: maxModelOffset },
            z: { min: -maxModelOffset, max: maxModelOffset }
        }).on('change', () => updateConfig(config));

        if (!targetConfig.modelForwardAxis) {
            targetConfig.modelForwardAxis = { x: 0, y: 0, z: 1 };
        }

        visFolder.addBinding(targetConfig, 'modelForwardAxis', {
            label: 'Model Forward Axis',
            x: { min: -1, max: 1, step: 0.1 },
            y: { min: -1, max: 1, step: 0.1 },
            z: { min: -1, max: 1, step: 0.1 }
        }).on('change', () => updateConfig(config));

        visFolder.addBinding(targetConfig, 'reverseOnTrack', {
            label: 'Reverse On Track'
        }).on('change', () => updateConfig(config));

        const bogieKey = getFolderKey([...basePath, 'Bogie Setup']);
        const bogieMainFolder = this.paneFolder.addFolder({
            title: 'Bogie Setup',
            expanded: getFolderExpanded(bogieKey, false)
        });
        registerFolder(bogieMainFolder, bogieKey);

        const addBogieControls = (folder: any, bogie: any, isRear: boolean) => {
            folder.addBinding(bogie, 'zOffset', {
                label: 'Z Offset',
                min: isRear ? -maxBogieZOffset : 0,
                max: isRear ? 0 : maxBogieZOffset,
                step: 0.1
            }).on('change', () => updateConfig(config));

            folder.addBinding(bogie, 'wheelOffsetFront', {
                label: 'Front Axle Dist',
                min: 0.0,
                max: maxWheelToBogieOffset,
                step: 0.05
            }).on('change', () => updateConfig(config));

            folder.addBinding(bogie, 'wheelOffsetRear', {
                label: 'Rear Axle Dist',
                min: -maxWheelToBogieOffset,
                max: 0.0,
                step: 0.05
            }).on('change', () => updateConfig(config));

            folder.addBinding(bogie, 'entityName', {
                label: 'Bone/Node Name'
            }).on('change', () => updateConfig(config));

            folder.addBinding(bogie, 'boneForwardAxis', {
                label: 'Bone Forward Axis',
                x: { min: -1, max: 1, step: 0.1 },
                y: { min: -1, max: 1, step: 0.1 },
                z: { min: -1, max: 1, step: 0.1 }
            }).on('change', () => updateConfig(config));
        };

        const frontBogieKey = getFolderKey([...basePath, 'Bogie Setup', 'Front Bogie']);
        const frontBogieFolder = bogieMainFolder.addFolder({
            title: 'Front Bogie',
            expanded: getFolderExpanded(frontBogieKey, true)
        });
        registerFolder(frontBogieFolder, frontBogieKey);
        addBogieControls(frontBogieFolder, targetConfig.frontBogie, false);

        const rearBogieKey = getFolderKey([...basePath, 'Bogie Setup', 'Rear Bogie']);
        const rearBogieFolder = bogieMainFolder.addFolder({
            title: 'Rear Bogie',
            expanded: getFolderExpanded(rearBogieKey, true)
        });
        registerFolder(rearBogieFolder, rearBogieKey);
        addBogieControls(rearBogieFolder, targetConfig.rearBogie, true);

        const wheelsKey = getFolderKey([...basePath, 'Wheels']);
        const wheelsFolder = this.paneFolder.addFolder({
            title: 'Wheels',
            expanded: getFolderExpanded(wheelsKey, false)
        });
        registerFolder(wheelsFolder, wheelsKey);

        if (!targetConfig.wheels) {
            targetConfig.wheels = [];
        }

        const rebuildWheelUI = () => {
            const children = [...wheelsFolder.children];
            children.forEach((child) => {
                if (child !== addWheelButton) {
                    wheelsFolder.remove(child);
                }
            });

            targetConfig.wheels.forEach((wheelConfig, index) => {
                const wheelKey = getFolderKey([...basePath, 'Wheels', `Wheel ${index + 1}`]);
                const wheelFolder = wheelsFolder.addFolder({
                    title: `Wheel ${index + 1}`,
                    expanded: getFolderExpanded(wheelKey, true)
                });
                registerFolder(wheelFolder, wheelKey);

                wheelFolder.addBinding(wheelConfig, 'pattern', {
                    label: 'Pattern (regex)'
                }).on('change', () => {
                    this.findWheels();
                    updateConfig(config);
                });

                wheelFolder.addBinding(wheelConfig, 'radius', {
                    label: 'Radius (m)',
                    min: 0.1,
                    max: 2.0,
                    step: 0.01
                }).on('change', () => {
                    this.findWheels();
                    updateConfig(config);
                });

                wheelFolder.addBinding(wheelConfig, 'rotationAxis', {
                    label: 'Rotation Axis',
                    x: { min: -1, max: 1, step: 0.1 },
                    y: { min: -1, max: 1, step: 0.1 },
                    z: { min: -1, max: 1, step: 0.1 }
                }).on('change', () => {
                    this.findWheels();
                    updateConfig(config);
                });

                wheelFolder.addButton({ title: 'Remove' }).on('click', () => {
                    targetConfig.wheels.splice(index, 1);
                    this.findWheels();
                    updateConfig(config);
                    rebuildWheelUI();
                });
            });
        };

        const addWheelButton = wheelsFolder.addButton({ title: 'Add Wheel Config' }).on('click', () => {
            targetConfig.wheels.push({
                pattern: '',
                rotationAxis: { x: 1, y: 0, z: 0 },
                radius: 0.5
            });
            updateConfig(config);
            rebuildWheelUI();
        });

        rebuildWheelUI();

        const interiorKey = getFolderKey([...basePath, 'Lights']);
        const interiorFolder = this.paneFolder.addFolder({
            title: 'Lights',
            expanded: getFolderExpanded(interiorKey, false)
        });
        registerFolder(interiorFolder, interiorKey);

        interiorFolder.addBinding(targetConfig.interiorMaterial, 'pattern', {
            label: 'Pattern (regex)'
        }).on('change', () => {
            if (this.model) this.setModelMaterials(this.model);
            updateConfig(config);
        });

        // Tweakpane color picker expects {r, g, b} object
        const colorProxy = {
            color: {
                r: (targetConfig.interiorMaterial.emissiveColor >> 16) & 0xff,
                g: (targetConfig.interiorMaterial.emissiveColor >> 8) & 0xff,
                b: targetConfig.interiorMaterial.emissiveColor & 0xff
            }
        };

        interiorFolder.addBinding(colorProxy, 'color', {
            label: 'Emissive Color'
        }).on('change', (ev) => {
            targetConfig.interiorMaterial.emissiveColor = (ev.value.r << 16) | (ev.value.g << 8) | ev.value.b;
            if (this.model) this.setModelMaterials(this.model);
            updateConfig(config);
        });

        interiorFolder.addBinding(targetConfig.interiorMaterial, 'emissiveIntensity', {
            label: 'Emissive Intensity',
            min: 0,
            max: 2,
            step: 0.01
        }).on('change', () => {
            if (this.model) this.setModelMaterials(this.model);
            updateConfig(config);
        });

        return this.paneFolder;
    }

    public exportConfig(): RollingStockConfig {
        const exported = { ...this.config };
        if (this.animator) {
            exported.animationGroups = this.animator.exportGroups();
        }
        return exported;
    }

    public setEmissiveEnabled(enabled: boolean): void {
        if (!this.model || !this.config.interiorMaterial.pattern) return;
        const regex = new RegExp(this.config.interiorMaterial.pattern);
        const targetIntensity = enabled ? this.config.interiorMaterial.emissiveIntensity : 0;

        this.model.traverse((child) => {
            if (child instanceof Mesh) {
                const mats = Array.isArray(child.material) ? child.material : [child.material];
                for (const mat of mats) {
                    if (regex.test(mat.name?.toLowerCase() || '')) {
                        (mat as MeshStandardMaterial).emissiveIntensity = targetIntensity;
                    }
                }
            }
        });
    }

    public playAnimationGroup(name: string, reverse: boolean = false, loop: boolean = false, alternate: boolean = false): void {
        if (!this.animator) return;
        const api = this.animator.getGroupAPI(name);
        api.play(reverse, loop, alternate);
    }

    public update(delta: number, distanceDelta: number = 0): void {
        if (this.animator) {
            this.animator.update(delta);
        }

        if (distanceDelta !== 0) {
            this.rotateWheels(distanceDelta);
        }
    }

    private rotateWheels(distanceDelta: number): void {
        const directionMultiplier = this.config.reverseOnTrack ? -1 : 1;
        for (const wheel of this.wheels) {
            // angle = distance / radius (circumference cancels out)
            const angle = (distanceDelta / wheel.radius) * directionMultiplier;
            wheel.mesh.rotateOnAxis(wheel.rotationAxis, angle);
        }
    }

    protected findMeshesByPattern(pattern: string): Mesh[] {
        const results: Mesh[] = [];
        if (!this.model) return results;

        try {
            const regex = new RegExp(pattern, 'i');
            this.model.traverse((child) => {
                if (child instanceof Mesh && regex.test(child.name || '')) {
                    results.push(child);
                }
            });
        } catch (e) {
            console.warn(`[RollingStock] Invalid mesh pattern regex: ${pattern}`, e);
        }

        return results;
    }

    public cleanup(): void {
        if (this.model) {
            this.model.traverse((child) => {
                if (child instanceof Mesh) {
                    child.geometry.dispose();
                    if (Array.isArray(child.material)) child.material.forEach(m => m.dispose());
                    else child.material.dispose();
                }
            });
        }
        Object.values(this.debugMeshes).forEach(mesh => {
            if (mesh) {
                mesh.geometry.dispose();
                (mesh.material as any).dispose();
            }
        });
    }
}
