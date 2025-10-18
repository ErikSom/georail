var Train = pc.createScript('train');

// initialize code called once per entity
Train.prototype.initialize = function() {
    this.wagons = [];
    this.distance = 0;
    // this.currentPathIndex = 0;
    // this.currentPathIndexDistance = 0;
    this.v1 = new pc.Vec3();
    this.v2 = new pc.Vec3();
    this.q = new pc.Quat();
    this.m = new pc.Mat4();
    this.camera = this.app.root.findByName('Camera');
};

Train.prototype.setRoute = function(route){
    this.route = route;

    // reparent all children
    while(this.entity.children.length){
        const child = this.entity.children[0];
        // we need it on the root else we get precision issues due to large position offset
        child.reparent(this.app.root);

        child.wheelFront = child.findByName('Wheel_Front');
        child.wheelBack = child.findByName('Wheel_Back');

        child.distanceWheelFront = this.v1.sub2(child.getPosition(), child.wheelFront.getPosition()).length();
        child.distanceWheelBack = this.v1.sub2(child.getPosition(), child.wheelBack.getPosition()).length();

        child.wheelFront.reparent(this.app.root);
        child.wheelBack.reparent(this.app.root);


        child.front = child.findByName('Front');
        child.back = child.findByName('Back');

        child.wagonLength = this.v1.sub2(child.front.getPosition(), child.back.getPosition()).length();

        // child.findByName('base').enabled = false;

        this.wagons.push(child);
    };

    const worldTransform = this.entity.parent.getWorldTransform();
    this.inverseWorldTransform = worldTransform.clone().invert();

    this.setOnTrack();

    this.camera.reparent(this.wagons[0]);
    this.v1.set(0.0, 14.0, 100.0);

    // this.camera.setLocalPosition(this.v1);
    this.camera.script.cameraOrbit.initializeFromLocalPosition(this.v1);
    // this.camera.lookAt(this.wagons[0].getLocalPosition());


}

Train.prototype.getPositionAtDistanceRelative = function(distance, startIndex, startDistance) {
    const path = this.route.path;
    const pathLength = path.length;
    let totalDistance = startDistance;
    let i = startIndex;

    if (distance < startDistance) {
        while (i > 0 && totalDistance > distance) {
            i--;
            if(path[i][2] == undefined){
                if(i === 0) path[i][2] = 0;
                path[i][2] = path[i-1][2] + this.calculateSegmentDistance(path[i-1], path[i]);
            }
            totalDistance = path[i][2];
        }
    } else {
        while (i < pathLength && totalDistance < distance) {
            if(path[i][2] == undefined){
                if(i === 0) path[i][2] = 0;
                else path[i][2] = path[i-1][2] + this.calculateSegmentDistance(path[i-1], path[i]);
            }

            totalDistance = path[i][2];
            i++;
        }
    }
    i--;

    if(i <= 0){
        i = 1;
    }

    const item = path[i-1];
    const nextItem = path[i];

    const p1 = this.getFloorPositionFromPathItem(item, nextItem);
    const p2 = this.getFloorPositionFromPathItem(nextItem, item);


    const distanceBetweenPoints = this.v1.sub2(p2, p1).length();
    const travelledDistanceOnPoints = distance - (item[2] || 0);

    const travelProgress = travelledDistanceOnPoints / distanceBetweenPoints;

    return this.v1.lerp(p1, p2, travelProgress);
};

Train.prototype.calculateSegmentDistance = function(prevItem, item) {
    const p1 = this.getFloorPositionFromPathItem(prevItem, item);
    const p2 = this.getFloorPositionFromPathItem(item, prevItem);
    return this.v1.sub2(p2, p1).length();
};

Train.prototype.getFloorPositionFromPathItem = function(pathItem, nextPathItem){
    if(pathItem[3]){
        return pathItem[3];
    }

    const coordData = pc.pathFinder.getDataForCoord(pathItem);
    const patchedAltitude = pc.patcher.getPatchedAltitude(coordData['@id'], coordData._arrayIndex);

    if(patchedAltitude != undefined){
        const [x, y, z] = earthatile.geodeticToCartesian(pathItem[0], pathItem[1], patchedAltitude);
        const floorPosition = this.v1.set(x, z, -y);
        this.entity.getWorldTransform().transformPoint(floorPosition, floorPosition);

        pathItem[3] = floorPosition.clone();
        return pathItem[3];
    }

    let hitData =  pc.geolocation.getFloorPosition(pathItem[0], pathItem[1]);

    if(!hitData.hit){
        // try to find ground along the path
        const lon1 = pathItem[0];
        const lan1 = pathItem[1];

        const lon2 = nextPathItem[0];
        const lan2 = nextPathItem[1];

        for(let alpha = 0.01; alpha < 1; alpha += 0.01){
            const lon = lon1 + alpha * (lon2 - lon1);
            const lan = lan1 + alpha * (lan2 - lan1);

            hitData =  pc.geolocation.getFloorPosition(lon, lan);

            if(hitData.hit){
                break;
            }
        }
    }
    
    pathItem[3] = hitData.point.clone();

    return pathItem[3]
}

