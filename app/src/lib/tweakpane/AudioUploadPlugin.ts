import {
    BladeApi,
    ClassName,
    LabeledValueBladeController,
    TpChangeEvent,
    ValueMap,
    ViewProps,
    createPlugin,
    createValue,
    parseRecord,
} from '@tweakpane/core';
import type {
    BaseBladeParams,
    BladePlugin,
    Value,
    ValueController,
    View,
} from '@tweakpane/core';

export interface AudioUploadBladeParams extends BaseBladeParams {
    value: string[];
    view: 'audiofiles';
    label?: string;
    maxHeight?: number;
}

interface AudioUploadControllerConfig {
    value: Value<string[]>;
    viewProps: ViewProps;
    maxHeight: number;
}

interface AudioItem {
    id: string;
    name: string;
    url: string;
    audio: HTMLAudioElement;
    created: boolean;
}

export type AudioUploadFile = {
    name: string;
    url: string;
};

const cn = ClassName('audio');
const STYLE_ID = 'tp-audio-upload-style';
const DEFAULT_MAX_HEIGHT = 200;
const AUDIO_EXTENSIONS = new Set([
    'mp3',
    'wav',
    'ogg',
    'flac',
    'm4a',
    'aac',
    'aiff',
    'opus',
    'weba',
]);

function ensureAudioStyles(doc: Document): void {
    if (doc.getElementById(STYLE_ID)) {
        return;
    }

    const style = doc.createElement('style');
    style.id = STYLE_ID;
    style.textContent = `
.tp-audiov {
    display: flex;
    flex-direction: column;
    gap: 6px;
    font-family: inherit;
}
.tp-audiov_drop {
    height: var(--cnt-usz, 20px);
    border-radius: var(--bld-br, 2px);
    border: 1px dashed var(--cnt-bg-h, rgba(255, 255, 255, 0.2));
    background: var(--cnt-bg, rgba(255, 255, 255, 0.08));
    color: var(--cnt-fg, rgba(255, 255, 255, 0.75));
    display: flex;
    align-items: center;
    justify-content: center;
    font-size: 11px;
    cursor: pointer;
    user-select: none;
    padding: 12px 4px;
    text-align: center;
}
.tp-audiov_drop:focus {
    outline: 2px solid rgba(99, 213, 255, 0.6);
    outline-offset: 2px;
}
.tp-audiov_drop.tp-audiov_drop-drag {
    border-color: rgba(99, 213, 255, 0.6);
    background: rgba(99, 213, 255, 0.12);
}
.tp-audiov_list {
    display: flex;
    flex-direction: column;
    gap: 6px;
    overflow-y: auto;
    padding-right: 2px;
}
.tp-audiov_empty {
    font-size: 11px;
    color: var(--lbl-fg, rgba(187, 188, 196, 0.7));
    padding: 6px 4px;
}
.tp-audiov_row {
    display: grid;
    grid-template-columns: minmax(0, 1fr) auto;
    gap: 6px;
    align-items: center;
    background: var(--cnt-bg, rgba(255, 255, 255, 0.08));
    border-radius: var(--bld-br, 2px);
    padding: 4px 6px;
}
.tp-audiov_name {
    font-size: 11px;
    color: var(--cnt-fg, rgba(255, 255, 255, 0.75));
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
}
.tp-audiov_controls {
    display: inline-flex;
    gap: 4px;
}
.tp-audiov_btn {
    border-radius: var(--bld-br, 2px);
    border: 1px solid var(--cnt-bg-h, rgba(255, 255, 255, 0.2));
    background: var(--btn-bg, rgba(255, 255, 255, 0.7));
    color: var(--btn-fg, #1b1e25);
    font-size: 10px;
    width: 22px;
    height: var(--cnt-usz, 20px);
    padding: 0;
    cursor: pointer;
    display: inline-flex;
    align-items: center;
    justify-content: center;
}
.tp-audiov_btn:hover {
    background: var(--btn-bg-h, rgba(255, 255, 255, 0.85));
}
.tp-audiov_btn:disabled {
    opacity: 0.5;
    cursor: not-allowed;
}
.tp-audiov_btn::before {
    content: '';
    display: block;
    width: 12px;
    height: 12px;
    background-color: currentColor;
    -webkit-mask-repeat: no-repeat;
    -webkit-mask-position: center;
    -webkit-mask-size: contain;
    mask-repeat: no-repeat;
    mask-position: center;
    mask-size: contain;
}
.tp-audiov_btn-play::before {
    -webkit-mask-image: url(data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHZpZXdCb3g9IjAgMCAxMiAxMiI+PHBvbHlnb24gcG9pbnRzPSIzLDIgMTAsNiAzLDEwIiBmaWxsPSIjMDAwIi8+PC9zdmc+);
    mask-image: url(data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHZpZXdCb3g9IjAgMCAxMiAxMiI+PHBvbHlnb24gcG9pbnRzPSIzLDIgMTAsNiAzLDEwIiBmaWxsPSIjMDAwIi8+PC9zdmc+);
}
.tp-audiov_btn-stop::before {
    -webkit-mask-image: url(data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHZpZXdCb3g9IjAgMCAxMiAxMiI+PHJlY3QgeD0iMyIgeT0iMyIgd2lkdGg9IjYiIGhlaWdodD0iNiIgZmlsbD0iIzAwMCIvPjwvc3ZnPg==);
    mask-image: url(data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHZpZXdCb3g9IjAgMCAxMiAxMiI+PHJlY3QgeD0iMyIgeT0iMyIgd2lkdGg9IjYiIGhlaWdodD0iNiIgZmlsbD0iIzAwMCIvPjwvc3ZnPg==);
}
.tp-audiov_btn-delete::before {
    -webkit-mask-image: url(data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHZpZXdCb3g9IjAgMCAxMiAxMiI+PHBhdGggZD0iTTQgNGgxdjVINHptMyAwaDF2NUg3ek0yIDNoOHYxSDJ6bTItMWg0djFINHptLTEgMmg2djZIM3oiIGZpbGw9IiMwMDAiLz48L3N2Zz4=);
    mask-image: url(data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHZpZXdCb3g9IjAgMCAxMiAxMiI+PHBhdGggZD0iTTQgNGgxdjVINHptMyAwaDF2NUg3ek0yIDNoOHYxSDJ6bTItMWg0djFINHptLTEgMmg2djZIM3oiIGZpbGw9IiMwMDAiLz48L3N2Zz4=);
}
.tp-audiov.tp-v-disabled .tp-audiov_drop {
    cursor: default;
}
`;
    doc.head.appendChild(style);
}

