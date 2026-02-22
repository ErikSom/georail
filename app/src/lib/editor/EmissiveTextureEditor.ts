import { CanvasTexture, Mesh, MeshStandardMaterial, Color } from 'three';
import type { EmissiveTextureConfig, EmissiveShape } from '../train/TrainConfig';
import { renderEmissiveTexture, compositeEmissiveWithDiffuse } from './EmissiveTextureRenderer';

type Tool = 'polygon' | 'circle';

const CANVAS_DISPLAY_SIZE = 512;
const CLOSE_THRESHOLD = 0.02; // normalized distance to close polygon

export class EmissiveTextureEditor {
    private key: string;
    private onSave: (config: EmissiveTextureConfig) => void;
    private meshes: Mesh[];

    // DOM
    private overlay: HTMLDivElement | null = null;
    private drawingCanvas!: HTMLCanvasElement;
    private drawingCtx!: CanvasRenderingContext2D;
    private previewCanvas!: HTMLCanvasElement;

    // Reference texture (diffuse map from mesh, drawn as faded background)
    private referenceImage: HTMLCanvasElement | null;

    // State
    private tool: Tool = 'polygon';
    private shapes: EmissiveShape[];
    private blur: number;
    private resolution: number;
    private color: number;
    private intensity: number;

    // In-progress polygon
    private polyPoints: { x: number; y: number }[] = [];

    // In-progress circle
    private circleCenter: { x: number; y: number } | null = null;
    private circleCurrent: { x: number; y: number } | null = null;
    private isDragging = false;

    // Tool buttons for active state styling
    private polygonBtn!: HTMLButtonElement;
    private circleBtn!: HTMLButtonElement;

    constructor(
        key: string,
        initialConfig: EmissiveTextureConfig | undefined,
        meshes: Mesh[],
        referenceImage: HTMLCanvasElement | null,
        lightColor: number,
        onSave: (config: EmissiveTextureConfig) => void
    ) {
        this.key = key;
        this.meshes = meshes;
        this.referenceImage = referenceImage;
        this.onSave = onSave;
        this.shapes = initialConfig ? [...initialConfig.shapes.map(s => ({ ...s }))] : [];
        this.blur = initialConfig?.blur ?? 0;
        this.resolution = initialConfig?.resolution ?? 512;
        this.color = initialConfig?.color ?? lightColor;
        this.intensity = initialConfig?.intensity ?? 0.5;
    }

    public open(): void {
        this.overlay = this.createOverlay();
        document.body.appendChild(this.overlay);
        this.redraw();
        this.updatePreview();
    }

    public close(): void {
        if (this.overlay) {
            document.body.removeChild(this.overlay);
            this.overlay = null;
        }
    }

    // --- DOM creation ---