Train.prototype.setOnTrack = function() {
    let wagonConnectionLength = 0.5;

    const wheelsLength = 2;

    let distance = this.distance;

    this.wagons.forEach((wagon, i) => {
        const d1 = distance-wagon.distanceWheelBack;
        const d2 = distance+wagon.distanceWheelFront;
        this.orientObjectBetweenDistances(wagon, d1, d2);
        distance -= wagon.wagonLength + wagonConnectionLength;

        const wheelBackD1 = d1 - wheelsLength;
        const wheelBackD2 = d1 + wheelsLength;
        this.orientObjectBetweenDistances(wagon.wheelBack, wheelBackD1, wheelBackD2, true);

        const wheelFrontD1 = d2 - wheelsLength;
        const wheelFrontD2 = d2 + wheelsLength;
        this.orientObjectBetweenDistances(wagon.wheelFront, wheelFrontD1, wheelFrontD2, true, i === 0);


        this.v1.copy(wagon.wheelBack.getPosition());
        wagon.wheelBack.getWorldTransform().transformVector(pc.Vec3.UP, this.v2);
        this.v2.normalize();
        this.v2.mulScalar(0.561);
        this.v1.add(this.v2);
        wagon.wheelBack.setPosition(this.v1);

        this.v1.copy(wagon.wheelFront.getPosition());
        wagon.wheelFront.getWorldTransform().transformVector(pc.Vec3.UP, this.v2);
        this.v2.normalize();
        this.v2.mulScalar(0.561);
        this.v1.add(this.v2);
        wagon.wheelFront.setPosition(this.v1);
    });
};

Train.prototype.orientObjectBetweenDistances = function(entity, d1, d2, setPosition = true, debugPoints){
        const p1 = this.getPositionAtDistanceRelative(d1, 0, 0).clone();
        const p2 = this.getPositionAtDistanceRelative(d2, 0, 0).clone();
        const d = d1 + (d2 - d1) / 2;
        const pos = this.getPositionAtDistanceRelative(d, 0, 0).clone();


        if(debugPoints && !this.debugP1){
            const material1 = new pc.StandardMaterial();

            this.debugP1 = new pc.Entity();
            this.debugP1.addComponent("render", {
                type: "sphere",
                material: material1
            });
            this.app.root.addChild(this.debugP1);
            this.debugP1.render.meshInstances[0].material.diffuse.set(1, 0, 0); 
            this.debugP1.render.meshInstances[0].material.update();

            const material2 = new pc.StandardMaterial();

            this.debugP2 = new pc.Entity();
            this.debugP2.addComponent("render", {
                type: "sphere",
                material: material2
            });
            this.app.root.addChild(this.debugP2);
            this.debugP2.render.meshInstances[0].material.diffuse.set(0, 1, 0); 
            this.debugP2.render.meshInstances[0].material.update();


            const material3 = new pc.StandardMaterial();

            this.debugP3 = new pc.Entity();
            this.debugP3.addComponent("render", {
                type: "sphere",
                material: material3
            });
            this.app.root.addChild(this.debugP3);
            this.debugP3.render.meshInstances[0].material.diffuse.set(0, 0, 1); 
            this.debugP3.render.meshInstances[0].material.update();
        }

        if(debugPoints){
            this.debugP1.setPosition(p1);
            this.debugP2.setPosition(p2);
            this.debugP3.setPosition(pos);
        }


        const direction = this.v1.sub2(p2, p1);
        direction.normalize();

        // // Transform p1 to local space to use with constructSphericalBasis
        const localPosition = this.inverseWorldTransform.transformPoint(pos.clone());

        // // Construct the spherical basis using the original local position
        const m = pc.math.constructSphericalBasis(localPosition);
        const initialQuat = this.q.setFromMat4(m);

        // // Extract the "up" direction from the initial quaternion
        const upDirection = this.v2;
        initialQuat.transformVector(pc.Vec3.UP, upDirection);

        // // Create a matrix from the forward and up directions
        const finalMatrix = this.m;
        finalMatrix.setLookAt(pc.Vec3.ZERO, direction, upDirection);

        // // Convert the final matrix to a quaternion
        const finalQuat = this.q.setFromMat4(finalMatrix);

        const slerpedQuat = entity.getRotation();
        slerpedQuat.slerp(slerpedQuat, finalQuat, 1.0);

        // Set the entity's position to p1 and apply the final rotation
        if(setPosition) entity.setPosition(pos);
        entity.setRotation(slerpedQuat);

}


// update code called every frame
Train.prototype.update = function(dt) {
    const speedKmh = 80; // speed in kilometers per hour
    const speedMps = speedKmh * 1000 / 3600; // convert to meters per second

    // Update distance traveled based on speed and delta time
    this.distance += speedMps * dt;
    this.setOnTrack();
};