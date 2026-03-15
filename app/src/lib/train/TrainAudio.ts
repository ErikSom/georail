import type { FolderApi, ListInputBindingApi, Pane } from 'tweakpane';
import { CurveBladePlugin, type CurveBladeApi } from '../tweakpane/CurvePlugin';
import {
    AudioUploadBladePlugin,
    type AudioUploadBladeApi,
    type AudioUploadFile,
} from '../tweakpane/AudioUploadPlugin';
import { getFolderKey } from './TrainUiUtils';
import type { AudioConfig, AudioSound, AudioCurve } from './TrainConfig';
import { AudioLoader, PositionalAudio, Group } from 'three';
import { trainPower, trainVelocityKmh, trainTractiveEffort } from '../../store/train';
import { audioListener } from '../../store/globals';
import { loadEncryptedAsset, getProtectedAssetPath, blobString } from '../utils/Security.secure';
import { trainAssetsPath } from './configs/TrainConfigurations.secure';

function getCurveTitle(curveBlade: CurveBladeApi): string {
    const axis = curveBlade.axis;
    const yLabel = axis.y.label || 'Target';
    const xLabel = axis.x.label || 'Input';
    return `${yLabel} vs ${xLabel}`;
}

type RegisterFolder = (folder: FolderApi, key: string) => void;
type GetFolderExpanded = (key: string, fallback: boolean) => boolean;

interface AudioInstance {
    audio: PositionalAudio;
    sound: AudioSound;
    compositionTitle: string;
}

interface TrainState {
    throttlePower: number;
    velocityKmh: number;
    brakePower: number;
    tractiveEffort: number;
}

export class TrainAudio {
    private audioInstances: AudioInstance[] = [];
    private audioLoader: AudioLoader;
    private trainGroup: Group | null = null;
    private isEnabled: boolean = false;
    private currentInitializationId: number = 0;
    private opusSupported: boolean = true;
    private _trainState: TrainState = { throttlePower: 0, velocityKmh: 0, brakePower: 0, tractiveEffort: 0 };
    private _volumeValues: number[] = [];
    private _pitchValues: number[] = [];
    private oneShotBuffers: Map<string, AudioBuffer> = new Map();

    constructor() {
        this.audioLoader = new AudioLoader();
    }

    public registerPlugins(pane: Pane): void {
        pane.registerPlugin({ id: 'curve', plugin: CurveBladePlugin });
        pane.registerPlugin({ id: 'audiofiles', plugin: AudioUploadBladePlugin });
    }

