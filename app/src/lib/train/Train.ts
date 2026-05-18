import { Group, Scene, Vector3 } from 'three';
import { Pane, type FolderApi } from 'tweakpane';
import type { CabConfig, TrainConfig, TrainDisplayConfig, WagonConfig } from './TrainConfig';
import { Cab } from './Cab';
import { Wagon } from './Wagon';
import type Path from '../utils/Path';
import * as EssentialsPlugin from '@tweakpane/plugin-essentials';
import { TrainPhysics, type IPhysicsTarget } from './TrainPhysics';
import { getFolderKey } from './TrainUiUtils';
import { TrainAudio } from './TrainAudio';
import { createPowertrain, type Powertrain } from './Powertrain';
import { trainDoorsOpen, trainDieselRPM, trainPowertrainType } from '../../store/train';
import { stopDistances, stopStatuses } from '../../store/journey';
import { type ConsistCar } from '../../store/train';

export class Train implements IPhysicsTarget {
    public group: Group;
    public globalDebugGroup: Group;

    private config!: TrainConfig;
    private cab: Cab;
    private wagons: Wagon[] = [];
    private rearCab: Cab | null = null;

    private path: Path | null = null;
    public distanceTraveled: number = 0; // Public so physics can control it
    private previousDistanceTraveled: number = 0; // For calculating distance delta


    private debug: boolean;
    private pane: Pane | null = null;

    private readonly paneFolderExpandedState = new Map<string, boolean>();
    private paneCleanups: Array<() => void> = [];
    private audio: TrainAudio;
    private physics: TrainPhysics;
    private powertrain: Powertrain | null = null;
    private lightsOn: boolean = false;
    private readonly _cabinWorldPos = new Vector3();

    public readonly ready: Promise<void>;

    constructor(config: TrainConfig, debug: boolean = false) {

        this.debug = debug;
        this.group = new Group();
        this.group.name = 'Train';

        this.globalDebugGroup = new Group();
        this.globalDebugGroup.name = 'Train Global Debug Spheres';

        this.cab = new Cab(structuredClone(config.cab), false, debug);
        this.group.add(this.cab.group);
        this.globalDebugGroup.add(this.cab.globalDebugGroup);

        // Initialize physics system with reference to this train
        this.physics = new TrainPhysics(this, config);

        // Initialize audio system
        this.audio = new TrainAudio();
        this.audio.setTrainGroup(this.group);

        // sets train on track;
        this.updateConfig(config);

        const pieces = [this.cab as Cab | Wagon, ...this.wagons];
        if (this.rearCab) pieces.push(this.rearCab);
        let remaining = pieces.length;
        this.ready = new Promise(resolve => {
            if (remaining === 0) { resolve(); return; }
            for (const p of pieces) {
                if (p.hasModel()) {
                    if (--remaining === 0) resolve();
                    continue;
                }
                p.onModelReady = () => {
                    if (--remaining === 0) resolve();
                };
            }
        });

        // Initialize audio engine with configuration
        this.audio.initialize(config.audio).catch((error) => {
            console.error('Failed to initialize train audio:', error);
        });

        if (this.debug) {
            this.createDebugUI();
        }
    }

    // Resolves once every rolling stock's pending model load has finished
    // (success or failure). Use after updateConfig() to know the new GLBs
    // are parsed and live in the scene.
    public assetsReady(): Promise<void> {
        const promises: Promise<void>[] = [this.cab.modelReady, ...this.wagons.map(w => w.modelReady)];
        if (this.rearCab) promises.push(this.rearCab.modelReady);
        return Promise.all(promises).then(() => undefined);
    }

