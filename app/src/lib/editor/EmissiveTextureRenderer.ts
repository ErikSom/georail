import { CanvasTexture } from 'three';
import type { EmissiveTextureConfig, EmissiveShape } from '../train/TrainConfig';

function drawShape(ctx: CanvasRenderingContext2D, shape: EmissiveShape, resolution: number): void {
    if (shape.type === 'polygon') {
        if (shape.points.length < 3) return;
        ctx.beginPath();
        ctx.moveTo(shape.points[0].x * resolution, shape.points[0].y * resolution);
        for (let i = 1; i < shape.points.length; i++) {
            ctx.lineTo(shape.points[i].x * resolution, shape.points[i].y * resolution);
        }
        ctx.closePath();
        ctx.fill();
    } else if (shape.type === 'circle') {
        ctx.beginPath();
        ctx.arc(
            shape.center.x * resolution,
            shape.center.y * resolution,
            shape.radius * resolution,
            0,
            Math.PI * 2
        );
        ctx.fill();
    }
}

/**
 * Renders emissive drawing instructions onto a canvas.
 * Black background with white shapes, optional blur post-processing.
 */
export function renderEmissiveTexture(
    config: EmissiveTextureConfig,
    existingCanvas?: HTMLCanvasElement
): HTMLCanvasElement {
    const resolution = config.resolution || 512;
    const canvas = existingCanvas || document.createElement('canvas');
    canvas.width = resolution;
    canvas.height = resolution;

    const ctx = canvas.getContext('2d')!;

    // Black background (no emission)
    ctx.filter = 'none';
    ctx.fillStyle = '#000000';
    ctx.fillRect(0, 0, resolution, resolution);

    // Draw white shapes onto a temp canvas, then composite (with optional blur) onto the output
    const tmpCanvas = document.createElement('canvas');
    tmpCanvas.width = resolution;
    tmpCanvas.height = resolution;
    const tmpCtx = tmpCanvas.getContext('2d')!;
    tmpCtx.fillStyle = '#ffffff';
    for (const shape of config.shapes) {
        drawShape(tmpCtx, shape, resolution);
    }

    if (config.blur > 0) {
        ctx.filter = `blur(${config.blur}px)`;
    }
    ctx.drawImage(tmpCanvas, 0, 0);
    ctx.filter = 'none';

    return canvas;
}

/**
 * Composites the emissive mask with a diffuse texture image using multiply blend.
 * This preserves texture detail in the glowing areas instead of producing flat patches.
 */
export function compositeEmissiveWithDiffuse(
    mask: HTMLCanvasElement,
    diffuseImage: CanvasImageSource
): HTMLCanvasElement {
    const canvas = document.createElement('canvas');
    canvas.width = mask.width;
    canvas.height = mask.height;
    const ctx = canvas.getContext('2d')!;

    // Draw the diffuse texture first
    ctx.drawImage(diffuseImage, 0, 0, canvas.width, canvas.height);

    // Multiply with the mask — black mask areas become black, white areas keep the diffuse
    ctx.globalCompositeOperation = 'multiply';
    ctx.drawImage(mask, 0, 0);

    return canvas;
}

/**
 * Creates a Three.js CanvasTexture from emissive drawing instructions.
 * If a diffuseImage is provided, the mask is multiplied with it to preserve texture detail.
 */
export function createEmissiveCanvasTexture(
    config: EmissiveTextureConfig,
    diffuseImage?: CanvasImageSource
): CanvasTexture {
    const mask = renderEmissiveTexture(config);
    const canvas = diffuseImage
        ? compositeEmissiveWithDiffuse(mask, diffuseImage)
        : mask;
    const texture = new CanvasTexture(canvas);
    texture.flipY = false; // Match GLB texture convention
    texture.needsUpdate = true;
    return texture;
}
