import { Mesh, MeshBasicMaterial, Scene, SphereGeometry, Vector3 } from "three";

const EPS = 1e-6;
const MAX_WALK = 4; // Max segments to scan linearly before switching to binary search

export default class Path {
    public points: Vector3[];

    // Optimized memory layout for fast CPU caching
    private cumulativeLengths!: Float64Array;
    private invSegmentLengths!: Float64Array;
    private totalLength = 0;

    // Cached extrapolation directions
    private startDir = new Vector3(1, 0, 0);
    private endDir = new Vector3(1, 0, 0);

    // Finger-search cache
    private lastIndex = 0;

    // Debug
    private pathDebugSpheres: Mesh[] = [];

    constructor(points: Vector3[]) {
        this.points = points;
        this.precompute();
    }

    private precompute(): void {
        const n = this.points.length;
        if (n < 2) {
            this.totalLength = 0;
            this.cumulativeLengths = new Float64Array(n);
            this.invSegmentLengths = new Float64Array(Math.max(0, n - 1));
            return;
        }

        this.cumulativeLengths = new Float64Array(n);
        this.invSegmentLengths = new Float64Array(n - 1);

        let total = 0;
        this.cumulativeLengths[0] = 0;

        for (let i = 0; i < n - 1; i++) {
            const a = this.points[i];
            const b = this.points[i + 1];

            const dx = b.x - a.x;
            const dy = b.y - a.y;
            const dz = b.z - a.z;

            const segLen = Math.sqrt(dx * dx + dy * dy + dz * dz);
            total += segLen;

            this.cumulativeLengths[i + 1] = total;
            // Store 1/length to multiply later (faster than division)
            this.invSegmentLengths[i] = segLen > EPS ? 1 / segLen : 0;
        }

        this.totalLength = total;
        this.lastIndex = 0;

        // Cache startDir: first non-degenerate segment direction
        for (let i = 0; i < n - 1; i++) {
            if (this.invSegmentLengths[i] !== 0) {
                const a = this.points[i];
                const b = this.points[i + 1];
                this.startDir.set(b.x - a.x, b.y - a.y, b.z - a.z).normalize();
                break;
            }
        }

        // Cache endDir: last non-degenerate segment direction
        for (let i = n - 2; i >= 0; i--) {
            if (this.invSegmentLengths[i] !== 0) {
                const a = this.points[i];
                const b = this.points[i + 1];
                this.endDir.set(b.x - a.x, b.y - a.y, b.z - a.z).normalize();
                break;
            }
        }
    }

    /**
     * Get a point on the path at distance X.
     * @param distance Absolute distance along the path.
     * @param out Optional Vector3 to write result into (avoids GC).
     */
    public getPointAtDistance(distance: number, out: Vector3 = new Vector3()): Vector3 {
        const n = this.points.length;

        // Handle degenerate paths
        if (n < 2) {
            return n === 1 ? out.copy(this.points[0]) : out.set(0, 0, 0);
        }

        // 1. Negative Extrapolation
        if (distance < 0) {
            return out.copy(this.points[0]).addScaledVector(this.startDir, distance);
        }

        // 2. Forward Extrapolation
        if (distance >= this.totalLength) {
            const last = this.points[n - 1];
            return out.copy(last).addScaledVector(this.endDir, distance - this.totalLength);
        }

        // 3. Interpolate
        return this.getPointOnPathInternal(distance, out);
    }

    private getPointOnPathInternal(distance: number, out: Vector3): Vector3 {
        const cum = this.cumulativeLengths;
        const pts = this.points;
        const maxSeg = pts.length - 2;

        // Clamp cached index to valid range
        let i = this.lastIndex;
        if (i < 0) i = 0;
        else if (i > maxSeg) i = maxSeg;

        // Check if 'i' is still correct (most likely case)
        if (distance < cum[i] || distance > cum[i + 1]) {

            // We moved! Use "Bounded Walk" strategy.
            // Checks neighbors first, walks a bit, then falls back to binary search.

            // Moving Forward
            if (distance > cum[i + 1]) {
                let k = 0;
                while (k < MAX_WALK && i < maxSeg && distance > cum[i + 1]) {
                    i++;
                    k++;
                }
            }
            // Moving Backward
            else {
                let k = 0;
                while (k < MAX_WALK && i > 0 && distance < cum[i]) {
                    i--;
                    k++;
                }
            }

            // If the walk didn't find it (Teleport or Fast Movement), use Binary Search
            if (distance < cum[i] || distance > cum[i + 1]) {
                i = this.binarySearchSeg(distance);
            }
        }

        // Update cache
        this.lastIndex = i;

        // --- Calculation ---
        // Direct array access + manual lerp (No Vector3 allocation)
        const a = pts[i];
        const b = pts[i + 1];

        // (distance - start) * (1 / length)
        const alpha = (distance - cum[i]) * this.invSegmentLengths[i];

        out.set(
            a.x + (b.x - a.x) * alpha,
            a.y + (b.y - a.y) * alpha,
            a.z + (b.z - a.z) * alpha
        );

        return out;
    }

    private binarySearchSeg(distance: number): number {
        const cum = this.cumulativeLengths;
        let low = 0;
        let high = cum.length - 2;

        while (low <= high) {
            const mid = (low + high) >>> 1;
            if (cum[mid + 1] < distance) {
                low = mid + 1;
            } else if (cum[mid] > distance) {
                high = mid - 1;
            } else {
                return mid; // Exact match found
            }
        }
        // Clamping handles out-of-bounds inputs gracefully
        return Math.max(0, Math.min(cum.length - 2, high));
    }

    public getTotalLength(): number {
        return this.totalLength;
    }

    public removeDebugPath(): void {
        this.pathDebugSpheres.forEach(sphere => {
            if (sphere.parent) {
                sphere.parent.remove(sphere);
            }
            sphere.geometry.dispose();
            if (sphere.material instanceof MeshBasicMaterial) {
                sphere.material.dispose();
            }
        });
        this.pathDebugSpheres = [];
    }

    public drawDebugPath(scene: Scene): void {
        this.removeDebugPath();

        const sphereGeometry = new SphereGeometry(0.4, 8, 8);
        const sphereMaterial = new MeshBasicMaterial({ color: 0xffff00 });

        this.points.forEach((point) => {
            const sphere = new Mesh(sphereGeometry, sphereMaterial);
            sphere.position.copy(point);
            scene.add(sphere);
            this.pathDebugSpheres.push(sphere);
        });
    }

    public cleanup(): void {
        this.removeDebugPath();
    }
}