    public exportConfig(): TrainConfig {
        return {
            display: this.config.display,
            cab: this.cab.exportConfig(),
            wagons: this.wagons.map(wagon => wagon.exportConfig()),
            rearCab: this.rearCab ? this.rearCab.exportConfig() : undefined,
            audio: this.config.audio,
        };
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

        // Update rear cab - remove if not in config, add if in config, update if exists
        if (this.config.rearCab) {
            if (!this.rearCab) {
                // Add rear cab
                this.rearCab = new Cab(structuredClone(this.config.rearCab), true, this.debug);
                this.group.add(this.rearCab.group);
                this.globalDebugGroup.add(this.rearCab.globalDebugGroup);
            } else {
                // Update existing rear cab
                this.rearCab.updateConfig(structuredClone(this.config.rearCab));
            }
        } else if (this.rearCab) {
            // Remove rear cab
            this.group.remove(this.rearCab.group);
            this.globalDebugGroup.remove(this.rearCab.globalDebugGroup);
            this.rearCab.cleanup();
            this.rearCab = null;
        }

        // Update physics with new configuration
        this.physics.updateConfiguration(this.config);

        this.powertrain = createPowertrain(this.config.powertrain);
        trainDieselRPM.value = this.powertrain?.getRPM() ?? 0;
        trainPowertrainType.value = this.config.powertrain?.type ?? null;

        if (this.path && this.path.points.length > 0) {
            this.positionOnPath();
        }

        this.pane?.refresh();
    }

    private currentSegmentIndex = 0;

    public setPath(path: Path): void {
        if (this.path) {
            this.path.cleanup();
        }

        this.path = path;
        this.currentSegmentIndex = 0;
        this.applySegmentBounds();

        if (this.debug) {
            this.path?.drawDebugPath(this.group.parent as Scene);
            this.createDebugUI();
        }
    }

    public getCurrentSegmentIndex(): number {
        return this.currentSegmentIndex;
    }

    // Pops the train to the start of the next sub-path (same physical spot at
    // a terminal buffer, different node ids). Velocity stays zero.
    public advanceToNextSegment(): boolean {
        if (!this.path) return false;
        const next = this.currentSegmentIndex + 1;
        if (next >= this.path.getSegmentCount()) return false;

        this.currentSegmentIndex = next;
        this.applySegmentBounds();

        const bounds = this.path.getSegmentBounds(next);
        const halfTrain = this.getTotalLength() / 2;
        this.distanceTraveled = bounds.startGlobal + halfTrain;
        this.positionOnPath();
        return true;
    }

    private maybeAdvanceSegment(): void {
        if (!this.path) return;
        const nextIdx = this.currentSegmentIndex + 1;
        if (nextIdx >= this.path.getSegmentCount()) return;

        const bounds = this.path.getSegmentBounds(this.currentSegmentIndex);
        const halfTrain = this.getTotalLength() / 2;
        const atMaxBound = this.distanceTraveled >= bounds.endGlobal - halfTrain - 0.5;
        if (!atMaxBound) return;

        if (Math.abs(this.physics.getVelocity()) > 0.05) return;
        if (trainDoorsOpen.value) return;

        // Only auto-advance after the player has actually arrived at the
        // turnaround station (otherwise they'd skip an unserved stop).
        const boundaryKm = bounds.endGlobal / 1000;
        const distances = stopDistances.value;
        const statuses = stopStatuses.value;
        let bufferStopArrived = false;
        for (let i = 0; i < distances.length; i++) {
            if (Math.abs(distances[i] - boundaryKm) < 0.1) {
                bufferStopArrived = !!statuses[i]?.arrived;
                break;
            }
        }
        if (!bufferStopArrived) return;

        this.advanceToNextSegment();
    }

    private applySegmentBounds(): void {
        if (!this.path) return;
        const bounds = this.path.getSegmentBounds(this.currentSegmentIndex);
        const halfTrain = this.getTotalLength() / 2;
        // First/last sub-paths keep the original overshoot; mid-route boundaries are hard stops.
        const isFirst = this.currentSegmentIndex === 0;
        const isLast = this.currentSegmentIndex === this.path.getSegmentCount() - 1;
        const min = isFirst ? bounds.startGlobal - halfTrain : bounds.startGlobal + halfTrain;
        const max = isLast ? bounds.endGlobal + halfTrain : bounds.endGlobal - halfTrain;
        this.physics.setBounds(min, max);
    }