function isAudioFile(file: File): boolean {
    if (file.type && file.type.startsWith('audio/')) {
        return true;
    }
    const extension = file.name.split('.').pop()?.toLowerCase();
    return extension ? AUDIO_EXTENSIONS.has(extension) : false;
}

function arrayEquals(a: string[], b: string[]): boolean {
    if (a === b) {
        return true;
    }
    if (a.length !== b.length) {
        return false;
    }
    for (let i = 0; i < a.length; i += 1) {
        if (a[i] !== b[i]) {
            return false;
        }
    }
    return true;
}

function guessNameFromUrl(url: string): string {
    try {
        const parsed = new URL(url, window.location.href);
        const last = parsed.pathname.split('/').pop();
        return last || url;
    } catch {
        const last = url.split('/').pop();
        return last || url;
    }
}

class AudioUploadView implements View {
    public readonly element: HTMLElement;
    public readonly dropElement: HTMLDivElement;
    public readonly inputElement: HTMLInputElement;
    public readonly listElement: HTMLDivElement;
    public readonly emptyElement: HTMLDivElement;

    constructor(doc: Document, config: { viewProps: ViewProps; maxHeight: number }) {
        this.element = doc.createElement('div');
        this.element.classList.add(cn());
        config.viewProps.bindClassModifiers(this.element);

        const drop = doc.createElement('div');
        drop.classList.add(cn('drop'));
        drop.tabIndex = 0;
        drop.setAttribute('role', 'button');
        drop.textContent = 'Drop audio files or click to upload';
        this.element.appendChild(drop);
        this.dropElement = drop;

        const input = doc.createElement('input');
        input.type = 'file';
        input.accept = 'audio/*';
        input.multiple = true;
        input.style.display = 'none';
        drop.appendChild(input);
        this.inputElement = input;

        const list = doc.createElement('div');
        list.classList.add(cn('list'));
        list.style.maxHeight = `${config.maxHeight}px`;
        this.element.appendChild(list);
        this.listElement = list;

        const empty = doc.createElement('div');
        empty.classList.add(cn('empty'));
        empty.textContent = 'No audio files';
        list.appendChild(empty);
        this.emptyElement = empty;

        config.viewProps.bindTabIndex(drop);
        config.viewProps.bindDisabled(input);
    }
}

class AudioUploadController implements ValueController<string[], AudioUploadView> {
    public readonly value: Value<string[]>;
    public readonly view: AudioUploadView;
    public readonly viewProps: ViewProps;

