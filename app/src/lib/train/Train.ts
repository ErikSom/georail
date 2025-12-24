import { Group, Scene } from 'three';
import { Pane } from 'tweakpane';
import type { TrainConfig, WagonConfig } from './TrainConfig';
import { Cab } from './Cab';
import { Wagon } from './Wagon';
import type Path from '../utils/Path';

export class Train {
    public group: Group;
    public globalDebugGroup: Group;

    private config!: TrainConfig;
    private cab: Cab;
    private wagons: Wagon[] = [];
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

        // Update wagons - remove excess, add missing, update existing
        while (this.wagons.length > this.config.wagons.length) {
            const wagon = this.wagons.pop();
            if (wagon) {
                this.group.remove(wagon.group);
                this.globalDebugGroup.remove(wagon.globalDebugGroup);
                wagon.cleanup();
            }
        }

        // Add new wagons if needed
        while (this.wagons.length < this.config.wagons.length) {
            const index = this.wagons.length;
            const wagonConfig = structuredClone(this.config.wagons[index]);
            const wagon = new Wagon(wagonConfig, index, this.debug);
            this.wagons.push(wagon);
            this.group.add(wagon.group);
            this.globalDebugGroup.add(wagon.globalDebugGroup);
        }

        // Update existing wagons
        this.wagons.forEach((wagon, index) => {
            wagon.updateConfig(structuredClone(this.config.wagons[index]));
        });

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

        if (index > 0 && index <= this.wagons.length) {
            return this.wagons[index - 1].group;
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

        // Position cab
        let currentDistance = this.distanceTraveled;
        this.cab.positionOnPath(currentDistance, this.path!);

        // Position wagons behind cab
        currentDistance -= this.config.cab.length / 2;
        currentDistance -= this.config.cab.couplerLengthRear;

        for (let i = 0; i < this.wagons.length; i++) {
            const wagonConfig = this.config.wagons[i];
            currentDistance -= wagonConfig.couplerLengthFront;
            currentDistance -= wagonConfig.length / 2;

            this.wagons[i].positionOnPath(currentDistance, this.path!);

            currentDistance -= wagonConfig.length / 2;
            currentDistance -= wagonConfig.couplerLengthRear;
        }
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

        // Wagons
        this.wagons.forEach((wagon, index) => {
            wagon.createDebugUI(
                this.pane!,
                this.config,
                (updatedConfig: TrainConfig) => {
                    this.updateConfig(updatedConfig);
                },
                () => this.deleteWagon(index),
                () => this.duplicateWagon(index)
            );
        });

        // Add Wagon button
        this.pane.addButton({ title: 'Add Wagon' }).on('click', () => {
            this.addWagon();
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

    private addWagon(): void {
        // Create a default wagon config
        const defaultWagon: WagonConfig = {
            length: 15.0,
            weight: 30.0,
            height: 4.0,
            width: 3.0,
            modelPath: '/models/train/wagon.glb',
            internal: false,
            scale: 1.0,
            modelOffset: { x: 0, y: 0, z: 0 },
            modelForwardAxis: { x: 0, y: 0, z: 1 },
            frontBogie: {
                zOffset: 5.0,
                wheelOffsetFront: 1.0,
                wheelOffsetRear: -1.0,
                entityName: '',
                boneForwardAxis: { x: 0, y: 0, z: 1 },
            },
            rearBogie: {
                zOffset: -5.0,
                wheelOffsetFront: 1.0,
                wheelOffsetRear: -1.0,
                entityName: '',
                boneForwardAxis: { x: 0, y: 0, z: 1 },
            },
            couplerLengthFront: 0.5,
            couplerLengthRear: 0.5,
            engine: false,
            enginePower: 0.0,
            brakingPower: 0.0,
        };

        this.config.wagons.push(defaultWagon);
        this.updateConfig(this.config);
        this.createDebugUI();
    }

    private duplicateWagon(index: number): void {
        if (index >= 0 && index < this.config.wagons.length) {
            // Clone the wagon config at the specified index
            const duplicatedWagon = structuredClone(this.config.wagons[index]);
            // Insert the duplicated wagon right after the original
            this.config.wagons.splice(index + 1, 0, duplicatedWagon);
            this.updateConfig(this.config);
            this.createDebugUI();
        }
    }

    private deleteWagon(index: number): void {
        if (index >= 0 && index < this.config.wagons.length) {
            this.config.wagons.splice(index, 1);
            this.updateConfig(this.config);
            this.createDebugUI();
        }
    }

    public update(delta: number): void {
        this.cab?.update(delta);
        this.wagons.forEach(wagon => wagon.update(delta));
        this.rearCab?.update(delta);
    }

    public cleanup(): void {
        this.cab.cleanup();
        this.wagons.forEach(wagon => wagon.cleanup());
        this.path?.cleanup();

        if (this.pane) {
            this.pane.dispose();
            this.pane = null;
        }
    }
}
