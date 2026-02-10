import {
    AnimationMixer,
    AnimationClip,
    AnimationAction,
    Group,
    LoopRepeat,
    LoopOnce,
    LoopPingPong
} from 'three';
import type { FolderApi } from 'tweakpane';
import type { AnimationGroupConfig } from './TrainConfig';

export interface AnimationGroupAPI {
    /**
     * Starts or updates the animation with specific settings.
     * calling this while running will update settings (direction, loop) without resetting progress.
     */
    play: (reverse?: boolean, loop?: boolean, alternate?: boolean) => void;
    /**
     * Stops the animation and resets it to the beginning.
     */
    stop: () => void;
    /**
     * Pauses the animation at the current frame.
     */
    pause: () => void;
}

export class RollingStockAnimator {
    private root: Group;
    private masterClip: AnimationClip | null = null;
    private mixer: AnimationMixer;

    // UI State
    private uiFolder: FolderApi | null = null;
    private groupsListFolder: FolderApi | null = null;

    private animGroups: Map<string, {
        action: AnimationAction;
        pattern: string;
        config: {
            speed: number;
            reverse: boolean;
            autoPlay: boolean;
            loop: boolean;
            alternate: boolean;
        };
    }> = new Map();

    constructor(root: Group, animations: AnimationClip[]) {
        this.root = root;
        this.mixer = new AnimationMixer(root);

        if (animations.length > 0) {
            this.masterClip = animations[0];
        }
    }

    /**
     * Creates a new animation group and returns an API to control it.
     */
    public createGroup(name: string, pattern: string): AnimationGroupAPI | null {
        if (!this.masterClip) return null;

        // Return existing API if group exists (idempotent)
        if (this.animGroups.has(name)) {
            return this.getGroupAPI(name);
        }

        const regex = new RegExp(pattern, 'i');
        const filteredTracks = this.masterClip.tracks.filter(track => {
            const nodeName = track.name.split('.')[0];
            return regex.test(nodeName);
        });

        if (filteredTracks.length === 0) {
            console.warn(`[Animator] No tracks found matching pattern: "${pattern}"`);
            return null;
        }

        const subClip = new AnimationClip(name, this.masterClip.duration, filteredTracks);
        const action = this.mixer.clipAction(subClip);

        // Default Settings
        action.clampWhenFinished = false;
        action.loop = LoopOnce;
        // Store internal state
        this.animGroups.set(name, {
            action: action,
            pattern: pattern,
            config: {
                speed: 1.0,
                reverse: false,
                autoPlay: false,
                loop: false,
                alternate: false
            }
        });

        return this.getGroupAPI(name);
    }

    public getGroupAPI(name: string): AnimationGroupAPI {
        return {
            play: (reverse = false, loop = false, alternate = false) => {
                const group = this.animGroups.get(name);
                if (!group) return;

                // Update internal config to match (so UI stays in sync if opened later)
                group.config.reverse = reverse;
                group.config.loop = loop;
                group.config.alternate = alternate;

                // Apply settings live
                this.updateAction(name);

                // Ensure it is running (unpause if paused, play if stopped)
                if (group.action.paused) group.action.paused = false;
                if (!group.action.isRunning()) group.action.play();
            },
            stop: () => {
                const group = this.animGroups.get(name);
                if (!group) return;

                group.action.stop(); // This resets time to 0
                group.action.reset();
            },
            pause: () => {
                const group = this.animGroups.get(name);
                if (!group) return;

                group.action.paused = true;
            }
        };
    }

    public removeGroup(name: string): void {
        const group = this.animGroups.get(name);
        if (group) {
            group.action.stop();
            this.mixer.uncacheClip(group.action.getClip());
            this.animGroups.delete(name);
        }
    }

    /**
     * Exports all animation groups as configuration objects.
     */
    public exportGroups(): AnimationGroupConfig[] {
        const configs: AnimationGroupConfig[] = [];
        this.animGroups.forEach((group, name) => {
            configs.push({
                name: name,
                pattern: group.pattern,
                speed: group.config.speed,
                reverse: group.config.reverse,
                autoPlay: group.config.autoPlay,
                loop: group.config.loop,
                alternate: group.config.alternate
            });
        });
        return configs;
    }

