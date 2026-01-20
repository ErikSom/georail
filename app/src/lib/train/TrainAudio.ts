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

/**
 * Represents a single audio source instance with its associated curves
 */
interface AudioInstance {
    audio: PositionalAudio;
    sound: AudioSound;
    compositionTitle: string;
}

/**
 * Train state used for curve evaluation
 */
interface TrainState {
    throttlePower: number;  // 0-1
    velocityKmh: number;    // km/h
    brakePower: number;     // 0-1
    tractiveEffort: number; // 0-1 (normalized)
}

/**
 * TrainAudio manages both the audio configuration UI and runtime audio playback.
 *
 * UI: Provides Tweakpane interface for configuring audio compositions and curves
 * Runtime: Uses ThreeJS PositionalAudio to play sounds based on train state
 */
export class TrainAudio {
    // Runtime audio engine properties
    private audioInstances: AudioInstance[] = [];
    private audioLoader: AudioLoader;
    private trainGroup: Group | null = null;
    private isEnabled: boolean = false;
    private currentInitializationId: number = 0;
    private opusSupported: boolean = true;

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
            // Convert from AudioUploadFile[] to AudioFile[]
            audioFiles = audioFilesBlade.files.map(f => ({ name: f.name, url: f.url }));
            updateAudioFileNames(audioFilesBlade.files);
            refreshSoundOptions();
            onAudioChange({ files: audioFiles, compositions: audioCompositions });
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
            onAudioChange({ files: audioFiles, compositions: audioCompositions });
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
                    onAudioChange({ files: audioFiles, compositions: audioCompositions });
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
                        onAudioChange({ files: audioFiles, compositions: audioCompositions });
                    });

                    soundBindings.push({ binding: soundBinding, sound });

                    soundFolder.addButton({ title: 'Add Curve' }).on('click', () => {
                        sound.curves.push(defaultCurve());
                        onAudioChange({ files: audioFiles, compositions: audioCompositions });
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
                            // Don't re-initialize audio for curve changes - they're applied in update()
                            onAudioChange({ files: audioFiles, compositions: audioCompositions });
                        });

                        curveBlade.on('axischange', () => {
                            // Update folder title when axis changes
                            const newTitle = getCurveTitle(curveBlade);
                            curveFolder.title = newTitle;
                            // Save the axis configuration
                            sound.curves[curveIndex].axis = curveBlade.axis;
                            // Don't re-initialize audio for axis changes - they're applied in update()
                            onAudioChange({ files: audioFiles, compositions: audioCompositions });
                        });

                        curveFolder.addButton({ title: 'Remove Curve' }).on('click', () => {
                            const confirmTitle = getCurveTitle(curveBlade);
                            if (!window.confirm(`Delete curve "${confirmTitle}"?`)) {
                                return;
                            }
                            sound.curves.splice(curveIndex, 1);
                            onAudioChange({ files: audioFiles, compositions: audioCompositions });
                            renderCompositions();
                        });
                    });

                    soundFolder.addButton({ title: 'Remove Sound' }).on('click', () => {
                        const label = sound.file || `Sound ${soundIndex + 1}`;
                        if (!window.confirm(`Delete sound "${label}"?`)) {
                            return;
                        }
                        composition.sounds.splice(soundIndex, 1);
                        onAudioChange({ files: audioFiles, compositions: audioCompositions });
                        renderCompositions();
                    });
                });

                compFolder.addButton({ title: 'Delete Composition' }).on('click', () => {
                    if (!window.confirm(`Delete composition "${compositionTitle}"?`)) {
                        return;
                    }
                    audioCompositions.splice(compositionIndex, 1);
                    onAudioChange({ files: audioFiles, compositions: audioCompositions });
                    renderCompositions();
                });
            });

            refreshSoundOptions();
        };

        renderCompositions();
    }

    // ============================================================================
    // Runtime Audio Engine Methods
    // ============================================================================

    /**
     * Set the train group for attaching positional audio
     */
    public setTrainGroup(trainGroup: Group): void {
        this.trainGroup = trainGroup;
    }

    /**
     * Initialize the audio engine with a configuration
     * Automatically uses the global audio listener from the store
     */
    public async initialize(config: AudioConfig): Promise<void> {
        // Increment initialization ID to cancel any ongoing initializations
        const initializationId = ++this.currentInitializationId;

        // Clean up existing audio instances
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

        // Load all audio files and create a mapping from filename to buffer
        // config.files contains AudioFile objects with both name and url
        const audioBuffers = new Map<string, AudioBuffer>();

        for (const audioFile of config.files) {
            try {
                const buffer = await this.loadAudioFile(audioFile.url);

                // Check if this initialization was cancelled
                if (initializationId !== this.currentInitializationId) {
                    console.log(`TrainAudio: Initialization ${initializationId} cancelled (current: ${this.currentInitializationId})`);
                    return;
                }

                audioBuffers.set(audioFile.name, buffer);
            } catch (error) {
                console.error(`TrainAudio: Failed to load audio file "${audioFile.name}" from "${audioFile.url}":`, error);
            }
        }

        // Check again before creating instances
        if (initializationId !== this.currentInitializationId) {
            console.log(`TrainAudio: Initialization ${initializationId} cancelled before creating instances`);
            return;
        }

        // Create audio instances for each sound in each composition
        for (const composition of config.compositions) {
            for (const sound of composition.sounds) {
                const buffer = audioBuffers.get(sound.file);
                if (!buffer) {
                    console.warn(`TrainAudio: No buffer found for "${sound.file}" in composition "${composition.title}"`);
                    continue;
                }

                // Create a PositionalAudio instance
                const positionalAudio = new PositionalAudio(listener);
                positionalAudio.setBuffer(buffer);
                positionalAudio.setLoop(true);
                positionalAudio.setRefDistance(5);
                positionalAudio.setRolloffFactor(1);

                // Attach to train group for spatial positioning
                this.trainGroup.add(positionalAudio);

                // Store the instance with its configuration
                this.audioInstances.push({
                    audio: positionalAudio,
                    sound: sound,
                    compositionTitle: composition.title
                });
            }
        }

        this.isEnabled = true;
        console.log(`TrainAudio: Initialization ${initializationId} completed with ${this.audioInstances.length} audio instances`);

        // Auto-play all audio instances
        this.play();
    }

    /**
     * Load an audio file and return its AudioBuffer
     * Handles both blob URLs and encrypted audio files
     * For encrypted files, tries opus/webm first, falls back to .fb (MP3) if opus not supported
     */
    private async loadAudioFile(filePath: string): Promise<AudioBuffer> {
        const listener = audioListener.value;
        if (!listener) {
            throw new Error('No AudioListener available');
        }
        const audioContext = listener.context;

        // Path A: Blob URLs - use standard loader
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

        // Path B: Internal encrypted files
        try {
            // Get the mangled/encrypted filename
            const mangledFileName = getProtectedAssetPath(filePath);
            const fetchUrl = `${trainAssetsPath}/${mangledFileName}`;

            // If opus support is already known to be false, go directly to MP3 fallback
            if (this.opusSupported === false) {
                console.log(`[TrainAudio] Loading MP3 fallback (opus not supported): ${fetchUrl}.fb`);
                const fallbackBuffer = await loadEncryptedAsset(`${fetchUrl}.fb`, filePath);
                const audioBuffer = await audioContext.decodeAudioData(fallbackBuffer.slice(0));
                return audioBuffer;
            }

            console.log(`[TrainAudio] Loading encrypted audio: ${fetchUrl}`);

            // Load and decrypt the buffer
            const buffer = await loadEncryptedAsset(fetchUrl, filePath);

            // Try to decode the audio buffer (opus/webm)
            try {
                const audioBuffer = await audioContext.decodeAudioData(buffer.slice(0));
                console.log(`[TrainAudio] Successfully decoded opus audio: ${filePath}`);
                return audioBuffer;
            } catch (decodeError) {
                // Opus not supported, mark flag and try fallback MP3
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


    /**
     * Start playing all audio instances
     */
    public play(): void {
        if (!this.isEnabled) return;

        for (const instance of this.audioInstances) {
            if (!instance.audio.isPlaying) {
                instance.audio.play();
            }
        }
    }

    /**
     * Stop playing all audio instances
     */
    public stop(): void {
        for (const instance of this.audioInstances) {
            if (instance.audio.isPlaying) {
                instance.audio.stop();
            }
        }
    }

    /**
     * Pause all audio instances
     */
    public pause(): void {
        for (const instance of this.audioInstances) {
            if (instance.audio.isPlaying) {
                instance.audio.pause();
            }
        }
    }

    /**
     * Update audio properties based on train state
     * Should be called every frame
     */
    public update(): void {
        if (!this.isEnabled || this.audioInstances.length === 0) return;

        // Get current train state from global store
        const trainState = this.getTrainState();

        // Update each audio instance based on its curves
        for (const instance of this.audioInstances) {
            this.updateAudioInstance(instance, trainState);
        }
    }

    /**
     * Get current train state for curve evaluation from global store
     */
    private getTrainState(): TrainState {
        const power = trainPower.value;
        const velocityKmh = trainVelocityKmh.value;

        // Calculate brake power: when power is opposite to velocity direction, or when coasting
        let brakePower = 0;

        // If moving and power is opposite direction, full brake
        if ((velocityKmh > 0 && power < -0.1) || (velocityKmh < 0 && power > 0.1)) {
            brakePower = 1.0;
        }
        // If moving and power is neutral, partial brake (coasting)
        else if (Math.abs(power) <= 0.1 && Math.abs(velocityKmh) > 0.1) {
            brakePower = 0.3;
        }

        const state = {
            throttlePower: Math.abs(power),
            velocityKmh: Math.abs(velocityKmh),
            brakePower: brakePower,
            tractiveEffort: trainTractiveEffort.value
        };

        return state;
    }

    /**
     * Update a single audio instance based on its curves and train state
     */
    private updateAudioInstance(instance: AudioInstance, trainState: TrainState): void {
        // Collect all volume and pitch values from curves
        const volumeValues: number[] = [];
        const pitchValues: number[] = [];

        for (const curve of instance.sound.curves) {
            const xAxis = curve.axis?.x.label || '';
            const yAxis = curve.axis?.y.label || '';

            // Get input value from train state
            const inputValue = this.getInputValue(trainState, xAxis);
            if (inputValue === null) continue;

            // Interpolate curve to get output value
            const outputValue = this.interpolateCurve(curve, inputValue);

            // Debug logging (remove after testing)
            if (Math.random() < 0.01) { // Log 1% of frames
                console.log(`Curve ${xAxis} -> ${yAxis}: input=${inputValue.toFixed(3)}, output=${outputValue.toFixed(3)}`);
            }

            // Store output value based on target axis
            if (yAxis === 'Volume') {
                volumeValues.push(outputValue);
            } else if (yAxis === 'Pitch') {
                pitchValues.push(outputValue);
            }
        }

        // Apply the LOWEST value for each property (lowest wins)
        // If no curves control a property, default to maximum (1.0)
        const finalVolume = volumeValues.length > 0 ? Math.min(...volumeValues) : 1.0;
        instance.audio.setVolume(finalVolume);

        // Debug logging (remove after testing)
        if (Math.random() < 0.01 && volumeValues.length > 0) {
            console.log(`Final volume: ${finalVolume.toFixed(3)} (from ${volumeValues.length} curves)`);
        }

        // Auto-play if volume is above 0 and not already playing
        if (finalVolume > 0 && !instance.audio.isPlaying) {
            instance.audio.play();
        }
        // Stop if volume is 0
        else if (finalVolume === 0 && instance.audio.isPlaying) {
            instance.audio.pause();
        }

        if (pitchValues.length > 0) {
            const finalPitch = Math.min(...pitchValues);
            instance.audio.setPlaybackRate(finalPitch);
        } else {
            // Default pitch to 1.0 if no curves control it
            instance.audio.setPlaybackRate(1.0);
        }
    }

    /**
     * Get input value from train state based on axis label
     */
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

    /**
     * Interpolate a curve to get the output value for a given input value
     * Uses linear interpolation between points
     */
    private interpolateCurve(curve: AudioCurve, inputValue: number): number {
        const points = curve.points;
        if (points.length === 0) return 0;
        if (points.length === 1) return points[0].y;

        // Sort points by x value (just in case they're not sorted)
        const sortedPoints = [...points].sort((a, b) => a.x - b.x);

        // Clamp input to curve range
        const minX = sortedPoints[0].x;
        const maxX = sortedPoints[sortedPoints.length - 1].x;
        const clampedInput = Math.max(minX, Math.min(maxX, inputValue));

        // Find the two points to interpolate between
        let leftPoint = sortedPoints[0];
        let rightPoint = sortedPoints[sortedPoints.length - 1];

        for (let i = 0; i < sortedPoints.length - 1; i++) {
            if (clampedInput >= sortedPoints[i].x && clampedInput <= sortedPoints[i + 1].x) {
                leftPoint = sortedPoints[i];
                rightPoint = sortedPoints[i + 1];
                break;
            }
        }

        // Linear interpolation
        if (leftPoint.x === rightPoint.x) {
            return leftPoint.y;
        }

        const t = (clampedInput - leftPoint.x) / (rightPoint.x - leftPoint.x);
        return leftPoint.y + t * (rightPoint.y - leftPoint.y);
    }

    /**
     * Enable or disable the audio engine
     */
    public setEnabled(enabled: boolean): void {
        this.isEnabled = enabled;
        if (!enabled) {
            this.stop();
        }
    }

    /**
     * Clean up all audio instances
     */
    public cleanup(): void {
        const instanceCount = this.audioInstances.length;

        // Stop all audio instances
        for (const instance of this.audioInstances) {
            if (instance.audio.isPlaying) {
                instance.audio.stop();
            }
        }

        // Remove from scene and disconnect
        if (this.trainGroup) {
            for (const instance of this.audioInstances) {
                this.trainGroup.remove(instance.audio);
                instance.audio.disconnect();
            }
        }

        // Clear instances array
        this.audioInstances = [];
        this.isEnabled = false;

        if (instanceCount > 0) {
            console.log(`TrainAudio: Cleaned up ${instanceCount} audio instances`);
        }
    }
}
