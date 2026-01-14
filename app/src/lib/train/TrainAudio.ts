import type { FolderApi, ListInputBindingApi, Pane } from 'tweakpane';
import { CurveBladePlugin, type CurveBladeApi } from '../tweakpane/CurvePlugin';
import {
    AudioUploadBladePlugin,
    type AudioUploadBladeApi,
    type AudioUploadFile,
} from '../tweakpane/AudioUploadPlugin';
import { getFolderKey } from './TrainUiUtils';
import type { AudioConfig, AudioComposition, AudioSound, AudioCurve } from './TrainConfig';

function getCurveTitle(curveBlade: CurveBladeApi): string {
    const axis = curveBlade.axis;
    const yLabel = axis.y.label || 'Target';
    const xLabel = axis.x.label || 'Input';
    return `${yLabel} vs ${xLabel}`;
}

type RegisterFolder = (folder: FolderApi, key: string) => void;
type GetFolderExpanded = (key: string, fallback: boolean) => boolean;

export class TrainAudio {
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
        let audioFileNames: string[] = [];
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
            value: audioFiles
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
            audioFiles = ev.value;
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
                            onAudioChange({ files: audioFiles, compositions: audioCompositions });
                        });

                        curveBlade.on('axischange', () => {
                            // Update folder title when axis changes
                            const newTitle = getCurveTitle(curveBlade);
                            curveFolder.title = newTitle;
                            // Save the axis configuration
                            sound.curves[curveIndex].axis = curveBlade.axis;
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
}
