pc.utils = pc.utils || {};

// currently only supports meshInstances
pc.utils.raycastChildNodesAABB = (() => {
    const ray = new pc.Ray();
    const invDir = new pc.Vec3();
    const sign = new Array(3);

    function rayIntersectsAABB(ray, aabb, invDir, sign) {
        const bounds = [aabb.getMin(), aabb.getMax()];

        // Check if the ray's origin is inside the AABB
        if (ray.origin.x >= bounds[0].x && ray.origin.x <= bounds[1].x &&
            ray.origin.y >= bounds[0].y && ray.origin.y <= bounds[1].y &&
            ray.origin.z >= bounds[0].z && ray.origin.z <= bounds[1].z) {
            return true; // Early exit, ray originates inside AABB
        }

        // else use Andrew Woo's algorithm from "Graphics Gems", 1990
        let tmin = (bounds[sign[0]].x - ray.origin.x) * invDir.x;
        let tmax = (bounds[1 - sign[0]].x - ray.origin.x) * invDir.x;
        let tymin = (bounds[sign[1]].y - ray.origin.y) * invDir.y;
        let tymax = (bounds[1 - sign[1]].y - ray.origin.y) * invDir.y;

        if ((tmin > tymax) || (tymin > tmax)) return false;
        if (tymin > tmin) tmin = tymin;
        if (tymax < tmax) tmax = tymax;

        let tzmin = (bounds[sign[2]].z - ray.origin.z) * invDir.z;
        let tzmax = (bounds[1 - sign[2]].z - ray.origin.z) * invDir.z;

        if ((tmin > tzmax) || (tzmin > tmax)) return false;
        if (tzmin > tmin) tmin = tzmin;
        if (tzmax < tmax) tmax = tzmax;

        return true;
    }

    return (origin, direction, rootNode = pc.app.root, maxIntersections = Infinity) => {
        ray.origin.copy(origin);
        ray.direction.copy(direction);

        // Pre-calculate invDir and sign
        invDir.set(1 / direction.x, 1 / direction.y, 1 / direction.z);
        sign[0] = invDir.x < 0 ? 1 : 0;
        sign[1] = invDir.y < 0 ? 1 : 0;
        sign[2] = invDir.z < 0 ? 1 : 0;

        const meshInstancesFound = [];

        for (let i = 0; i < rootNode.children.length; i++) {
            const child = rootNode.children[i];
            if(!child.render?.enabled) continue;
            const meshInstances = child.render?.meshInstances;
            if (meshInstances && meshInstances.length > 0) {
                const meshInstance = meshInstances[0];
                const aabb = meshInstance.aabb;

                // Perform ray-AABB intersection test
                if (rayIntersectsAABB(ray, aabb, invDir, sign)) {
                    meshInstancesFound.push(meshInstance);
                    if (meshInstancesFound.length >= maxIntersections) {
                        break;
                    }
                }
            }
        }

        return meshInstancesFound;
    };
})();
