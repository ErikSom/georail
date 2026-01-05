import { Group, Mesh, Object3D, SphereGeometry, BoxGeometry, MeshBasicMaterial, Vector3, MeshStandardMaterial, DoubleSide } from 'three';
import type { BogieConfig, RollingStockConfig, TrainConfig } from './TrainConfig';
import { getGLTFLoader } from '../utils/ModelLoader';
import type Path from '../utils/Path';
import type { FolderApi, Pane } from 'tweakpane';
import { dummy, dummyForward, dummyQuad, dummyVec3 } from '../utils/Helper';
import FilePicker from '../utils/FilePicker';
import { applyDeobfuscation } from '../utils/Security';
import { glassMaterial } from './Materials';
import { RollingStockAnimator } from './RollingStockAnimator';

export class RollingStock {
    public group: Group;
    public globalDebugGroup: Group;

    protected config: RollingStockConfig;
    private model: Group | null = null;

    private animator: RollingStockAnimator | null = null;

    private frontBogieEntity: Object3D | null = null;
    private rearBogieEntity: Object3D | null = null;

    private railPositions = {
        center: new Vector3(),
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
            this.loadModel(config.modelPath);
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

    private loadModel(path: string): void {
        const loader = getGLTFLoader();
        loader.load(
            path,
            (gltf: any) => {
                if (this.model) this.group.remove(this.model);
                if (this.animator) this.animator.cleanup();

                this.model = gltf.scene!;

                this.setModelMaterials(this.model!);


                // 2. Get the Animations (The movement data) and create animator
                const animations = gltf.animations || [];

                this.animator = new RollingStockAnimator(this.model!, animations);

                // Import animation groups from config
                if (this.config.animationGroups.length > 0) {
                    this.animator.importGroups(this.config.animationGroups);
                }

                if (this.paneFolder) this.animator.createDebugUI(this.paneFolder);

                if (this.config.internal) {
                    // Apply the GPU repair shader
                    applyDeobfuscation(this.model!);
                }

                this.updateModelTransform();
                this.group.add(this.model!);
                this.findBogieEntities();
            },
            undefined,
            (error: any) => console.warn('Failed to load cab model:', path, error)
        );
    }

    private setModelMaterials(scene: Group): void {
        scene.traverse((child) => {
            if (child instanceof Mesh) {
                const materials = Array.isArray(child.material) ? child.material : [child.material];

                console.log(`[RollingStock] Processing Mesh: "${child.name}" with ${materials.length} material(s).`);

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
                });
            }
        });
    };
    private setDebugVisibility(visible: boolean): void {
        // Set visibility for all debug meshes in the group
        if (this.debugAnchor) {
            this.debugAnchor.visible = visible;
        }

        // Set visibility for global debug spheres
        Object.values(this.debugMeshes).forEach((mesh) => {
            if (mesh && mesh.parent === this.globalDebugGroup) {
                mesh.visible = visible;
            }
        });
    }

    private getDebugVisibility(): boolean {
        // Return visibility state based on debugAnchor or first available debug mesh
        if (this.debugAnchor) {
            return this.debugAnchor.visible;
        }

        // Check first available debug mesh
        for (const mesh of Object.values(this.debugMeshes)) {
            if (mesh) {
                return mesh.visible;
            }
        }

        return true; // Default to visible
    }

    public positionOnPath(distance: number, path: Path): void {
        const { frontBogie, rearBogie } = this.config;

        const getWheelPoint = (config: BogieConfig, offset: number, out: Vector3) => {
            const totalOffset = config.zOffset + offset;
            return path.getPointAtDistance(totalOffset, out);
        };

        // Update rail position vectors
        getWheelPoint(frontBogie, distance, this.railPositions.bogieFront);
        getWheelPoint(frontBogie, distance + frontBogie.wheelOffsetFront, this.railPositions.bogieFrontFront);
        getWheelPoint(frontBogie, distance + frontBogie.wheelOffsetRear, this.railPositions.bogieFrontBack);

        getWheelPoint(rearBogie, distance, this.railPositions.bogieRear);
        getWheelPoint(rearBogie, distance + rearBogie.wheelOffsetFront, this.railPositions.bogieRearFront);
        getWheelPoint(rearBogie, distance + rearBogie.wheelOffsetRear, this.railPositions.bogieRearBack);

        path.getPointAtDistance(distance, this.railPositions.center);

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
    }

    public updateConfig(config: RollingStockConfig): void {
        const modelChanged = config.modelPath !== this.config.modelPath;
        const bogieNamesChanged =
            config.frontBogie.entityName !== this.config.frontBogie.entityName ||
            config.rearBogie.entityName !== this.config.rearBogie.entityName;

        this.config = config;
        this.updateModelTransform();

        if (bogieNamesChanged && this.model) this.findBogieEntities();
        if (modelChanged && config.modelPath) this.loadModel(config.modelPath);
    }

    public orientOnRails(): void {
        const frontPoint = this.railPositions.bogieFront;
        const rearPoint = this.railPositions.bogieRear;

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
        const trackDirection = new Vector3().subVectors(frontPoint, rearPoint).normalize();
        const offset = new Vector3().subVectors(bogieMidpoint, this.railPositions.center);

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
            const localFront = entity.parent!.worldToLocal(posFront.clone());
            const localBack = entity.parent!.worldToLocal(posBack.clone());
            const localDirection = dummyVec3.subVectors(localFront, localBack).normalize();

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

        // Apply to Front Bogie
        if (this.frontBogieEntity && this.model) {
            updateBogieRotation(
                this.frontBogieEntity,
                this.config.frontBogie,
                this.railPositions.bogieFrontFront,
                this.railPositions.bogieFrontBack
            );
        }

        // Apply to Rear Bogie
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

    public createDebugUI(pane: Pane | FolderApi, config: TrainConfig, updateConfig: (config: TrainConfig) => void): FolderApi {
        // Main Folder
        this.paneFolder = pane.addFolder({
            title: this.debugPaneName,
            expanded: true
        });

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
        const physFolder = this.paneFolder.addFolder({ title: 'Dimensions & Physics', expanded: false });

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
        const connFolder = this.paneFolder.addFolder({ title: 'Connections', expanded: false });

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

        const engFolder = this.paneFolder.addFolder({
            title: 'Engine Specs',
            expanded: true
        });
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
        const visFolder = this.paneFolder.addFolder({ title: 'Visuals', expanded: false });

        visFolder.addBinding(targetConfig, 'modelPath', {
            label: 'Model Path'
        }).on('change', () => updateConfig(config));

        visFolder.addBinding(targetConfig, 'internal', {
            label: 'Is Obfuscated',
        }).on('change', () => {
            if (targetConfig.modelPath) this.loadModel(targetConfig.modelPath);
            updateConfig(config);
        });

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

        // --- 5. Bogie Configuration ---
        const bogieMainFolder = this.paneFolder.addFolder({ title: 'Bogie Setup', expanded: false });

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

        const frontBogieFolder = bogieMainFolder.addFolder({ title: 'Front Bogie', expanded: true });
        addBogieControls(frontBogieFolder, targetConfig.frontBogie, false);

        const rearBogieFolder = bogieMainFolder.addFolder({ title: 'Rear Bogie', expanded: true });
        addBogieControls(rearBogieFolder, targetConfig.rearBogie, true);

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

    public update(delta: number): void {
        if (this.animator) {
            this.animator.update(delta);
        }
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