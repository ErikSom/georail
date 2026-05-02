import { Scene, Vector3, Matrix4, MathUtils } from "three";
import { NodeIndicator } from "../editor/NodeIndicator";
import { dummy } from "./Helper";

const EPS = 1e-6;
const MAX_WALK = 5;

const SEG_LINEAR = 0;
const SEG_CURVE = 1;

// Config
const CURVE_ANGLE_THRESHOLD = MathUtils.degToRad(10);
const COS_CURVE_THRESHOLD = Math.cos(CURVE_ANGLE_THRESHOLD);
const MIN_SEG_LEN = 1e-3; // Ignore segments smaller than 1mm (tune to your scale)
const LUT_STEPS = 20;

export default class Path {
    public points: Vector3[];

    // --- Logical Segment Data ---
    private segPointIndices!: Int32Array;
    private segTypes!: Uint8Array;
    private segLUTOffsets!: Int32Array;

    private curveControlPoints!: Float32Array;
    private curveLUT!: Float32Array;

    private cumulativeLengths!: Float64Array;
    private invSegmentLengths!: Float64Array;
    private totalLength = 0;
    private logicalCount = 0;

    private looping = false;
    private startDir = new Vector3(1, 0, 0);
    private endDir = new Vector3(1, 0, 0);

    private lastIndex = 0;
    private pathDebugIndicators: NodeIndicator[] = [];

    // Sorted arc-length distances of sub-path boundaries (terminal buffers).
    private segmentBoundaries: Float64Array = new Float64Array(0);

    constructor(points: Vector3[]) {
        this.points = points;
        const loopingEpsilon = 1e-5;
        if (points.length > 2 && points[0].distanceToSquared(points[points.length - 1]) < loopingEpsilon) {
            this.looping = true;
        }
        this.precompute();
    }

    public setSegmentBoundaries(pointIndices: number[]): void {
        if (!pointIndices || pointIndices.length === 0) {
            this.segmentBoundaries = new Float64Array(0);
            return;
        }
        const distances: number[] = [];
        for (const pi of pointIndices) {
            const d = this.getDistanceAtPointIndex(pi);
            if (Number.isFinite(d) && d > 0 && d < this.totalLength) distances.push(d);
        }
        distances.sort((a, b) => a - b);
        this.segmentBoundaries = Float64Array.from(distances);
    }

    public getSegmentCount(): number {
        return this.segmentBoundaries.length + 1;
    }

    public getSegmentIndexAt(distance: number): number {
        const arr = this.segmentBoundaries;
        for (let i = 0; i < arr.length; i++) {
            // Boundary-equal distance belongs to the earlier segment (stop is at the approach end).
            if (distance <= arr[i]) return i;
        }
        return arr.length;
    }

    public getSegmentBounds(index: number): { startGlobal: number; endGlobal: number } {
        const arr = this.segmentBoundaries;
        const startGlobal = index === 0 ? 0 : arr[index - 1];
        const endGlobal = index < arr.length ? arr[index] : this.totalLength;
        return { startGlobal, endGlobal };
    }

    /** Global arc-length distance at segment boundary `index` (0-based). */
    public getSegmentBoundaryDistance(index: number): number {
        const arr = this.segmentBoundaries;
        if (index < 0 || index >= arr.length) return this.totalLength;
        return arr[index];
    }