    public getPath(): Path | null {
        return this.path;
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

        // distanceTraveled represents the train CENTER position
        // Calculate offset to position cab center relative to train center
        const totalLength = this.getTotalLength();
        const cabLength = this.config.cab.length;
        const cabCenterOffset = totalLength / 2 - cabLength / 2;

        // Position cab (cab center is ahead of train center)
        let currentDistance = this.distanceTraveled + cabCenterOffset;
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

        // Position rear cab behind all wagons
        if (this.rearCab && this.config.rearCab) {
            currentDistance -= this.config.rearCab.couplerLengthFront;
            currentDistance -= this.config.rearCab.length / 2;
            this.rearCab.positionOnPath(currentDistance, this.path!);
        }
    }

    private createDebugUI(): void {
        if (this.pane) {
            this.pane.dispose();
        }
        for (const cleanup of this.paneCleanups) cleanup();
        this.paneCleanups = [];

        const rootDomContainer = document.getElementById('tweakpane-container');

        this.pane = new Pane({ title: 'Train Configuration', container: rootDomContainer || undefined });
        this.pane.registerPlugin(EssentialsPlugin);
        this.audio.registerPlugins(this.pane);

        const rootPath = ['Train Configuration'];

        // Display info (what shows up in the picker). The id is intentionally
        // omitted — it's the train's stable identity and shouldn't be edited.
        const displayKey = getFolderKey([...rootPath, 'Display']);
        const displayFolder = this.pane.addFolder({
            title: 'Display',
            expanded: this.getFolderExpanded(displayKey, false),
        });
        this.registerFolder(displayFolder, displayKey);

        const displayParams = {
            name: this.config.display.name,
            operator: this.config.display.operator,
            topSpeedKmh: this.config.display.topSpeedKmh,
            era: this.config.display.era ?? '',
            creator: this.config.display.creator ?? '',
        };

        displayFolder.addBinding(displayParams, 'name', { label: 'Name' })
            .on('change', ev => { this.config.display.name = ev.value.trim() || 'Untitled'; });
        displayFolder.addBinding(displayParams, 'operator', { label: 'Operator' })
            .on('change', ev => { this.config.display.operator = ev.value.trim() || 'Unknown'; });
        displayFolder.addBinding(displayParams, 'topSpeedKmh', {
            label: 'Top speed (km/h)', min: 0, max: 400, step: 1,
        }).on('change', ev => { this.config.display.topSpeedKmh = ev.value; });
        displayFolder.addBinding(displayParams, 'era', { label: 'Era' })
            .on('change', ev => { this.config.display.era = ev.value.trim() || undefined; });
        displayFolder.addBinding(displayParams, 'creator', { label: 'Creator' })
            .on('change', ev => { this.config.display.creator = ev.value.trim() || undefined; });

        // Description: per-language rows with add/remove. Normalize to a
        // Record<lang, text> for editing; rebuild the folder on add/remove.
        const descriptionByLang: Record<string, string> = (() => {
            const d = this.config.display.description;
            if (typeof d === 'string') return { en: d };
            if (d) return { ...d };
            return {};
        })();

        const writeDescription = () => {
            const cleaned: Record<string, string> = {};
            for (const [lang, text] of Object.entries(descriptionByLang)) {
                cleaned[lang] = text.trim();
            }
            const keys = Object.keys(cleaned);
            if (keys.length === 0) {
                this.config.display.description = undefined;
                return;
            }
            // LocalizedString invariant: must have `en`. If the user removed
            // or cleared EN, backfill from the first language that does have
            // content; if everything is empty, leave EN empty.
            if (!cleaned.en) {
                const firstWithText = keys.find(k => cleaned[k] !== '');
                cleaned.en = firstWithText ? cleaned[firstWithText] : '';
            }
            this.config.display.description = cleaned as TrainDisplayConfig['description'];
        };

        const descriptionFolder = displayFolder.addFolder({
            title: 'Description',
            expanded: this.getFolderExpanded(getFolderKey([...rootPath, 'Display', 'Description']), true),
        });
        this.registerFolder(descriptionFolder, getFolderKey([...rootPath, 'Display', 'Description']));

        for (const lang of Object.keys(descriptionByLang)) {
            descriptionFolder.addBinding(descriptionByLang, lang, { label: lang.toUpperCase() })
                .on('change', writeDescription);
            descriptionFolder.addButton({ title: `Remove ${lang.toUpperCase()}` }).on('click', () => {
                delete descriptionByLang[lang];
                writeDescription();
                this.createDebugUI();
            });
        }
        descriptionFolder.addButton({ title: '+ Add language' }).on('click', () => {
            const code = prompt('Language code (e.g. "de", "fr"):');
            if (!code) return;
            const norm = code.trim().toLowerCase();
            if (!norm) return;
            if (norm in descriptionByLang) {
                alert(`Language "${norm}" already exists.`);
                return;
            }
            descriptionByLang[norm] = '';
            writeDescription();
            this.createDebugUI();
        });

        this.createPowertrainDebugUI(rootPath);

        const physicalKey = getFolderKey([...rootPath, 'Visual & Physics']);

        // changing physical and visual parameters
        const physical = this.pane.addFolder({
            title: 'Visual & Physics',
            expanded: this.getFolderExpanded(physicalKey, false)
        });
        this.registerFolder(physical, physicalKey);

        // Cab
        this.cab.createDebugUI(physical, this.config, (updatedConfig: TrainConfig) => {
            this.updateConfig(updatedConfig);
        }, () => this.createDebugUI(), null, this.registerFolder.bind(this), [...rootPath, 'Visual & Physics'], this.getFolderExpanded.bind(this));

        // Wagons folder
        const wagonsKey = getFolderKey([...rootPath, 'Visual & Physics', 'Wagons']);
        const wagonsFolder = physical.addFolder({
            title: 'Wagons',
            expanded: this.getFolderExpanded(wagonsKey, true)
        });
        this.registerFolder(wagonsFolder, wagonsKey);

        // Individual wagons
        this.wagons.forEach((wagon, index) => {
            wagon.createDebugUI(
                wagonsFolder,
                this.config,
                (updatedConfig: TrainConfig) => {
                    this.updateConfig(updatedConfig);
                },
                () => this.deleteWagon(index),
                () => this.duplicateWagon(index),
                this.registerFolder.bind(this),
                [...rootPath, 'Visual & Physics', 'Wagons'],
                this.getFolderExpanded.bind(this)
            );
        });

        // Add Wagon button
        wagonsFolder.addButton({ title: 'Add Wagon' }).on('click', () => {
            this.addWagon();
        });

        // Rear Cab
        if (this.rearCab && this.config.rearCab) {
            this.rearCab.createDebugUI(physical, this.config, (updatedConfig: TrainConfig) => {
                this.updateConfig(updatedConfig);
            }, () => this.createDebugUI(), null, this.registerFolder.bind(this), [...rootPath, 'Visual & Physics'], this.getFolderExpanded.bind(this));
        }

        // Add/Remove Rear Cab button
        const rearCabButtonTitle = this.config.rearCab ? 'Remove Rear Cab' : 'Add Rear Cab';
        physical.addButton({ title: rearCabButtonTitle }).on('click', () => {
            this.toggleRearCab();
        });

        this.audio.createDebugUI(
            this.pane,
            rootPath,
            this.registerFolder.bind(this),
            this.getFolderExpanded.bind(this),
            this.config.audio,
            (updatedAudioConfig) => {
                // Update audio in config and refresh UI without circular updates
                this.config.audio = updatedAudioConfig;
                this.pane?.refresh();
                // Re-initialize audio with new configuration
                this.audio.initialize(updatedAudioConfig).catch((error) => {
                    console.error('Failed to re-initialize train audio:', error);
                });
            }
        );

        // Add button to copy and paste configuration as JSON
        const miscButtons = this.pane.addBlade({
            view: 'buttongrid',
            size: [2, 1],
            cells: (x: number, y: number) => ({
                title: [
                    ['Copy JSON', 'Paste JSON'],
                ][y][x],
            }),
        }) as any;

        miscButtons.on('click', (ev: any) => {
            const [x] = ev.index;
            if (x === 0) {
                const configJson = JSON.stringify(this.exportConfig(), null, 2);
                navigator.clipboard.writeText(configJson).then(() => {
                    console.log('Configuration copied to clipboard:', configJson);
                    alert('Configuration copied to clipboard!');
                }).catch(err => {
                    console.error('Failed to copy configuration:', err);
                });
            } else if (x === 1) {
                this.importConfig();
            }
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

    private createPowertrainDebugUI(rootPath: string[]): void {
        if (!this.pane) return;

        const ptKey = getFolderKey([...rootPath, 'Powertrain']);
        const ptFolder = this.pane.addFolder({
            title: 'Powertrain',
            expanded: this.getFolderExpanded(ptKey, false),
        });
        this.registerFolder(ptFolder, ptKey);

        const params = {
            dieselElectric: this.config.powertrain?.type === 'diesel-electric',
        };

        ptFolder.addBinding(params, 'dieselElectric', { label: 'Diesel-electric' })
            .on('change', (ev) => {
                if (ev.value) {
                    this.config.powertrain = {
                        type: 'diesel-electric',
                        idleRPM: 600,
                        maxRPM: 2100,
                        revUpTau: 1.8,
                        revDownTau: 3.0,
                        brakeRevDownTau: 0.8,
                        loadInfluence: 0.8,
                    };
                } else {
                    this.config.powertrain = undefined;
                }
                this.updateConfig(this.config);
                this.createDebugUI();
            });

        if (this.config.powertrain?.type !== 'diesel-electric') return;

        const cfg = this.config.powertrain;

        const rpmReadout = { rpm: trainDieselRPM.value };
        ptFolder.addBinding(rpmReadout, 'rpm', {
            label: 'Live RPM',
            readonly: true,
            interval: 100,
        });
        const rpmUnsub = trainDieselRPM.subscribe((v) => { rpmReadout.rpm = v; });
        this.paneCleanups.push(rpmUnsub);

        ptFolder.addBinding(cfg, 'idleRPM', { label: 'Idle RPM', min: 200, max: 1200, step: 10 })
            .on('change', () => this.updateConfig(this.config));
        ptFolder.addBinding(cfg, 'maxRPM', { label: 'Max RPM', min: 1000, max: 4000, step: 10 })
            .on('change', () => this.updateConfig(this.config));
        ptFolder.addBinding(cfg, 'revUpTau', { label: 'Rev-up τ (s)', min: 0.1, max: 8, step: 0.1 })
            .on('change', () => this.updateConfig(this.config));
        ptFolder.addBinding(cfg, 'revDownTau', { label: 'Rev-down τ (s)', min: 0.1, max: 12, step: 0.1 })
            .on('change', () => this.updateConfig(this.config));
        ptFolder.addBinding(cfg, 'brakeRevDownTau', { label: 'Brake rev-down τ (s)', min: 0.05, max: 6, step: 0.05 })
            .on('change', () => this.updateConfig(this.config));
        ptFolder.addBinding(cfg, 'loadInfluence', { label: 'Load influence', min: 0, max: 1, step: 0.05 })
            .on('change', () => this.updateConfig(this.config));
    }

    private addWagon(): void {
        // Create a default wagon config
        const defaultWagon: WagonConfig = {
            length: 15.0,
            weight: 30.0,
            height: 4.0,
            width: 3.0,
            modelPath: '/models/train/wagon.glb',
            scale: 1.0,
            modelOffset: { x: 0, y: 0, z: 0 },
            modelForwardAxis: { x: 0, y: 0, z: 1 },
            reverseOnTrack: false,
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
            animationGroups: [],
            wheels: [],
            interiorMaterial: {
                pattern: '',
                emissiveColor: 0xffffff,
                emissiveIntensity: 1.0,
            },
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

    private toggleRearCab(): void {
        if (this.config.rearCab) {
            // Remove rear cab
            if (this.rearCab) {
                this.group.remove(this.rearCab.group);
                this.globalDebugGroup.remove(this.rearCab.globalDebugGroup);
                this.rearCab.cleanup();
                this.rearCab = null;
            }
            this.config.rearCab = undefined;
        } else {
            // Add rear cab - create a default rear cab config based on the front cab
            this.config.rearCab = structuredClone(this.config.cab);
        }
        this.updateConfig(this.config);
        this.createDebugUI();
    }

    private importConfig(): void {
        // Create overlay
        const overlay = document.createElement('div');
        overlay.style.position = 'fixed';
        overlay.style.top = '0';
        overlay.style.left = '0';
        overlay.style.width = '100%';
        overlay.style.height = '100%';
        overlay.style.backgroundColor = 'rgba(0, 0, 0, 0.7)';
        overlay.style.display = 'flex';
        overlay.style.alignItems = 'center';
        overlay.style.justifyContent = 'center';
        overlay.style.zIndex = '10000';

        // Create dialog
        const dialog = document.createElement('div');
        dialog.style.backgroundColor = '#2a2a2a';
        dialog.style.padding = '20px';
        dialog.style.borderRadius = '8px';
        dialog.style.maxWidth = '600px';
        dialog.style.width = '90%';
        dialog.style.maxHeight = '80vh';
        dialog.style.display = 'flex';
        dialog.style.flexDirection = 'column';
        dialog.style.gap = '10px';

        // Title
        const title = document.createElement('h3');
        title.textContent = 'Import Train Configuration';
        title.style.margin = '0';
        title.style.color = '#ffffff';

        // Text area
        const textarea = document.createElement('textarea');
        textarea.placeholder = 'Paste your train configuration JSON here...';
        textarea.style.width = '100%';
        textarea.style.minHeight = '300px';
        textarea.style.fontFamily = 'monospace';
        textarea.style.fontSize = '12px';
        textarea.style.padding = '10px';
        textarea.style.backgroundColor = '#1a1a1a';
        textarea.style.color = '#ffffff';
        textarea.style.border = '1px solid #444';
        textarea.style.borderRadius = '4px';
        textarea.style.resize = 'vertical';

        // Button container
        const buttonContainer = document.createElement('div');
        buttonContainer.style.display = 'flex';
        buttonContainer.style.gap = '10px';
        buttonContainer.style.justifyContent = 'flex-end';

        // Import button
        const importButton = document.createElement('button');
        importButton.textContent = 'Import';
        importButton.style.padding = '8px 16px';
        importButton.style.backgroundColor = '#4CAF50';
        importButton.style.color = 'white';
        importButton.style.border = 'none';
        importButton.style.borderRadius = '4px';
        importButton.style.cursor = 'pointer';

        // Cancel button
        const cancelButton = document.createElement('button');
        cancelButton.textContent = 'Cancel';
        cancelButton.style.padding = '8px 16px';
        cancelButton.style.backgroundColor = '#666';
        cancelButton.style.color = 'white';
        cancelButton.style.border = 'none';
        cancelButton.style.borderRadius = '4px';
        cancelButton.style.cursor = 'pointer';

        // Event handlers
        const closeDialog = () => {
            document.body.removeChild(overlay);
        };

        importButton.onclick = () => {
            try {
                const jsonString = textarea.value.trim();
                if (!jsonString) {
                    alert('Please paste a train configuration JSON');
                    return;
                }

                const trainConfig: TrainConfig = JSON.parse(jsonString);

                // Validate the basic structure
                if (!trainConfig.cab) {
                    throw new Error('Invalid train configuration: missing cab');
                }

                // Update the train with the new configuration
                this.updateConfig(trainConfig);
                this.createDebugUI();

                console.log('Train configuration imported successfully');
                closeDialog();
            } catch (error) {
                console.error('Error importing train configuration:', error);
                alert(`Failed to import train configuration: ${error instanceof Error ? error.message : 'Unknown error'}`);
            }
        };

        cancelButton.onclick = closeDialog;

        // Close on overlay click
        overlay.onclick = (e) => {
            if (e.target === overlay) {
                closeDialog();
            }
        };

        // Assemble dialog
        buttonContainer.appendChild(cancelButton);
        buttonContainer.appendChild(importButton);
        dialog.appendChild(title);
        dialog.appendChild(textarea);
        dialog.appendChild(buttonContainer);
        overlay.appendChild(dialog);

        // Add to document
        document.body.appendChild(overlay);

        // Focus the textarea
        textarea.focus();
    }

    /**
     * Open or close doors on all rolling stock.
     * @param open true = play doors animation forward, false = play in reverse
     */
    public setDoorsOpen(open: boolean): void {
        const reverse = !open;
        this.cab?.playAnimationGroup('doors', reverse);
        this.wagons.forEach(wagon => wagon.playAnimationGroup('doors', reverse));
        this.rearCab?.playAnimationGroup('doors', reverse);
    }

    public setTrainLightsOn(on: boolean): void {
        this.lightsOn = on;

        // Emissive interior lights on all rolling stock
        this.cab.setEmissiveEnabled(on);
        this.wagons.forEach(w => w.setEmissiveEnabled(on));
        this.rearCab?.setEmissiveEnabled(on);

        if (!on) {
            this.cab.setHeadlights(false);
            this.cab.setTaillights(false);
            this.rearCab?.setHeadlights(false);
            this.rearCab?.setTaillights(false);
            return;
        }

        // Apply current direction
        this.setTrainLightDirection();
    }

    public setTrainLightDirection(): void {
        if (!this.lightsOn) return;

        const forward = this.getEffectiveDirection() === 1;

        if (this.rearCab) {
            this.cab.setHeadlights(forward);
            this.cab.setTaillights(!forward);
            this.rearCab.setHeadlights(!forward);
            this.rearCab.setTaillights(forward);
        } else {
            // No rear cab: front lights stay on
            this.cab.setHeadlights(true);
            this.cab.setTaillights(false);
        }
    }

    /**
     * Set train power control
     * @param power -1 to 1 where 1 is full forward, 0 is brake, -1 is full reverse
     */
    public setPower(power: number): void {
        this.physics.setPower(power);
    }

    /**
     * Get current power setting
     */
    public getPower(): number {
        return this.physics.getPower();
    }

    /**
     * Get current velocity in m/s
     */
    public getVelocity(): number {
        return this.physics.getVelocity();
    }

    /**
     * Get current velocity in km/h
     */
    public getVelocityKmh(): number {
        return this.physics.getVelocityKmh();
    }

    /**
     * Get normalized tractive effort (0-1 range)
     */
    public getNormalizedTractiveEffort(): number {
        return this.physics.getNormalizedTraction();
    }

    public isBraking(): boolean {
        return this.physics.isBraking();
    }

    public setDirection(dir: 1 | -1): void {
        this.physics.setDirection(dir);
    }

    public getDirection(): -1 | 1 {
        return this.physics.getDirection();
    }

    public getEffectiveDirection(): -1 | 1 {
        return this.physics.getDirection();
    }

    /**
     * Get the rail positions of the front cab for orientation calculation.
     */
    public getCabRailPositions() {
        return this.cab.getRailPositions();
    }

    /**
     * Get the world-space cabin position for the front or rear cab.
     * Falls back to the cab group world position if no cabinPosition is configured.
     */
    public getCabinWorldPosition(rear: boolean = false): Vector3 {
        const cab = rear ? this.rearCab : this.cab;
        if (!cab) return this.group.getWorldPosition(this._cabinWorldPos);
        const localPos = (cab.config as CabConfig).cabinPosition;
        if (!localPos) return cab.group.getWorldPosition(this._cabinWorldPos);
        return cab.group.localToWorld(this._cabinWorldPos.set(localPos.x, localPos.y, localPos.z));
    }

    /**
     * Get the world-space cabin position for the active cab based on travel direction.
     * Forward (velocity >= 0) = front cab, backward with rear cab = rear cab.
     */
    public getActiveCabinWorldPosition(): Vector3 {
        const forward = this.getEffectiveDirection() === 1;
        if (!forward && this.rearCab) {
            return this.getCabinWorldPosition(true);
        }
        return this.getCabinWorldPosition(false);
    }

    /**
     * Get the total length of the train (cab + wagons + rear cab + couplers) in meters
     */
    public getTotalLength(): number {
        let length = this.config.cab.length;
        length += this.config.cab.couplerLengthRear;

        for (const wagonConfig of this.config.wagons) {
            length += wagonConfig.couplerLengthFront;
            length += wagonConfig.length;
            length += wagonConfig.couplerLengthRear;
        }

        if (this.config.rearCab) {
            length += this.config.rearCab.couplerLengthFront;
            length += this.config.rearCab.length;
        }

        return length;
    }

    /**
     * Get the consist layout for 2D map rendering.
     */
    public getConsistLayout(): ConsistCar[] {
        const cars: ConsistCar[] = [{ type: 'cab', length: this.config.cab.length }];
        for (const w of this.config.wagons) {
            cars.push({ type: 'wagon', length: w.length });
        }
        if (this.config.rearCab) {
            cars.push({ type: 'rearCab', length: this.config.rearCab.length });
        }
        return cars;
    }

    public update(delta: number): void {
        // Update physics simulation (this will directly update distanceTraveled)
        this.physics.update(delta);

        if (this.powertrain) {
            const braking = this.physics.isBraking();
            const throttle01 = braking ? 0 : Math.abs(this.physics.getPower());
            const tractive01 = braking ? 0 : this.physics.getNormalizedTraction();
            this.powertrain.update(delta, throttle01, tractive01, braking);
            trainDieselRPM.value = this.powertrain.getRPM();
        }

        // Calculate distance delta for wheel rotation
        const distanceDelta = this.distanceTraveled - this.previousDistanceTraveled;
        this.previousDistanceTraveled = this.distanceTraveled;

        this.maybeAdvanceSegment();

        // Update position on path based on physics-driven distanceTraveled
        if (this.path && this.path.points.length > 0) {
            this.positionOnPath();
        }

        // Update rolling stock animations and wheel rotation
        this.cab?.update(delta, distanceDelta);
        this.wagons.forEach(wagon => wagon.update(delta, distanceDelta));
        this.rearCab?.update(delta, distanceDelta);

        // Update light direction based on velocity
        this.setTrainLightDirection();

        // Update audio engine (evaluates curves and updates audio properties)
        this.audio.update();
    }

    public playSound(role: string): void {
        this.audio.playSound(role);
    }

    public cleanup(): void {
        this.cab.cleanup();
        this.wagons.forEach(wagon => wagon.cleanup());
        this.path?.cleanup();
        this.audio.cleanup();

        if (this.pane) {
            this.pane.dispose();
            this.pane = null;
        }
    }

    private registerFolder(folder: FolderApi, key: string): void {
        const stored = this.paneFolderExpandedState.get(key);
        if (stored !== undefined) {
            folder.expanded = stored;
        }

        this.paneFolderExpandedState.set(key, folder.expanded);
        folder.on('fold', (ev) => {
            this.paneFolderExpandedState.set(key, ev.expanded);
        });
    }

    private getFolderExpanded(key: string, fallback: boolean): boolean {
        return this.paneFolderExpandedState.get(key) ?? fallback;
    }
}