    private createOverlay(): HTMLDivElement {
        const overlay = document.createElement('div');
        Object.assign(overlay.style, {
            position: 'fixed', top: '0', left: '0', width: '100%', height: '100%',
            backgroundColor: 'rgba(0, 0, 0, 0.7)', display: 'flex',
            alignItems: 'center', justifyContent: 'center', zIndex: '10000',
        });
        overlay.addEventListener('click', (e) => { if (e.target === overlay) this.close(); });

        const dialog = document.createElement('div');
        Object.assign(dialog.style, {
            backgroundColor: '#2a2a2a', padding: '16px', borderRadius: '8px',
            maxWidth: '800px', width: '90%', display: 'flex', flexDirection: 'column',
            gap: '12px', color: '#ffffff', fontFamily: 'monospace', fontSize: '13px',
        });
        dialog.addEventListener('click', (e) => e.stopPropagation());

        // Title
        const title = document.createElement('div');
        title.textContent = `Emissive Texture Editor — ${this.key}`;
        Object.assign(title.style, { fontSize: '15px', fontWeight: 'bold' });
        dialog.appendChild(title);

        // Toolbar
        dialog.appendChild(this.createToolbar());

        // Canvas area
        const canvasRow = document.createElement('div');
        Object.assign(canvasRow.style, { display: 'flex', gap: '12px', justifyContent: 'center', flexWrap: 'wrap' });

        // Drawing canvas
        const drawingWrapper = document.createElement('div');
        const drawingLabel = document.createElement('div');
        drawingLabel.textContent = 'Draw';
        Object.assign(drawingLabel.style, { marginBottom: '4px', textAlign: 'center', opacity: '0.6' });
        drawingWrapper.appendChild(drawingLabel);

        this.drawingCanvas = document.createElement('canvas');
        this.drawingCanvas.width = CANVAS_DISPLAY_SIZE;
        this.drawingCanvas.height = CANVAS_DISPLAY_SIZE;
        Object.assign(this.drawingCanvas.style, {
            border: '1px solid #555', cursor: 'crosshair', background: '#1a1a1a',
            width: `${CANVAS_DISPLAY_SIZE}px`, height: `${CANVAS_DISPLAY_SIZE}px`,
        });
        this.drawingCtx = this.drawingCanvas.getContext('2d')!;
        this.setupCanvasEvents();
        drawingWrapper.appendChild(this.drawingCanvas);
        canvasRow.appendChild(drawingWrapper);

        // Preview canvas
        const previewWrapper = document.createElement('div');
        const previewLabel = document.createElement('div');
        previewLabel.textContent = 'Result';
        Object.assign(previewLabel.style, { marginBottom: '4px', textAlign: 'center', opacity: '0.6' });
        previewWrapper.appendChild(previewLabel);

        this.previewCanvas = document.createElement('canvas');
        this.previewCanvas.width = 256;
        this.previewCanvas.height = 256;
        Object.assign(this.previewCanvas.style, {
            border: '1px solid #555', background: '#000',
            width: '256px', height: '256px',
        });
        previewWrapper.appendChild(this.previewCanvas);
        canvasRow.appendChild(previewWrapper);

        dialog.appendChild(canvasRow);

        // Bottom buttons
        const btnRow = document.createElement('div');
        Object.assign(btnRow.style, { display: 'flex', gap: '8px', justifyContent: 'flex-end' });

        const cancelBtn = this.makeButton('Cancel', '#666');
        cancelBtn.addEventListener('click', () => this.close());
        btnRow.appendChild(cancelBtn);

        const saveBtn = this.makeButton('Save', '#4CAF50');
        saveBtn.addEventListener('click', () => this.save());
        btnRow.appendChild(saveBtn);

        dialog.appendChild(btnRow);
        overlay.appendChild(dialog);
        return overlay;
    }

