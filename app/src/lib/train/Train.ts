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
    private distanceTraveled: number = 0;

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
            this.positionOnPath();
        }

        this.pane?.refresh();
    }

    public setPath(path: Path): void {
        if (this.path) {
            this.path.cleanup();
        }

        this.path = path;

        if (this.debug) {
            this.path?.drawDebugPath(this.group.parent as Scene);
            this.createDebugUI();
        }
    }

    public getRollingStockTransform(index: number = 0): Group {
        if (index === 0) {
            return this.cab.group;
        }

        throw new Error(`Train: getRollingStockTransform - No rolling stock at index ${index}`);
    }

    public positionOnPath(): void {
        const pathPoints = this.path?.points || [];
        if (pathPoints.length < 2) {
            console.warn('Train: Not enough path points to position train');
            return;
        }

        const trainPosition = this.path!.getPointAtDistance(this.distanceTraveled, this.group.position);

        this.cab.positionOnPath(this.distanceTraveled, this.path!);
    }

    private createDebugUI(): void {
        if (this.pane) {
            this.pane.dispose();
        }

        const rootDomContainer = document.getElementById('tweakpane-container');

        this.pane = new Pane({ title: 'Train Configuration', container: rootDomContainer || undefined });

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
            const params = { pathProgress: 0 };
            this.pane.addBinding(params, 'pathProgress', {
                label: 'Path Progress',
                min: 0,
                max: 1,
                step: 0.0001,
            }).on('change', (ev) => {
                this.distanceTraveled = this.path?.getTotalLength()! * ev.value;
                this.positionOnPath();
            });
        }
    }

    public cleanup(): void {
        this.cab.cleanup();
        this.path?.cleanup();

        if (this.pane) {
            this.pane.dispose();
            this.pane = null;
        }
    }
}
