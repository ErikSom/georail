import { Scene, Vector3, MathUtils } from "three";
import { NodeIndicator } from "../editor/NodeIndicator";
import { dummy } from "./Helper";

const EPS = 1e-6;
const MAX_WALK = 5;

const SEG_LINEAR = 0;
const SEG_CURVE = 1;

// 30 degrees: If angle is sharper than this, we treat it as a curve.
const CURVE_ANGLE_THRESHOLD = MathUtils.degToRad(10);
const COS_CURVE_THRESHOLD = Math.cos(CURVE_ANGLE_THRESHOLD);

export default class Path {
    public points: Vector3[];

    // --- Logical Segment Data ---
    private segPointIndices!: Int32Array;
    private segTypes!: Uint8Array;

    // NEW: We store the calculated "pushed" control points here (x,y,z per segment)
    // This allows the curve to pass THROUGH the vertex.
    private curveControlPoints!: Float32Array;

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

        // 1. Calculate raw directions
        const rawDirs: Vector3[] = [];
        const rawLengths: number[] = [];

        for (let i = 0; i < n - 1; i++) {
            const v = new Vector3().subVectors(this.points[i + 1], this.points[i]);
            const len = v.length();
            rawLengths.push(len);
            if (len > EPS) v.multiplyScalar(1 / len);
            rawDirs.push(v);
        }

        // 2. Build Logical Segments
        const maxSegs = n - 1;
        this.segPointIndices = new Int32Array(maxSegs);
        this.segTypes = new Uint8Array(maxSegs);
        this.cumulativeLengths = new Float64Array(maxSegs + 1);
        this.invSegmentLengths = new Float64Array(maxSegs);

        // Store X,Y,Z for every logical segment (only used if type is curve)
        this.curveControlPoints = new Float32Array(maxSegs * 3);

        let logicalIdx = 0;
        let totalLen = 0;
        this.cumulativeLengths[0] = 0;