    private createToolbar(): HTMLDivElement {
        const toolbar = document.createElement('div');
        Object.assign(toolbar.style, {
            display: 'flex', gap: '8px', alignItems: 'center', flexWrap: 'wrap',
        });

        // Tool buttons
        this.polygonBtn = this.makeButton('Polygon', '#555');
        this.circleBtn = this.makeButton('Circle', '#555');
        this.setActiveTool('polygon');

        this.polygonBtn.addEventListener('click', () => this.setActiveTool('polygon'));
        this.circleBtn.addEventListener('click', () => this.setActiveTool('circle'));
        toolbar.appendChild(this.polygonBtn);
        toolbar.appendChild(this.circleBtn);

        // Separator
        toolbar.appendChild(this.makeSeparator());

        // Undo
        const undoBtn = this.makeButton('Undo', '#555');
        undoBtn.addEventListener('click', () => this.undo());
        toolbar.appendChild(undoBtn);

        // Separator
        toolbar.appendChild(this.makeSeparator());

        // Blur slider
        const blurLabel = document.createElement('span');
        blurLabel.textContent = 'Blur:';
        Object.assign(blurLabel.style, { opacity: '0.7' });
        toolbar.appendChild(blurLabel);

        const blurSlider = document.createElement('input');
        blurSlider.type = 'range';
        blurSlider.min = '0';
        blurSlider.max = '20';
        blurSlider.step = '1';
        blurSlider.value = String(this.blur);
        Object.assign(blurSlider.style, { width: '100px', accentColor: '#4CAF50' });
        blurSlider.addEventListener('input', () => {
            this.blur = Number(blurSlider.value);
            blurValue.textContent = String(this.blur);
            this.updatePreview();
            this.applyToMeshes();
        });
        toolbar.appendChild(blurSlider);

        const blurValue = document.createElement('span');
        blurValue.textContent = String(this.blur);
        Object.assign(blurValue.style, { minWidth: '20px' });
        toolbar.appendChild(blurValue);

        // Separator
        toolbar.appendChild(this.makeSeparator());

        // Intensity slider
        const intensityLabel = document.createElement('span');
        intensityLabel.textContent = 'Intensity:';
        Object.assign(intensityLabel.style, { opacity: '0.7' });
        toolbar.appendChild(intensityLabel);

        const intensitySlider = document.createElement('input');
        intensitySlider.type = 'range';
        intensitySlider.min = '0';
        intensitySlider.max = '1';
        intensitySlider.step = '0.05';
        intensitySlider.value = String(this.intensity);
        Object.assign(intensitySlider.style, { width: '100px', accentColor: '#4CAF50' });
        intensitySlider.addEventListener('input', () => {
            this.intensity = Number(intensitySlider.value);
            intensityValue.textContent = this.intensity.toFixed(2);
            this.applyToMeshes();
        });
        toolbar.appendChild(intensitySlider);

        const intensityValue = document.createElement('span');
        intensityValue.textContent = this.intensity.toFixed(2);
        Object.assign(intensityValue.style, { minWidth: '30px' });
        toolbar.appendChild(intensityValue);

        return toolbar;
    }

    private makeButton(text: string, bg: string): HTMLButtonElement {
        const btn = document.createElement('button');
        btn.textContent = text;
        Object.assign(btn.style, {
            padding: '6px 12px', backgroundColor: bg, color: '#fff',
            border: 'none', borderRadius: '4px', cursor: 'pointer',
            fontFamily: 'monospace', fontSize: '12px',
        });
        return btn;
    }

    private makeSeparator(): HTMLSpanElement {
        const sep = document.createElement('span');
        Object.assign(sep.style, {
            width: '1px', height: '20px', backgroundColor: '#555', display: 'inline-block',
        });
        return sep;
    }

    private setActiveTool(tool: Tool): void {
        // Cancel any in-progress drawing
        this.polyPoints = [];
        this.circleCenter = null;
        this.circleCurrent = null;
        this.isDragging = false;

        this.tool = tool;
        this.polygonBtn.style.backgroundColor = tool === 'polygon' ? '#4CAF50' : '#555';
        this.circleBtn.style.backgroundColor = tool === 'circle' ? '#4CAF50' : '#555';
        if (this.drawingCtx) this.redraw();
    }

    // --- Canvas events ---

    private setupCanvasEvents(): void {
        this.drawingCanvas.addEventListener('click', (e) => this.onCanvasClick(e));
        this.drawingCanvas.addEventListener('dblclick', (e) => this.onCanvasDblClick(e));
        this.drawingCanvas.addEventListener('mousemove', (e) => this.onCanvasMouseMove(e));
        this.drawingCanvas.addEventListener('mousedown', (e) => this.onCanvasMouseDown(e));
        this.drawingCanvas.addEventListener('mouseup', (e) => this.onCanvasMouseUp(e));
    }

