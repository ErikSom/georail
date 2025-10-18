var FlyCamera = pc.createScript('flyCamera');

FlyCamera.attributes.add('speed', {
    type: 'number',
    default: 10
});

FlyCamera.attributes.add('fastSpeed', {
    type: 'number',
    default: 20
});

FlyCamera.attributes.add('mode', {
    type: 'number',
    default: 0,
    enum: [{
        "Lock": 0
    }, {
        "Drag": 1
    }]
});

FlyCamera.attributes.add('mouseButton', {
    type: 'number',
    default: 0,
    enum: [{
        "Left": pc.MOUSEBUTTON_LEFT
    }, {
        "Middle": pc.MOUSEBUTTON_MIDDLE
    }, {
        "Right": pc.MOUSEBUTTON_RIGHT
    }]
});

const Interp = {
    quintic: n => Math.pow(n - 1, 5) + 1
};

class SmoothValue {
    constructor(value, speed = 2) {
        this.start = this.end = this._value = value;
        this.speed = speed;
        this.timer = 0;
    }

    set value(value) {
        this.start = this._value;
        this.end = value;
        this.timer = 0;
    }

    get value() {
        return this.end;
    }

    update(dt) {
        this.timer = Math.min(1.0, this.timer + dt * this.speed);
        const t = Interp.quintic(this.timer);
        this._value = this.start * (1 - t) + this.end * t;
        return this._value;
    }
}

FlyCamera.prototype.initialize = function () {
    this.pitch = new SmoothValue(0);
    this.yaw = new SmoothValue(0);

    this.moved = false;
    this.mbDown = false;

    // Disabling the context menu stops the browser displaying a menu when
    // you right-click the page
    this.app.mouse.disableContextMenu();
    this.app.mouse.on(pc.EVENT_MOUSEMOVE, this.onMouseMove, this);
    this.app.mouse.on(pc.EVENT_MOUSEDOWN, this.onMouseDown, this);
    this.app.mouse.on(pc.EVENT_MOUSEUP, this.onMouseUp, this);
};

const p = new pc.Vec3();
const m1 = new pc.Mat4();
const m2 = new pc.Mat4();
const m3 = new pc.Mat4();
const q = new pc.Quat();

FlyCamera.prototype.update = function (dt) {
    var app = this.app;

    const offset = app.root.findByName('World').getPosition();
    p.copy(this.entity.getLocalPosition()).sub(offset);

    // construct basis
    pc.math.constructSphericalBasis(p, m1);

    // align the sky
    m2.setFromEulerAngles(0, -80, 0);
    m3.mul2(m1, m2);
    q.setFromMat4(m3).invert();

    const skyRot = app.scene.skyboxRotation;
    if (
        Math.abs(skyRot.x - q.x) > 0.01 ||
        Math.abs(skyRot.y - q.y) > 0.01 ||
        Math.abs(skyRot.z - q.z) > 0.01 ||
        Math.abs(skyRot.w - q.w) > 0.01
    ) {
        // Don't call this every frame:
        // https://github.com/playcanvas/engine/issues/5458
        app.scene.skyboxRotation = q;
    }

    // apply yaw pitch
    m2.setFromEulerAngles(this.pitch.update(dt), this.yaw.update(dt), 0);
    m3.mul2(m1, m2);
    q.setFromMat4(m3);
    this.entity.setLocalRotation(q);

    var speed = this.speed;
    if (app.keyboard.isPressed(pc.KEY_SHIFT)) {
        speed = this.fastSpeed;
    }

    // Update the camera's position
    if (app.keyboard.isPressed(pc.KEY_UP) || app.keyboard.isPressed(pc.KEY_W)) {
        this.entity.translateLocal(0, 0, -speed * dt);
    } else if (app.keyboard.isPressed(pc.KEY_DOWN) || app.keyboard.isPressed(pc.KEY_S)) {
        this.entity.translateLocal(0, 0, speed * dt);
    }

    if (app.keyboard.isPressed(pc.KEY_LEFT) || app.keyboard.isPressed(pc.KEY_A)) {
        this.entity.translateLocal(-speed * dt, 0, 0);
    } else if (app.keyboard.isPressed(pc.KEY_RIGHT) || app.keyboard.isPressed(pc.KEY_D)) {
        this.entity.translateLocal(speed * dt, 0, 0);
    }
};

FlyCamera.prototype.onMouseMove = function (event) {
    if (!this.mode) {
        if (!pc.Mouse.isPointerLocked())
            return;
    } else {
        if (!this.mbDown)
            return;
    }

    // Update the current Euler angles, clamp the pitch.
    if (!this.moved) {
        // first move event can be very large
        this.moved = true;
        return;
    }

    if (event.dy) {
        this.pitch.value -= event.dy / 5;
    }

    if (event.dx) {
        this.yaw.value -= event.dx / 5;
    }
};

FlyCamera.prototype.onMouseDown = function (event) {
    console.log(event.button, this.mouseButton);
    if (event.button === this.mouseButton) {
        this.mbDown = true;

        // When the mouse button is clicked try and capture the pointer
        if (!this.mode && !pc.Mouse.isPointerLocked()) {
            this.app.mouse.enablePointerLock();
        }
    }
};

FlyCamera.prototype.onMouseUp = function (event) {
    if (event.button === this.mouseButton) {
        this.mbDown = false;
    }
};
