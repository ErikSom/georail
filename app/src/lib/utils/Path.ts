import { Mesh, MeshBasicMaterial, Scene, SphereGeometry, Vector3 } from "three";

export default class Path {
    public points: Vector3[];
    public pathDebugSpheres: Mesh[] = [];

    constructor(points: Vector3[]) {
        this.points = points;
    }

    /**
     * Get a point on the path at a specific distance from a starting index
     * This allows us to find where the wheels should be positioned
     * Extrapolates beyond path endpoints if necessary
     */
    public getPointAtDistance(startIndex: number, distance: number): { point: Vector3; index: number } | null {
        if (this.points.length < 2) return null;

        let currentIndex = startIndex;
        let remainingDistance = Math.abs(distance);
        const forward = distance >= 0;

        let currentPoint = this.points[currentIndex].clone();

        while (remainingDistance > 0 && currentIndex >= 0 && currentIndex < this.points.length - 1) {
            const nextIndex = forward ? currentIndex + 1 : currentIndex - 1;

            // If we've reached the bounds, extrapolate
            if (nextIndex < 0) {
                // Extrapolate backward from index 0 using direction from point 1 to point 0
                const direction = new Vector3().subVectors(this.points[0], this.points[1]).normalize();
                currentPoint.copy(this.points[0]).add(direction.multiplyScalar(remainingDistance));
                break;
            } else if (nextIndex >= this.points.length) {
                // Extrapolate forward from last index
                const lastIndex = this.points.length - 1;
                const direction = new Vector3().subVectors(this.points[lastIndex], this.points[lastIndex - 1]).normalize();
                currentPoint.copy(this.points[lastIndex]).add(direction.multiplyScalar(remainingDistance));
                break;
            }

            const segmentVector = new Vector3().subVectors(this.points[nextIndex], this.points[currentIndex]);
            const segmentLength = segmentVector.length();

            if (segmentLength >= remainingDistance) {
                // The point is within this segment
                const t = remainingDistance / segmentLength;
                currentPoint.lerpVectors(this.points[currentIndex], this.points[nextIndex], t);
                currentIndex = nextIndex;
                break;
            } else {
                // Move to next segment
                remainingDistance -= segmentLength;
                currentIndex = nextIndex;
                currentPoint.copy(this.points[currentIndex]);
            }
        }

        return { point: currentPoint, index: currentIndex };
    }

    public drawDebugPath(scene: Scene): void {
        // Clear existing debug spheres
        this.pathDebugSpheres.forEach(sphere => scene.remove(sphere));
        this.pathDebugSpheres = [];

        const sphereGeometry = new SphereGeometry(0.4, 8, 8);
        const sphereMaterial = new MeshBasicMaterial({ color: 0xffff00 });

        this.points.forEach((point, index) => {
            const sphere = new Mesh(sphereGeometry, sphereMaterial);
            sphere.position.copy(point);
            scene.add(sphere);
            this.pathDebugSpheres.push(sphere);
        });
    }
}