    private canvasToNormalized(e: MouseEvent): { x: number; y: number } {
        const rect = this.drawingCanvas.getBoundingClientRect();
        return {
            x: Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width)),
            y: Math.max(0, Math.min(1, (e.clientY - rect.top) / rect.height)),
        };
    }

    private onCanvasClick(e: MouseEvent): void {
        if (this.tool !== 'polygon') return;

        const pt = this.canvasToNormalized(e);

        // Close polygon if clicking near first point
        if (this.polyPoints.length >= 3) {
            const first = this.polyPoints[0];
            const dx = pt.x - first.x;
            const dy = pt.y - first.y;
            if (Math.sqrt(dx * dx + dy * dy) < CLOSE_THRESHOLD) {
                this.commitPolygon();
                return;
            }
        }

        this.polyPoints.push(pt);
        this.redraw();
    }

    private onCanvasDblClick(e: MouseEvent): void {
        if (this.tool !== 'polygon') return;
        e.preventDefault();
        if (this.polyPoints.length >= 3) {
            this.commitPolygon();
        }
    }

    private onCanvasMouseMove(e: MouseEvent): void {
        const pt = this.canvasToNormalized(e);

        if (this.tool === 'polygon' && this.polyPoints.length > 0) {
            this.redraw();
            // Draw rubber-band line from last point to cursor
            const ctx = this.drawingCtx;
            const last = this.polyPoints[this.polyPoints.length - 1];
            ctx.strokeStyle = '#ffffff';
            ctx.lineWidth = 1;
            ctx.setLineDash([4, 4]);
            ctx.beginPath();
            ctx.moveTo(last.x * CANVAS_DISPLAY_SIZE, last.y * CANVAS_DISPLAY_SIZE);
            ctx.lineTo(pt.x * CANVAS_DISPLAY_SIZE, pt.y * CANVAS_DISPLAY_SIZE);
            ctx.stroke();
            ctx.setLineDash([]);
        }

        if (this.tool === 'circle' && this.isDragging && this.circleCenter) {
            this.circleCurrent = pt;
            this.redraw();
            // Draw in-progress circle
            const ctx = this.drawingCtx;
            const dx = pt.x - this.circleCenter.x;
            const dy = pt.y - this.circleCenter.y;
            const radius = Math.sqrt(dx * dx + dy * dy);
            ctx.strokeStyle = '#ffffff';
            ctx.lineWidth = 1;
            ctx.setLineDash([4, 4]);
            ctx.beginPath();
            ctx.arc(
                this.circleCenter.x * CANVAS_DISPLAY_SIZE,
                this.circleCenter.y * CANVAS_DISPLAY_SIZE,
                radius * CANVAS_DISPLAY_SIZE,
                0, Math.PI * 2
            );
            ctx.stroke();
            ctx.setLineDash([]);
        }
    }

    private onCanvasMouseDown(e: MouseEvent): void {
        if (this.tool !== 'circle') return;
        this.circleCenter = this.canvasToNormalized(e);
        this.isDragging = true;
    }

    private onCanvasMouseUp(e: MouseEvent): void {
        if (this.tool !== 'circle' || !this.isDragging || !this.circleCenter) return;
        this.isDragging = false;

        const pt = this.canvasToNormalized(e);
        const dx = pt.x - this.circleCenter.x;
        const dy = pt.y - this.circleCenter.y;
        const radius = Math.sqrt(dx * dx + dy * dy);

        if (radius > 0.005) {
            this.shapes.push({
                type: 'circle',
                center: { ...this.circleCenter },
                radius,
            });
            this.circleCenter = null;
            this.circleCurrent = null;
            this.redraw();
            this.updatePreview();
            this.applyToMeshes();
        }
    }

    // --- Drawing ---

    private commitPolygon(): void {
        if (this.polyPoints.length < 3) return;
        this.shapes.push({
            type: 'polygon',
            points: this.polyPoints.map(p => ({ ...p })),
        });
        this.polyPoints = [];
        this.redraw();
        this.updatePreview();
        this.applyToMeshes();
    }

    private redraw(): void {
        const ctx = this.drawingCtx;
        const s = CANVAS_DISPLAY_SIZE;
        ctx.clearRect(0, 0, s, s);

        // Draw reference texture as background
        if (this.referenceImage) {
            ctx.drawImage(this.referenceImage, 0, 0, s, s);
        }

        // Draw committed shapes
        for (const shape of this.shapes) {
            ctx.fillStyle = 'rgba(255, 255, 255, 0.5)';
            ctx.strokeStyle = '#ffffff';
            ctx.lineWidth = 1;

            if (shape.type === 'polygon' && shape.points.length >= 3) {
                ctx.beginPath();
                ctx.moveTo(shape.points[0].x * s, shape.points[0].y * s);
                for (let i = 1; i < shape.points.length; i++) {
                    ctx.lineTo(shape.points[i].x * s, shape.points[i].y * s);
                }
                ctx.closePath();
                ctx.fill();
                ctx.stroke();
            } else if (shape.type === 'circle') {
                ctx.beginPath();
                ctx.arc(shape.center.x * s, shape.center.y * s, shape.radius * s, 0, Math.PI * 2);
                ctx.fill();
                ctx.stroke();
            }
        }

        // Draw in-progress polygon points and edges
        if (this.polyPoints.length > 0) {
            ctx.strokeStyle = '#00ff00';
            ctx.lineWidth = 1;

            // Draw edges
            if (this.polyPoints.length > 1) {
                ctx.beginPath();
                ctx.moveTo(this.polyPoints[0].x * s, this.polyPoints[0].y * s);
                for (let i = 1; i < this.polyPoints.length; i++) {
                    ctx.lineTo(this.polyPoints[i].x * s, this.polyPoints[i].y * s);
                }
                ctx.stroke();
            }

            // Draw vertices
            for (const pt of this.polyPoints) {
                ctx.fillStyle = '#00ff00';
                ctx.beginPath();
                ctx.arc(pt.x * s, pt.y * s, 4, 0, Math.PI * 2);
                ctx.fill();
            }

            // Highlight close target (first point)
            if (this.polyPoints.length >= 3) {
                const first = this.polyPoints[0];
                ctx.strokeStyle = '#ffff00';
                ctx.lineWidth = 2;
                ctx.beginPath();
                ctx.arc(first.x * s, first.y * s, CLOSE_THRESHOLD * s, 0, Math.PI * 2);
                ctx.stroke();
            }
        }
    }

    private updatePreview(): void {
        const config: EmissiveTextureConfig = {
            shapes: this.shapes,
            blur: this.blur,
            resolution: 256,
            color: 0xfff4e0,
            intensity: 1,
        };
        renderEmissiveTexture(config, this.previewCanvas);
    }

    private applyToMeshes(): void {
        const config: EmissiveTextureConfig = {
            shapes: this.shapes,
            blur: this.blur,
            resolution: this.resolution,
            color: this.color,
            intensity: this.intensity,
        };
        const mask = renderEmissiveTexture(config);

        for (const mesh of this.meshes) {
            const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
            for (const mat of mats) {
                const std = mat as MeshStandardMaterial;
                // Multiply mask with diffuse texture to preserve detail in glowing areas
                const diffuse = std.map?.image;
                const canvas = diffuse
                    ? compositeEmissiveWithDiffuse(mask, diffuse)
                    : mask;
                const texture = new CanvasTexture(canvas);
                texture.flipY = false;
                texture.needsUpdate = true;
                std.emissiveMap = texture;
                std.emissive = new Color(this.color);
                std.emissiveIntensity = this.intensity;
                std.needsUpdate = true;
            }
        }
    }

    // --- Actions ---

    private undo(): void {
        if (this.polyPoints.length > 0) {
            // Undo last polygon point if in-progress
            this.polyPoints.pop();
        } else if (this.shapes.length > 0) {
            this.shapes.pop();
        }
        this.redraw();
        this.updatePreview();
        this.applyToMeshes();
    }

    private save(): void {
        this.onSave({
            shapes: this.shapes.map(s => ({ ...s })),
            blur: this.blur,
            resolution: this.resolution,
            color: this.color,
            intensity: this.intensity,
        });
        this.close();
    }
}