    private items: AudioItem[] = [];
    private idCounter = 0;
    private dragDepth = 0;
    private readonly onValueChange: () => void;

    constructor(doc: Document, config: AudioUploadControllerConfig) {
        ensureAudioStyles(doc);
        this.value = config.value;
        this.viewProps = config.viewProps;
        this.view = new AudioUploadView(doc, {
            viewProps: config.viewProps,
            maxHeight: config.maxHeight,
        });

        this.syncFromValue(this.value.rawValue);
        this.renderList();

        this.onValueChange = () => {
            this.syncFromValue(this.value.rawValue);
            this.renderList();
        };
        this.value.emitter.on('change', this.onValueChange);

        this.attachHandlers();

        this.viewProps.handleDispose(() => {
            this.dispose();
        });
    }

    public getFiles(): AudioUploadFile[] {
        return this.items.map((item) => ({
            name: item.name,
            url: item.url,
        }));
    }

    private dispose(): void {
        this.value.emitter.off('change', this.onValueChange);
        this.items.forEach((item) => {
            this.stopItem(item);
            if (item.created) {
                URL.revokeObjectURL(item.url);
            }
        });
        this.items = [];
    }

    private attachHandlers(): void {
        const drop = this.view.dropElement;
        const input = this.view.inputElement;

        drop.addEventListener('click', () => {
            if (!this.viewProps.get('disabled')) {
                input.click();
            }
        });

        drop.addEventListener('keydown', (ev) => {
            if (ev.key === 'Enter' || ev.key === ' ') {
                ev.preventDefault();
                if (!this.viewProps.get('disabled')) {
                    input.click();
                }
            }
        });

        input.addEventListener('change', () => {
            const files = Array.from(input.files ?? []);
            this.addFiles(files);
            input.value = '';
        });

        drop.addEventListener('dragenter', (ev) => {
            if (this.viewProps.get('disabled')) {
                return;
            }
            ev.preventDefault();
            this.dragDepth += 1;
            drop.classList.add(cn('drop', 'drag'));
        });

        drop.addEventListener('dragover', (ev) => {
            if (this.viewProps.get('disabled')) {
                return;
            }
            ev.preventDefault();
            if (ev.dataTransfer) {
                ev.dataTransfer.dropEffect = 'copy';
            }
            drop.classList.add(cn('drop', 'drag'));
        });

        drop.addEventListener('dragleave', (ev) => {
            if (this.viewProps.get('disabled')) {
                return;
            }
            ev.preventDefault();
            this.dragDepth = Math.max(0, this.dragDepth - 1);
            if (this.dragDepth === 0) {
                drop.classList.remove(cn('drop', 'drag'));
            }
        });

        drop.addEventListener('drop', (ev) => {
            if (this.viewProps.get('disabled')) {
                return;
            }
            ev.preventDefault();
            this.dragDepth = 0;
            drop.classList.remove(cn('drop', 'drag'));
            const files = Array.from(ev.dataTransfer?.files ?? []);
            this.addFiles(files);
        });
    }

    private addFiles(files: File[]): void {
        if (files.length === 0) {
            return;
        }
        const audioFiles = files.filter((file) => isAudioFile(file));
        if (audioFiles.length === 0) {
            return;
        }
        audioFiles.forEach((file) => {
            const url = URL.createObjectURL(file);
            const audio = new Audio(url);
            audio.preload = 'metadata';
            this.items.push({
                id: `${Date.now()}-${this.idCounter++}`,
                name: file.name,
                url,
                audio,
                created: true,
            });
        });
        this.updateValueFromItems();
        this.renderList();
    }

    private updateValueFromItems(): void {
        this.value.rawValue = this.items.map((item) => item.url);
    }

    private syncFromValue(urls: string[]): void {
        const existingByUrl = new Map(this.items.map((item) => [item.url, item]));
        const nextItems: AudioItem[] = [];
        urls.forEach((url) => {
            const existing = existingByUrl.get(url);
            if (existing) {
                nextItems.push(existing);
            } else {
                const audio = new Audio(url);
                audio.preload = 'metadata';
                nextItems.push({
                    id: `${Date.now()}-${this.idCounter++}`,
                    name: guessNameFromUrl(url),
                    url,
                    audio,
                    created: false,
                });
            }
        });

        this.items.forEach((item) => {
            if (!urls.includes(item.url)) {
                this.stopItem(item);
                if (item.created) {
                    URL.revokeObjectURL(item.url);
                }
            }
        });

        this.items = nextItems;
    }

    private stopItem(item: AudioItem): void {
        try {
            item.audio.pause();
            item.audio.currentTime = 0;
        } catch {
            // ignore playback errors
        }
    }

