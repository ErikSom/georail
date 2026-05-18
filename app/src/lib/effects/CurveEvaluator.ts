import type { Curve } from '../train/TrainConfig';
import type { TrainState } from '../train/TrainState';
import { getInputValue } from '../train/TrainState';

export function interpolateCurve(curve: Curve, inputValue: number): number {
    const points = curve.points;
    if (points.length === 0) return 0;
    if (points.length === 1) return points[0].y;

    if (!(curve as { _sorted?: boolean })._sorted) {
        points.sort((a, b) => a.x - b.x);
        (curve as { _sorted?: boolean })._sorted = true;
    }

    const minX = points[0].x;
    const maxX = points[points.length - 1].x;
    const clampedInput = Math.max(minX, Math.min(maxX, inputValue));

    let left = points[0];
    let right = points[points.length - 1];
    for (let i = 0; i < points.length - 1; i++) {
        if (clampedInput >= points[i].x && clampedInput <= points[i + 1].x) {
            left = points[i];
            right = points[i + 1];
            break;
        }
    }

    if (left.x === right.x) return left.y;
    const t = (clampedInput - left.x) / (right.x - left.x);
    return left.y + t * (right.y - left.y);
}

// Multiple curves targeting the same Y label combine via min-wins (matches TrainAudio).
export function evaluateCurves(curves: Curve[], state: TrainState): Map<string, number> {
    const result = new Map<string, number>();
    for (const curve of curves) {
        const xLabel = curve.axis?.x.label;
        const yLabel = curve.axis?.y.label;
        if (!xLabel || !yLabel) continue;
        const input = getInputValue(state, xLabel);
        if (input === null) continue;
        const output = interpolateCurve(curve, input);
        const prev = result.get(yLabel);
        result.set(yLabel, prev === undefined ? output : Math.min(prev, output));
    }
    return result;
}
