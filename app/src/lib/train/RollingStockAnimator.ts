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
        config: { 
            speed: number; 
            reverse: boolean; 
            play: boolean;
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
            config: { 
                speed: 1.0, 
                reverse: false, 
                play: true,
                loop: true,
                alternate: false
            }
        });

        return this.getGroupAPI(name);
    }

    private getGroupAPI(name: string): AnimationGroupAPI {
        return {
            play: (reverse = false, loop = false, alternate = false) => {
                const group = this.animGroups.get(name);
                if (!group) return;

                // Update internal config to match (so UI stays in sync if opened later)
                group.config.reverse = reverse;
                group.config.loop = loop;
                group.config.alternate = alternate;
                group.config.play = true;

                // Apply settings live
                this.updateAction(name);

                // Ensure it is running (unpause if paused, play if stopped)
                if (group.action.paused) group.action.paused = false;
                if (!group.action.isRunning()) group.action.play();
            },
            stop: () => {
                const group = this.animGroups.get(name);
                if (!group) return;
                
                group.config.play = false;
                group.action.stop(); // This resets time to 0
                group.action.reset();
            },
            pause: () => {
                const group = this.animGroups.get(name);
                if (!group) return;

                group.config.play = false;
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
            
            // Active (Play/Pause)
            sub.addBinding(group.config, 'play', { label: 'Active' }).on('change', (ev) => {
                group.action.paused = !ev.value;
                if (ev.value && !group.action.isRunning()) group.action.play();
            });

            // Loop Settings
            sub.addBinding(group.config, 'loop', { label: 'Loop' }).on('change', () => this.updateAction(name));
            sub.addBinding(group.config, 'alternate', { label: 'Alternate' }).on('change', () => this.updateAction(name));

            // Direction & Speed
            sub.addBinding(group.config, 'speed', { min: 0.1, max: 5.0 }).on('change', () => this.updateAction(name));
            sub.addBinding(group.config, 'reverse').on('change', () => this.updateAction(name));

            // Stop Button (Hard Reset)
            sub.addButton({ title: 'Stop & Reset' }).on('click', () => {
                group.config.play = false;
                group.action.stop();
                sub.refresh(); // Refresh the 'Active' checkbox visually if possible, or user toggles it back
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

        const { speed, reverse, loop, alternate, play } = group.config;
        
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
        if (play && group.action.paused) {
            group.action.paused = false;
        }
    }

    public cleanup(): void {
        this.mixer.stopAllAction();
        this.animGroups.clear();
        if (this.uiFolder) this.uiFolder.dispose();
    }
}