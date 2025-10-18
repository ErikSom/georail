// BVH
(function(){
    const _tempVec1 = new pc.Vec3();

    class BVHNode {
        constructor(aabbMin = new pc.Vec3(), aabbMax = new pc.Vec3(), leftFirst = null, triCount = 0) {
            this.aabbMin = aabbMin || new pc.Vec3();
            this.aabbMax = aabbMax || new pc.Vec3();
            this.leftFirst = leftFirst || null;
            this.triCount = triCount || 0;
        }
        isLeaf() {
            return this.triCount > 0;
        }
    }


    class Bin {
        constructor(BINS) {
            this.BINS = BINS;
            this.bounds = new pc.BoundingBox(new pc.Vec3(), new pc.Vec3());
            this.triCount = 0;
        }
    }

    class Bvh {
        constructor(triangles, args = {}) {
            this.bvhNode = [];
            this.triangles = triangles || [];
            this.triIdx = [];
            this.minDist = null;

            this.updateNodeBounds = this.updateNodeBounds.bind(this);
            this.subdivide = this.subdivide.bind(this);
            this.build = this.build.bind(this);
            this.intersectAABB = this.intersectAABB.bind(this);
            this.intersect = this.intersect.bind(this);

            this.bins = args.bins || 10;

            this.stack = [];

            this.build();
        }

        updateNodeBounds(nodeIdx) {
            const node = this.bvhNode[nodeIdx];
            node.aabbMin.set(Infinity, Infinity, Infinity);
            node.aabbMax.set(-Infinity, -Infinity, -Infinity);
            const first = node.leftFirst;
            const triCount = node.triCount;
            const { triangles } = this;
            for (let i = 0; i < triCount; i++) {
                const leafTriIdx = this.triIdx[first + i];
                const leafTri = triangles[leafTriIdx];
                node.aabbMin.min(leafTri.vertex0);
                node.aabbMin.min(leafTri.vertex1);
                node.aabbMin.min(leafTri.vertex2);
                node.aabbMax.max(leafTri.vertex0);
                node.aabbMax.max(leafTri.vertex1);
                node.aabbMax.max(leafTri.vertex2);
            }
        }

        findBestSplitPlane(splitDetails) {
            const node = splitDetails.node;
            let bestCost = Infinity;
            const { triangles, triIdx } = this;
            for (let a = 0; a < 3; a++) {
                const b = ['x', 'y', 'z'][a];
                let boundsMin = Infinity;
                let boundsMax = -1 * Infinity;
                for (let i = 0; i < node.triCount; i++) {
                    const triangle = triangles[triIdx[node.leftFirst + i]];
                    boundsMin = Math.min(boundsMin, triangle.centroid[b]);
                    boundsMax = Math.max(boundsMax, triangle.centroid[b]);
                }
                if (boundsMin === boundsMax) continue;

                const bin = Array.apply(null, Array(this.bins)).map(function () {
                    return new Bin();
                });
                let scale = this.bins / (boundsMax - boundsMin);
                for (let i = 0; i < node.triCount; i++) {
                    const triangle = triangles[triIdx[node.leftFirst + i]];
                    const binIdx = Math.min(this.bins - 1, Math.floor((triangle.centroid[b] - boundsMin) * scale));
                    bin[binIdx].triCount++;
                    bin[binIdx].bounds.setMinMax(_tempVec1.min2(bin[binIdx].bounds.getMin(), triangle.vertex0), _tempVec1.max2(bin[binIdx].bounds.getMax(), triangle.vertex0));
                    bin[binIdx].bounds.setMinMax(_tempVec1.min2(bin[binIdx].bounds.getMin(), triangle.vertex1), _tempVec1.max2(bin[binIdx].bounds.getMax(), triangle.vertex1));
                    bin[binIdx].bounds.setMinMax(_tempVec1.min2(bin[binIdx].bounds.getMin(), triangle.vertex2), _tempVec1.max2(bin[binIdx].bounds.getMax(), triangle.vertex2));
                }
                const leftArea = Array(this.bins - 1);
                const rightArea = Array(this.bins - 1);
                const leftCount = Array(this.bins - 1);
                const rightCount = Array(this.bins - 1);

                const leftBox = new pc.BoundingBox(new pc.Vec3(), new pc.Vec3());
                const rightBox = new pc.BoundingBox(new pc.Vec3(), new pc.Vec3());
                let leftSum = 0;
                let rightSum = 0;

                for (let i = 0; i < this.bins - 1; i++) {
                    leftSum += bin[i].triCount;
                    leftCount[i]  = leftSum;
                    leftBox.setMinMax(_tempVec1.min2(leftBox.getMin(), bin[i].bounds.getMin()), _tempVec1.max2(leftBox.getMax(), bin[i].bounds.getMax()));
                    leftArea[i] = leftBox.halfArea;
                    rightSum += bin[this.bins - 1 - i].triCount;
                    rightCount[this.bins - 2 - i] = rightSum;
                    rightBox.setMinMax(_tempVec1.min2(rightBox.getMin(), bin[this.bins - 1 - i].bounds.getMin()), _tempVec1.max2(rightBox.getMax(), bin[this.bins - 1 - i].bounds.getMax()));
                    rightArea[this.bins - 2 - i] = rightBox.halfArea;
                }

                scale = (boundsMax - boundsMin) / this.bins;
                for (let i = 0; i < this.bins - 1; i++) {
                    const planeCost = leftCount[i] * leftArea[i] + rightCount[i] * rightArea[i];
                    if (planeCost < bestCost) {
                        splitDetails.axis = b;
                        splitDetails.splitPos = boundsMin + scale * (i + 1);
                        bestCost = planeCost;
                    }
                }
            }
            return bestCost;
        }

        calculateNodeCost(node) {
            // Calculate the extent of the node's aabb
            _tempVec1.sub2(node.aabbMax, node.aabbMin);

            const surfaceArea = _tempVec1.x * _tempVec1.y + _tempVec1.y * _tempVec1.z + _tempVec1.z * _tempVec1.x;

            return node.triCount * surfaceArea;
        }

        subdivide(nodeIdx) {
            const node = this.bvhNode[nodeIdx];

            const { triangles, triIdx } = this;

            const splitDetails = { node: node, axis: null, splitPos: null, splitCost: null };

            // const splitCost = this.findBestSplitPlane(splitDetails);
            this.findBestSplitPlane(splitDetails);

            const axis = splitDetails.axis;

            const splitPos = splitDetails.splitPos;

            // terminates tree building when number of leafnodes is less than a threshold
            if (node.triCount < 10) {
                return;
            }

            // Perform the split
            let i = node.leftFirst;
            let j = i + node.triCount - 1;
            while (i <= j) {
                if (triangles[triIdx[i]].centroid[axis] < splitPos) {
                    i++;
                } else {
                    [triIdx[i], triIdx[j]] = [triIdx[j], triIdx[i]];
                    j--;
                }
            }

            const leftCount = i - node.leftFirst;
            if (leftCount === 0 || leftCount === node.triCount) {
                return;
            }

            // Create child nodes for each half
            const leftChildIdx = this.nodesUsed++;
            const rightChildIdx = this.nodesUsed++;
            this.bvhNode[leftChildIdx].leftFirst = node.leftFirst;
            this.bvhNode[leftChildIdx].triCount = leftCount;
            this.bvhNode[rightChildIdx].leftFirst = i;
            this.bvhNode[rightChildIdx].triCount = node.triCount - leftCount;
            node.leftFirst = leftChildIdx;
            node.triCount = 0;
            this.updateNodeBounds(leftChildIdx);
            this.updateNodeBounds(rightChildIdx);

            // Recurse into each of the child nodes
            this.subdivide(leftChildIdx);
            this.subdivide(rightChildIdx);
        }

        build() {
            const { triangles } = this;
            const n = triangles.length;
            this.triIdx = Array.from({ length: n }, (x, i) => i);
            this.bvhNode = Array.apply(null, Array(n * 2)).map(function () {
                return new BVHNode();
            });
            const rootNodeIdx = 0;
            this.nodesUsed = 1;

            for (let i = 0; i < n; i++) {
                triangles[i].calculateCentroid();
            }
            const root = this.bvhNode[0];
            root.leftFirst = 0;
            root.triCount = n;
            this.updateNodeBounds(rootNodeIdx);
            this.subdivide(rootNodeIdx);
        }

        refit(triangles) {
            this.triangles = triangles;
            const bvhNode = this.bvhNode;
            for (let i = this.nodesUsed - 1; i >= 0; i--) {
                if (i !== 1) {
                    const node = bvhNode[i];
                    if (node.isLeaf()) {
                        // adjust bounds to contained triangles for leaf nodes
                        this.updateNodeBounds(i);
                        continue;
                    }
                    // adjust boudns to child node bounds in interior nodes
                    const leftChild = bvhNode[node.leftFirst];
                    const rightChild = bvhNode[node.leftFirst + 1];
                    node.aabbMin.min2(leftChild.aabbMin, rightChild.aabbMin);
                    node.aabbMax.max2(leftChild.aabbMax, rightChild.aabbMax);
                }
            }
        }

        intersect(ray, nodeIdx = 0) {
            this.minDist = null;
            const stack = this.stack;
            stack.length = 0;

            ray.rDx = 1 / ray.direction.x;
            ray.rDy = 1 / ray.direction.y;
            ray.rDz = 1 / ray.direction.z;

            let node = this.bvhNode[nodeIdx];
            let stackPtr = 0;
            while (true) {
                if (node.isLeaf()) {
                    for (let i = 0; i < node.triCount; i++) {
                        const dist = this.triangles[this.triIdx[node.leftFirst + i]].intersectWithRay(ray);
                        if (dist) {
                            if (this.minDist == null) {
                                this.minDist = dist;
                            }
                            this.minDist = Math.min(this.minDist, dist);
                        }
                    }
                    if (stackPtr === 0) {
                        break;
                    } else {
                        node = stack[--stackPtr];
                        continue;
                    }
                }
                let child1 = this.bvhNode[node.leftFirst];
                let child2 = this.bvhNode[node.leftFirst + 1];
                let dist1 = this.intersectAABB(ray, child1.aabbMin, child1.aabbMax);
                let dist2 = this.intersectAABB(ray, child2.aabbMin, child2.aabbMax);
                if (dist1 > dist2) {
                    [dist1, dist2] = [dist2, dist1];
                    [child1, child2] = [child2, child1];
                }
                if (dist1 === Infinity) {
                    if (stackPtr === 0) {
                        break;
                    } else {
                        node = stack[--stackPtr];
                    }
                } else {
                    node = child1;
                    if (dist2 !== Infinity) {
                        stack[stackPtr++] = child2;
                    }
                }
            }
        }

        intersectAABB(ray, bmin, bmax) {

            const tx1 = (bmin.x - ray.origin.x) * ray.rDx;
            const tx2 = (bmax.x - ray.origin.x) * ray.rDx;
            let tmin = Math.min(tx1, tx2);
            let tmax = Math.max(tx1, tx2);
            const ty1 = (bmin.y - ray.origin.y) * ray.rDy;
            const ty2 = (bmax.y - ray.origin.y) * ray.rDy;
            tmin = Math.max(tmin, Math.min(ty1, ty2));
            tmax = Math.min(tmax, Math.max(ty1, ty2));
            const tz1 = (bmin.z - ray.origin.z) * ray.rDz;
            const tz2 = (bmax.z - ray.origin.z) * ray.rDz;
            tmin = Math.max(tmin, Math.min(tz1, tz2));
            tmax = Math.min(tmax, Math.max(tz1, tz2));
            if (tmax >= tmin  && tmax > 0 && (this.minDist == null || (this.minDist != null && tmin < this.minDist))) {
                return tmin;
            }
            return Infinity;
        }
    }

    pc.math.Bvh = Bvh;
})();

