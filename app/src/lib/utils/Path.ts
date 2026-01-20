import { Scene, Vector3, MathUtils } from "three";
import { NodeIndicator } from "../editor/NodeIndicator";
import { dummy } from "./Helper";

const EPS = 1e-6;
const MAX_WALK = 5;

const SEG_LINEAR = 0;
const SEG_CURVE = 1;

const CURVE_ANGLE_THRESHOLD = MathUtils.degToRad(10);
const COS_CURVE_THRESHOLD = Math.cos(CURVE_ANGLE_THRESHOLD);

// Samples per curve. 
// A size of 20 means 21 entries (0..20) in the array.
const LUT_STEPS = 20;

export default class Path {
    public points: Vector3[];

    // --- Logical Segment Data ---
    private segPointIndices!: Int32Array;
    private segTypes!: Uint8Array;

    // Maps logical segment index -> index in the giant curveLUT array.
    // Stores -1 for linear segments.
    private segLUTOffsets!: Int32Array;

    // FLATTENED ARRAYS for cache locality
    private curveControlPoints!: Float32Array; // Stride: 3 (x, y, z)
    private curveLUT!: Float32Array;           // Stride: LUT_STEPS + 1

    private cumulativeLengths!: Float64Array;
    private invSegmentLengths!: Float64Array;
    private totalLength = 0;
    private logicalCount = 0;

    private looping = false;
    private startDir = new Vector3(1, 0, 0);
    private endDir = new Vector3(1, 0, 0);

    private lastIndex = 0;
    private pathDebugIndicators: NodeIndicator[] = [];

    constructor(points: Vector3[]) {
        this.points = points;
        const loopingEpsilon = 1e-5;
        if (points.length > 2 && points[0].distanceToSquared(points[points.length - 1]) < loopingEpsilon) {
            this.looping = true;
        }
        this.precompute();
    }

    private precompute(): void {
        const n = this.points.length;
        if (n < 2) {
            this.resetEmpty();
            return;
        }

        // 1. Analyze directions to detect curves
        const rawDirs: Vector3[] = [];
        const rawLengths: number[] = [];
        for (let i = 0; i < n - 1; i++) {
            const v = new Vector3().subVectors(this.points[i + 1], this.points[i]);
            const len = v.length();
            rawLengths.push(len);
            if (len > EPS) v.multiplyScalar(1 / len);
            rawDirs.push(v);
        }

        // 2. Count Logical Segments & Curves (Pass 1)
        // We do this to allocate the exact amount of memory needed for the arrays
        let tempLogicalCount = 0;
        let tempCurveCount = 0;
        let k = 0;
        while (k < n - 1) {
            let isCurve = false;
            if (k < n - 2) {
                if (rawDirs[k].dot(rawDirs[k + 1]) < COS_CURVE_THRESHOLD) isCurve = true;
            }
            tempLogicalCount++;
            if (isCurve) {
                tempCurveCount++;
                k += 2;
            } else {
                k += 1;
            }
        }

        // 3. Allocate Memory
        const maxSegs = tempLogicalCount;
        this.segPointIndices = new Int32Array(maxSegs);
        this.segTypes = new Uint8Array(maxSegs);
        this.segLUTOffsets = new Int32Array(maxSegs);
        this.cumulativeLengths = new Float64Array(maxSegs + 1);
        this.invSegmentLengths = new Float64Array(maxSegs);

        // Optimize: Only allocate space for actual curves
        // If we didn't use flattened arrays, we'd have thousands of small objects
        this.curveControlPoints = new Float32Array(maxSegs * 3);
        this.curveLUT = new Float32Array(tempCurveCount * (LUT_STEPS + 1));

        // 4. Fill Data (Pass 2)
        let logicalIdx = 0;
        let curveFillIdx = 0; // Index in the Float32Array
        let totalLen = 0;
        this.cumulativeLengths[0] = 0;

        let i = 0;
        while (i < n - 1) {
            let isCurve = false;
            if (i < n - 2) {
                if (rawDirs[i].dot(rawDirs[i + 1]) < COS_CURVE_THRESHOLD) isCurve = true;
            }

            this.segPointIndices[logicalIdx] = i;
            let segLen = 0;

            if (isCurve) {
                this.segTypes[logicalIdx] = SEG_CURVE;
                this.segLUTOffsets[logicalIdx] = curveFillIdx; // Store pointer to giant array

                const p0 = this.points[i];
                const pVertex = this.points[i + 1];
                const p2 = this.points[i + 2];

                // Solve for Control Point (pushed out)
                const cx = 2 * pVertex.x - 0.5 * p0.x - 0.5 * p2.x;
                const cy = 2 * pVertex.y - 0.5 * p0.y - 0.5 * p2.y;
                const cz = 2 * pVertex.z - 0.5 * p0.z - 0.5 * p2.z;

                const cIdx = logicalIdx * 3;
                this.curveControlPoints[cIdx] = cx;
                this.curveControlPoints[cIdx + 1] = cy;
                this.curveControlPoints[cIdx + 2] = cz;

                // Build LUT directly into the shared buffer
                segLen = this.buildArcLengthLUT(
                    curveFillIdx, // Write at this offset
                    p0.x, p0.y, p0.z,
                    cx, cy, cz,
                    p2.x, p2.y, p2.z
                );

                curveFillIdx += (LUT_STEPS + 1); // Advance the LUT pointer
                i += 2;
            } else {
                this.segTypes[logicalIdx] = SEG_LINEAR;
                this.segLUTOffsets[logicalIdx] = -1; // No LUT
                segLen = rawLengths[i];
                i += 1;
            }

            totalLen += segLen;
            this.cumulativeLengths[logicalIdx + 1] = totalLen;
            this.invSegmentLengths[logicalIdx] = segLen > EPS ? 1 / segLen : 0;

            logicalIdx++;
        }

        this.logicalCount = logicalIdx;
        this.totalLength = totalLen;
        this.lastIndex = 0;

        // Cache Directions
        if (this.logicalCount > 0) {
            const firstIdx = this.segPointIndices[0];
            const p0 = this.points[firstIdx];
            const p1 = this.points[firstIdx + 1];
            this.startDir.subVectors(p1, p0).normalize();

            const lastLogIdx = this.logicalCount - 1;
            const pIdx = this.segPointIndices[lastLogIdx];
            if (this.segTypes[lastLogIdx] === SEG_CURVE) {
                const cIdx = lastLogIdx * 3;
                const cx = this.curveControlPoints[cIdx];
                const cy = this.curveControlPoints[cIdx + 1];
                const cz = this.curveControlPoints[cIdx + 2];
                const pEnd = this.points[pIdx + 2];
                this.endDir.set(pEnd.x - cx, pEnd.y - cy, pEnd.z - cz).normalize();
            } else {
                const l0 = this.points[pIdx];
                const l1 = this.points[pIdx + 1];
                this.endDir.subVectors(l1, l0).normalize();
            }
        }
    }

