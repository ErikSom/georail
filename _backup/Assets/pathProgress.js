var PathProgress = pc.createScript('pathProgress');

PathProgress.attributes.add('pathContainer', {
    type: 'entity'
});

PathProgress.attributes.add('mass', {
    type: 'number',
    default: 1.0,
    description: 'Mass of the entity'
});

PathProgress.attributes.add('engineForce', {
    type: 'number',
    default: 10.0,
    description: 'Force applied by the engine'
});

PathProgress.attributes.add('dragCoefficient', {
    type: 'number',
    default: 0.1,
    description: 'Linear drag coefficient to simulate friction and air resistance'
});

PathProgress.attributes.add('brakingCoefficient', {
    type: 'number',
    default: 0.2,  // Braking coefficient to simulate additional friction when braking
    description: 'Coefficient for braking, similar to drag but applied when brakes are engaged'
});

PathProgress.prototype.initialize = function() {
    this.v = new pc.Vec3();
    this.path = pc.pathFromChilds(this.pathContainer);
    this.distanceTravelled = 0.0;
    
    // Initialize physics properties
    this.velocity = 0.0; // Start with zero velocity
    this.acceleration = 0.0; // Acceleration will be calculated based on force and mass
};

PathProgress.prototype.positionOnPath = function() {
    let totalDistance = 0;
    const { path, v } = this;
    for (let i = 0; i < path.length - 1; i++) {
        let segmentLength = v.sub2(path[i], path[i + 1]).length();
        if (this.distanceTravelled >= 0 && this.distanceTravelled <= totalDistance + segmentLength) {
            const t = (this.distanceTravelled - totalDistance) / segmentLength;
            v.set(
                path[i].x + t * (path[i + 1].x - path[i].x),
                path[i].y + t * (path[i + 1].y - path[i].y),
                path[i].z + t * (path[i + 1].z - path[i].z)
            );
            this.entity.setPosition(v);
            return;
        }
        totalDistance += segmentLength;
    }

    if(this.distanceTravelled < 0){
        this.distanceTravelled += totalDistance;
    } else {
        this.distanceTravelled -= totalDistance;
    }

    this.positionOnPath();
}

// update code called every frame
PathProgress.prototype.update = function(dt) {
    // Calculate acceleration based on the engine force and mass
    this.acceleration = this.engineForce / this.mass;


    if (this.app.keyboard.isPressed(pc.KEY_W)) {
        // Apply acceleration to velocity
        this.velocity += this.acceleration * dt;
    } else  if (this.app.keyboard.isPressed(pc.KEY_S)) {
        // Apply acceleration to velocity
        this.velocity -= this.acceleration * dt;
    }

    let effectiveDragCoefficient = this.dragCoefficient;
    if(this.app.keyboard.isPressed(pc.KEY_SPACE)){
        // Add break friction
        console.log("******** BRAKING!!!")
        effectiveDragCoefficient += this.brakingCoefficient;
    }

    // Apply linear drag to simulate brake, friction and air resistance
    this.velocity -= effectiveDragCoefficient * this.velocity * dt;

    // Update the distance travelled based on the velocity
    this.distanceTravelled += this.velocity * dt;

    // Update the entity's position along the path
    this.positionOnPath();
};