// Tri
(function(){
    // Internal variables
    const h = new pc.Vec3();
    const s = new pc.Vec3();
    const q = new pc.Vec3();

    const third = 1 / 3;

    class Tri {

        constructor(vertex0, vertex1, vertex2) {
            this.vertex0 = vertex0;
            this.vertex1 = vertex1;
            this.vertex2 = vertex2;
            this.centroid = new pc.Vec3();
            this.edge1 = new pc.Vec3();
            this.edge1.sub2(this.vertex1, this.vertex0);
            this.edge2 = new pc.Vec3();
            this.edge2.sub2(this.vertex2, this.vertex0);
        }

        resetEdges() {
            this.edge1.sub2(this.vertex1, this.vertex0);
            this.edge2.sub2(this.vertex2, this.vertex0);
        }

        intersectWithRay(ray) {
            const { edge1, edge2 } = this;
            h.cross(ray.direction, edge2);
            const a = edge1.dot(h);
            if (a > -0.0001 && a < 0.0001) {
                return;
            }
            const f = 1 / a;
            s.sub2(ray.origin, this.vertex0);
            const u = f * s.dot(h);
            if (u < 0 || u > 1) {
                return;
            }
            q.cross(s, edge1);
            const v = f * ray.direction.dot(q);
            if (v < 0 || u + v > 1) {
                return;
            }
            const t = f * edge2.dot(q);
            if (t > 0.0001) {
                return t;
            }
        }

        calculateCentroid() {
            this.centroid.set(0, 0, 0);
            this.centroid.add(this.vertex0);
            this.centroid.add(this.vertex1);
            this.centroid.add(this.vertex2);
            this.centroid.mulScalar(third);
        }
    }

    pc.math.Tri = Tri;
})();