    private resetEmpty(): void {
        this.totalLength = 0;
        this.logicalCount = 0;
        this.cumulativeLengths = new Float64Array(0);
        this.invSegmentLengths = new Float64Array(0);
        this.segPointIndices = new Int32Array(0);
        this.segTypes = new Uint8Array(0);
        this.segLUTOffsets = new Int32Array(0);
        this.curveControlPoints = new Float32Array(0);
        this.curveLUT = new Float32Array(0);
    }

    /**
     * Builds the LUT directly into the flattened 'this.curveLUT' array.
     * Returns the total arc length of the curve.
     */
    private buildArcLengthLUT(
        offset: number,
        ax: number, ay: number, az: number,
        bx: number, by: number, bz: number,
        cx: number, cy: number, cz: number
    ): number {
        // 1. Calculate Arc Lengths for uniform T (0, 0.05, 0.1 ...)
        // We use a temporary stack array for this small calculation to avoid GC
        // Note: Float32Array on stack is very fast
        const tempArc = new Float32Array(LUT_STEPS + 1);
        tempArc[0] = 0;

        let prevX = ax, prevY = ay, prevZ = az;
        let currentLen = 0;

        // Step 1: Measure distance at uniform T steps
        for (let i = 1; i <= LUT_STEPS; i++) {
            const t = i / LUT_STEPS;
            const mt = 1 - t;
            // Bezier Expansion
            const c0 = mt * mt;
            const c1 = 2 * mt * t;
            const c2 = t * t;

            const px = c0 * ax + c1 * bx + c2 * cx;
            const py = c0 * ay + c1 * by + c2 * cy;
            const pz = c0 * az + c1 * bz + c2 * cz;

            const dx = px - prevX;
            const dy = py - prevY;
            const dz = pz - prevZ;

            currentLen += Math.sqrt(dx * dx + dy * dy + dz * dz);
            tempArc[i] = currentLen;
            prevX = px; prevY = py; prevZ = pz;
        }

        // Step 2: Invert mapping (Uniform Distance -> T)
        // Write directly to this.curveLUT at 'offset'
        const lut = this.curveLUT;
        lut[offset] = 0;
        lut[offset + LUT_STEPS] = 1;

        const totalLen = currentLen;
        let arcIdx = 1;

        // "Remapping" loop
        for (let i = 1; i < LUT_STEPS; i++) {
            const targetDist = (i / LUT_STEPS) * totalLen;

            // Find which interval [arcIdx-1, arcIdx] contains targetDist
            while (arcIdx < LUT_STEPS && tempArc[arcIdx] < targetDist) {
                arcIdx++;
            }

            // Interpolate T
            const lenPrev = tempArc[arcIdx - 1];
            const lenNext = tempArc[arcIdx];
            const fraction = (lenNext - lenPrev) > EPS
                ? (targetDist - lenPrev) / (lenNext - lenPrev)
                : 0;

            const tPrev = (arcIdx - 1) / LUT_STEPS;
            const tNext = arcIdx / LUT_STEPS;

            lut[offset + i] = tPrev + fraction * (tNext - tPrev);
        }

        return totalLen;
    }

