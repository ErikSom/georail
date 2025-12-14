import { Group, Scene } from 'three';
import { Pane } from 'tweakpane';
import type { TrainConfig } from './TrainConfig';
import { Cab } from './Cab';
import type Path from '../utils/Path';

export class Train {
    public group: Group;
    public globalDebugGroup: Group;

    private config!: TrainConfig;
    private cab: Cab;
    private rearCab: Cab | null = null;

    private path: Path | null = null;
    private currentPathIndex: number = 0;

    private debug: boolean;
    private pane: Pane | null = null;

    constructor(config: TrainConfig, debug: boolean = false) {

        this.debug = debug;
        this.group = new Group();
        this.group.name = 'Train';

        this.globalDebugGroup = new Group();
        this.globalDebugGroup.name = 'Train Global Debug Spheres';

        this.cab = new Cab(structuredClone(config.cab), false, debug);
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

        // Cab
        this.cab.createDebugUI(this.pane, this.config, (updatedConfig: TrainConfig) => {
            this.updateConfig(updatedConfig);
        });

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
