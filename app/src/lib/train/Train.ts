import { Group, Vector3, Mesh, SphereGeometry, MeshBasicMaterial, Scene } from 'three';
import { Pane } from 'tweakpane';
import type { TrainConfig } from './TrainConfig';
import { Cab } from './Cab';
import type Path from '../utils/Path';

export class Train {
    public group: Group;
    public globalDebugGroup: Group;

    private config!: TrainConfig;
    private cab: Cab;
    private debug: boolean;
    private pane: Pane | null = null;

    private path: Path | null = null;
    public pathDebugSpheres: Mesh[] = [];
    private currentPathIndex: number = 0;

    constructor(config: TrainConfig, debug: boolean = false) {

        this.debug = debug;
        this.group = new Group();
        this.group.name = 'Train';

        this.globalDebugGroup = new Group();
        this.globalDebugGroup.name = 'Train Global Debug Spheres';

        this.cab = new Cab(structuredClone(config.cab), debug);
        this.group.add(this.cab.group);
        this.globalDebugGroup.add(this.cab.globalDebugGroup);

        // sets train on track;
        this.updateConfig(config);

        if (this.debug) {
            this.createDebugUI();
        }
    }

    public updateConfig(config: TrainConfig): void {
        this.config = config;

        // clone config to avoid reference issues
        this.cab.updateConfig(structuredClone(this.config.cab));

        if (this.path && this.path.points.length > 0) {
            this.positionOnPath(this.currentPathIndex);
        }
    }

    public setPath(path: Path): void {
        this.path = path;
        this.currentPathIndex = 0;

        if (this.debug) {
            this.path?.drawDebugPath(this.group.parent as Scene);
        }
    }

    public positionOnPath(pathIndex: number): void {
        const pathPoints = this.path?.points || [];
        if (pathPoints.length < 2) {
            console.warn('Train: Not enough path points to position train');
            return;
        }

        // Clamp path index
        pathIndex = Math.max(0, Math.min(pathIndex, pathPoints.length - 1));
        this.currentPathIndex = pathIndex;

        this.cab.positionOnPath(pathIndex, this.path!);
    }

    public getCurrentPathIndex(): number {
        return this.currentPathIndex;
    }

    private openGLBFilePicker(): void {
        // Create a hidden file input element
        const input = document.createElement('input');
        input.type = 'file';
        input.accept = '.glb,.gltf';
        input.style.display = 'none';

        input.onchange = (e) => {
            const file = (e.target as HTMLInputElement).files?.[0];
            if (!file) return;

            // Create a blob URL for the selected file
            const url = URL.createObjectURL(file);

            console.log('Loading GLB file:', file.name, 'from URL:', url);

            this.config.cab.modelPath = url;

            this.updateConfig(this.config);

            if (this.pane) {
                this.pane.refresh();
            }
        };

        // Trigger the file picker
        document.body.appendChild(input);
        input.click();
        document.body.removeChild(input);
    }

    private createDebugUI(): void {
        this.pane = new Pane({ title: 'Train Configuration' });

        // Cab folder
        const cabFolder = this.pane.addFolder({ title: 'Cab', expanded: true });

        cabFolder.addBinding(this.config.cab, 'modelPath', {
            label: 'Model Path'
        }).on('change', () => this.updateConfig(this.config));

        // Add file picker button for GLB model
        cabFolder.addButton({ title: 'Load GLB File...' }).on('click', () => {
            this.openGLBFilePicker();
        });

        cabFolder.addBinding(this.config.cab, 'scale', {
            label: 'Scale',
            min: 0.1,
            max: 5.0,
            step: 0.1
        }).on('change', () => {
            this.updateConfig(this.config);
        });

        // 3d point model offset bindings
        cabFolder.addBinding(this.config.cab, 'modelOffset', {
            label: 'Model Offset'
        }).on('change', () => {
            this.updateConfig(this.config);
        });

        // Front Bogie folder
        const frontBogieFolder = cabFolder.addFolder({ title: 'Front Bogie', expanded: true });

        frontBogieFolder.addBinding(this.config.cab.frontBogie, 'zOffset', {
            label: 'Z Offset',
            min: -20.0,
            max: 20.0,
            step: 0.1
        }).on('change', () => {
            this.updateConfig(this.config)
        });

        frontBogieFolder.addBinding(this.config.cab.frontBogie, 'frontWheelOffset', {
            label: 'Front Wheel Offset',
            min: -5.0,
            max: 5.0,
            step: 0.1
        }).on('change', () => {
            this.updateConfig(this.config);
        });

        frontBogieFolder.addBinding(this.config.cab.frontBogie, 'backWheelOffset', {
            label: 'Back Wheel Offset',
            min: -5.0,
            max: 5.0,
            step: 0.1
        }).on('change', () => {
            this.updateConfig(this.config);
        });

        frontBogieFolder.addBinding(this.config.cab.frontBogie, 'entityName', {
            label: 'Entity Name (GLB)'
        }).on('change', () => this.updateConfig(this.config));

        // Rear Bogie folder
        const rearBogieFolder = cabFolder.addFolder({ title: 'Rear Bogie', expanded: true });

        rearBogieFolder.addBinding(this.config.cab.rearBogie, 'zOffset', {
            label: 'Z Offset',
            min: -20.0,
            max: 20.0,
            step: 0.1
        }).on('change', () => {
            this.updateConfig(this.config);
        });

        rearBogieFolder.addBinding(this.config.cab.rearBogie, 'frontWheelOffset', {
            label: 'Front Wheel Offset',
            min: -5.0,
            max: 5.0,
            step: 0.1
        }).on('change', () => {
            this.updateConfig(this.config);
        });

        rearBogieFolder.addBinding(this.config.cab.rearBogie, 'backWheelOffset', {
            label: 'Back Wheel Offset',
            min: -5.0,
            max: 5.0,
            step: 0.1
        }).on('change', () => {
            this.updateConfig(this.config);
        });

        rearBogieFolder.addBinding(this.config.cab.rearBogie, 'entityName', {
            label: 'Entity Name (GLB)'
        }).on('change', () => this.updateConfig(this.config));

        // Add button to copy configuration as JSON
        this.pane.addButton({ title: 'Copy Config JSON' }).on('click', () => {
            const configJson = JSON.stringify(this.config, null, 2);
            navigator.clipboard.writeText(configJson).then(() => {
                console.log('Configuration copied to clipboard:', configJson);
                alert('Configuration copied to clipboard!');
            }).catch(err => {
                console.error('Failed to copy configuration:', err);
            });
        });

        // Add path index slider if we have a path
        const pathPoints = this.path?.points || [];
        if (pathPoints.length > 1) {
            const params = { pathIndex: this.currentPathIndex };
            this.pane.addBinding(params, 'pathIndex', {
                label: 'Path Position',
                min: 0,
                max: Math.max(0, pathPoints.length - 1),
                step: 1
            }).on('change', (ev) => {
                this.positionOnPath(ev.value);
            });
        }
    }

    public cleanup(): void {
        this.cab.cleanup();

        if (this.pane) {
            this.pane.dispose();
            this.pane = null;
        }
    }
}