    public createDebugUI(
        pane: Pane,
        rootPath: string[],
        registerFolder: RegisterFolder,
        getFolderExpanded: GetFolderExpanded,
        audioConfig: AudioConfig,
        onAudioChange: (config: AudioConfig) => void
    ): void {
        // Local state for UI management
        let audioFiles = audioConfig.files;
        let audioCompositions = audioConfig.compositions;
        let audioSounds: Record<string, string> = { ...audioConfig.sounds };
        let audioFileNames: string[] = audioFiles.map(f => f.name);
        const audioKey = getFolderKey([...rootPath, 'Audio']);
        const audioFolder = pane.addFolder({
            title: 'Audio',
            expanded: getFolderExpanded(audioKey, false)
        });
        registerFolder(audioFolder, audioKey);

        const audioFilesKey = getFolderKey([...rootPath, 'Audio', 'Files']);
        const audioFilesFolder = audioFolder.addFolder({
            title: 'Files',
            expanded: getFolderExpanded(audioFilesKey, false)
        });
        registerFolder(audioFilesFolder, audioFilesKey);

        const audioFilesBlade = audioFilesFolder.addBlade({
            view: 'audiofiles',
            maxHeight: 200,
            value: audioFiles.map(f => f.url)
        }) as AudioUploadBladeApi;

        const updateAudioFileNames = (files: AudioUploadFile[]) => {
            audioFileNames = files.map((file) => file.name);
        };

        const soundBindings: Array<{
            binding: ListInputBindingApi<string>;
            sound: AudioSound;
        }> = [];
        const compositionFolders: FolderApi[] = [];

        const buildSoundOptions = (current: string) => {
            const options = audioFileNames.map((name) => ({
                text: name,
                value: name,
            }));
            if (!options.length) {
                options.push({ text: 'No files', value: '' });
            } else if (current && !audioFileNames.includes(current)) {
                options.unshift({ text: `${current} (missing)`, value: current });
            }
            return options;
        };

        const refreshSoundOptions = () => {
            soundBindings.forEach(({ binding, sound }) => {
                binding.options = buildSoundOptions(sound.file);
            });
        };

        const defaultCurve = (): AudioCurve => ({
            points: [
                { x: 0, y: 0 },
                { x: 1, y: 0 },
            ],
            axis: {
                x: { min: 0, max: 1, label: 'Throttle Power' },
                y: { min: 0, max: 1, label: 'Volume' }
            }
        });

        audioFilesBlade.on('change', (ev) => {
            audioFiles = audioFilesBlade.files.map(f => ({ name: f.name, url: f.url }));
            updateAudioFileNames(audioFilesBlade.files);
            refreshSoundOptions();
            onAudioChange({ files: audioFiles, compositions: audioCompositions, sounds: audioSounds });
        });
        updateAudioFileNames(audioFilesBlade.files);

        const compositionsKey = getFolderKey([...rootPath, 'Audio', 'Compositions']);
        const compositionsFolder = audioFolder.addFolder({
            title: 'Compositions',
            expanded: getFolderExpanded(compositionsKey, false)
        });
        registerFolder(compositionsFolder, compositionsKey);

        compositionsFolder.addButton({ title: 'Add Composition' }).on('click', () => {
            const title = window.prompt('Composition title?', '')?.trim() ?? '';
            if (!title) {
                return;
            }
            audioCompositions.push({ title, sounds: [] });
            onAudioChange({ files: audioFiles, compositions: audioCompositions, sounds: audioSounds });
            pane.refresh();
            renderCompositions();
        });

        const renderCompositions = () => {
            compositionFolders.forEach((folder) => folder.dispose());
            compositionFolders.length = 0;
            soundBindings.length = 0;

            audioCompositions.forEach((composition, compositionIndex) => {
                const compositionTitle = composition.title || `Composition ${compositionIndex + 1}`;
                const compKey = getFolderKey([
                    ...rootPath,
                    'Audio',
                    'Compositions',
                    compositionTitle,
                ]);
                const compFolder = compositionsFolder.addFolder({
                    title: compositionTitle,
                    expanded: getFolderExpanded(compKey, false)
                });
                registerFolder(compFolder, compKey);
                compositionFolders.push(compFolder);


                compFolder.addButton({ title: 'Add Sound' }).on('click', () => {
                    const defaultFile = audioFileNames[0] ?? '';
                    composition.sounds.push({ file: defaultFile, curves: [] });
                    onAudioChange({ files: audioFiles, compositions: audioCompositions, sounds: audioSounds });
                    renderCompositions();
                });

                composition.sounds.forEach((sound, soundIndex) => {
                    const soundTitle = sound.file || `Sound ${soundIndex + 1}`;
                    const soundKey = getFolderKey([
                        ...rootPath,
                        'Audio',
                        'Compositions',
                        compositionTitle,
                        soundTitle,
                    ]);
                    const soundFolder = compFolder.addFolder({
                        title: soundTitle,
                        expanded: getFolderExpanded(soundKey, false)
                    });
                    registerFolder(soundFolder, soundKey);

                    const soundParams = { file: sound.file };
                    const soundBinding = soundFolder.addBinding(soundParams, 'file', {
                        label: 'File',
                        options: buildSoundOptions(sound.file),
                    }) as ListInputBindingApi<string>;

                    soundBinding.on('change', (ev) => {
                        sound.file = ev.value;
                        soundFolder.title = ev.value || `Sound ${soundIndex + 1}`;
                        onAudioChange({ files: audioFiles, compositions: audioCompositions, sounds: audioSounds });
                    });

                    soundBindings.push({ binding: soundBinding, sound });

                    soundFolder.addButton({ title: 'Add Curve' }).on('click', () => {
                        sound.curves.push(defaultCurve());
                        onAudioChange({ files: audioFiles, compositions: audioCompositions, sounds: audioSounds });
                        renderCompositions();
                    });

                    sound.curves.forEach((curve, curveIndex) => {
                        // Create a temporary blade to get initial axis info
                        const tempBlade = soundFolder.addBlade({
                            view: 'curve',
                            value: curve.points,
                            axis: curve.axis,
                        }) as CurveBladeApi;
                        const initialTitle = getCurveTitle(tempBlade);
                        tempBlade.dispose();

                        const curveKey = getFolderKey([
                            ...rootPath,
                            'Audio',
                            'Compositions',
                            compositionTitle,
                            soundTitle,
                            initialTitle,
                        ]);
                        const curveFolder = soundFolder.addFolder({
                            title: initialTitle,
                            expanded: getFolderExpanded(curveKey, false)
                        });
                        registerFolder(curveFolder, curveKey);

                        const curveBlade = curveFolder.addBlade({
                            view: 'curve',
                            value: curve.points,
                            axis: curve.axis,
                        }) as CurveBladeApi;

                        curveBlade.on('change', (ev) => {
                            sound.curves[curveIndex].points = ev.value;
                            sound.curves[curveIndex].axis = curveBlade.axis;
                            onAudioChange({ files: audioFiles, compositions: audioCompositions, sounds: audioSounds });
                        });

                        curveBlade.on('axischange', () => {
                            curveFolder.title = getCurveTitle(curveBlade);
                            sound.curves[curveIndex].axis = curveBlade.axis;
                            onAudioChange({ files: audioFiles, compositions: audioCompositions, sounds: audioSounds });
                        });

                        curveFolder.addButton({ title: 'Remove Curve' }).on('click', () => {
                            const confirmTitle = getCurveTitle(curveBlade);
                            if (!window.confirm(`Delete curve "${confirmTitle}"?`)) {
                                return;
                            }
                            sound.curves.splice(curveIndex, 1);
                            onAudioChange({ files: audioFiles, compositions: audioCompositions, sounds: audioSounds });
                            renderCompositions();
                        });
                    });

                    soundFolder.addButton({ title: 'Remove Sound' }).on('click', () => {
                        const label = sound.file || `Sound ${soundIndex + 1}`;
                        if (!window.confirm(`Delete sound "${label}"?`)) {
                            return;
                        }
                        composition.sounds.splice(soundIndex, 1);
                        onAudioChange({ files: audioFiles, compositions: audioCompositions, sounds: audioSounds });
                        renderCompositions();
                    });
                });

                compFolder.addButton({ title: 'Delete Composition' }).on('click', () => {
                    if (!window.confirm(`Delete composition "${compositionTitle}"?`)) {
                        return;
                    }
                    audioCompositions.splice(compositionIndex, 1);
                    onAudioChange({ files: audioFiles, compositions: audioCompositions, sounds: audioSounds });
                    renderCompositions();
                });
            });

            refreshSoundOptions();
        };

        renderCompositions();

        // One-shot sounds UI (horn, door_open, door_close, etc.)
        const soundsKey = getFolderKey([...rootPath, 'Audio', 'Sounds']);
        const soundsFolder = audioFolder.addFolder({
            title: 'Sounds',
            expanded: getFolderExpanded(soundsKey, false)
        });
        registerFolder(soundsFolder, soundsKey);

        const SOUND_ROLES = ['horn_low', 'horn_high', 'door_open', 'door_close'] as const;
        const oneShotBindings: ListInputBindingApi<string>[] = [];

        const buildOneShotOptions = (current: string) => {
            const options = [{ text: '(none)', value: '' }, ...audioFileNames.map(name => ({ text: name, value: name }))];
            if (current && !audioFileNames.includes(current)) {
                options.unshift({ text: `${current} (missing)`, value: current });
            }
            return options;
        };

        for (const role of SOUND_ROLES) {
            const params = { file: audioSounds[role] || '' };
            const binding = soundsFolder.addBinding(params, 'file', {
                label: role,
                options: buildOneShotOptions(params.file),
            }) as ListInputBindingApi<string>;

            binding.on('change', (ev) => {
                if (ev.value) {
                    audioSounds[role] = ev.value;
                } else {
                    delete audioSounds[role];
                }
                onAudioChange({ files: audioFiles, compositions: audioCompositions, sounds: audioSounds });
            });

            oneShotBindings.push(binding);
        }

        // Refresh one-shot options when files change
        const origRefresh = refreshSoundOptions;
        const refreshAll = () => {
            origRefresh();
            oneShotBindings.forEach((binding, i) => {
                const role = SOUND_ROLES[i];
                binding.options = buildOneShotOptions(audioSounds[role] || '');
            });
        };
        // Patch the file upload handler to also refresh one-shot bindings
        audioFilesBlade.on('change', () => {
            refreshAll();
        });
    }

