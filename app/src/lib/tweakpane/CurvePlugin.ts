import {
    BladeApi,
    ClassName,
    Emitter,
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

export type CurvePoint = { x: number; y: number };
export type CurveAxis = { min: number; max: number; label?: string };
export type CurveAxes = { x: CurveAxis; y: CurveAxis };
export type CurveGrid = { x: number; y: number };
export type CurveTargetMap = Record<string, CurveAxes>;

type PartialAxis = { min?: number; max?: number; label?: string };
type PartialAxes = { x?: PartialAxis; y?: PartialAxis };
type PartialGrid = { x?: number; y?: number };

export type VerticalAxisType = 'Volume' | 'Pitch';
export type HorizontalAxisType = 'Throttle Power' | 'Velocity (m/s)' | 'Brake Power';

const AXIS_DEFAULTS: Record<VerticalAxisType | HorizontalAxisType, { min: number; max: number }> = {
    'Volume': { min: 0, max: 1 },
    'Pitch': { min: 0.5, max: 2 },
    'Throttle Power': { min: 0, max: 1 },
    'Velocity (m/s)': { min: 0, max: 30 },
    'Brake Power': { min: 0, max: 1 },
};

export interface CurveBladeParams extends BaseBladeParams {
    value: CurvePoint[];
    view: 'curve';
    label?: string;
    target?: string;
    axis?: PartialAxes;
    grid?: PartialGrid;
    targets?: CurveTargetMap;
}

interface CurveControllerConfig {
    axis: CurveAxes;
    grid: CurveGrid;
    target: string | undefined;
    targets: CurveTargetMap;
    value: Value<CurvePoint[]>;
    viewProps: ViewProps;
}

interface CurveEditorElements {
    root: HTMLDivElement;
    panel: HTMLDivElement;
    canvas: HTMLCanvasElement;
    closeButton: HTMLButtonElement;
    yAxisTypeSelect: HTMLSelectElement;
    xAxisTypeSelect: HTMLSelectElement;
    yMinInput: HTMLInputElement;
    yMaxInput: HTMLInputElement;
    xMinInput: HTMLInputElement;
    xMaxInput: HTMLInputElement;
    selectedXInput: HTMLInputElement;
    selectedYInput: HTMLInputElement;
    hint: HTMLParagraphElement;
}

const cn = ClassName('curve');
const STYLE_ID = 'tp-curve-plugin-style';
const CANVAS_PADDING = 12; // Padding in pixels for grid edges

const DEFAULT_AXIS: CurveAxes = {
    x: { min: 0, max: 1, label: 'Throttle Power' },
    y: { min: 0, max: 1, label: 'Volume' },
};

const DEFAULT_GRID: CurveGrid = {
    x: 4,
    y: 4,
};

const DEFAULT_TARGETS: CurveTargetMap = {
    pitch: { x: { min: 0, max: 1 }, y: { min: -90, max: 90 } },
    yaw: { x: { min: 0, max: 1 }, y: { min: -180, max: 180 } },
    roll: { x: { min: 0, max: 1 }, y: { min: -45, max: 45 } },
};

function ensureCurveStyles(doc: Document): void {
    if (doc.getElementById(STYLE_ID)) {
        return;
    }

    const style = doc.createElement('style');
    style.id = STYLE_ID;
    style.textContent = `
.tp-curvev {
    --curve-bg: rgba(30, 36, 46, 0.7);
    --curve-grid: rgba(255, 255, 255, 0.08);
    --curve-border: rgba(255, 255, 255, 0.14);
    --curve-line: #63d5ff;
    --curve-point: #ecf8ff;
    --curve-point-active: #ffb454;
    --curve-grid-label: rgba(255, 255, 255, 0.35);
    --curve-point-label-bg: rgba(10, 14, 20, 0.8);
    --curve-point-label-fg: rgba(255, 255, 255, 0.9);
    --curve-text: rgba(255, 255, 255, 0.7);
    --curve-text-strong: rgba(255, 255, 255, 0.9);
    --curve-button-bg: #2b3442;
    --curve-button-hover: #3a4558;
    display: flex;
    flex-direction: column;
    gap: 6px;
    font-family: inherit;
}
.tp-curvev_preview {
    position: relative;
    height: 72px;
    border-radius: 6px;
    border: 1px solid var(--curve-border);
    background: var(--curve-bg);
    overflow: hidden;
    cursor: pointer;
}
.tp-curvev_canvas {
    width: 100%;
    height: 100%;
    display: block;
    touch-action: none;
}
.tp-curvev_axis {
    position: absolute;
    font-size: 9px;
    line-height: 1;
    color: var(--curve-text);
    pointer-events: none;
}
.tp-curvev_axis-x-min {
    left: 6px;
    bottom: 6px;
}
.tp-curvev_axis-x-max {
    right: 6px;
    bottom: 6px;
}
.tp-curvev_axis-y-min {
    left: 6px;
    top: 50%;
    transform: translateY(10px);
}
.tp-curvev_axis-y-max {
    left: 6px;
    top: 6px;
}
.tp-curvev_preview:focus {
    outline: 2px solid rgba(99, 213, 255, 0.6);
    outline-offset: 2px;
}
.tp-curvev.tp-v-disabled .tp-curvev_preview {
    cursor: default;
}
.tp-curve-overlay {
    position: fixed;
    inset: 0;
    background: rgba(10, 12, 16, 0.75);
    display: flex;
    align-items: center;
    justify-content: center;
    z-index: 2000;
    padding: 20px;
}
.tp-curve-overlay__panel {
    width: min(860px, 95vw);
    max-height: 92vh;
    background: #141923;
    --curve-bg: rgba(20, 26, 35, 0.9);
    --curve-grid: rgba(255, 255, 255, 0.08);
    --curve-line: #63d5ff;
    --curve-point: #eef9ff;
    --curve-point-active: #ffb454;
    border: 1px solid rgba(255, 255, 255, 0.12);
    border-radius: 14px;
    color: #eef2f7;
    display: flex;
    flex-direction: column;
    gap: 14px;
    padding: 16px;
    box-shadow: 0 24px 60px rgba(0, 0, 0, 0.35);
}
.tp-curve-overlay__header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 12px;
}
.tp-curve-overlay__title {
    font-size: 16px;
    font-weight: 600;
    letter-spacing: 0.01em;
}
.tp-curve-overlay__close {
    border: 1px solid rgba(255, 255, 255, 0.2);
    background: rgba(255, 255, 255, 0.08);
    color: #f5f7fb;
    border-radius: 6px;
    padding: 6px 12px;
    cursor: pointer;
}
.tp-curve-overlay__canvas {
    width: 100%;
    height: 360px;
    border-radius: 12px;
    border: 1px solid rgba(255, 255, 255, 0.12);
    background: rgba(22, 27, 36, 0.9);
    display: block;
    touch-action: none;
}
.tp-curve-overlay__controls {
    display: grid;
    grid-template-columns: repeat(4, 1fr);
    gap: 12px 10px;
}
.tp-curve-overlay__controls > label:nth-child(1),
.tp-curve-overlay__controls > label:nth-child(2) {
    grid-column: span 2;
}
.tp-curve-overlay__field {
    display: flex;
    flex-direction: column;
    gap: 6px;
    font-size: 11px;
    font-weight: 500;
    color: rgba(255, 255, 255, 0.75);
    letter-spacing: 0.01em;
}
.tp-curve-overlay__field input,
.tp-curve-overlay__field select {
    border-radius: 6px;
    border: 1px solid rgba(255, 255, 255, 0.16);
    background: rgba(15, 19, 26, 0.9);
    color: #f0f4f8;
    padding: 7px 10px;
    font-size: 12px;
    transition: border-color 0.15s ease;
}
.tp-curve-overlay__field input:focus,
.tp-curve-overlay__field select:focus {
    outline: none;
    border-color: rgba(99, 213, 255, 0.5);
}
.tp-curve-overlay__field select {
    cursor: pointer;
    font-weight: 500;
}
.tp-curve-overlay__hint {
    margin: 0;
    font-size: 12px;
    color: rgba(255, 255, 255, 0.6);
}
@media (max-width: 640px) {
    .tp-curve-overlay {
        padding: 0;
    }
    .tp-curve-overlay__panel {
        width: 100vw;
        height: 100vh;
        max-height: none;
        border-radius: 0;
    }
    .tp-curve-overlay__canvas {
        height: 280px;
    }
}
`;
    doc.head.appendChild(style);
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return !!value && typeof value === 'object';
}

function parseAxisRange(value: unknown): PartialAxis | undefined {
    if (!isRecord(value)) {
        return undefined;
    }
    const min = typeof value.min === 'number' ? value.min : undefined;
    const max = typeof value.max === 'number' ? value.max : undefined;
    const label = typeof value.label === 'string' ? value.label : undefined;
    if (min === undefined && max === undefined && label === undefined) {
        return undefined;
    }
    return { min, max, label };
}

function parseAxes(value: unknown): PartialAxes | undefined {
    if (!isRecord(value)) {
        return undefined;
    }
    const x = parseAxisRange(value.x);
    const y = parseAxisRange(value.y);
    if (!x && !y) {
        return undefined;
    }
    return { x, y };
}

function parseGrid(value: unknown): PartialGrid | undefined {
    if (!isRecord(value)) {
        return undefined;
    }
    const x = typeof value.x === 'number' ? value.x : undefined;
    const y = typeof value.y === 'number' ? value.y : undefined;
    if (x === undefined && y === undefined) {
        return undefined;
    }
    return { x, y };
}

function parseCurvePoints(value: unknown): CurvePoint[] | undefined {
    if (!Array.isArray(value)) {
        return undefined;
    }
    const points: CurvePoint[] = [];
    for (const entry of value) {
        if (Array.isArray(entry) && entry.length >= 2) {
            const x = entry[0];
            const y = entry[1];
            if (typeof x === 'number' && typeof y === 'number') {
                points.push({ x, y });
                continue;
            }
            return undefined;
        }
        if (isRecord(entry)) {
            const x = entry.x;
            const y = entry.y;
            if (typeof x === 'number' && typeof y === 'number') {
                points.push({ x, y });
                continue;
            }
        }
        return undefined;
    }
    return points;
}

function parseTargets(value: unknown): CurveTargetMap | undefined {
    if (!isRecord(value)) {
        return undefined;
    }
    const targets: CurveTargetMap = {};
    for (const [key, targetValue] of Object.entries(value)) {
        if (!targetValue || typeof targetValue !== 'object') {
            return undefined;
        }
        const axes = parseAxes(targetValue);
        if (!axes || !axes.x || !axes.y) {
            return undefined;
        }
        targets[key] = {
            x: {
                min: axes.x.min ?? DEFAULT_AXIS.x.min,
                max: axes.x.max ?? DEFAULT_AXIS.x.max,
                label: axes.x.label,
            },
            y: {
                min: axes.y.min ?? DEFAULT_AXIS.y.min,
                max: axes.y.max ?? DEFAULT_AXIS.y.max,
                label: axes.y.label,
            },
        };
    }
    return targets;
}

function clamp(value: number, min: number, max: number): number {
    return Math.min(max, Math.max(min, value));
}

function normalizeAxisRange(axis: CurveAxis): CurveAxis {
    let min = Number.isFinite(axis.min) ? axis.min : 0;
    let max = Number.isFinite(axis.max) ? axis.max : min + 1;
    if (min === max) {
        max = min + 1;
    }
    if (min > max) {
        [min, max] = [max, min];
    }
    return { min, max, label: axis.label };
}

function normalizeAxes(axes: CurveAxes): CurveAxes {
    return {
        x: normalizeAxisRange(axes.x),
        y: normalizeAxisRange(axes.y),
    };
}

function resolveTargets(customTargets: CurveTargetMap | undefined): CurveTargetMap {
    return { ...DEFAULT_TARGETS, ...(customTargets ?? {}) };
}

function resolveAxis(
    axis: PartialAxes | undefined,
    target: string | undefined,
    targets: CurveTargetMap
): CurveAxes {
    const targetAxes = target && targets[target] ? targets[target] : DEFAULT_AXIS;
    const merged: CurveAxes = {
        x: { ...targetAxes.x },
        y: { ...targetAxes.y },
    };
    if (axis?.x?.min !== undefined) {
        merged.x.min = axis.x.min;
    }
    if (axis?.x?.max !== undefined) {
        merged.x.max = axis.x.max;
    }
    if (axis?.x?.label !== undefined) {
        merged.x.label = axis.x.label;
    }
    if (axis?.y?.min !== undefined) {
        merged.y.min = axis.y.min;
    }
    if (axis?.y?.max !== undefined) {
        merged.y.max = axis.y.max;
    }
    if (axis?.y?.label !== undefined) {
        merged.y.label = axis.y.label;
    }
    return normalizeAxes(merged);
}

function resolveGrid(grid: PartialGrid | undefined): CurveGrid {
    const x = grid?.x ?? DEFAULT_GRID.x;
    const y = grid?.y ?? DEFAULT_GRID.y;
    return {
        x: Math.max(2, Math.round(x)),
        y: Math.max(2, Math.round(y)),
    };
}

function normalizePoints(points: CurvePoint[], axis: CurveAxes): CurvePoint[] {
    const cleaned = points
        .filter((point) => Number.isFinite(point.x) && Number.isFinite(point.y))
        .map((point) => ({
            x: clamp(point.x, axis.x.min, axis.x.max),
            y: clamp(point.y, axis.y.min, axis.y.max),
        }))
        .sort((a, b) => a.x - b.x);

    if (cleaned.length < 2) {
        return [
            { x: axis.x.min, y: axis.y.min },
            { x: axis.x.max, y: axis.y.max },
        ];
    }
    return cleaned.map((point) => ({ x: point.x, y: point.y }));
}

function curveEquals(a: CurvePoint[], b: CurvePoint[]): boolean {
    if (a === b) {
        return true;
    }
    if (a.length !== b.length) {
        return false;
    }
    for (let i = 0; i < a.length; i += 1) {
        if (a[i].x !== b[i].x || a[i].y !== b[i].y) {
            return false;
        }
    }
    return true;
}

function formatAxisValue(value: number): string {
    const rounded = Math.round(value * 100) / 100;
    if (Number.isInteger(rounded)) {
        return `${rounded}`;
    }
    return rounded.toFixed(2);
}

function toNormalized(value: number, axis: CurveAxis): number {
    const span = axis.max - axis.min;
    if (span === 0) {
        return 0;
    }
    return (value - axis.min) / span;
}

function fromNormalized(value: number, axis: CurveAxis): number {
    return axis.min + value * (axis.max - axis.min);
}

function readCssVar(element: HTMLElement, name: string, fallback: string): string {
    const value = getComputedStyle(element).getPropertyValue(name).trim();
    return value || fallback;
}

function resizeCanvas(canvas: HTMLCanvasElement): { ctx: CanvasRenderingContext2D; width: number; height: number } | null {
    const rect = canvas.getBoundingClientRect();
    const width = Math.max(1, Math.round(rect.width));
    const height = Math.max(1, Math.round(rect.height));
    const dpr = canvas.ownerDocument.defaultView?.devicePixelRatio ?? 1;
    if (canvas.width !== width * dpr || canvas.height !== height * dpr) {
        canvas.width = width * dpr;
        canvas.height = height * dpr;
    }
    const ctx = canvas.getContext('2d');
    if (!ctx) {
        return null;
    }
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    return { ctx, width, height };
}

function distanceToSegment(px: number, py: number, ax: number, ay: number, bx: number, by: number): number {
    const dx = bx - ax;
    const dy = by - ay;
    if (dx === 0 && dy === 0) {
        return Math.hypot(px - ax, py - ay);
    }
    const t = clamp(((px - ax) * dx + (py - ay) * dy) / (dx * dx + dy * dy), 0, 1);
    const sx = ax + t * dx;
    const sy = ay + t * dy;
    return Math.hypot(px - sx, py - sy);
}

class CurveView implements View {
    public readonly element: HTMLElement;
    public readonly previewElement: HTMLElement;
    public readonly canvas: HTMLCanvasElement;
    public readonly axisLabels: {
        xMin: HTMLSpanElement;
        xMax: HTMLSpanElement;
        yMin: HTMLSpanElement;
        yMax: HTMLSpanElement;
    };

    constructor(doc: Document, config: { viewProps: ViewProps }) {
        this.element = doc.createElement('div');
        this.element.classList.add(cn());
        config.viewProps.bindClassModifiers(this.element);

        const preview = doc.createElement('div');
        preview.classList.add(cn('preview'));
        preview.tabIndex = 0;
        preview.setAttribute('role', 'button');
        this.element.appendChild(preview);
        this.previewElement = preview;

        const canvas = doc.createElement('canvas');
        canvas.classList.add(cn('canvas'));
        preview.appendChild(canvas);
        this.canvas = canvas;

        const xMin = doc.createElement('span');
        xMin.classList.add(cn('axis', 'x-min'));
        preview.appendChild(xMin);

        const xMax = doc.createElement('span');
        xMax.classList.add(cn('axis', 'x-max'));
        preview.appendChild(xMax);

        const yMin = doc.createElement('span');
        yMin.classList.add(cn('axis', 'y-min'));
        preview.appendChild(yMin);

        const yMax = doc.createElement('span');
        yMax.classList.add(cn('axis', 'y-max'));
        preview.appendChild(yMax);

        this.axisLabels = { xMin, xMax, yMin, yMax };

        config.viewProps.bindTabIndex(preview);
    }
}

type AxisEmitterEvents = {
    change: { axis: CurveAxes };
};

class CurveController implements ValueController<CurvePoint[], CurveView> {
    public readonly value: Value<CurvePoint[]>;
    public readonly view: CurveView;
    public readonly viewProps: ViewProps;
    public readonly axisEmitter = new Emitter<AxisEmitterEvents>();

    private axis: CurveAxes;
    private grid: CurveGrid;
    private target: string | undefined;
    private targets: CurveTargetMap;
    private editor: CurveEditorElements | null = null;
    private editorDocument: Document | null = null;
    private dragIndex: number | null = null;
    private dragMoved = false;
    private lastTapTime = 0;
    private lastTapPoint: { x: number; y: number } | null = null;
    private resizeObserver: ResizeObserver | null = null;
    private selectedIndex: number | null = null;

    private readonly onValueChange: () => void;
    private readonly onPreviewClick: () => void;
    private readonly onPreviewKeydown: (ev: KeyboardEvent) => void;
    private onEditorKeydown: ((ev: KeyboardEvent) => void) | null = null;

    constructor(doc: Document, config: CurveControllerConfig) {
        ensureCurveStyles(doc);
        this.value = config.value;
        this.viewProps = config.viewProps;
        this.axis = config.axis;
        this.grid = config.grid;
        this.target = config.target;
        this.targets = config.targets;

        this.view = new CurveView(doc, { viewProps: config.viewProps });
        this.syncAxisLabels();
        this.renderPreview();

        this.onValueChange = () => {
            this.ensureSelectedIndex();
            this.syncSelectedInputs();
            this.renderPreview();
            this.renderEditor();
        };
        this.onPreviewClick = () => {
            if (!this.viewProps.get('disabled')) {
                this.openEditor(doc);
            }
        };
        this.onPreviewKeydown = (ev: KeyboardEvent) => {
            if (ev.key === 'Enter' || ev.key === ' ') {
                ev.preventDefault();
                this.onPreviewClick();
            }
        };

        this.value.emitter.on('change', this.onValueChange);
        this.view.previewElement.addEventListener('click', this.onPreviewClick);
        this.view.previewElement.addEventListener('keydown', this.onPreviewKeydown);

        if (typeof ResizeObserver !== 'undefined') {
            this.resizeObserver = new ResizeObserver(() => {
                this.renderPreview();
            });
            this.resizeObserver.observe(this.view.previewElement);
        } else {
            const raf = doc.defaultView?.requestAnimationFrame;
            if (raf) {
                raf(() => this.renderPreview());
            } else {
                this.renderPreview();
            }
        }

        this.viewProps.handleDispose(() => {
            this.dispose();
        });
    }

    public getAxis(): CurveAxes {
        return {
            x: { ...this.axis.x },
            y: { ...this.axis.y },
        };
    }

    public getTarget(): string | undefined {
        return this.target;
    }

    public setAxis(axis: CurveAxes): void {
        this.axis = normalizeAxes(axis);
        this.applyAxisUpdate();
        this.axisEmitter.emit('change', { axis: this.axis });
    }

    public setTarget(target: string | undefined): void {
        this.target = target;
        if (target && this.targets[target]) {
            this.axis = normalizeAxes(this.targets[target]);
            this.applyAxisUpdate();
        } else {
            this.syncAxisLabels();
            this.renderPreview();
            this.renderEditor();
        }
        this.updateEditorTitle();
    }

    public setPoints(points: CurvePoint[]): void {
        const normalized = normalizePoints(points, this.axis);
        this.value.rawValue = normalized;
    }

    private dispose(): void {
        this.value.emitter.off('change', this.onValueChange);
        this.view.previewElement.removeEventListener('click', this.onPreviewClick);
        this.view.previewElement.removeEventListener('keydown', this.onPreviewKeydown);
        if (this.resizeObserver) {
            this.resizeObserver.disconnect();
            this.resizeObserver = null;
        }
        this.destroyEditor();
    }

    private applyAxisUpdate(): void {
        this.syncAxisLabels();
        this.syncEditorInputs();
        this.value.rawValue = normalizePoints(this.value.rawValue, this.axis);
        this.renderPreview();
        this.renderEditor();
    }

    private syncAxisLabels(): void {
        const xLabel = this.axis.x.label ? `${this.axis.x.label}: ` : '';
        const yLabel = this.axis.y.label ? `${this.axis.y.label}: ` : '';
        this.view.axisLabels.xMin.textContent = `${xLabel}${formatAxisValue(this.axis.x.min)}`;
        this.view.axisLabels.xMax.textContent = `${xLabel}${formatAxisValue(this.axis.x.max)}`;
        this.view.axisLabels.yMin.textContent = `${yLabel}${formatAxisValue(this.axis.y.min)}`;
        this.view.axisLabels.yMax.textContent = `${yLabel}${formatAxisValue(this.axis.y.max)}`;
    }

    private syncEditorInputs(): void {
        if (!this.editor) {
            return;
        }
        this.editor.xMinInput.value = `${this.axis.x.min}`;
        this.editor.xMaxInput.value = `${this.axis.x.max}`;
        this.editor.yMinInput.value = `${this.axis.y.min}`;
        this.editor.yMaxInput.value = `${this.axis.y.max}`;
        if (this.axis.x.label) {
            this.editor.xAxisTypeSelect.value = this.axis.x.label;
        }
        if (this.axis.y.label) {
            this.editor.yAxisTypeSelect.value = this.axis.y.label;
        }
        this.syncSelectedInputs();
    }

    private syncSelectedInputs(): void {
        if (!this.editor) {
            return;
        }
        const points = this.value.rawValue;
        const index = this.selectedIndex;
        if (index === null || !points[index]) {
            this.editor.selectedXInput.value = '';
            this.editor.selectedYInput.value = '';
            this.editor.selectedXInput.disabled = true;
            this.editor.selectedYInput.disabled = true;
            return;
        }
        this.editor.selectedXInput.disabled = false;
        this.editor.selectedYInput.disabled = false;
        // Round to 2 decimal places for display
        this.editor.selectedXInput.value = `${Math.round(points[index].x * 100) / 100}`;
        this.editor.selectedYInput.value = `${Math.round(points[index].y * 100) / 100}`;
    }

    private openEditor(doc: Document): void {
        if (!this.editor) {
            this.editor = this.createEditor(doc);
        }
        this.editor.root.style.display = 'flex';
        this.syncEditorInputs();
        this.renderEditor();
    }

    private destroyEditor(): void {
        if (!this.editor) {
            return;
        }
        if (this.onEditorKeydown) {
            this.editorDocument?.removeEventListener('keydown', this.onEditorKeydown);
            this.onEditorKeydown = null;
        }
        this.editor.root.remove();
        this.editor = null;
        this.editorDocument = null;
    }

    private closeEditor(): void {
        if (!this.editor) {
            return;
        }
        this.editor.root.style.display = 'none';
        this.dragIndex = null;
        this.dragMoved = false;
    }

    private createEditor(doc: Document): CurveEditorElements {
        const root = doc.createElement('div');
        root.classList.add('tp-curve-overlay');

        const panel = doc.createElement('div');
        panel.classList.add('tp-curve-overlay__panel');
        root.appendChild(panel);

        const header = doc.createElement('div');
        header.classList.add('tp-curve-overlay__header');
        panel.appendChild(header);

        const title = doc.createElement('div');
        title.classList.add('tp-curve-overlay__title');
        title.textContent = this.target ? `Curve Editor · ${this.target}` : 'Curve Editor';
        header.appendChild(title);

        const closeButton = doc.createElement('button');
        closeButton.type = 'button';
        closeButton.classList.add('tp-curve-overlay__close');
        closeButton.textContent = 'Done';
        header.appendChild(closeButton);

        const canvas = doc.createElement('canvas');
        canvas.classList.add('tp-curve-overlay__canvas');
        panel.appendChild(canvas);

        const controls = doc.createElement('div');
        controls.classList.add('tp-curve-overlay__controls');
        panel.appendChild(controls);

        const yAxisTypeSelect = this.createAxisTypeSelect(doc, controls, 'Target (Y)', ['Volume', 'Pitch']);
        const xAxisTypeSelect = this.createAxisTypeSelect(doc, controls, 'Input (X)', ['Throttle Power', 'Velocity (m/s)', 'Brake Power']);

        const yMinInput = this.createNumberField(doc, controls, 'Y Min', '0.01');
        const yMaxInput = this.createNumberField(doc, controls, 'Y Max', '0.01');
        const xMinInput = this.createNumberField(doc, controls, 'X Min', '0.01');
        const xMaxInput = this.createNumberField(doc, controls, 'X Max', '0.01');

        const selectedYInput = this.createNumberField(doc, controls, 'Selected Point Y', '0.01');
        const selectedXInput = this.createNumberField(doc, controls, 'Selected Point X', '0.01');

        const hint = doc.createElement('p');
        hint.classList.add('tp-curve-overlay__hint');
        hint.textContent = 'Tap a node to select. Double-tap a node to delete. Double-tap the line to add a new node.';
        panel.appendChild(hint);

        root.addEventListener('click', (ev) => {
            if (ev.target === root) {
                this.closeEditor();
            }
        });

        closeButton.addEventListener('click', () => {
            this.closeEditor();
        });

        this.onEditorKeydown = (ev: KeyboardEvent) => {
            if (ev.key === 'Escape') {
                this.closeEditor();
            }
        };
        doc.addEventListener('keydown', this.onEditorKeydown);
        this.editorDocument = doc;

        const onPointerDown = (ev: PointerEvent) => {
            this.onEditorPointerDown(ev);
        };
        const onPointerMove = (ev: PointerEvent) => {
            this.onEditorPointerMove(ev);
        };
        const onPointerUp = (ev: PointerEvent) => {
            this.onEditorPointerUp(ev);
        };
        const onDoubleClick = (ev: MouseEvent) => {
            this.onEditorDoubleClick(ev);
        };

        canvas.addEventListener('pointerdown', onPointerDown);
        canvas.addEventListener('pointermove', onPointerMove);
        canvas.addEventListener('pointerup', onPointerUp);
        canvas.addEventListener('pointercancel', onPointerUp);
        canvas.addEventListener('dblclick', onDoubleClick);

        const onAxisInput = () => {
            this.onAxisInputChange();
        };

        xMinInput.addEventListener('change', onAxisInput);
        xMaxInput.addEventListener('change', onAxisInput);
        yMinInput.addEventListener('change', onAxisInput);
        yMaxInput.addEventListener('change', onAxisInput);

        const onAxisTypeChange = () => {
            this.onAxisTypeChange();
        };
        xAxisTypeSelect.addEventListener('change', onAxisTypeChange);
        yAxisTypeSelect.addEventListener('change', onAxisTypeChange);

        const onSelectedInput = () => {
            this.onSelectedInputChange();
        };
        selectedXInput.addEventListener('change', onSelectedInput);
        selectedYInput.addEventListener('change', onSelectedInput);

        doc.body.appendChild(root);

        return {
            root,
            panel,
            canvas,
            closeButton,
            yAxisTypeSelect,
            xAxisTypeSelect,
            yMinInput,
            yMaxInput,
            xMinInput,
            xMaxInput,
            selectedXInput,
            selectedYInput,
            hint,
        };
    }

    private createAxisTypeSelect(doc: Document, controls: HTMLElement, label: string, options: string[]): HTMLSelectElement {
        const field = doc.createElement('label');
        field.classList.add('tp-curve-overlay__field');
        field.textContent = label;
        const select = doc.createElement('select');
        options.forEach((option) => {
            const optionEl = doc.createElement('option');
            optionEl.value = option;
            optionEl.textContent = option;
            select.appendChild(optionEl);
        });
        field.appendChild(select);
        controls.appendChild(field);
        return select;
    }

    private createNumberField(doc: Document, controls: HTMLElement, label: string, step: string = '0.01'): HTMLInputElement {
        const field = doc.createElement('label');
        field.classList.add('tp-curve-overlay__field');
        field.textContent = label;
        const input = doc.createElement('input');
        input.type = 'number';
        input.step = step;
        input.inputMode = 'decimal';
        field.appendChild(input);
        controls.appendChild(field);
        return input;
    }

    private onAxisInputChange(): void {
        if (!this.editor) {
            return;
        }
        const axis = this.getAxis();
        const xMinRaw = this.editor.xMinInput.value.trim();
        const xMaxRaw = this.editor.xMaxInput.value.trim();
        const yMinRaw = this.editor.yMinInput.value.trim();
        const yMaxRaw = this.editor.yMaxInput.value.trim();
        const xMin = xMinRaw === '' ? null : Number(xMinRaw);
        const xMax = xMaxRaw === '' ? null : Number(xMaxRaw);
        const yMin = yMinRaw === '' ? null : Number(yMinRaw);
        const yMax = yMaxRaw === '' ? null : Number(yMaxRaw);
        if (xMin !== null && Number.isFinite(xMin)) {
            axis.x.min = xMin;
        }
        if (xMax !== null && Number.isFinite(xMax)) {
            axis.x.max = xMax;
        }
        if (yMin !== null && Number.isFinite(yMin)) {
            axis.y.min = yMin;
        }
        if (yMax !== null && Number.isFinite(yMax)) {
            axis.y.max = yMax;
        }
        this.target = undefined;
        this.updateEditorTitle();
        this.setAxis(axis);
    }

    private onAxisTypeChange(): void {
        if (!this.editor) {
            return;
        }
        const axis = this.getAxis();
        const xAxisType = this.editor.xAxisTypeSelect.value as HorizontalAxisType;
        const yAxisType = this.editor.yAxisTypeSelect.value as VerticalAxisType;

        // Apply default ranges when axis type changes
        const xDefaults = AXIS_DEFAULTS[xAxisType];
        const yDefaults = AXIS_DEFAULTS[yAxisType];

        axis.x.label = xAxisType;
        axis.x.min = xDefaults.min;
        axis.x.max = xDefaults.max;

        axis.y.label = yAxisType;
        axis.y.min = yDefaults.min;
        axis.y.max = yDefaults.max;

        this.setAxis(axis);
    }

    private onSelectedInputChange(): void {
        if (!this.editor || this.selectedIndex === null) {
            return;
        }
        const points = this.value.rawValue;
        const point = points[this.selectedIndex];
        if (!point) {
            return;
        }
        const xRaw = this.editor.selectedXInput.value.trim();
        const yRaw = this.editor.selectedYInput.value.trim();
        const nextX = xRaw === '' ? null : Number(xRaw);
        const nextY = yRaw === '' ? null : Number(yRaw);
        if (
            (nextX === null || !Number.isFinite(nextX)) &&
            (nextY === null || !Number.isFinite(nextY))
        ) {
            this.syncSelectedInputs();
            return;
        }
        const rangeX = this.axis.x.max - this.axis.x.min;
        const minSpacing = rangeX * 0.002;
        const prevLimit =
            this.selectedIndex > 0 ? points[this.selectedIndex - 1].x + minSpacing : this.axis.x.min;
        const nextLimit =
            this.selectedIndex < points.length - 1
                ? points[this.selectedIndex + 1].x - minSpacing
                : this.axis.x.max;
        const updatedX = nextX !== null && Number.isFinite(nextX) ? nextX : point.x;
        const updatedY = nextY !== null && Number.isFinite(nextY) ? nextY : point.y;
        const nextPoint = {
            x: clamp(updatedX, prevLimit, nextLimit),
            y: clamp(updatedY, this.axis.y.min, this.axis.y.max),
        };
        const nextPoints = points.map((entry, index) =>
            index === this.selectedIndex ? nextPoint : { ...entry }
        );
        this.value.rawValue = nextPoints;
    }

    private ensureSelectedIndex(): void {
        if (this.selectedIndex === null) {
            return;
        }
        if (!this.value.rawValue[this.selectedIndex]) {
            this.selectedIndex = null;
        }
    }

    private updateEditorTitle(): void {
        if (!this.editor) {
            return;
        }
        const title = this.editor.panel.querySelector('.tp-curve-overlay__title');
        if (title) {
            const yLabel = this.axis.y.label || 'Target';
            const xLabel = this.axis.x.label || 'Input';
            title.textContent = `Curve Editor · ${yLabel} vs ${xLabel}`;
        }
    }

    private onEditorPointerDown(ev: PointerEvent): void {
        if (!this.editor || this.viewProps.get('disabled')) {
            return;
        }
        const pos = this.getCanvasPosition(ev, this.editor.canvas);
        const points = this.value.rawValue;
        const index = this.findPointIndex(points, pos, this.editor.canvas, 12);
        if (index !== null) {
            this.dragIndex = index;
            this.dragMoved = false;
            this.editor.canvas.setPointerCapture(ev.pointerId);
            this.selectedIndex = index;
            this.syncSelectedInputs();
            this.renderEditor();
            return;
        }
        this.selectedIndex = null;
        this.syncSelectedInputs();
        this.renderEditor();
    }

    private onEditorPointerMove(ev: PointerEvent): void {
        if (!this.editor || this.dragIndex === null) {
            return;
        }
        ev.preventDefault();
        this.dragMoved = true;
        const pos = this.getCanvasPosition(ev, this.editor.canvas);
        this.updatePointFromCanvas(this.dragIndex, pos, this.editor.canvas);
    }

    private onEditorPointerUp(ev: PointerEvent): void {
        if (!this.editor) {
            return;
        }
        if (this.dragIndex !== null) {
            this.editor.canvas.releasePointerCapture(ev.pointerId);
            this.dragIndex = null;
        }
        if (!this.dragMoved && ev.pointerType === 'touch') {
            const pos = this.getCanvasPosition(ev, this.editor.canvas);
            this.handleTap(pos, this.editor.canvas);
        }
        this.dragMoved = false;
    }

    private onEditorDoubleClick(ev: MouseEvent): void {
        if (!this.editor) {
            return;
        }
        const pos = this.getCanvasPosition(ev, this.editor.canvas);
        this.handleDoubleAction(pos, this.editor.canvas);
    }

    private handleTap(pos: { x: number; y: number }, canvas: HTMLCanvasElement): void {
        const now = performance.now();
        if (this.lastTapPoint) {
            const distance = Math.hypot(pos.x - this.lastTapPoint.x, pos.y - this.lastTapPoint.y);
            if (now - this.lastTapTime < 320 && distance < 14) {
                this.handleDoubleAction(pos, canvas);
                this.lastTapPoint = null;
                this.lastTapTime = 0;
                return;
            }
        }
        this.lastTapPoint = pos;
        this.lastTapTime = now;
    }

    private handleDoubleAction(pos: { x: number; y: number }, canvas: HTMLCanvasElement): void {
        const points = this.value.rawValue;
        const hitIndex = this.findPointIndex(points, pos, canvas, 10);
        if (hitIndex !== null) {
            if (points.length <= 2) {
                return;
            }
            const next = points.filter((_, index) => index !== hitIndex);
            this.value.rawValue = next;
            if (this.selectedIndex !== null) {
                if (this.selectedIndex === hitIndex) {
                    this.selectedIndex = null;
                } else if (this.selectedIndex > hitIndex) {
                    this.selectedIndex -= 1;
                }
                this.syncSelectedInputs();
            }
            return;
        }
        if (!this.isNearLine(points, pos, canvas, 10)) {
            return;
        }
        const valuePos = this.canvasToValue(pos, canvas);
        const nextPoints = [...points, valuePos].sort((a, b) => a.x - b.x);
        const insertedIndex = nextPoints.findIndex((point) => point === valuePos);
        this.value.rawValue = nextPoints;
        if (insertedIndex !== -1) {
            this.selectedIndex = insertedIndex;
            this.syncSelectedInputs();
        }
    }

    private updatePointFromCanvas(index: number, pos: { x: number; y: number }, canvas: HTMLCanvasElement): void {
        const points = this.value.rawValue;
        const valuePos = this.canvasToValue(pos, canvas);
        const rangeX = this.axis.x.max - this.axis.x.min;
        const minSpacing = rangeX * 0.002;
        const minX = index > 0 ? points[index - 1].x + minSpacing : this.axis.x.min;
        const maxX = index < points.length - 1 ? points[index + 1].x - minSpacing : this.axis.x.max;
        const nextPoint = {
            x: clamp(valuePos.x, minX, maxX),
            y: clamp(valuePos.y, this.axis.y.min, this.axis.y.max),
        };
        const next = points.map((point, i) => (i === index ? nextPoint : { ...point }));
        this.value.rawValue = next;
    }

    private canvasToValue(pos: { x: number; y: number }, canvas: HTMLCanvasElement): CurvePoint {
        const rect = canvas.getBoundingClientRect();
        const padding = CANVAS_PADDING;
        const gridWidth = rect.width - padding * 2;
        const gridHeight = rect.height - padding * 2;
        const normX = clamp((pos.x - padding) / gridWidth, 0, 1);
        const normY = clamp((pos.y - padding) / gridHeight, 0, 1);
        return {
            x: fromNormalized(normX, this.axis.x),
            y: fromNormalized(1 - normY, this.axis.y),
        };
    }

    private getCanvasPosition(
        ev: { clientX: number; clientY: number },
        canvas: HTMLCanvasElement
    ): { x: number; y: number } {
        const rect = canvas.getBoundingClientRect();
        return {
            x: clamp(ev.clientX - rect.left, 0, rect.width),
            y: clamp(ev.clientY - rect.top, 0, rect.height),
        };
    }

    private findPointIndex(
        points: CurvePoint[],
        pos: { x: number; y: number },
        canvas: HTMLCanvasElement,
        radius: number
    ): number | null {
        const rect = canvas.getBoundingClientRect();
        const padding = CANVAS_PADDING;
        const gridWidth = rect.width - padding * 2;
        const gridHeight = rect.height - padding * 2;
        for (let i = 0; i < points.length; i += 1) {
            const x = padding + toNormalized(points[i].x, this.axis.x) * gridWidth;
            const y = padding + (1 - toNormalized(points[i].y, this.axis.y)) * gridHeight;
            if (Math.hypot(pos.x - x, pos.y - y) <= radius) {
                return i;
            }
        }
        return null;
    }

    private isNearLine(
        points: CurvePoint[],
        pos: { x: number; y: number },
        canvas: HTMLCanvasElement,
        threshold: number
    ): boolean {
        if (points.length < 2) {
            return false;
        }
        const rect = canvas.getBoundingClientRect();
        const padding = CANVAS_PADDING;
        const gridWidth = rect.width - padding * 2;
        const gridHeight = rect.height - padding * 2;
        for (let i = 0; i < points.length - 1; i += 1) {
            const ax = padding + toNormalized(points[i].x, this.axis.x) * gridWidth;
            const ay = padding + (1 - toNormalized(points[i].y, this.axis.y)) * gridHeight;
            const bx = padding + toNormalized(points[i + 1].x, this.axis.x) * gridWidth;
            const by = padding + (1 - toNormalized(points[i + 1].y, this.axis.y)) * gridHeight;
            if (distanceToSegment(pos.x, pos.y, ax, ay, bx, by) <= threshold) {
                return true;
            }
        }
        return false;
    }

    private renderPreview(): void {
        const result = resizeCanvas(this.view.canvas);
        if (!result) {
            return;
        }
        const { ctx, width, height } = result;
        const colors = this.getPalette(this.view.element);

        ctx.clearRect(0, 0, width, height);
        ctx.fillStyle = colors.background;
        ctx.fillRect(0, 0, width, height);

        this.drawGrid(ctx, width, height, colors.grid, 4, 3);
        this.drawCurve(ctx, width, height, colors, false);
    }

    private renderEditor(): void {
        if (!this.editor) {
            return;
        }
        const result = resizeCanvas(this.editor.canvas);
        if (!result) {
            return;
        }
        const { ctx, width, height } = result;
        const colors = this.getPalette(this.editor.panel);
        ctx.clearRect(0, 0, width, height);
        ctx.fillStyle = colors.background;
        ctx.fillRect(0, 0, width, height);
        this.drawGrid(
            ctx,
            width,
            height,
            colors.grid,
            this.grid.x,
            this.grid.y,
            this.axis,
            colors.gridLabel,
            colors.fontFamily
        );
        this.drawCurve(ctx, width, height, colors, true);
    }

    private drawGrid(
        ctx: CanvasRenderingContext2D,
        width: number,
        height: number,
        color: string,
        columns: number,
        rows: number,
        axis?: CurveAxes,
        labelColor?: string,
        fontFamily?: string
    ): void {
        const padding = CANVAS_PADDING;
        const gridWidth = width - padding * 2;
        const gridHeight = height - padding * 2;

        ctx.strokeStyle = color;
        ctx.lineWidth = 1;
        ctx.beginPath();
        for (let i = 1; i < columns; i += 1) {
            const x = padding + (gridWidth / columns) * i;
            ctx.moveTo(x, padding);
            ctx.lineTo(x, height - padding);
        }
        for (let i = 1; i < rows; i += 1) {
            const y = padding + (gridHeight / rows) * i;
            ctx.moveTo(padding, y);
            ctx.lineTo(width - padding, y);
        }
        ctx.stroke();

        if (!axis || !labelColor) {
            return;
        }

        const font = fontFamily ? `10px ${fontFamily}` : '10px sans-serif';
        ctx.fillStyle = labelColor;
        ctx.font = font;

        for (let i = 0; i <= columns; i += 1) {
            const value = axis.x.min + ((axis.x.max - axis.x.min) * i) / columns;
            const text = formatAxisValue(value);
            const x = padding + (gridWidth / columns) * i;
            ctx.textBaseline = 'bottom';
            if (i === 0) {
                ctx.textAlign = 'left';
                ctx.fillText(text, x, height - 4);
            } else if (i === columns) {
                ctx.textAlign = 'right';
                ctx.fillText(text, x, height - 4);
            } else {
                ctx.textAlign = 'center';
                ctx.fillText(text, x, height - 4);
            }
        }

        for (let i = 0; i <= rows; i += 1) {
            const value = axis.y.max - ((axis.y.max - axis.y.min) * i) / rows;
            const text = formatAxisValue(value);
            const y = padding + (gridHeight / rows) * i;
            if (i === 0) {
                ctx.textBaseline = 'top';
                ctx.textAlign = 'left';
                ctx.fillText(text, 4, y);
            } else if (i === rows) {
                ctx.textBaseline = 'bottom';
                ctx.textAlign = 'left';
                ctx.fillText(text, 4, y);
            } else {
                ctx.textBaseline = 'middle';
                ctx.textAlign = 'left';
                ctx.fillText(text, 4, y);
            }
        }
    }

    private drawCurve(
        ctx: CanvasRenderingContext2D,
        width: number,
        height: number,
        colors: {
            line: string;
            point: string;
            pointActive: string;
            pointLabelBg: string;
            pointLabelText: string;
            fontFamily: string;
        },
        drawPoints: boolean
    ): void {
        const points = this.value.rawValue;
        if (points.length === 0) {
            return;
        }

        const padding = CANVAS_PADDING;
        const gridWidth = width - padding * 2;
        const gridHeight = height - padding * 2;

        const first = points[0];
        const last = points[points.length - 1];
        const firstX = padding + toNormalized(first.x, this.axis.x) * gridWidth;
        const firstY = padding + (1 - toNormalized(first.y, this.axis.y)) * gridHeight;
        const lastX = padding + toNormalized(last.x, this.axis.x) * gridWidth;
        const lastY = padding + (1 - toNormalized(last.y, this.axis.y)) * gridHeight;

        ctx.strokeStyle = colors.line;
        ctx.lineWidth = 2;
        ctx.beginPath();
        if (firstX > padding) {
            ctx.moveTo(padding, firstY);
            ctx.lineTo(firstX, firstY);
        } else {
            ctx.moveTo(firstX, firstY);
        }
        for (let i = 1; i < points.length; i += 1) {
            const x = padding + toNormalized(points[i].x, this.axis.x) * gridWidth;
            const y = padding + (1 - toNormalized(points[i].y, this.axis.y)) * gridHeight;
            ctx.lineTo(x, y);
        }
        if (lastX < width - padding) {
            ctx.lineTo(width - padding, lastY);
        }
        ctx.stroke();

        if (!drawPoints) {
            return;
        }
        const activeIndex = this.dragIndex ?? this.selectedIndex;
        points.forEach((point, index) => {
            const x = padding + toNormalized(point.x, this.axis.x) * gridWidth;
            const y = padding + (1 - toNormalized(point.y, this.axis.y)) * gridHeight;
            ctx.fillStyle = index === activeIndex ? colors.pointActive : colors.point;
            ctx.beginPath();
            ctx.arc(x, y, 5, 0, Math.PI * 2);
            ctx.fill();
        });

        if (this.selectedIndex !== null && points[this.selectedIndex]) {
            this.drawPointLabel(ctx, width, height, points[this.selectedIndex], colors);
        }
    }

    private drawPointLabel(
        ctx: CanvasRenderingContext2D,
        width: number,
        height: number,
        point: CurvePoint,
        colors: {
            pointLabelBg: string;
            pointLabelText: string;
            fontFamily: string;
        }
    ): void {
        const padding = CANVAS_PADDING;
        const gridWidth = width - padding * 2;
        const gridHeight = height - padding * 2;

        const x = padding + toNormalized(point.x, this.axis.x) * gridWidth;
        const y = padding + (1 - toNormalized(point.y, this.axis.y)) * gridHeight;
        const text = `x: ${formatAxisValue(point.x)}, y: ${formatAxisValue(point.y)}`;
        ctx.font = `11px ${colors.fontFamily}`;
        const metrics = ctx.measureText(text);
        const labelPadding = 6;
        const boxWidth = metrics.width + labelPadding * 2;
        const boxHeight = 18;
        let boxX = x - boxWidth / 2;
        let boxY = y - boxHeight - 10;
        if (boxX < padding) {
            boxX = padding;
        }
        if (boxX + boxWidth > width - padding) {
            boxX = width - boxWidth - padding;
        }
        if (boxY < padding) {
            boxY = y + 12;
        }
        ctx.fillStyle = colors.pointLabelBg;
        const roundRect = (
            ctx as CanvasRenderingContext2D & {
                roundRect?: (x: number, y: number, w: number, h: number, r: number) => void;
            }
        ).roundRect;
        if (roundRect) {
            ctx.beginPath();
            roundRect.call(ctx, boxX, boxY, boxWidth, boxHeight, 6);
            ctx.fill();
        } else {
            const radius = 6;
            ctx.beginPath();
            ctx.moveTo(boxX + radius, boxY);
            ctx.lineTo(boxX + boxWidth - radius, boxY);
            ctx.quadraticCurveTo(boxX + boxWidth, boxY, boxX + boxWidth, boxY + radius);
            ctx.lineTo(boxX + boxWidth, boxY + boxHeight - radius);
            ctx.quadraticCurveTo(
                boxX + boxWidth,
                boxY + boxHeight,
                boxX + boxWidth - radius,
                boxY + boxHeight
            );
            ctx.lineTo(boxX + radius, boxY + boxHeight);
            ctx.quadraticCurveTo(boxX, boxY + boxHeight, boxX, boxY + boxHeight - radius);
            ctx.lineTo(boxX, boxY + radius);
            ctx.quadraticCurveTo(boxX, boxY, boxX + radius, boxY);
            ctx.closePath();
            ctx.fill();
        }
        ctx.fillStyle = colors.pointLabelText;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(text, boxX + boxWidth / 2, boxY + boxHeight / 2 + 0.5);
    }

    private getPalette(element: HTMLElement): {
        background: string;
        grid: string;
        gridLabel: string;
        line: string;
        point: string;
        pointActive: string;
        pointLabelBg: string;
        pointLabelText: string;
        fontFamily: string;
    } {
        const computed = getComputedStyle(element);
        return {
            background: readCssVar(element, '--curve-bg', '#1f2531'),
            grid: readCssVar(element, '--curve-grid', 'rgba(255,255,255,0.1)'),
            gridLabel: readCssVar(element, '--curve-grid-label', 'rgba(255,255,255,0.35)'),
            line: readCssVar(element, '--curve-line', '#61d2ff'),
            point: readCssVar(element, '--curve-point', '#eef9ff'),
            pointActive: readCssVar(element, '--curve-point-active', '#ffb454'),
            pointLabelBg: readCssVar(element, '--curve-point-label-bg', 'rgba(10, 14, 20, 0.8)'),
            pointLabelText: readCssVar(element, '--curve-point-label-fg', '#f5f7fb'),
            fontFamily: computed.fontFamily || 'sans-serif',
        };
    }
}

export interface CurveBladeApiEvents {
    change: {
        event: TpChangeEvent<CurvePoint[]>;
    };
    axischange: {
        axis: CurveAxes;
    };
}

export class CurveBladeApi extends BladeApi<LabeledValueBladeController<CurvePoint[], CurveController>> {
    get label(): string | null | undefined {
        return this.controller.labelController.props.get('label');
    }

    set label(label: string | null | undefined) {
        this.controller.labelController.props.set('label', label);
    }

    get value(): CurvePoint[] {
        return this.controller.valueController.value.rawValue;
    }

    set value(value: CurvePoint[]) {
        this.controller.valueController.setPoints(value);
    }

    get axis(): CurveAxes {
        return this.controller.valueController.getAxis();
    }

    set axis(axis: CurveAxes) {
        this.controller.valueController.setAxis(axis);
    }

    get target(): string | undefined {
        return this.controller.valueController.getTarget();
    }

    set target(target: string | undefined) {
        this.controller.valueController.setTarget(target);
    }

    on<EventName extends keyof CurveBladeApiEvents>(
        eventName: EventName,
        handler: EventName extends 'change'
            ? (ev: CurveBladeApiEvents[EventName]['event']) => void
            : (ev: CurveBladeApiEvents[EventName]) => void
    ): this {
        const boundHandler = handler.bind(this);

        if (eventName === 'change') {
            this.controller.valueController.value.emitter.on(eventName as 'change', (ev) => {
                if ('rawValue' in ev && 'options' in ev) {
                    boundHandler(new TpChangeEvent(this, ev.rawValue, ev.options.last) as any);
                }
            });
        } else if (eventName === 'axischange') {
            this.controller.valueController.axisEmitter.on('change', (ev) => {
                boundHandler(ev as any);
            });
        }

        return this;
    }
}

export const CurveBladePlugin: BladePlugin<CurveBladeParams> = createPlugin({
    id: 'curve',
    type: 'blade',
    accept(params) {
        const result = parseRecord<CurveBladeParams>(params, (p) => ({
            value: p.required.custom(parseCurvePoints),
            view: p.required.constant('curve'),
            label: p.optional.string,
            target: p.optional.string,
            axis: p.optional.custom(parseAxes),
            grid: p.optional.custom(parseGrid),
            targets: p.optional.custom(parseTargets),
        }));
        return result ? { params: result } : null;
    },
    controller(args) {
        const targets = resolveTargets(args.params.targets);
        const resolvedTarget = args.params.target && targets[args.params.target] ? args.params.target : undefined;
        const axis = resolveAxis(args.params.axis, resolvedTarget, targets);
        const normalized = normalizePoints(args.params.value, axis);
        const value = createValue(normalized, { equals: curveEquals });
        const vc = new CurveController(args.document, {
            axis,
            grid: resolveGrid(args.params.grid),
            target: resolvedTarget,
            targets,
            value,
            viewProps: args.viewProps,
        });
        return new LabeledValueBladeController(args.document, {
            blade: args.blade,
            props: ValueMap.fromObject({
                label: args.params.label ?? undefined,
            }),
            value,
            valueController: vc,
        });
    },
    api(args) {
        if (!(args.controller instanceof LabeledValueBladeController)) {
            return null;
        }
        if (!(args.controller.valueController instanceof CurveController)) {
            return null;
        }
        return new CurveBladeApi(args.controller);
    },
});
