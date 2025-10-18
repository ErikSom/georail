pc.utils = pc.utils || {};

// currently only supports meshInstances
pc.utils.raycastFurthestPointOnMeshInstances = (() => {
    const ray = new pc.Ray();
    const initialOrigin = new pc.Vec3();
    const furthestHitPoint = new pc.Vec3();
    const v = new pc.Vec3();

    return (origin, direction, targets, maxDistance = Infinity) => {
        initialOrigin.copy(origin);
        ray.direction = direction;

        furthestHitPoint.set(0, 0, 0);
        let furthestDistance = 0;
        
        targets.forEach(target => {
            ray.origin = initialOrigin.clone();
            let continueRaycasting = true;

            while (continueRaycasting) {
                const hitPoint = target.rayCast(ray);

                if (hitPoint) {
                    // Calculate the distance from the ray's origin to the hit point
                    const distance = v.sub2(hitPoint, initialOrigin).length();

                    // If this hit is further than the previous one, update the furthest hit
                    if (distance > furthestDistance && distance < maxDistance) {
                        furthestDistance = distance;
                        furthestHitPoint.copy(hitPoint);
                    }

                    // Move the ray origin slightly forward to avoid hitting the same triangle again
                    v.copy(ray.direction).scale(0.1);
                    ray.origin.copy(hitPoint).add(v);
                } else {
                    // If no more hits are found, stop the loop
                    continueRaycasting = false;
                }
            }
        });

        return { hit: furthestDistance > 0, distance:furthestDistance, point: furthestHitPoint }
    };
})();