    private renderList(): void {
        const list = this.view.listElement;
        while (list.firstChild) {
            list.removeChild(list.firstChild);
        }

        if (this.items.length === 0) {
            list.appendChild(this.view.emptyElement);
            return;
        }

        this.items.forEach((item) => {
            const row = list.ownerDocument.createElement('div');
            row.classList.add(cn('row'));

            const name = list.ownerDocument.createElement('div');
            name.classList.add(cn('name'));
            name.textContent = item.name;
            name.title = item.name;
            row.appendChild(name);

            const controls = list.ownerDocument.createElement('div');
            controls.classList.add(cn('controls'));

            const playButton = this.createButton(list.ownerDocument, 'Play', 'play');
            playButton.addEventListener('click', () => {
                item.audio.currentTime = 0;
                item.audio.play();
            });
            controls.appendChild(playButton);

            const stopButton = this.createButton(list.ownerDocument, 'Stop', 'stop');
            stopButton.addEventListener('click', () => {
                this.stopItem(item);
            });
            controls.appendChild(stopButton);

            const deleteButton = this.createButton(list.ownerDocument, 'Delete', 'delete');
            deleteButton.addEventListener('click', () => {
                this.removeItem(item);
            });
            controls.appendChild(deleteButton);

            row.appendChild(controls);
            list.appendChild(row);
        });
    }

    private createButton(
        doc: Document,
        label: string,
        kind: 'play' | 'stop' | 'delete'
    ): HTMLButtonElement {
        const button = doc.createElement('button');
        button.type = 'button';
        button.classList.add(cn('btn'), cn('btn', kind));
        button.setAttribute('aria-label', label);
        button.title = label;
        this.viewProps.bindDisabled(button);
        return button;
    }

    private removeItem(item: AudioItem): void {
        if (!window.confirm(`Delete "${item.name}"?`)) {
            return;
        }
        const index = this.items.findIndex((entry) => entry.id === item.id);
        if (index === -1) {
            return;
        }
        this.stopItem(item);
        if (item.created) {
            URL.revokeObjectURL(item.url);
        }
        this.items.splice(index, 1);
        this.updateValueFromItems();
        this.renderList();
    }
}

export interface AudioUploadBladeApiEvents {
    change: {
        event: TpChangeEvent<string[]>;
    };
}

export class AudioUploadBladeApi extends BladeApi<
    LabeledValueBladeController<string[], AudioUploadController>
> {
    get label(): string | null | undefined {
        return this.controller.labelController.props.get('label');
    }

    set label(label: string | null | undefined) {
        this.controller.labelController.props.set('label', label);
    }

    get value(): string[] {
        return this.controller.valueController.value.rawValue;
    }

    set value(value: string[]) {
        this.controller.valueController.value.rawValue = value;
    }

    get files(): AudioUploadFile[] {
        return this.controller.valueController.getFiles();
    }

    on<EventName extends keyof AudioUploadBladeApiEvents>(
        eventName: EventName,
        handler: (ev: AudioUploadBladeApiEvents[EventName]['event']) => void
    ): this {
        const boundHandler = handler.bind(this);
        this.controller.valueController.value.emitter.on(eventName, (ev) => {
            boundHandler(new TpChangeEvent(this, ev.rawValue, ev.options.last));
        });
        return this;
    }
}

export const AudioUploadBladePlugin: BladePlugin<AudioUploadBladeParams> = createPlugin({
    id: 'audiofiles',
    type: 'blade',
    accept(params) {
        const result = parseRecord<AudioUploadBladeParams>(params, (p) => ({
            value: p.required.array(p.required.string),
            view: p.required.constant('audiofiles'),
            label: p.optional.string,
            maxHeight: p.optional.number,
        }));
        return result ? { params: result } : null;
    },
    controller(args) {
        const maxHeight =
            typeof args.params.maxHeight === 'number' ? args.params.maxHeight : DEFAULT_MAX_HEIGHT;
        const value = createValue(args.params.value, { equals: arrayEquals });
        const vc = new AudioUploadController(args.document, {
            value,
            viewProps: args.viewProps,
            maxHeight,
        });
        return new LabeledValueBladeController(args.document, {
            blade: args.blade,
            props: ValueMap.fromObject({
                label: args.params.label,
            }),
            value,
            valueController: vc,
        });
    },
    api(args) {
        if (!(args.controller instanceof LabeledValueBladeController)) {
            return null;
        }
        if (!(args.controller.valueController instanceof AudioUploadController)) {
            return null;
        }
        return new AudioUploadBladeApi(args.controller);
    },
});