    public setTrainGroup(trainGroup: Group): void {
        this.trainGroup = trainGroup;
    }

    public async initialize(config: AudioConfig): Promise<void> {
        const initializationId = ++this.currentInitializationId;
        this.cleanup();

        const listener = audioListener.value;
        if (!listener) {
            console.warn('TrainAudio: No AudioListener available in global store. Audio will not be initialized.');
            return;
        }

        if (!this.trainGroup) {
            console.warn('TrainAudio: Train group not set. Call setTrainGroup() first.');
            return;
        }

        const audioBuffers = new Map<string, AudioBuffer>();

        for (const audioFile of config.files) {
            try {
                const buffer = await this.loadAudioFile(audioFile.url);

                if (initializationId !== this.currentInitializationId) {
                    return;
                }

                audioBuffers.set(audioFile.name, buffer);
            } catch (error) {
                console.error(`TrainAudio: Failed to load audio file "${audioFile.name}" from "${audioFile.url}":`, error);
            }
        }

        if (initializationId !== this.currentInitializationId) return;

        for (const composition of config.compositions) {
            for (const sound of composition.sounds) {
                const buffer = audioBuffers.get(sound.file);
                if (!buffer) {
                    console.warn(`TrainAudio: No buffer found for "${sound.file}" in composition "${composition.title}"`);
                    continue;
                }

                const positionalAudio = new PositionalAudio(listener);
                positionalAudio.setBuffer(buffer);
                positionalAudio.setLoop(true);
                positionalAudio.setRefDistance(5);
                positionalAudio.setRolloffFactor(1);

                this.trainGroup.add(positionalAudio);
                this.audioInstances.push({
                    audio: positionalAudio,
                    sound: sound,
                    compositionTitle: composition.title
                });
            }
        }

        // Load one-shot sounds (horn, door_open, door_close, etc.)
        if (config.sounds) {
            for (const [role, fileName] of Object.entries(config.sounds)) {
                if (!fileName) continue;
                const buffer = audioBuffers.get(fileName);
                if (buffer) {
                    this.oneShotBuffers.set(role, buffer);
                } else {
                    console.warn(`TrainAudio: No buffer found for one-shot sound "${role}" -> "${fileName}"`);
                }
            }
        }

        this.isEnabled = true;
        console.log(`TrainAudio: Initialized ${this.audioInstances.length} audio instances, ${this.oneShotBuffers.size} one-shot sounds`);
        this.play();
    }