    private precompute(): void {
        const n = this.points.length;
        if (n < 2) {
            this.resetEmpty();
            return;
        }

        // 1. Analyze directions & Lengths
        const rawDirs: Vector3[] = [];
        const rawLengths: number[] = [];
        
        for (let i = 0; i < n - 1; i++) {
            const v = new Vector3().subVectors(this.points[i + 1], this.points[i]);
            const len = v.length();
            rawLengths.push(len);
            // Handle tiny segments gracefully
            if (len > EPS) v.multiplyScalar(1 / len);
            else v.set(0, 0, 0); // Safe fallback
            rawDirs.push(v);
        }

        // Helper to check if a tuple (i, i+1, i+2) is safe to curve
        const isSafeCurve = (i: number): boolean => {
            if (i >= n - 2) return false;

            // A) Check Segment Lengths
            const len0 = rawLengths[i];
            const len1 = rawLengths[i + 1];
            if (len0 < MIN_SEG_LEN || len1 < MIN_SEG_LEN) return false;

            // B) Check Angle
            if (rawDirs[i].dot(rawDirs[i + 1]) >= COS_CURVE_THRESHOLD) return false;

            // C) Geometric Safety (The Feedback Fix)
            const p0 = this.points[i];
            const p1 = this.points[i + 1];
            const p2 = this.points[i + 2];

            // Calculate candidate Control Point (B)
            const cx = 2 * p1.x - 0.5 * p0.x - 0.5 * p2.x;
            const cy = 2 * p1.y - 0.5 * p0.y - 0.5 * p2.y;
            const cz = 2 * p1.z - 0.5 * p0.z - 0.5 * p2.z;

            // Vectors: A->B and B->C
            const t0x = cx - p0.x, t0y = cy - p0.y, t0z = cz - p0.z;
            const t1x = p2.x - cx, t1y = p2.y - cy, t1z = p2.z - cz;
            
            // Check 1: Tangent Alignment (prevent cusps/reversals)
            const dotT = t0x * t1x + t0y * t1y + t0z * t1z;
            if (dotT <= 0) return false; // Control point creates a V-shape or loop

            // Check 2: Chord Projection (prevent overshoot)
            // Project B onto the chord A->C
            const chordX = p2.x - p0.x, chordY = p2.y - p0.y, chordZ = p2.z - p0.z;
            const chordLenSq = chordX * chordX + chordY * chordY + chordZ * chordZ;
            
            if (chordLenSq > EPS) {
                // Projection of (B-A) onto Chord
                const proj = (t0x * chordX + t0y * chordY + t0z * chordZ) / chordLenSq;
                // If B projects outside [0, 1], it means the curve swings way wide
                if (proj < 0 || proj > 1) return false;
            }

            return true;
        };

        // 2. Count Segments (Pass 1)
        let tempLogicalCount = 0;
        let tempCurveCount = 0;
        let k = 0;
        while (k < n - 1) {
            if (isSafeCurve(k)) {
                tempCurveCount++;
                tempLogicalCount++;
                k += 2;
            } else {
                tempLogicalCount++;
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

        this.curveControlPoints = new Float32Array(maxSegs * 3);
        this.curveLUT = new Float32Array(tempCurveCount * (LUT_STEPS + 1));

        // 4. Fill Data (Pass 2)
        let logicalIdx = 0;
        let curveFillIdx = 0;
        let totalLen = 0;
        this.cumulativeLengths[0] = 0;

        let i = 0;
        while (i < n - 1) {
            // We must use the exact same logic as Pass 1 to keep indices aligned
            if (isSafeCurve(i)) {
                this.segPointIndices[logicalIdx] = i;
                this.segTypes[logicalIdx] = SEG_CURVE;
                this.segLUTOffsets[logicalIdx] = curveFillIdx;

                const p0 = this.points[i];
                const p1 = this.points[i + 1];
                const p2 = this.points[i + 2];

                const cx = 2 * p1.x - 0.5 * p0.x - 0.5 * p2.x;
                const cy = 2 * p1.y - 0.5 * p0.y - 0.5 * p2.y;
                const cz = 2 * p1.z - 0.5 * p0.z - 0.5 * p2.z;

                const cIdx = logicalIdx * 3;
                this.curveControlPoints[cIdx] = cx;
                this.curveControlPoints[cIdx + 1] = cy;
                this.curveControlPoints[cIdx + 2] = cz;

                const segLen = this.buildArcLengthLUT(
                    curveFillIdx,
                    p0.x, p0.y, p0.z,
                    cx, cy, cz,
                    p2.x, p2.y, p2.z
                );
                
                totalLen += segLen;
                this.cumulativeLengths[logicalIdx + 1] = totalLen;
                this.invSegmentLengths[logicalIdx] = segLen > EPS ? 1 / segLen : 0;

                curveFillIdx += (LUT_STEPS + 1);
                i += 2;
            } else {
                // Linear fallback
                this.segPointIndices[logicalIdx] = i;
                this.segTypes[logicalIdx] = SEG_LINEAR;
                this.segLUTOffsets[logicalIdx] = -1;

                const segLen = rawLengths[i];
                totalLen += segLen;
                
                this.cumulativeLengths[logicalIdx + 1] = totalLen;
                this.invSegmentLengths[logicalIdx] = segLen > EPS ? 1 / segLen : 0;
                i += 1;
            }
            logicalIdx++;
        }

        this.logicalCount = logicalIdx;
        this.totalLength = totalLen;
        this.lastIndex = 0;

        // 5. Correct Start/End Directions
        if (this.logicalCount > 0) {
            // Start Dir
            const firstIdx = this.segPointIndices[0];
            if (this.segTypes[0] === SEG_CURVE) {
                // Tangent of Bezier at t=0 is 2*(P1 - P0). Direction is same as (P1 - P0) aka (ControlPoint - Start)
                const cIdx = 0; // 0 * 3
                const cx = this.curveControlPoints[cIdx];
                const cy = this.curveControlPoints[cIdx + 1];
                const cz = this.curveControlPoints[cIdx + 2];
                const p0 = this.points[firstIdx];
                this.startDir.set(cx - p0.x, cy - p0.y, cz - p0.z).normalize();
            } else {
                const p0 = this.points[firstIdx];
                const p1 = this.points[firstIdx + 1];
                this.startDir.subVectors(p1, p0).normalize();
            }

            // End Dir
            const lastLogIdx = this.logicalCount - 1;
            const pIdx = this.segPointIndices[lastLogIdx];
            if (this.segTypes[lastLogIdx] === SEG_CURVE) {
                // Tangent of Bezier at t=1 is 2*(P2 - P1). Direction is (End - ControlPoint)
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

    private buildArcLengthLUT(
        offset: number,
        ax: number, ay: number, az: number,
        bx: number, by: number, bz: number,
        cx: number, cy: number, cz: number
    ): number {
        const tempArc = new Float32Array(LUT_STEPS + 1);
        tempArc[0] = 0;

        let prevX = ax, prevY = ay, prevZ = az;
        let currentLen = 0;

        for (let i = 1; i <= LUT_STEPS; i++) {
            const t = i / LUT_STEPS;
            const mt = 1 - t;
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

        const lut = this.curveLUT;
        lut[offset] = 0;
        lut[offset + LUT_STEPS] = 1;

        const totalLen = currentLen;
        let arcIdx = 1;

        for (let i = 1; i < LUT_STEPS; i++) {
            const targetDist = (i / LUT_STEPS) * totalLen;
            while (arcIdx < LUT_STEPS && tempArc[arcIdx] < targetDist) {
                arcIdx++;
            }
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

        // When extrapolating past either endpoint, keep the anchor's altitude.
        // Spurious height discontinuities in the first/last segment (often from
        // a route's trimmed entry where no override matched) would otherwise
        // make extrapolated train wagons sink below or shoot above the rail.
        if (distance < 0) {
            out.copy(this.points[0]).addScaledVector(this.startDir, distance);
            out.y = this.points[0].y;
            return out;
        }
        if (distance >= this.totalLength) {
             const lastLogIdx = this.logicalCount - 1;
             const pIdx = this.segPointIndices[lastLogIdx];
             const isCurve = this.segTypes[lastLogIdx] === SEG_CURVE;
             const lastPt = this.points[pIdx + (isCurve ? 2 : 1)];
             out.copy(lastPt).addScaledVector(this.endDir, distance - this.totalLength);
             out.y = lastPt.y;
             return out;
        }

        return this.getPointInternal(distance, out);
    }

    private getPointInternal(distance: number, out: Vector3): Vector3 {
        const cum = this.cumulativeLengths;
        const count = this.logicalCount;

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

        const normalizedDist = (distance - cum[i]) * this.invSegmentLengths[i];
        const pIdx = this.segPointIndices[i];
        const pts = this.points;

        if (this.segTypes[i] === SEG_LINEAR) {
            const a = pts[pIdx];
            const b = pts[pIdx + 1];
            out.set(
                a.x + (b.x - a.x) * normalizedDist,
                a.y + (b.y - a.y) * normalizedDist,
                a.z + (b.z - a.z) * normalizedDist
            );
        } else {
            const offset = this.segLUTOffsets[i];
            const scaled = normalizedDist * LUT_STEPS;
            const idx = scaled | 0;

            let t = 0;
            if (idx >= LUT_STEPS) t = 1;
            else if (idx < 0) t = 0;
            else {
                const frac = scaled - idx;
                const t1 = this.curveLUT[offset + idx];
                const t2 = this.curveLUT[offset + idx + 1];
                t = t1 + (t2 - t1) * frac;
            }

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

    /**
     * Get the cumulative path distance (meters) at a given input point index.
     * Useful for computing stop distances from route point indices.
     */
    public getDistanceAtPointIndex(pointIndex: number): number {
        if (pointIndex <= 0) return 0;
        if (pointIndex >= this.points.length - 1) return this.totalLength;

        for (let seg = 0; seg < this.logicalCount; seg++) {
            const startPt = this.segPointIndices[seg];
            const isCurve = this.segTypes[seg] === SEG_CURVE;
            const endPt = startPt + (isCurve ? 2 : 1);

            if (pointIndex === startPt) {
                return this.cumulativeLengths[seg];
            }
            if (pointIndex === endPt) {
                return this.cumulativeLengths[seg + 1];
            }
            if (isCurve && pointIndex === startPt + 1) {
                // Middle point of curve — approximate as midpoint of segment
                return (this.cumulativeLengths[seg] + this.cumulativeLengths[seg + 1]) / 2;
            }
        }
        return this.totalLength;
    }

    /**
     * Inverse of getDistanceAtPointIndex: returns the input point index that
     * the train is currently nearest to, given its arc-length distance.
     * Useful for debugging — combined with the journey route's `editor` array
     * it lets a debug HUD report the train's current segment_id/point_index.
     */
    public getPointIndexAtDistance(distance: number): number {
        if (!Number.isFinite(distance)) return 0;
        if (distance <= 0) return 0;
        if (distance >= this.totalLength) return this.points.length - 1;
        const seg = this.binarySearch(distance);
        const startPt = this.segPointIndices[seg];
        const isCurve = this.segTypes[seg] === SEG_CURVE;
        const endPt = startPt + (isCurve ? 2 : 1);
        const segStart = this.cumulativeLengths[seg];
        const segEnd = this.cumulativeLengths[seg + 1];
        const segLen = Math.max(EPS, segEnd - segStart);
        // Pick the point (start, optional middle, end) whose distance is
        // closest to `distance`.
        const candidates = isCurve
            ? [
                { pi: startPt, d: segStart },
                { pi: startPt + 1, d: (segStart + segEnd) / 2 },
                { pi: endPt, d: segEnd },
            ]
            : [
                { pi: startPt, d: segStart },
                { pi: endPt, d: segEnd },
            ];
        let best = candidates[0];
        let bestDelta = Math.abs(distance - best.d);
        for (let i = 1; i < candidates.length; i++) {
            const dlt = Math.abs(distance - candidates[i].d);
            if (dlt < bestDelta) { best = candidates[i]; bestDelta = dlt; }
        }
        // Suppress unused-var warning in case we add interpolation logic later.
        void segLen;
        return best.pi;
    }

    /**
     * Apply a rigid body transform to all geometry in-place.
     * Preserves distances, segment structure, and arc-length LUTs.
     * Used after reorientation to update world positions cheaply.
     */
    public applyTransform(matrix: Matrix4): void {
        // Transform all points
        for (let i = 0; i < this.points.length; i++) {
            this.points[i].applyMatrix4(matrix);
        }

        // Transform curve control points (flat Float32Array, xyz triples)
        const cp = this.curveControlPoints;
        const tv = new Vector3();
        for (let i = 0; i < cp.length; i += 3) {
            tv.set(cp[i], cp[i + 1], cp[i + 2]).applyMatrix4(matrix);
            cp[i] = tv.x;
            cp[i + 1] = tv.y;
            cp[i + 2] = tv.z;
        }

        // Recompute start/end directions from transformed geometry
        this.recomputeDirections();
    }

    private recomputeDirections(): void {
        if (this.logicalCount === 0) return;

        // Start direction
        const firstIdx = this.segPointIndices[0];
        if (this.segTypes[0] === SEG_CURVE) {
            const cp = this.curveControlPoints;
            const p0 = this.points[firstIdx];
            this.startDir.set(cp[0] - p0.x, cp[1] - p0.y, cp[2] - p0.z).normalize();
        } else {
            this.startDir.subVectors(this.points[firstIdx + 1], this.points[firstIdx]).normalize();
        }

        // End direction
        const lastLogIdx = this.logicalCount - 1;
        const pIdx = this.segPointIndices[lastLogIdx];
        if (this.segTypes[lastLogIdx] === SEG_CURVE) {
            const cIdx = lastLogIdx * 3;
            const cp = this.curveControlPoints;
            const pEnd = this.points[pIdx + 2];
            this.endDir.set(pEnd.x - cp[cIdx], pEnd.y - cp[cIdx + 1], pEnd.z - cp[cIdx + 2]).normalize();
        } else {
            this.endDir.subVectors(this.points[pIdx + 1], this.points[pIdx]).normalize();
        }
    }

    public getTotalLength(): number { return this.totalLength; }
    public getStartDirection(): Vector3 { return this.startDir; }
    public getEndDirection(): Vector3 { return this.endDir; }
    public getStartPoint(): Vector3 { return this.points[0]; }
    public getEndPoint(): Vector3 { return this.points[this.points.length - 1]; }
    public cleanup(): void { this.removeDebugPath(); }
    public drawDebugPath(scene: Scene): void {
        this.removeDebugPath();
        const debugSteps = 500;
        const step = this.totalLength / debugSteps;
        for (let i = 0; i <= debugSteps; i++) {
            const indicator = new NodeIndicator(0.05);
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