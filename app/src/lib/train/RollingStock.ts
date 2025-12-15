import { Group, Mesh, Object3D, SphereGeometry, BoxGeometry, MeshBasicMaterial, Vector3 } from 'three';
import type { BogieConfig, CabConfig, RollingStockConfig, TrainConfig } from './TrainConfig';
import { getGLTFLoader } from '../utils/ModelLoader';
import type Path from '../utils/Path';
import type { Pane } from 'tweakpane';
import { dummy } from '../utils/Helper';
import FilePicker from '../utils/FilePicker';

export class RollingStock {
    public group: Group;
    public globalDebugGroup: Group;

    protected config: RollingStockConfig;
    private model: Group | null = null;

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
    }

    private loadModel(path: string): void {
        const loader = getGLTFLoader();
        loader.load(
            path,
            (gltf: any) => {
                if (this.model) this.group.remove(this.model);
                this.model = gltf.scene!;
                this.updateModelTransform();
                this.group.add(this.model!);
                this.findBogieEntities();
            },
            undefined,
            (error: any) => console.warn('Failed to load cab model:', path, error)
        );
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

        this.railPositions.center.lerpVectors(
            this.railPositions.bogieFront,
            this.railPositions.bogieRear,
            0.5
        );

        this.orientOnRails();

        if (this.debug) this.updateDebugVisuals();
    }

    private updateDebugVisuals(): void {
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
            this.debugAnchor.position.copy(this.railPositions.center);
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
    }

    public updateConfig(config: CabConfig): void {
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

        dummy.position.copy(rearPoint);
        dummy.lookAt(frontPoint);
        this.group.quaternion.copy(dummy.quaternion);

        dummy.position.copy(this.railPositions.center);
        this.group.parent!.worldToLocal(dummy.position);
        this.group.position.copy(dummy.position);
    }

    public createDebugUI(pane: Pane, config: TrainConfig, updateConfig: (config: TrainConfig) => void): void {
        // Main Folder
        const cabFolder = pane.addFolder({
            title: this.debugPaneName,
            expanded: true
        });

        const maxBogieZOffset = 20;
        const maxWheelToBogieOffset = 4.0; // Reduced: wheels are rarely >4m from bogie center

        // --- 1. Physics & Dimensions ---
        const physFolder = cabFolder.addFolder({ title: 'Dimensions & Physics', expanded: false });

        physFolder.addBinding(config.cab, 'length', {
            label: 'Length (m)',
            min: 5.0,
            max: 30.0,
            step: 0.1
        }).on('change', () => updateConfig(config));

        // NEW: Width
        physFolder.addBinding(config.cab, 'width', {
            label: 'Width (m)',
            min: 1.5, // Narrow gauge
            max: 4.5, // Wide cargo
            step: 0.05
        }).on('change', () => updateConfig(config));

        // NEW: Height
        physFolder.addBinding(config.cab, 'height', {
            label: 'Height (m)',
            min: 2.0,
            max: 6.5, // Double-decker height
            step: 0.05
        }).on('change', () => updateConfig(config));

        physFolder.addBinding(config.cab, 'weight', {
            label: 'Weight (Tons)',
            min: 10.0,
            max: 200.0, // Heavy locomotives can reach ~150-180t
            step: 0.5
        }).on('change', () => updateConfig(config));

        // --- 2. Connections (Couplers) ---
        // Added a separate folder for these as requested
        const connFolder = cabFolder.addFolder({ title: 'Connections', expanded: false });

        // NEW: Coupler Front
        connFolder.addBinding(config.cab, 'couplerLengthFront', {
            label: 'Coupler Front (m)',
            min: 0.0, // Buffers touching
            max: 2.5, // Long drawbar
            step: 0.05
        }).on('change', () => updateConfig(config));

        // NEW: Coupler Rear
        connFolder.addBinding(config.cab, 'couplerLengthRear', {
            label: 'Coupler Rear (m)',
            min: 0.0,
            max: 2.5,
            step: 0.05
        }).on('change', () => updateConfig(config));

        // --- 3. Engine Configuration ---
        const engineToggle = cabFolder.addBinding(config.cab, 'engine', {
            label: 'Is Engine'
        });

        const engFolder = cabFolder.addFolder({
            title: 'Engine Specs',
            expanded: true
        });
        // Set initial visibility
        engFolder.hidden = !config.cab.engine;

        engineToggle.on('change', (ev) => {
            engFolder.hidden = !ev.value;
            updateConfig(config);
        });

        engFolder.addBinding(config.cab, 'enginePower', {
            label: 'Power (kW)',
            min: 0,
            max: 12000, // Modern heavy electric locos can hit 8-10MW
            step: 50
        }).on('change', () => updateConfig(config));

        engFolder.addBinding(config.cab, 'brakingPower', {
            label: 'Brakes (kN)',
            min: 0,
            max: 2000,
            step: 10
        }).on('change', () => updateConfig(config));

        // --- 4. Visuals & Model Loading ---
        const visFolder = cabFolder.addFolder({ title: 'Visuals', expanded: false });

        visFolder.addBinding(config.cab, 'modelPath', {
            label: 'Model Path'
        }).on('change', () => updateConfig(config));

        visFolder.addButton({ title: 'Load GLB File...' }).on('click', () => {
            FilePicker((url: string) => {
                config.cab.modelPath = url;
                updateConfig(config);
            }, '.glb,.gltf');
        });

        visFolder.addBinding(config.cab, 'scale', {
            label: 'Scale',
            min: 0.1,
            max: 5.0,
            step: 0.01 // Finer step for precision scaling
        }).on('change', () => updateConfig(config));

        visFolder.addBinding(config.cab, 'modelOffset', {
            label: 'Model Offset',
            x: { min: -10, max: 10 }, // 50 was likely too large for a visual offset
            y: { min: -10, max: 10 },
            z: { min: -10, max: 10 }
        }).on('change', () => updateConfig(config));

        // --- 5. Bogie Configuration ---
        const bogieMainFolder = cabFolder.addFolder({ title: 'Bogie Setup', expanded: false });

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
        };

        const frontBogieFolder = bogieMainFolder.addFolder({ title: 'Front Bogie', expanded: true });
        addBogieControls(frontBogieFolder, config.cab.frontBogie, false);

        const rearBogieFolder = bogieMainFolder.addFolder({ title: 'Rear Bogie', expanded: true });
        addBogieControls(rearBogieFolder, config.cab.rearBogie, true);
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