    private async loadAudioFile(filePath: string): Promise<AudioBuffer> {
        const listener = audioListener.value;
        if (!listener) {
            throw new Error('No AudioListener available');
        }
        const audioContext = listener.context;

        if (filePath.startsWith(blobString)) {
            return new Promise((resolve, reject) => {
                this.audioLoader.load(
                    filePath,
                    (buffer) => resolve(buffer),
                    undefined,
                    (error) => reject(error)
                );
            });
        }

        try {
            const mangledFileName = getProtectedAssetPath(filePath);
            const fetchUrl = `${trainAssetsPath}/${mangledFileName}`;

            if (this.opusSupported === false) {
                console.log(`[TrainAudio] Loading MP3 fallback (opus not supported): ${fetchUrl}.fb`);
                const fallbackBuffer = await loadEncryptedAsset(`${fetchUrl}.fb`, filePath);
                const audioBuffer = await audioContext.decodeAudioData(fallbackBuffer.slice(0));
                return audioBuffer;
            }

            console.log(`[TrainAudio] Loading encrypted audio: ${fetchUrl}`);

            const buffer = await loadEncryptedAsset(fetchUrl, filePath);

            try {
                const audioBuffer = await audioContext.decodeAudioData(buffer.slice(0));
                console.log(`[TrainAudio] Successfully decoded opus audio: ${filePath}`);
                return audioBuffer;
            } catch (decodeError) {
                this.opusSupported = false;
                console.log(`[TrainAudio] Opus not supported, using MP3 fallback for all files`);
                const fallbackUrl = `${fetchUrl}.fb`;
                const fallbackBuffer = await loadEncryptedAsset(fallbackUrl, filePath);
                const audioBuffer = await audioContext.decodeAudioData(fallbackBuffer.slice(0));
                console.log(`[TrainAudio] Successfully decoded MP3 fallback: ${filePath}`);
                return audioBuffer;
            }
        } catch (error) {
            console.error(`[TrainAudio] Failed to load encrypted audio: ${filePath}`, error);
            throw error;
        }
    }


