var CameraOrbit = pc.createScript('cameraOrbit');

// Editor attributes to tweak the behavior from the editor
CameraOrbit.attributes.add('targetLocalPosition', {
    type: 'vec3',
    default: [0, 0, 0],
    title: 'Target Local Position',
    description: 'The local position in the target entity to look at'
});

CameraOrbit.attributes.add('distanceMax', {
    type: 'number',
    default: 100,
    title: 'Max Distance',
    description: 'Maximum zoom distance from the target'
});

CameraOrbit.attributes.add('distanceMin', {
    type: 'number',
    default: 20,
    title: 'Min Distance',
    description: 'Minimum zoom distance from the target'
});

CameraOrbit.attributes.add('pitchAngleMax', {
    type: 'number',
    default: 75,
    title: 'Max Pitch Angle',
    description: 'Maximum pitch angle in degrees'
});

CameraOrbit.attributes.add('pitchAngleMin', {
    type: 'number',
    default: -75,
    title: 'Min Pitch Angle',
    description: 'Minimum pitch angle in degrees'
});

CameraOrbit.attributes.add('yawSpeed', {
    type: 'number',
    default: 0.3,
    title: 'Yaw Speed',
    description: 'Speed of yaw rotation'
});

CameraOrbit.attributes.add('pitchSpeed', {
    type: 'number',
    default: 0.3,
    title: 'Pitch Speed',
    description: 'Speed of pitch rotation'
});

CameraOrbit.attributes.add('zoomSpeed', {
    type: 'number',
    default: 0.5,
    title: 'Zoom Speed',
    description: 'Speed of zooming in and out'
});

// Initialize the script
CameraOrbit.prototype.initialize = function() {
    // Current pitch and yaw angles
    this.pitch = 0;
    this.yaw = 0;
    this.v1 = new pc.Vec3();

    // Current distance from the target
    this.distance = (this.distanceMax + this.distanceMin) / 2;

    // Flag to check if mouse is pressed
    this.isMousePressed = false;

    // Listen to mouse events
    this.app.mouse.on(pc.EVENT_MOUSEDOWN, this.onMouseDown, this);
    this.app.mouse.on(pc.EVENT_MOUSEUP, this.onMouseUp, this);
    this.app.mouse.on(pc.EVENT_MOUSEMOVE, this.onMouseMove, this);
    this.app.mouse.on(pc.EVENT_MOUSEWHEEL, this.onMouseWheel, this);

    // Lock the mouse pointer (optional)
    // this.app.mouse.enablePointerLock();

    // Update the camera position once at the start
    this.updateCameraPosition();
};

// Update function called every frame
CameraOrbit.prototype.update = function(dt) {
    // Smoothly update the camera position
    this.updateCameraPosition();
};

// Mouse down event
CameraOrbit.prototype.onMouseDown = function(event) {
    if (event.button === pc.MOUSEBUTTON_LEFT) {
        this.isMousePressed = true;
    }
};

// Mouse up event
CameraOrbit.prototype.onMouseUp = function(event) {
    if (event.button === pc.MOUSEBUTTON_LEFT) {
        this.isMousePressed = false;
    }
};

// Mouse move event
CameraOrbit.prototype.onMouseMove = function(event) {
    if (this.isMousePressed) {
        // Update yaw and pitch based on mouse movement
        this.yaw -= event.dx * this.yawSpeed;
        this.pitch += event.dy * this.pitchSpeed;

        // Clamp the pitch angle within min and max limits
        this.pitch = pc.math.clamp(this.pitch, this.pitchAngleMin, this.pitchAngleMax);
    }
};

// Mouse wheel event
CameraOrbit.prototype.onMouseWheel = function(event) {
    // Update the distance based on mouse wheel movement
    this.distance -= event.wheel * this.zoomSpeed;

    // Clamp the distance within min and max limits
    this.distance = pc.math.clamp(this.distance, this.distanceMin, this.distanceMax);
};

// Function to update the camera's position and orientation
CameraOrbit.prototype.updateCameraPosition = function() {
    // Calculate yaw and pitch rotations
    var yawPitchQuat = new pc.Quat();
    yawPitchQuat.setFromEulerAngles(this.pitch, this.yaw, 0);

    // Calculate the offset vector in local space
    var offset = new pc.Vec3(0, 0, -this.distance);
    yawPitchQuat.transformVector(offset, offset);

    // Set the camera's local position relative to the parent
    this.entity.setLocalPosition(offset);

    // Compute the forward vector (from camera to target in local space)
    var forward = offset.clone().scale(-1).normalize();

    // Use lookRotation to compute the rotation quaternion
    var rotationEntity = new pc.Entity()
    rotationEntity.lookAt(forward, pc.Vec3.UP);

    var rotation = rotationEntity.getRotation();

    // Set the camera's local rotation
    this.entity.setLocalRotation(rotation);
};

// Function to initialize the camera from a local position
CameraOrbit.prototype.initializeFromLocalPosition = function(localPosition) {
    // Calculate the offset vector from the target to the camera in local space
    this.entity.setLocalPosition(localPosition);
    const offset = localPosition.clone().sub(this.targetLocalPosition);

    // Compute distance
    this.distance = offset.length();

    if (this.distance === 0) {
        // Avoid division by zero
        this.pitch = 0;
        this.yaw = 0;
        return;
    }

    // Normalize the offset vector
    const normalizedOffset = offset.clone().normalize();

    // Compute pitch and yaw in degrees
    this.pitch = pc.math.clamp(
        Math.asin(normalizedOffset.y) * pc.math.RAD_TO_DEG,
        this.pitchAngleMin,
        this.pitchAngleMax
    );

    this.yaw = Math.atan2(-normalizedOffset.x, -normalizedOffset.z) * pc.math.RAD_TO_DEG;

    // Ensure yaw is within 0 to 360 degrees
    if (this.yaw < 0) {
        this.yaw += 360;
    }
};