    /**
     * Imports animation groups from configuration objects.
     */
    public importGroups(configs: AnimationGroupConfig[]): void {
        // Clear existing groups
        this.animGroups.forEach((group, name) => {
            this.removeGroup(name);
        });

        // Create new groups from configs
        configs.forEach(config => {
            const api = this.createGroup(config.name, config.pattern);
            if (api) {
                const group = this.animGroups.get(config.name);
                if (group) {
                    // Apply config settings
                    group.config.speed = config.speed;
                    group.config.reverse = config.reverse;
                    group.config.autoPlay = config.autoPlay;
                    group.config.loop = config.loop;
                    group.config.alternate = config.alternate;

                    // Update the action with these settings
                    this.updateAction(config.name);

                    // Auto-play if configured
                    if (config.autoPlay) {
                        api.play(config.reverse, config.loop, config.alternate);
                    }
                }
            }
        });
    }

    public update(delta: number): void {
        this.mixer.update(delta);
    }

    public createDebugUI(parentFolder: FolderApi): void {
        this.uiFolder = parentFolder.addFolder({ title: 'Animation Manager', expanded: true });

        const creationParams = { name: 'New Group', pattern: 'fan|blade' };

        this.uiFolder.addBinding(creationParams, 'name', { label: 'Name' });
        this.uiFolder.addBinding(creationParams, 'pattern', { label: 'Regex Pattern' });

        this.uiFolder.addButton({ title: '+ Add Group' }).on('click', () => {
            if (creationParams.name && creationParams.pattern) {
                this.createGroup(creationParams.name, creationParams.pattern);
                this.refreshGroupsUI();
            }
        });

        this.uiFolder.addBlade({ view: 'separator' });

        this.groupsListFolder = this.uiFolder.addFolder({ title: 'Active Groups', expanded: true });
        this.refreshGroupsUI();
    }

    private refreshGroupsUI(): void {
        if (!this.uiFolder || !this.groupsListFolder) return;

        this.groupsListFolder.dispose();
        this.groupsListFolder = this.uiFolder.addFolder({ title: 'Active Groups', expanded: true });

        this.animGroups.forEach((group, name) => {
            const sub = this.groupsListFolder!.addFolder({ title: name, expanded: false });

            // Auto Play setting
            sub.addBinding(group.config, 'autoPlay', { label: 'Auto Play' });

            // Loop Settings
            sub.addBinding(group.config, 'loop', { label: 'Loop' }).on('change', () => this.updateAction(name));
            sub.addBinding(group.config, 'alternate', { label: 'Alternate' }).on('change', () => this.updateAction(name));

            // Direction & Speed
            sub.addBinding(group.config, 'speed', { min: 0.1, max: 5.0 }).on('change', () => this.updateAction(name));
            sub.addBinding(group.config, 'reverse').on('change', () => this.updateAction(name));

            // Play Button (Stop, Reset, and Play using API)
            sub.addButton({ title: 'Play' }).on('click', () => {
                const api = this.getGroupAPI(name);
                // Play with current config settings
                api.play(group.config.reverse, group.config.loop, group.config.alternate);
            });

            // Stop Button
            sub.addButton({ title: 'Stop' }).on('click', () => {
                const api = this.getGroupAPI(name);
                api.stop();
            });

            sub.addButton({ title: 'Delete Group' }).on('click', () => {
                this.removeGroup(name);
                this.refreshGroupsUI();
            });
        });
    }

    private updateAction(name: string): void {
        const group = this.animGroups.get(name);
        if (!group) return;

        const { speed, reverse, loop, alternate } = group.config;

        // 1. Update Direction/Speed (Safe to call anytime)
        group.action.timeScale = reverse ? -speed : speed;

        // 2. Update Loop Logic (Safe to call anytime)
        if (loop) {
            if (alternate) {
                group.action.setLoop(LoopPingPong, Infinity);
            } else {
                group.action.setLoop(LoopRepeat, Infinity);
            }
            group.action.clampWhenFinished = false;
        } else {
            group.action.setLoop(LoopOnce, 1);
            group.action.clampWhenFinished = true;
        }

        // 3. Smart Resume
        // If we were stuck at the end (LoopOnce finished) and we change settings,
        // we likely want to move again (e.g. we reversed direction).
        if (group.action.paused && group.action.isRunning()) {
            group.action.paused = false;
        }
    }

    public cleanup(): void {
        this.mixer.stopAllAction();
        this.animGroups.clear();
        if (this.uiFolder) this.uiFolder.dispose();
    }
}