    public play(): void {
        if (!this.isEnabled) return;

        for (const instance of this.audioInstances) {
            if (!instance.audio.isPlaying) {
                instance.audio.play();
            }
        }
    }

    public stop(): void {
        for (const instance of this.audioInstances) {
            if (instance.audio.isPlaying) {
                instance.audio.stop();
            }
        }
    }

    public pause(): void {
        for (const instance of this.audioInstances) {
            if (instance.audio.isPlaying) {
                instance.audio.pause();
            }
        }
    }

    public update(): void {
        if (!this.isEnabled || this.audioInstances.length === 0) return;

        const trainState = this.getTrainState();
        for (const instance of this.audioInstances) {
            this.updateAudioInstance(instance, trainState);
        }
    }

    private getTrainState(): TrainState {
        const power = trainPower.value;
        const velocityKmh = trainVelocityKmh.value;

        let brakePower = 0;
        if ((velocityKmh > 0 && power < -0.1) || (velocityKmh < 0 && power > 0.1)) {
            brakePower = 1.0;
        } else if (Math.abs(power) <= 0.1 && Math.abs(velocityKmh) > 0.1) {
            brakePower = 0.3;
        }

        this._trainState.throttlePower = Math.abs(power);
        this._trainState.velocityKmh = Math.abs(velocityKmh);
        this._trainState.brakePower = brakePower;
        this._trainState.tractiveEffort = trainTractiveEffort.value;

        return this._trainState;
    }