// Extensions
(function(){
    // Vec3 extension
    pc.Vec3.prototype.min2 = function(lhs, rhs) {
        this.x = Math.min(lhs.x, rhs.x);
        this.y = Math.min(lhs.y, rhs.y);
        this.z = Math.min(lhs.z, rhs.z);
        return this;
    }

    pc.Vec3.prototype.max2 = function(lhs, rhs) {
        this.x = Math.max(lhs.x, rhs.x);
        this.y = Math.max(lhs.y, rhs.y);
        this.z = Math.max(lhs.z, rhs.z);
        return this;
    }
    // BoundingBox extension
    pc.BoundingBox.prototype.halfArea = function() {
        const { x, y, z } = this.halfExtents;
        // Multiply halfExtents by 2 and simplify to least amount of add/mul:
        // == (x*2)*(y*2) + (z*2)*(x*2) + (y*2)*(z*2)
        // == 4 * x * y   + 4 * z * x   + 4 * y * z
        // == 4 * (x * y  + z * x       + y * z)
        // == 4 * (x * (y + z)          + y * z)
        return 4 * (x * (y + z) + y * z);
    }
    // Ray extension
    pc.Ray.prototype.transform = function(matrix) {
        matrix.transformPoint(this.origin, this.origin);
        matrix.transformVector(this.direction, this.direction);
    }

    // Mesh extension
    pc.Mesh.prototype.buildTriangleArray = function () {
        if(this.triangles === undefined){
            this.triangles = [];
            this.points = [];
        }

        const triangles = this.triangles;
        const positions = [];
        const indices = [];
        const numPositions = this.getPositions(positions);
        const numIndices = this.getIndices(indices);
        const points = this.points;
        const numTriangles = numIndices / 3;

        if (points.length === 0) {
            let j = 0;
            for (let i = 0; i < numPositions; i++) {
                const v = new pc.Vec3(positions[j], positions[j + 1], positions[j + 2]);
                points.push(v);
                j += 3;
            }
        } else {
            let j = 0;
            for (let i = 0; i < numPositions; i++) {
                const v = points[i];
                v.set(positions[j], positions[j + 1], positions[j + 2]);
                j += 3;
            }
        }


        if (triangles.length === 0) {
            let j = 0;
            for (let i = 0; i < numTriangles; i++) {
                const triangle = new pc.math.Tri(points[indices[j]], points[indices[j + 1]], points[indices[j + 2]]);
                triangles.push(triangle);
                j += 3;
            }
        } else {
            let j = 0;
            for (let i = 0; i < numTriangles; i++) {
                const triangle = triangles[i];
                triangle.vertex0.copy(points[indices[j]]);
                triangle.vertex1.copy(points[indices[j + 1]]);
                triangle.vertex2.copy(points[indices[j + 2]]);
                triangle.resetEdges();
                j += 3;
            }
        }
    }

    const oldUpdate = pc.Mesh.prototype.update;
    pc.Mesh.prototype.update = function(primitiveType = pc.PRIMITIVE_TRIANGLES, updateBoundingBox = true){
        oldUpdate.call(this, primitiveType, updateBoundingBox);
        this.dirtyBVH = true;
    }

    pc.Mesh.prototype.rayCast = function(ray) {

        // if the BVH doesn't exist, build it
        if (!this.bvh) {
            this.buildTriangleArray();
            this.bvh = new pc.math.Bvh(this.triangles);
        }

        // Rebuild triangles and refit the BVH if the mesh has been altered
        if (this.dirtyBVH) {
            this.buildTriangleArray();
            this.bvh.refit(this.triangles);
            this.dirtyBVH = false;
        }

        this.bvh.intersect(ray, 0);

        return this.bvh.minDist;
    }

    // MeshInstance extension
    const _worldTransformInverted = new pc.Mat4();
    const _transformedRay = new pc.Ray();

    pc.MeshInstance.prototype.rayCast = function(ray) {
        _worldTransformInverted.copy(this.node.getWorldTransform());
        _worldTransformInverted.invert();
        _transformedRay.set(ray.origin, ray.direction);
        _transformedRay.transform(_worldTransformInverted);
        _transformedRay.direction.normalize();
        const dist = this._mesh.rayCast(_transformedRay);
        if (dist) {
            _transformedRay.direction.mulScalar(dist);
            _transformedRay.origin.add(_transformedRay.direction);
            this.node.getWorldTransform().transformPoint(_transformedRay.origin, _transformedRay.origin);
            return _transformedRay.origin;
        }
        return null;
    }
})();