var Geolocation = pc.createScript('geolocation');

Geolocation.attributes.add('camera', {
    type: 'entity'
})

Geolocation.prototype.teleport = function (lon, lat, alt) {
    const [x, y, z] = earthatile.geodeticToCartesian(lon, lat, alt ?? 300);

    this.entity.setPosition(-x, -z, y);
    this.camera.setPosition(0, 0, 0);
};

Geolocation.prototype.getFloorPosition = function(lon, lat) {
   const [cx, cy, cz] = earthatile.geodeticToCartesian(lon, lat, 300);

    // playcanvas world position
    const localPosition = this.v1.set(cx, cz, -cy);

    const m = pc.math.constructSphericalBasis(localPosition);
    this.q.setFromMat4(m);
    this.e.setLocalRotation(this.q);

    const relativeDown = this.v2.copy(this.e.up).scale(-1);

    const worldTransform = this.entity.getWorldTransform();
    const worldPosition = worldTransform.transformPoint(this.v3.copy(localPosition));
    
    // query for meshInstances
    const results = pc.utils.raycastChildNodesAABB(worldPosition, relativeDown, this.entity);

    // raycast meshInstances for floor position
    const maxRaycastLength = 1000;
    const hitData = pc.utils.raycastFurthestPointOnMeshInstances(worldPosition, relativeDown, results, maxRaycastLength);

    return hitData;
}

// initialize code called once per entity
Geolocation.prototype.initialize = function() {
    // Create a debug UI
    this.panel = new pcui.Panel({
        collapsible: true,
        headerText: 'CONTROLS',
        hiddern: true,
        width: 400
    });
    document.body.appendChild(this.panel.dom);

    this.longLat = new pcui.VectorInput({
        dimensions: 3,
        readOnly: true
    })
    let group = new pcui.LabelGroup({
        text: 'Camera Coord',
        field: this.longLat
    })
    this.panel.append(group);


    this.e = new pc.Entity();
    this.v1 = new pc.Vec3();
    this.v2 = new pc.Vec3();
    this.v3 = new pc.Vec3();
    this.q = new pc.Quat();

    pc.geolocation = this;
};

// update code called every frame
Geolocation.prototype.update = function(dt) {
    if (this.camera) {
        const pos = this.camera.getPosition().clone();
        const offset = this.entity.getPosition();
        pos.sub(offset);
        const [lon, lat, alt] = earthatile.cartesianToGeodetic(pos.x, pos.y, pos.z);
        this.longLat.value = [lon, lat, alt];
    }
    if(this.from) pc.AppBase.renderLine(this.from, this.to, this.color);
};