    private updateAudioInstance(instance: AudioInstance, trainState: TrainState): void {
        const volumeValues = this._volumeValues;
        const pitchValues = this._pitchValues;
        volumeValues.length = 0;
        pitchValues.length = 0;

        for (const curve of instance.sound.curves) {
            const xAxis = curve.axis?.x.label || '';
            const yAxis = curve.axis?.y.label || '';

            const inputValue = this.getInputValue(trainState, xAxis);
            if (inputValue === null) continue;

            const outputValue = this.interpolateCurve(curve, inputValue);
            if (yAxis === 'Volume') {
                volumeValues.push(outputValue);
            } else if (yAxis === 'Pitch') {
                pitchValues.push(outputValue);
            }
        }

        // Lowest value wins; default to 1.0 if no curves control a property
        let finalVolume = 1.0;
        for (let i = 0; i < volumeValues.length; i++) {
            if (volumeValues[i] < finalVolume) finalVolume = volumeValues[i];
        }
        instance.audio.setVolume(finalVolume);

        if (finalVolume > 0 && !instance.audio.isPlaying) {
            instance.audio.play();
        } else if (finalVolume === 0 && instance.audio.isPlaying) {
            instance.audio.pause();
        }

        if (pitchValues.length > 0) {
            let finalPitch = pitchValues[0];
            for (let i = 1; i < pitchValues.length; i++) {
                if (pitchValues[i] < finalPitch) finalPitch = pitchValues[i];
            }
            instance.audio.setPlaybackRate(finalPitch);
        } else {
            instance.audio.setPlaybackRate(1.0);
        }
    }

    private getInputValue(trainState: TrainState, axisLabel: string): number | null {
        switch (axisLabel) {
            case 'Throttle Power':
                return trainState.throttlePower;
            case 'Velocity (km/h)':
                return trainState.velocityKmh;
            case 'Brake Power':
                return trainState.brakePower;
            case 'Tractive Effort':
                return trainState.tractiveEffort;
            default:
                console.warn(`TrainAudio: Unknown input axis "${axisLabel}"`);
                return null;
        }
    }

    private interpolateCurve(curve: AudioCurve, inputValue: number): number {
        const points = curve.points;
        if (points.length === 0) return 0;
        if (points.length === 1) return points[0].y;

        if (!(curve as any)._sorted) {
            points.sort((a, b) => a.x - b.x);
            (curve as any)._sorted = true;
        }

        const minX = points[0].x;
        const maxX = points[points.length - 1].x;
        const clampedInput = Math.max(minX, Math.min(maxX, inputValue));

        let leftPoint = points[0];
        let rightPoint = points[points.length - 1];

        for (let i = 0; i < points.length - 1; i++) {
            if (clampedInput >= points[i].x && clampedInput <= points[i + 1].x) {
                leftPoint = points[i];
                rightPoint = points[i + 1];
                break;
            }
        }

        if (leftPoint.x === rightPoint.x) {
            return leftPoint.y;
        }

        const t = (clampedInput - leftPoint.x) / (rightPoint.x - leftPoint.x);
        return leftPoint.y + t * (rightPoint.y - leftPoint.y);
    }

    public playSound(role: string): void {
        if (!this.isEnabled || !this.trainGroup) return;

        const buffer = this.oneShotBuffers.get(role);
        if (!buffer) return;

        const listener = audioListener.value;
        if (!listener) return;

        const audio = new PositionalAudio(listener);
        audio.setBuffer(buffer);
        audio.setLoop(false);
        audio.setRefDistance(5);
        audio.setRolloffFactor(1);
        audio.setVolume(1.0);

        this.trainGroup.add(audio);
        audio.play();

        // Remove from scene when finished
        audio.onEnded = () => {
            audio.disconnect();
            this.trainGroup?.remove(audio);
        };
    }

    public getOneShotRoles(): string[] {
        return Array.from(this.oneShotBuffers.keys());
    }

    public setEnabled(enabled: boolean): void {
        this.isEnabled = enabled;
        if (!enabled) {
            this.stop();
        }
    }

    public cleanup(): void {
        const instanceCount = this.audioInstances.length;
        for (const instance of this.audioInstances) {
            if (instance.audio.isPlaying) {
                instance.audio.stop();
            }
        }

        if (this.trainGroup) {
            for (const instance of this.audioInstances) {
                this.trainGroup.remove(instance.audio);
                instance.audio.disconnect();
            }
        }

        this.audioInstances = [];
        this.oneShotBuffers.clear();
        this.isEnabled = false;

        if (instanceCount > 0) {
            console.log(`TrainAudio: Cleaned up ${instanceCount} audio instances`);
        }
    }
}