    public getPointAtDistance(distance: number, out: Vector3 = new Vector3()): Vector3 {
        if (this.logicalCount === 0) return out.copy(this.points.length > 0 ? this.points[0] : out.set(0, 0, 0));

        if (this.looping) return this.getPointInternal(this.wrapDistance(distance), out);

        // Extrapolations
        if (distance < 0) return out.copy(this.points[0]).addScaledVector(this.startDir, distance);
        if (distance >= this.totalLength) {
            const lastLogIdx = this.logicalCount - 1;
            const pIdx = this.segPointIndices[lastLogIdx];
            const isCurve = this.segTypes[lastLogIdx] === SEG_CURVE;
            const lastPt = this.points[pIdx + (isCurve ? 2 : 1)];
            return out.copy(lastPt).addScaledVector(this.endDir, distance - this.totalLength);
        }

        return this.getPointInternal(distance, out);
    }

    private getPointInternal(distance: number, out: Vector3): Vector3 {
        const cum = this.cumulativeLengths;
        const count = this.logicalCount;

        // Finger Search
        let i = this.lastIndex;
        if (i >= count) i = count - 1;

        if (distance < cum[i] || distance > cum[i + 1]) {
            if (distance > cum[i + 1]) {
                let k = 0;
                while (k < MAX_WALK && i < count - 1 && distance > cum[i + 1]) { i++; k++; }
            } else {
                let k = 0;
                while (k < MAX_WALK && i > 0 && distance < cum[i]) { i--; k++; }
            }
            if (distance < cum[i] || distance > cum[i + 1]) {
                i = this.binarySearch(distance);
            }
        }

        this.lastIndex = i;

        const normalizedDist = (distance - cum[i]) * this.invSegmentLengths[i]; // 0..1
        const pIdx = this.segPointIndices[i];
        const pts = this.points;

        if (this.segTypes[i] === SEG_LINEAR) {
            // Linear
            const a = pts[pIdx];
            const b = pts[pIdx + 1];
            out.set(
                a.x + (b.x - a.x) * normalizedDist,
                a.y + (b.y - a.y) * normalizedDist,
                a.z + (b.z - a.z) * normalizedDist
            );
        } else {
            // Curve with LUT
            const offset = this.segLUTOffsets[i];

            // --- LUT LOOKUP ---
            // Map 0..1 dist to index 0..LUT_STEPS
            const scaled = normalizedDist * LUT_STEPS;
            const idx = scaled | 0; // Fast floor

            let t = 0;
            // Boundary checks
            if (idx >= LUT_STEPS) {
                t = 1;
            } else if (idx < 0) {
                t = 0;
            } else {
                const frac = scaled - idx;
                const t1 = this.curveLUT[offset + idx];
                const t2 = this.curveLUT[offset + idx + 1];
                t = t1 + (t2 - t1) * frac;
            }

            // Bezier Calc
            const p0 = pts[pIdx];
            const p2 = pts[pIdx + 2];
            const cIdx = i * 3;
            const cx = this.curveControlPoints[cIdx];
            const cy = this.curveControlPoints[cIdx + 1];
            const cz = this.curveControlPoints[cIdx + 2];

            const mt = 1 - t;
            const c0 = mt * mt;
            const c1 = 2 * mt * t;
            const c2 = t * t;

            out.set(
                c0 * p0.x + c1 * cx + c2 * p2.x,
                c0 * p0.y + c1 * cy + c2 * p2.y,
                c0 * p0.z + c1 * cz + c2 * p2.z
            );
        }

        return out;
    }

    private binarySearch(dist: number): number {
        let low = 0;
        let high = this.logicalCount - 1;
        const cum = this.cumulativeLengths;
        while (low <= high) {
            const mid = (low + high) >>> 1;
            if (cum[mid + 1] < dist) low = mid + 1;
            else if (cum[mid] > dist) high = mid - 1;
            else return mid;
        }
        return Math.max(0, Math.min(this.logicalCount - 1, high));
    }

    private wrapDistance(d: number): number {
        const L = this.totalLength;
        if (L <= EPS) return 0;
        d %= L;
        return d < 0 ? d + L : d;
    }

    public getTotalLength(): number { return this.totalLength; }

    public cleanup(): void { this.removeDebugPath(); }

    public drawDebugPath(scene: Scene): void {
        this.removeDebugPath();
        const debugSteps = 500;
        const step = this.totalLength / debugSteps;
        for (let i = 0; i <= debugSteps; i++) {
            const indicator = new NodeIndicator(0.05); // Smaller debug points
            indicator.mesh.position.copy(this.getPointAtDistance(i * step));
            indicator.setMode('selected');
            scene.add(indicator.mesh);
            this.pathDebugIndicators.push(indicator);
        }
    }

    public removeDebugPath(): void {
        this.pathDebugIndicators.forEach(i => {
            if (i.mesh.parent) i.mesh.parent.remove(i.mesh);
            i.dispose();
        });
        this.pathDebugIndicators = [];
    }
}