        let i = 0;
        while (i < n - 1) {
            let isCurve = false;

            // Check neighbors to decide if we curve
            if (i < n - 2) {
                const dir1 = rawDirs[i];
                const dir2 = rawDirs[i + 1];
                if (dir1.dot(dir2) < COS_CURVE_THRESHOLD) {
                    isCurve = true;
                }
            }

            this.segPointIndices[logicalIdx] = i;
            let segLen = 0;

            if (isCurve) {
                // CURVE MODE
                this.segTypes[logicalIdx] = SEG_CURVE;

                const p0 = this.points[i];     // Start
                const pVertex = this.points[i + 1]; // The Corner (Target)
                const p2 = this.points[i + 2];   // End

                // --- KEY MATH FIX ---
                // We want the curve to pass exactly through pVertex at t=0.5.
                // Standard Bezier at t=0.5 is: 0.25*p0 + 0.5*Ctrl + 0.25*p2
                // We solve for Ctrl: Ctrl = 2*pVertex - 0.5*p0 - 0.5*p2
                const cx = 2 * pVertex.x - 0.5 * p0.x - 0.5 * p2.x;
                const cy = 2 * pVertex.y - 0.5 * p0.y - 0.5 * p2.y;
                const cz = 2 * pVertex.z - 0.5 * p0.z - 0.5 * p2.z;

                // Store in our typed array
                const cIdx = logicalIdx * 3;
                this.curveControlPoints[cIdx] = cx;
                this.curveControlPoints[cIdx + 1] = cy;
                this.curveControlPoints[cIdx + 2] = cz;

                // Calculate length using this NEW control point
                segLen = this.approxBezierLength(
                    p0.x, p0.y, p0.z,
                    cx, cy, cz,
                    p2.x, p2.y, p2.z,
                    10 // Slightly higher samples for accuracy
                );

                i += 2; // Skip the corner point, we consumed it
            } else {
                // LINEAR MODE
                this.segTypes[logicalIdx] = SEG_LINEAR;
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

        // Cache Directions for Extrapolation
        if (this.logicalCount > 0) {
            // Start Dir
            const firstIdx = this.segPointIndices[0];
            const p0 = this.points[firstIdx];
            const p1 = this.points[firstIdx + 1];
            this.startDir.subVectors(p1, p0).normalize();

            // End Dir
            const lastLogIdx = this.logicalCount - 1;
            const pIdx = this.segPointIndices[lastLogIdx];

            if (this.segTypes[lastLogIdx] === SEG_CURVE) {
                const cIdx = lastLogIdx * 3;
                // Tangent at end of Bezier is (P2 - Control)
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
        this.curveControlPoints = new Float32Array(0);
    }

    // Unrolled arguments to avoid Vector3 creation
    private approxBezierLength(
        ax: number, ay: number, az: number,
        bx: number, by: number, bz: number,
        cx: number, cy: number, cz: number,
        samples: number
    ): number {
        let len = 0;
        let prevX = ax, prevY = ay, prevZ = az;

        for (let i = 1; i <= samples; i++) {
            const t = i / samples;
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

            len += Math.sqrt(dx * dx + dy * dy + dz * dz);
            prevX = px; prevY = py; prevZ = pz;
        }
        return len;
    }

    public getPointAtDistance(distance: number, out: Vector3 = new Vector3()): Vector3 {
        if (this.logicalCount === 0) return out.copy(this.points.length > 0 ? this.points[0] : out.set(0, 0, 0));

        if (this.looping) return this.getPointInternal(this.wrapDistance(distance), out);

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

        const t = (distance - cum[i]) * this.invSegmentLengths[i];
        const pIdx = this.segPointIndices[i];
        const pts = this.points;

        if (this.segTypes[i] === SEG_LINEAR) {
            const a = pts[pIdx];
            const b = pts[pIdx + 1];
            out.set(
                a.x + (b.x - a.x) * t,
                a.y + (b.y - a.y) * t,
                a.z + (b.z - a.z) * t
            );
        } else {
            // Bezier with Calculated Control Point
            const p0 = pts[pIdx];
            const p2 = pts[pIdx + 2];

            // Read from cache
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
        console.log("Drawing debug path indicators...");
        const debugSteps = 500;
        const step = this.totalLength / debugSteps;
        for (let i = 0; i <= debugSteps; i++) {
            const d = i * step;
            const pos = this.getPointAtDistance(d);
            const indicator = new NodeIndicator(0.1);
            indicator.mesh.position.copy(pos);
            indicator.setMode('selected');
            scene.add(indicator.mesh);
            this.pathDebugIndicators.push(indicator);
        }

        // draw the points normal
        this.points.forEach((point, index) => {
            const indicator = new NodeIndicator(0.2);
            indicator.mesh.position.copy(point);

            // Orient the indicator to point towards the next point (or previous for last point)
            if (index < this.points.length - 1) {
                // Point towards next point
                const nextPoint = this.points[index + 1];
                dummy.position.copy(point);
                dummy.lookAt(nextPoint);
                indicator.mesh.quaternion.copy(dummy.quaternion);
            } else if (index > 0 && !this.looping) {
                // Last point: use same orientation as previous point
                const prevIndicator = this.pathDebugIndicators[index - 1];
                indicator.mesh.quaternion.copy(prevIndicator.mesh.quaternion);
            } else if (this.looping && this.points.length > 1) {
                // Looping path: point towards first point
                const nextPoint = this.points[0];
                dummy.position.copy(point);
                dummy.lookAt(nextPoint);
                indicator.mesh.quaternion.copy(dummy.quaternion);
            }

            // Use 'selected' mode (yellow) to make them stand out
            indicator.setMode('selected');

            scene.add(indicator.mesh);
            this.pathDebugIndicators.push(indicator);
        });
    }

    public removeDebugPath(): void {
        this.pathDebugIndicators.forEach(i => {
            if (i.mesh.parent) i.mesh.parent.remove(i.mesh);
            i.dispose();
        });
        this.pathDebugIndicators = [];
    }
}