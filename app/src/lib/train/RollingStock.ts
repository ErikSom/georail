import { Group, Mesh, Object3D, SphereGeometry, BoxGeometry, MeshBasicMaterial, Vector3, MeshStandardMaterial, CylinderGeometry, Quaternion, Color } from 'three';
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
    private model: Group | null = null;

    private animator: RollingStockAnimator | null = null;

    private frontBogieEntity: Object3D | null = null;
    private rearBogieEntity: Object3D | null = null;

    // Wheel rotation data - wheels with their cached radius, rotation axis, and optional debug mesh
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

    // Global debug visualization
    private debug: boolean = false;
    protected debugPaneName: string = 'RollingStock Debug';
    private paneFolder: FolderApi | null = null;

    // Container for rotating debug parts (Box, Couplers)
    private debugAnchor: Group | null = null;

    private debugMeshes: {
        // Spheres
        center: Mesh | null;
        bogieFront: Mesh | null;
        bogieFrontFront: Mesh | null;
        bogieFrontBack: Mesh | null;
        bogieRear: Mesh | null;
        bogieRearFront: Mesh | null;
        bogieRearBack: Mesh | null;

        // Boxes
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

        // Load model if path is provided
        if (config.modelPath) {
            this.loadModel(config.modelPath, config.internal);
        }

        if (debug) {
            this.createDebugVisuals();
        }
    }

    private createDebugVisuals(): void {
        const sphereGeo = new SphereGeometry(0.5, 16, 16);
        const boxGeo = new BoxGeometry(1, 1, 1); // Unit box, we will scale it

        // --- 1. Wheel/Bogie Spheres (Absolute World Positioning) ---

        // Front bogie
        this.debugMeshes.bogieFrontFront = new Mesh(sphereGeo, new MeshBasicMaterial({ color: 0x00ff00 }));
        this.debugMeshes.bogieFront = new Mesh(sphereGeo, new MeshBasicMaterial({ color: 0x009b00 }));
        this.debugMeshes.bogieFrontBack = new Mesh(sphereGeo, new MeshBasicMaterial({ color: 0x005f00 }));

        // Rear bogie
        this.debugMeshes.bogieRearFront = new Mesh(sphereGeo, new MeshBasicMaterial({ color: 0xff0000 }));
        this.debugMeshes.bogieRear = new Mesh(sphereGeo, new MeshBasicMaterial({ color: 0x9b0000 }));
        this.debugMeshes.bogieRearBack = new Mesh(sphereGeo, new MeshBasicMaterial({ color: 0x5f0000 }));

        // Center
        this.debugMeshes.center = new Mesh(sphereGeo, new MeshBasicMaterial({ color: 0x0000ff }));

        // Add spheres directly to global debug group
        this.globalDebugGroup.add(
            this.debugMeshes.bogieFrontFront, this.debugMeshes.bogieFront, this.debugMeshes.bogieFrontBack,
            this.debugMeshes.bogieRearFront, this.debugMeshes.bogieRear, this.debugMeshes.bogieRearBack,
            this.debugMeshes.center
        );

        // --- 2. Structural Boxes (Relative Positioning) ---

        // Create an anchor group that will copy the train's transform
        this.debugAnchor = new Group();
        this.globalDebugGroup.add(this.debugAnchor);

        // Body Box (Wireframe so we can see inside)
        this.debugMeshes.body = new Mesh(
            boxGeo,
            new MeshBasicMaterial({ color: 0x00ffff, wireframe: true })
        );
        this.debugAnchor.add(this.debugMeshes.body);

        // Couplers
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

        // Apply rotation based on model forward axis
        if (this.config.modelForwardAxis) {
            const modelForward = new Vector3(
                this.config.modelForwardAxis.x,
                this.config.modelForwardAxis.y,
                this.config.modelForwardAxis.z
            ).normalize();

            // Default forward direction is +Z
            const targetForward = new Vector3(0, 0, 1);

            // Calculate rotation to align model's forward axis with +Z
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

                        // standardMat.side = DoubleSide;

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

        // Apply shader fix if internal
        if (isInternal) {
            applyDeobfuscation(this.model!);
        }

        this.updateModelTransform();
        this.group.add(this.model!);
        this.findBogieEntities();
        this.onModelLoaded();
    }

    protected onModelLoaded(): void {
        // Override in subclasses to react to model loading
    }

    private async loadModel(path: string, isInternal: boolean = false): Promise<void> {
        const loader = getGLTFLoader();

        // PATH A: Secure / Internal (Use .parse)
        if (isInternal && !path.startsWith(blobString)) {
            try {
                const mangledFileName = getProtectedAssetPath(path);
                const fetchUrl = `${trainAssetsPath}/${mangledFileName}`;

                console.log(`[RollingStock] Fetching secure buffer: ${fetchUrl}`);

                // 1. Get Decrypted Buffer directly
                const buffer = await loadEncryptedAsset(fetchUrl, path);

                // 2. Parse the Buffer
                // The second argument './' is the path to resolve external resources. 
                // For GLB files (which embed textures), './' is standard.
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

        // PATH B: Standard / External (Use .load)
        else {
            loader.load(
                path,
                (gltf) => {
                    this.setupLoadedModel(gltf, isInternal);
                },
                undefined, // Progress callback
                (error) => {
                    console.warn('Failed to load model:', path, error);
                }
            );
        }
    }

    private setDebugVisibility(visible: boolean): void {
        // Set visibility for all debug meshes in the group
        if (this.debugAnchor) {
            this.debugAnchor.visible = visible;
        }

        // disable globalDebugGroup if needed
        this.globalDebugGroup.visible = visible;
    }

    private getDebugVisibility(): boolean {
        // Return visibility state based on debugAnchor or first available debug mesh
        if (this.debugAnchor) {
            return this.debugAnchor.visible;
        }

        // Check first available debug mesh
        return this.globalDebugGroup.visible;
    }

    public positionOnPath(distance: number, path: Path): void {
        const { frontBogie, rearBogie } = this.config;
        const directionMultiplier = this.config.reverseOnTrack ? -1 : 1;

        const getWheelPoint = (config: BogieConfig, offset: number, out: Vector3) => {
            const totalOffset = (config.zOffset + offset) * directionMultiplier;
            return path.getPointAtDistance(distance + totalOffset, out);
        };

        // Update rail position vectors
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
        // Calculate position (same logic as in orientOnRails)
        const frontPoint = this.railPositions.bogieFront;
        const rearPoint = this.railPositions.bogieRear;
        const bogieMidpoint = new Vector3().addVectors(frontPoint, rearPoint).multiplyScalar(0.5);

        // Calculate the train's actual position (path center + lateral offset)
        const trackDirection = new Vector3().subVectors(frontPoint, rearPoint).normalize();
        const offset = new Vector3().subVectors(bogieMidpoint, this.railPositions.center);
        const longitudinalComponent = offset.dot(trackDirection);
        offset.addScaledVector(trackDirection, -longitudinalComponent);

        const trainPosition = new Vector3().copy(this.railPositions.center).add(offset);

        // 1. Update Spheres positions
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

        // 2. Update Structural Boxes
        if (this.debugAnchor && this.debugMeshes.body) {
            // Move anchor to match train center/rotation
            this.debugAnchor.position.copy(trainPosition);
            this.debugAnchor.quaternion.copy(this.group.quaternion);

            const c = this.config;

            // Update Body Box
            // Scale to config dimensions
            this.debugMeshes.body.scale.set(c.width, c.height, c.length);
            // Position: sit on top of the rail (y = height/2)
            this.debugMeshes.body.position.set(0, c.height / 2, 0);

            // Update Couplers
            // We want them "thin", say 20% of width/height
            const cw = c.width * 0.2;
            const ch = c.height * 0.2;

            // Front Coupler
            if (this.debugMeshes.couplerFront) {
                const len = Math.max(0.1, c.couplerLengthFront); // prevent 0 scale warning
                this.debugMeshes.couplerFront.scale.set(cw, ch, len);
                // Position: at the front face of body + half coupler length
                this.debugMeshes.couplerFront.position.set(0, c.height / 2, (c.length / 2) + (len / 2));
                this.debugMeshes.couplerFront.visible = c.couplerLengthFront > 0;
            }

            // Rear Coupler
            if (this.debugMeshes.couplerRear) {
                const len = Math.max(0.1, c.couplerLengthRear);
                this.debugMeshes.couplerRear.scale.set(cw, ch, len);
                // Position: at the rear face of body - half coupler length
                this.debugMeshes.couplerRear.position.set(0, c.height / 2, -(c.length / 2) - (len / 2));
                this.debugMeshes.couplerRear.visible = c.couplerLengthRear > 0;
            }
        }

        // 3. Update Wheel Debug Meshes
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

        // Find and cache wheels for both bogies
        this.findWheels();
    }

    private findWheels(): void {
        if (!this.model) return;

        // Clean up old wheel debug meshes
        for (const wheel of this.wheels) {
            if (wheel.debugMesh) {
                this.globalDebugGroup.remove(wheel.debugMesh);
                wheel.debugMesh.geometry.dispose();
                (wheel.debugMesh.material as MeshBasicMaterial).dispose();
            }
        }

        this.wheels = [];

        // Process each wheel configuration
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
                    // Check if this wheel was already added
                    if (regex.test(child.name) && !this.wheels.some(w => w.mesh === child)) {
                        const radius = wheelConfig.radius;
                        let debugMesh: Mesh | undefined;

                        // Create debug visualization based on configured radius
                        if (this.debug) {
                            // NOTE: CylinderGeometry is Y-up by default. We must orient it to the wheel's rotation axis.
                            const wheelDebugGeo = new CylinderGeometry(radius, radius, 1.5, 16);

                            // Align the geometry to the rotation axis
                            const alignQuat = dummyQuad.setFromUnitVectors(dummyUp, rotationAxis);
                            wheelDebugGeo.applyQuaternion(alignQuat);

                            debugMesh = new Mesh(wheelDebugGeo, wheelDebugMat);
                            debugMesh.name = `wheel-debug-${child.name}`;
                            this.globalDebugGroup.add(debugMesh);
                        }


                        // Use configured radius directly
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

        // Calculate the midpoint between bogies for lateral positioning
        const bogieMidpoint = dummyVec3.addVectors(frontPoint, rearPoint).multiplyScalar(0.5);

        // 1. Orient the Main Train Group (Car Body)
        // This handles the main pitch and yaw of the train car
        dummy.position.copy(rearPoint);
        dummy.lookAt(frontPoint);
        this.group.quaternion.copy(dummy.quaternion);

        // Position center of car
        // Use the path center for longitudinal position, but apply lateral offset from bogie midpoint
        dummy.position.copy(this.railPositions.center);

        // Calculate lateral offset: project the difference between path center and bogie midpoint
        // onto the plane perpendicular to the track direction
        const trackDirection = dummyVec3B.subVectors(frontPoint, rearPoint).normalize();
        const offset = dummyVec3.subVectors(bogieMidpoint, this.railPositions.center);

        // Remove the component along the track direction (keep only lateral offset)
        const longitudinalComponent = offset.dot(trackDirection);
        offset.addScaledVector(trackDirection, -longitudinalComponent);

        // Apply lateral offset to the path center
        dummy.position.add(offset);

        this.group.parent!.worldToLocal(dummy.position);
        this.group.position.copy(dummy.position);

        // Helper to rotate bogie using LookAt (Stable Up Vector) + Axis Correction
        const updateBogieRotation = (
            entity: Object3D,
            config: BogieConfig,
            posFront: Vector3,
            posBack: Vector3
        ) => {
            // A. Calculate the direction vector in Local Space
            // (The direction the bogie SHOULD face relative to the train car)
            const worldDirection = dummyVec3.subVectors(posFront, posBack).normalize();
            const parentQuat = entity.parent!.getWorldQuaternion(dummyQuad);
            const localDirection = worldDirection.applyQuaternion(parentQuat.invert());

            // B. Calculate the "Ideal" Rotation (assuming +Z is forward)
            // We use lookAt because it enforces the Y-Up constraint automatically,
            // preventing the "sideways roll" issue.
            dummy.position.set(0, 0, 0);
            dummy.lookAt(localDirection);
            const targetRotation = dummy.quaternion.clone();

            // C. Calculate Axis Correction
            // If your model uses X or Y as forward, we calculate the offset 
            // needed to align your bone axis to the standard +Z axis.
            const boneAxis = config.boneForwardAxis;
            const boneForward = dummyVec3.set(boneAxis.x, boneAxis.y, boneAxis.z).normalize();
            const standardForward = dummyForward;

            // We want a rotation that takes BoneForward -> StandardForward (+Z)
            const correctionQuat = dummyQuad.setFromUnitVectors(boneForward, standardForward);

            // D. Apply: Final = Target (LookAt) * Correction
            // 1. Correction turns your mesh so BoneForward points to Z
            // 2. Target turns Z to face the Track
            entity.quaternion.copy(targetRotation.multiply(correctionQuat));
        };

        // Apply to Front Bogie entity (bo01)
        if (this.frontBogieEntity && this.model) {
            updateBogieRotation(
                this.frontBogieEntity,
                this.config.frontBogie,
                this.railPositions.bogieFrontFront,
                this.railPositions.bogieFrontBack
            );
        }

        // Apply to Rear Bogie entity (bo02)
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

    /**
     * Get the rail positions for this rolling stock.
     * These are the world positions of the bogies and center point on the track.
     */
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

        // Main Folder
        const baseKey = getFolderKey(basePath);
        this.paneFolder = pane.addFolder({
            title: this.debugPaneName,
            expanded: getFolderExpanded(baseKey, false)
        });
        registerFolder(this.paneFolder, baseKey);

        // Get the correct config target (cab or specific wagon)
        const targetConfig = this.getConfigTarget(config);

        // Debug Visualization Toggle
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

        // --- 1. Physics & Dimensions ---
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

        // NEW: Width
        physFolder.addBinding(targetConfig, 'width', {
            label: 'Width (m)',
            min: 1.5, // Narrow gauge
            max: 4.5, // Wide cargo
            step: 0.05
        }).on('change', () => updateConfig(config));

        // NEW: Height
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

        // --- 2. Connections (Couplers) ---
        // Added a separate folder for these as requested
        const connKey = getFolderKey([...basePath, 'Connections']);
        const connFolder = this.paneFolder.addFolder({
            title: 'Connections',
            expanded: getFolderExpanded(connKey, false)
        });
        registerFolder(connFolder, connKey);

        // NEW: Coupler Front
        connFolder.addBinding(targetConfig, 'couplerLengthFront', {
            label: 'Coupler Front (m)',
            min: 0.0, // Buffers touching
            max: 2.5, // Long drawbar
            step: 0.05
        }).on('change', () => updateConfig(config));

        // NEW: Coupler Rear
        connFolder.addBinding(targetConfig, 'couplerLengthRear', {
            label: 'Coupler Rear (m)',
            min: 0.0,
            max: 2.5,
            step: 0.05
        }).on('change', () => updateConfig(config));

        // --- 3. Engine Configuration ---
        const engineToggle = this.paneFolder.addBinding(targetConfig, 'engine', {
            label: 'Is Engine'
        });

        const engKey = getFolderKey([...basePath, 'Engine Specs']);
        const engFolder = this.paneFolder.addFolder({
            title: 'Engine Specs',
            expanded: getFolderExpanded(engKey, true)
        });
        registerFolder(engFolder, engKey);
        // Set initial visibility
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

        // --- 4. Visuals & Model Loading ---
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

        // Ensure modelForwardAxis exists
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

        // --- 5. Bogie Configuration ---
        const bogieKey = getFolderKey([...basePath, 'Bogie Setup']);
        const bogieMainFolder = this.paneFolder.addFolder({
            title: 'Bogie Setup',
            expanded: getFolderExpanded(bogieKey, false)
        });
        registerFolder(bogieMainFolder, bogieKey);

        // Helper to keep code dry
        const addBogieControls = (folder: any, bogie: any, isRear: boolean) => {
            folder.addBinding(bogie, 'zOffset', {
                label: 'Z Offset',
                // Dynamically set min/max based on whether it's front or rear
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

        // --- 6. Wheels Configuration ---
        const wheelsKey = getFolderKey([...basePath, 'Wheels']);
        const wheelsFolder = this.paneFolder.addFolder({
            title: 'Wheels',
            expanded: getFolderExpanded(wheelsKey, false)
        });
        registerFolder(wheelsFolder, wheelsKey);

        // Ensure wheels array exists
        if (!targetConfig.wheels) {
            targetConfig.wheels = [];
        }

        // Helper to rebuild wheel UI
        const rebuildWheelUI = () => {
            // Remove all children from wheelsFolder except the Add button
            const children = [...wheelsFolder.children];
            children.forEach((child) => {
                if (child !== addWheelButton) {
                    wheelsFolder.remove(child);
                }
            });

            // Add UI for each wheel config
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

        // Add Wheel button
        const addWheelButton = wheelsFolder.addButton({ title: 'Add Wheel Config' }).on('click', () => {
            targetConfig.wheels.push({
                pattern: '',
                rotationAxis: { x: 1, y: 0, z: 0 },
                radius: 0.5
            });
            updateConfig(config);
            rebuildWheelUI();
        });

        // Initial build
        rebuildWheelUI();

        // --- 7. Lights ---
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

        // Color picker - tweakpane expects {r, g, b} object
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

    /**
     * Exports the current config with animation groups included.
     */
    public exportConfig(): RollingStockConfig {
        const exported = { ...this.config };
        if (this.animator) {
            exported.animationGroups = this.animator.exportGroups();
        }
        return exported;
    }

    /**
     * Plays a named animation group with the given settings.
     * If the group doesn't exist in the animator, this is a no-op.
     */
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

        // Rotate wheels based on distance traveled
        if (distanceDelta !== 0) {
            this.rotateWheels(distanceDelta);
        }
    }

    private rotateWheels(distanceDelta: number): void {
        const directionMultiplier = this.config.reverseOnTrack ? -1 : 1;
        for (const wheel of this.wheels) {
            // Wheel rotation calculation:
            // Circumference = 2 * π * radius
            // Full rotation (2π radians) occurs when distance = circumference
            // So: angle = (distance / circumference) * 2π = (distance / (2πr)) * 2π = distance / radius
            const angle = (distanceDelta / wheel.radius) * directionMultiplier;

            // Rotate around the wheel's rotation axis in local space
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
        // Clean up model
        if (this.model) {
            this.model.traverse((child) => {
                if (child instanceof Mesh) {
                    child.geometry.dispose();
                    if (Array.isArray(child.material)) child.material.forEach(m => m.dispose());
                    else child.material.dispose();
                }
            });
        }
        // Clean up debug meshes
        Object.values(this.debugMeshes).forEach(mesh => {
            if (mesh) {
                mesh.geometry.dispose();
                (mesh.material as any).dispose();
            }
        });
    }
}
