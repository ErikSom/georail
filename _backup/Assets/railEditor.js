var RailEditor = pc.createScript('railEditor');

RailEditor.attributes.add('sphereMaterial', {
    type: 'asset',
    assetType: 'material'
});

RailEditor.attributes.add('sphereSelectedMaterial', {
    type: 'asset',
    assetType: 'material'
});


RailEditor.attributes.add('sphereNavigationMaterial', {
    type: 'asset',
    assetType: 'material'
});

RailEditor.attributes.add('camera', {
    type: 'entity',
});

RailEditor.attributes.add('altitudeData', {type: 'asset', assetType:'json'});

RailEditor.prototype.initialize = function() {
    this.editableSpheres = [];
    this.selectedSpheres = [];
    this.transforming = false;
    this.v1 = new pc.Vec3();
    this.q = new pc.Quat();

    this.sphereMaterialAlpha = this.sphereMaterial.resource.clone();
    this.sphereMaterialAlpha.opacity = 0.5;
    this.sphereMaterialAlpha.depthTest = false;
    this.sphereMaterialAlpha.update();
    this.sphereSelectedMaterialAlpha = this.sphereSelectedMaterial.resource.clone();
    this.sphereSelectedMaterialAlpha.opacity = 0.5;
    this.sphereSelectedMaterialAlpha.depthTest = false;
    this.sphereSelectedMaterialAlpha.update();
    this.sphereNavigationMaterialAlpha = this.sphereNavigationMaterial.resource.clone();
    this.sphereNavigationMaterialAlpha.opacity = 0.5;
    this.sphereNavigationMaterialAlpha.depthTest = false;
    this.sphereNavigationMaterialAlpha.update();
    this.sphereNavigationMaterialAlpha = this.sphereNavigationMaterial.resource.clone();
    this.sphereNavigationMaterialAlpha.opacity = 0.5;
    this.sphereNavigationMaterialAlpha.depthTest = false;
    this.sphereNavigationMaterialAlpha.update();

    this.buildTranslateEntity();

    this.debugLayer = this.app.scene.layers.getLayerByName("Debug");

    const canvas = this.app.graphicsDevice.canvas;
    const canvasWidth = parseInt(canvas.clientWidth, 10);
    const canvasHeight = parseInt(canvas.clientHeight, 10);

    this.pickAreaScale = 1.0;
    this.picker = new pc.Picker(this.app, canvasWidth * this.pickAreaScale, canvasHeight * this.pickAreaScale);

    this.showApiInput();

    this.startPointerDown = new pc.Vec2();
    this.endPointerDown = new pc.Vec2();
    this.selectionTopLeft = new pc.Vec2();
    this.selectionBotRight = new pc.Vec2();

    canvas.addEventListener('pointerdown', (e) => {
        this.startPointerDown.x = e.clientX;
        this.startPointerDown.y = e.clientY;
    });

    canvas.addEventListener('pointerup', (e) => {
        this.endPointerDown.x = e.clientX;
        this.endPointerDown.y = e.clientY;

        if(!this.transforming && e.button === pc.MOUSEBUTTON_LEFT){
            this.selectionTopLeft.x = Math.min(this.startPointerDown.x, this.endPointerDown.x);
            this.selectionTopLeft.y = Math.min(this.startPointerDown.y, this.endPointerDown.y);

            this.selectionBotRight.x = Math.max(this.startPointerDown.x, this.endPointerDown.x);
            this.selectionBotRight.y = Math.max(this.startPointerDown.y, this.endPointerDown.y);

            this.makeSelection();
        }
        this.transforming = false;
    });

    this.cameraPositionSpheres = new pc.Vec3();
    this.cameraPositionGranular = new pc.Vec3();

    pc.patcher.setPatch(this.altitudeData.resource);
};

RailEditor.prototype.query = function(){
    console.log("[QUERYING NEW DATA]")

    const localPosition = this.inverseWorldTransform.transformPoint(this.camera.getPosition().clone());

    const objects = pc.pathFinder.queryQuadTree(localPosition, 1000);

    const uniqueLines = new Map();

    objects.forEach(o => {
        if(!uniqueLines.has(o.originalData.id)){
            uniqueLines.set(o.originalData.id, o.originalData);
        }
    });

    this.linesInRange = Array.from(uniqueLines.values());

    this.buildEditableSpheres();
}

RailEditor.prototype.buildTranslateEntity = function(){
    this.translateEntityContainer = new pc.Entity();
    this.translateEntity = new pc.Entity();
    this.translateEntity.previousPosition = new pc.Vec3();
    this.translateEntity.delta = new pc.Vec3();
    const gizmoLayer = this.app.scene.layers.getLayerByName("UI");

    this.translateGizmo = new pc.TranslateGizmo(this.camera.camera, gizmoLayer);
    this.translateGizmo.coordSpace = pc.GIZMOSPACE_LOCAL;

    for (const key in this.translateGizmo._shapes) {
        this.translateGizmo._shapes[key].meshInstances.forEach(mi => {
            mi._material.depthTest = false;
        });
    }

    const slopeAngleCylinderLength = 100;
    const slopeAngleCylinderWidth = 2;
    this.slopeAngleCylinder = new pc.Entity();
    this.slopeAngleCylinder.enabled = false;

    const slopeAngleCylinderMesh = new pc.Entity();
    const slopeAngleCylinderMat = this.sphereMaterial.resource.clone();
    slopeAngleCylinderMat.opacity = 0.5;
    slopeAngleCylinderMat.depthTest = false;

    slopeAngleCylinderMesh.addComponent("render", {
        type: "cylinder",
        material: slopeAngleCylinderMat
    });
    this.slopeAngleCylinder.addChild(slopeAngleCylinderMesh);
    slopeAngleCylinderMesh.setLocalRotation(this.q.setFromEulerAngles(90, 0, 0));
    slopeAngleCylinderMesh.setLocalPosition(this.v1.set(0, 0, -slopeAngleCylinderLength/2));
    slopeAngleCylinderMesh.setLocalScale(this.v1.set(slopeAngleCylinderWidth, slopeAngleCylinderLength, slopeAngleCylinderWidth));
    this.translateEntity.addChild(this.slopeAngleCylinder);

    this.translateGizmo.enableShape('x', false);
    this.translateGizmo.enableShape('z', false);
    this.translateGizmo.enableShape('xy', false);
    this.translateGizmo.enableShape('yz', false);
    this.translateGizmo.enableShape('xz', false);
    
    this.translateEntityContainer.addChild(this.translateEntity);

    this.translateGizmo.on('transform:start', (e) => {
        this.translateEntity.previousPosition.copy(this.translateEntity.getPosition());
        this.transforming = true;
    });

    this.translateGizmo.on('transform:move', (e) => {
        this.translateEntity.delta.sub2(this.translateEntity.getPosition(), this.translateEntity.previousPosition);

        this.selectedSpheres.forEach(sphere => {
            const pos = sphere.getPosition();
            pos.add(this.translateEntity.delta);
            sphere.setPosition(pos);
        });

        this.translateEntity.previousPosition.copy(this.translateEntity.getPosition());

        this.updateEditUI();
    });

}

RailEditor.prototype.attachTranslateEntity = function(){
    if(!this.selectedSpheres.length){
        return;
    }

    this.app.root.addChild(this.translateEntityContainer);

    const averagePosition = this.v1.set(0, 0, 0);
    this.selectedSpheres.forEach(sphere => {
        averagePosition.add(sphere.getPosition());
    });

    averagePosition.mulScalar(1 / this.selectedSpheres.length);

    this.translateEntityContainer.setPosition(averagePosition);
    this.translateEntityContainer.setLocalRotation(this.selectedSpheres[0].getLocalRotation());

    this.translateGizmo.detach();

    this.translateEntity.setLocalPosition(new pc.Vec3());

    this.translateGizmo.attach([this.translateEntity]);
}

RailEditor.prototype.deselect = function() {
    this.selectedSpheres.forEach((sphere) => {
        sphere.alphaEntity.render.material = this.sphereMaterialAlpha;
        sphere.opaqueBaseEntity.render.material = this.sphereMaterial.resource;

        const key = sphere.coord.join(',');
        if(this.routeCoordMap && this.routeCoordMap[key]){
            sphere.alphaEntity.render.material = this.sphereNavigationMaterialAlpha;
            sphere.opaqueBaseEntity.render.material = this.sphereNavigationMaterial.resource;
        }

    });
    this.selectedSpheres.length = 0;

    this.app.root.removeChild(this.translateEntityContainer);
    this.translateGizmo.detach();

    this.updateEditUI();
}

RailEditor.prototype.makeSelection = function() {
    const selectionRect = new pc.Vec4(
        this.selectionTopLeft.x,
        this.selectionTopLeft.y,
        this.selectionBotRight.x,
        this.selectionBotRight.y
    );

    const minSelectionSize = 5;

    this.deselect();

    if(selectionRect.z - selectionRect.x > minSelectionSize || selectionRect.w - selectionRect.y > minSelectionSize){
        const selectedSpheres = this.editableSpheres.filter((sphere) => {
            const screenPos = this.camera.camera.worldToScreen(sphere.getPosition());
            return this.isInRect(screenPos, selectionRect);
        });

        this.selectedSpheres = selectedSpheres;
    } else {
        const canvas = this.app.graphicsDevice.canvas;
        const canvasWidth = parseInt(canvas.clientWidth, 10);
        const canvasHeight = parseInt(canvas.clientHeight, 10);

        const camera = this.camera.camera;
        const scene = this.app.scene;
        const picker = this.picker;

        picker.resize(canvasWidth * this.pickAreaScale, canvasHeight * this.pickAreaScale);
        picker.prepare(camera, scene, [this.debugLayer]);

        const selected = picker.getSelection(selectionRect.x, selectionRect.y);
        this.selectedSpheres = selected.map(instance => instance.node);
        // make sure we have the root entity and not a child
        this.selectedSpheres = this.selectedSpheres.map(n => n.alphaEntity ? n : n.parent).filter(n => n.alphaEntity);
    }

    this.selectedSpheres.forEach((sphere) => {
        sphere.alphaEntity.render.material = this.sphereSelectedMaterialAlpha;
        sphere.opaqueBaseEntity.render.material = this.sphereSelectedMaterial.resource;
    });

    this.attachTranslateEntity();

    this.updateEditUI();
}

RailEditor.prototype.isInRect = function(point, rect) {
    return point.x > rect.x && point.x < rect.z && point.y > rect.y && point.y < rect.w;
}

RailEditor.prototype.showApiInput = function(){
    const key = localStorage.getItem('tiles-api-key');

    const style = document.createElement('style');
    style.textContent = `
    .pcui-label {
        font-size: 12px;
    }

    .pcui-overlay-content {
        padding: 8px;
        z-index: 0;
    }`;
    document.head.appendChild(style);

    const overlay = new pcui.Overlay({
        clickable: false,
        transparent: false
    });
    document.body.appendChild(overlay.dom);

    const textInput = new pcui.TextInput({
        value: key
    });
    const group = new pcui.LabelGroup({
        field: textInput,
        text: 'API key:'
    });
    overlay.append(group);

    const button = new pcui.Button({
        enabled: true,
        text: 'OK'
    });
    button.style.float = 'right';
    button.on('click', () => {
        localStorage.setItem('tiles-api-key', textInput.value);
        overlay.hidden = true;
        this.start(textInput.value);
    });
    overlay.append(button);

    textInput.on('change', (value) => {
        localStorage.setItem('tiles-api-key', textInput.value);
        button.enabled = value.length > 0;
    });
    textInput.focus();
}

RailEditor.prototype.createEditUI = function(){
    this.panel = new pcui.Panel({
        collapsible: true,
        headerText: 'SELECTION',
        width: 400
    });
    document.body.appendChild(this.panel.dom);

    this.longLat = new pcui.VectorInput({
        dimensions: 2,
        readOnly: true
    })
    let group = new pcui.LabelGroup({
        text: 'Longitude / Latitude',
        field: this.longLat
    })

    this.panel.append(group);

    this.alt = new pcui.NumericInput({});

    group = new pcui.LabelGroup({
        text: 'Altitude',
        field: this.alt,
    });
    this.panel.append(group);

    this.alt.on('change', () => {
        this.onAltitudeChange();
    });

    this.approximateAltitudes = new pcui.Button({
        text: "Approximate Altitude",
    });
    this.approximateAltitudes.on('click', () => {
        this.approximateAltitudeForSelectedSpheres();
    });
    this.panel.append(this.approximateAltitudes);

    this.panel.append(new pcui.Divider());

    this.slopeMode = new pcui.BooleanInput({});
    group = new pcui.LabelGroup({
        text: 'Slope Mode',
        field: this.slopeMode,
    });
    this.panel.append(group);
    this.slopeMode.on('change', () => {
        this.slopeAngleCylinder.enabled = this.slopeMode.value;
    })

    this.slopeAltitudeStart = new pcui.NumericInput({});
    group = new pcui.LabelGroup({
        text: 'Start Altitude',
        field: this.slopeAltitudeStart,
    });

    this.slopeAltitudeStart.on('change', () => {
        this.onAltitudeChange();
    });
    this.panel.append(group);

    this.slopeAngle = new pcui.NumericInput({});

    this.slopeAngle.on('change', () => {
        this.q.setFromEulerAngles(0, this.slopeAngle.value, 0);
        this.slopeAngleCylinder.setLocalRotation(this.q);
    });


    group = new pcui.LabelGroup({
        text: 'Angle',
        field: this.slopeAngle,
    });
    this.panel.append(group);
}

RailEditor.prototype.createNavUI = function(){
    this.panel = new pcui.Panel({
        collapsible: true,
        headerText: 'NAVIGATION',
        width: 400
    });
    document.body.appendChild(this.panel.dom);

    const stationNames = Object.keys(pc.pathFinder.nameStopLookup).sort();

    const stations = stationNames.map((station, i) => ({
        t: station,
        v: i
    }));

    console.log(stations);

    this.startStation = new pcui.SelectInput({
        options: stations,
        defaultValue: 0,
        type: 'number'
    })
    let group = new pcui.LabelGroup({
        text: 'Start Station',
        field: this.startStation
    })
    this.panel.append(group);

    const getTracks = function(station){
        return Object.keys(pc.pathFinder.nameStopLookup[station]).map((t, i) => ({
            t: parseInt(t)+1,
            v:i,
        }));
    };

    this.startTrack = new pcui.SelectInput({
        options: getTracks(stationNames[this.startStation.value]),
        defaultValue: 0,
        type: 'number'
    })
    group = new pcui.LabelGroup({
        text: 'Start Track',
        field: this.startTrack
    })
    this.panel.append(group);

    this.startStation.on('change', () => {
        this.startTrack.options = getTracks(stationNames[this.startStation.value]);
        this.startTrack.value = 0;
    })

    this.desitationStation = new pcui.SelectInput({
        options: stations,
        defaultValue: 1,
        type: 'number'
    })
    group = new pcui.LabelGroup({
        text: 'Destination Station',
        field: this.desitationStation
    })
    this.panel.append(group);

    this.destinationTrack = new pcui.SelectInput({
        options: getTracks(stationNames[this.startStation.value]),
        defaultValue: 0,
        type: 'number'
    })
    group = new pcui.LabelGroup({
        text: 'Destination Track',
        field: this.destinationTrack
    })
    this.panel.append(group);

    this.desitationStation.on('change', () => {
        this.destinationTrack.options = getTracks(stationNames[this.desitationStation.value]);
        this.destinationTrack.value = 0;
    })

    this.navigateButton = new pcui.Button({
        text: "Navigate",
    });
    this.navigateButton.on('click', () => { 
        console.log("NAVIGATE");
        
        const stationA = stationNames[this.startStation.value];
        const stationB = stationNames[this.desitationStation.value];
        const trackA = this.startTrack.options[this.startTrack.value].t;
        const trackB = this.destinationTrack.options[this.destinationTrack.value].t;

        console.log(stationA, trackA, stationB, trackB);

        const a = pc.pathFinder.getStationNode(stationA, trackA);
        const b = pc.pathFinder.getStationNode(stationB, trackB);

        this.route = pc.pathFinder.findPath(a, b);
        this.routeCoordMap = {};
        if(this.route.path.length){
            this.route.path.forEach(coord => {
                const key = coord.join(',');
                this.routeCoordMap[key] = true;
            });
        }

        this.buildEditableSpheres();
    });
    this.panel.append(this.navigateButton);

    this.teleportStartButton = new pcui.Button({
        text: "Teleport Start",
    });
    this.teleportStartButton.on('click', () => {
        const stationA = stationNames[this.startStation.value];
        const trackA = this.startTrack.options[this.startTrack.value].t;
        const node = pc.pathFinder.getStationNode(stationA, trackA);
        const coord = node.geometry.coordinates;
        pc.geolocation.teleport(coord[0], coord[1]);

        // trigger query
        pc.pathFinder.setupQuadTree();
        this.cameraPositionSpheres.copy(this.camera.getPosition());
        this.cameraPositionGranular.copy(this.camera.getPosition());
        this.entity.script.tileRenderer.once('tilesLoaded', () => {
            const worldTransform = this.entity.getWorldTransform();
            this.inverseWorldTransform = worldTransform.clone().invert();
            this.query();
        });
    });
    this.panel.append(this.teleportStartButton);

    this.teleportDestinationButton = new pcui.Button({
        text: "Teleport Destination",
    });
    this.teleportDestinationButton.on('click', () => {
        const stationB = stationNames[this.desitationStation.value];
        const trackB = this.destinationTrack.options[this.destinationTrack.value].t;
        const node = pc.pathFinder.getStationNode(stationB, trackB);
        const coord = node.geometry.coordinates;
        pc.geolocation.teleport(coord[0], coord[1]);

        // trigger query
        pc.pathFinder.setupQuadTree();
        this.cameraPositionSpheres.copy(this.camera.getPosition());
        this.cameraPositionGranular.copy(this.camera.getPosition());
        this.entity.script.tileRenderer.once('tilesLoaded', () => {
            const worldTransform = this.entity.getWorldTransform();
            this.inverseWorldTransform = worldTransform.clone().invert();
            this.query();
        });
    });
    this.panel.append(this.teleportDestinationButton);
}

RailEditor.prototype.onAltitudeChange = function(){
    if(this.transforming) return;
    if(!this.slopeMode.value || this.selectedSpheres.length === 1){
        this.selectedSpheres.forEach((sphere) => {
            
            const coord = sphere.coord;
            const alt = parseFloat(this.alt.input.value);
            const [x, y, z] = earthatile.geodeticToCartesian(coord[0], coord[1], alt);
            const pos = new pc.Vec3(x, z, -y);
            this.entity.getWorldTransform().transformPoint(pos, pos);  // Convert to world space
            sphere.setPosition(pos);

            pc.patcher.patchNodeFromSphere(sphere, this.entity);
        });
    } else {
        // Step 1: Get global slope direction in world space (normalized)
        const globalSlopeDirection = new pc.Vec3();
        this.slopeAngleCylinder.getRotation().transformVector(pc.Vec3.FORWARD, globalSlopeDirection);
        globalSlopeDirection.normalize();  // Ensure the direction is normalized

        // Step 2: Get a point on the line (translateEntityContainer's world position)
        const linePoint = this.translateEntityContainer.getPosition();

        let minDistance = Number.POSITIVE_INFINITY;
        let maxDistance = -Number.POSITIVE_INFINITY;

        const distances = [];

        this.selectedSpheres.forEach((sphere) => {
            
            const coord = sphere.coord;
            const alt = parseFloat(this.alt.input.value);
            const [x, y, z] = earthatile.geodeticToCartesian(coord[0], coord[1], alt);
            const pos = new pc.Vec3(x, z, -y);
            this.entity.getWorldTransform().transformPoint(pos, pos);  // Convert to world space

            // Step 3: Calculate vector from line point to sphere position
            const pointToLine = pos.clone().sub(linePoint);

            // Step 4: Calculate dot product of (P - P₀) with D
            const dotProduct = pointToLine.dot(globalSlopeDirection);

            // // Step 5: Calculate projection (closest point on the line)
            // const closestPointOnLine = globalSlopeDirection.clone().scale(dotProduct).add(linePoint);

            if(dotProduct < minDistance){
                minDistance = dotProduct;
            }

            if(dotProduct > maxDistance){
                maxDistance = dotProduct;
            }

            distances.push(dotProduct);

            // // Debug box at the projected point
            // const debug = new pc.Entity();
            // debug.addComponent("render", {
            //     type: "box",
            //     material: this.sphereMaterialAlpha,
            //     layers: [this.debugLayer.id]
            // });
            // debug.setLocalScale(new pc.Vec3(10, 10, 10));
            // debug.setPosition(closestPointOnLine);

            // this.app.root.addChild(debug);

            // console.log(dotProduct, closestPointOnLine);  // Log the closest point on the line
        });

        const distanceDiff = maxDistance - minDistance;
        
        const targetAlt = parseFloat(this.alt.input.value);
        const startAlt = parseFloat(this.slopeAltitudeStart.input.value);
        const altDiff = targetAlt - startAlt;

        this.selectedSpheres.forEach((sphere, i) => {
            const distance = distances[i];
            const distanceProgress = (distance - minDistance) / distanceDiff;

            const coord = sphere.coord;

            const alt = startAlt + altDiff * distanceProgress;

            const [x, y, z] = earthatile.geodeticToCartesian(coord[0], coord[1], alt);
            const pos = new pc.Vec3(x, z, -y);
            this.entity.getWorldTransform().transformPoint(pos, pos);  // Convert to world space
            sphere.setPosition(pos);

            pc.patcher.patchNodeFromSphere(sphere, this.entity);
        });
    }

    this.attachTranslateEntity();
}

RailEditor.prototype.updateEditUI = function(){
    if(!this.longLat){
        return;
    }
    this.longLat.value = [0, 0];
    this.alt.value = 0;
    if(this.selectedSpheres.length){
        if(this.selectedSpheres.length === 1){
            this.longLat.value = this.selectedSpheres[0].coord;
        }

        const alts = [];
        this.selectedSpheres.forEach(sphere => {
            const pos = sphere.getPosition().clone();
            const offset = this.entity.getPosition();
            pos.sub(offset);
            const [lon, lat, alt] = earthatile.cartesianToGeodetic(pos.x, pos.y, pos.z);
            alts.push(alt);
        });

        const allEqual = alts.every( v => v === alts[0]);

        if(allEqual){
            this.alt.value = alts[0];
        }
    }
}

RailEditor.prototype.start = function(apiKey){
    const a = pc.pathFinder.getStationNode('Schiphol Airport', 3);

    const coord = pc.pathFinder.getCoordFromNode(a);
    this.startNode = a;
    pc.geolocation.teleport(coord.x, coord.y);

    // start tiles 3D rendering
    this.entity.script.tileRenderer.start(apiKey, true);

    pc.pathFinder.setupQuadTree();

    this.createEditUI();
    this.createNavUI();

    this.entity.script.tileRenderer.once('tilesLoaded', () => {
        this.cameraPositionSpheres.copy(this.camera.getPosition());
        this.cameraPositionGranular.copy(this.camera.getPosition());
        const worldTransform = this.entity.getWorldTransform();
        this.inverseWorldTransform = worldTransform.clone().invert();
        this.query();
    });
}

RailEditor.prototype.buildEditableSpheres = function(){
    this.destroyEditiableSpheres();
    console.log("********* LINES IN RANGE:", this.linesInRange.length);
    for(let i = 0; i< this.linesInRange.length; i++){
        const line = this.linesInRange[i];
        const {coordinates} = line.geometry;
        for(let j = 0; j<coordinates.length; j++){
            const coord = coordinates[j];
            const nextCoord = coordinates[(j+1) % coordinates.length];

            const sphere = this.buildSphere();

            let floorPosition;
            const patchedAltitude = pc.patcher.getPatchedAltitude(line.id, j);
            if(patchedAltitude != undefined){
                const [x, y, z] = earthatile.geodeticToCartesian(coord[0], coord[1], patchedAltitude);
                floorPosition = this.v1.set(x, z, -y);
                this.entity.getWorldTransform().transformPoint(floorPosition, floorPosition);
            } else {
                floorPosition = this.getFloorPositionFromLineItem(coord, nextCoord);
            }
            sphere.setPosition(floorPosition);

            const localPosition = this.inverseWorldTransform.transformPoint(this.v1.copy(floorPosition));

            const m = pc.math.constructSphericalBasis(localPosition);
            this.q.setFromMat4(m);
            sphere.setLocalRotation(this.q);

            this.editableSpheres.push(sphere);

            sphere.lineData = line;
            sphere.coord = coord;
            sphere.nextCoord = nextCoord;
            sphere.coordinateIndex = j;

            const key = coord.join(',');
            if(this.routeCoordMap && this.routeCoordMap[key]){
                this.addCheckpointToSphere(sphere);

                sphere.alphaEntity.render.material = this.sphereNavigationMaterialAlpha;
                sphere.opaqueBaseEntity.render.material = this.sphereNavigationMaterial.resource;
            }

            pc.patcher.patchNodeFromSphere(sphere, this.entity);
        }
    }
}

RailEditor.prototype.destroyEditiableSpheres = function(){
    this.deselect();
    this.editableSpheres.forEach(sphere => {
        sphere.destroy();
    });
    this.editableSpheres.length = 0;
}

RailEditor.prototype.buildSphere = function(){
    const nodeEntity = new pc.Entity();

    const nodeHeight = 0.3;


    const alphaEntity = new pc.Entity();
    alphaEntity.addComponent("render", {
        type: "cylinder",
        material: this.sphereMaterialAlpha,
        layers: [this.debugLayer.id]
    });
    alphaEntity.setLocalScale(this.v1.set(1, nodeHeight, 1));
    alphaEntity.setLocalPosition(this.v1.set(0, nodeHeight / 2, 0));

    nodeEntity.addChild(alphaEntity);
    nodeEntity.alphaEntity = alphaEntity;

    const opaqueBaseEntity = new pc.Entity();
    opaqueBaseEntity.addComponent("render", {
        type: "cylinder",
        material: this.sphereMaterial.resource,
    });
    opaqueBaseEntity.setLocalScale(this.v1.set(1, nodeHeight, 1));
    opaqueBaseEntity.setLocalPosition(this.v1.set(0, nodeHeight / 2, 0));

    nodeEntity.addChild(opaqueBaseEntity);
    nodeEntity.opaqueBaseEntity = opaqueBaseEntity;

    this.app.root.addChild(nodeEntity);

    return nodeEntity;
}

RailEditor.prototype.addCheckpointToSphere = function(sphere){
    const navigationCylinderLength = 200;
    const navigationCylinderWidth = 4;

    const navigationCylinderMesh = new pc.Entity();
    if(!this.navigationCylinderMat){
        this.navigationCylinderMat = this.sphereNavigationMaterial.resource.clone();
        this.navigationCylinderMat.opacity = 0.5;
        this.navigationCylinderMat.cull = pc.CULLFACE_FRONT;
    }

    // navigationCylinderMat.depthTest = false;

    navigationCylinderMesh.addComponent("render", {
        type: "cylinder",
        material: this.navigationCylinderMat
    });
    sphere.addChild(navigationCylinderMesh);
    navigationCylinderMesh.setLocalRotation(this.q.setFromEulerAngles(0, 0, 0));
    // navigationCylinderMesh.setLocalPosition(this.v1.set(0, 0, -navigationCylinderLength/2));
    navigationCylinderMesh.setLocalScale(this.v1.set(navigationCylinderWidth, navigationCylinderLength, navigationCylinderWidth));
}

RailEditor.prototype.getFloorPositionFromLineItem = function(item, nextItem){

    let hitData =  pc.geolocation.getFloorPosition(item[0], item[1]);

    if(!hitData.hit){
        // try to find ground along the path
        const lon1 = item[0];
        const lan1 = item[1];

        const lon2 = nextItem[0];
        const lan2 = nextItem[1];

        for(let alpha = 0.01; alpha < 1; alpha += 0.01){
            const lon = lon1 + alpha * (lon2 - lon1);
            const lan = lan1 + alpha * (lan2 - lan1);

            hitData =  pc.geolocation.getFloorPosition(lon, lan);

            if(hitData.hit){
                break;
            }
        }
    }

    if(hitData.point.length() === 0){
        // for some reason we can't find an altitude, so we fix it:
        const coord = item;
        const alt = 50.0;
        const [x, y, z] = earthatile.geodeticToCartesian(coord[0], coord[1], alt);
        const pos = new pc.Vec3(x, z, -y);
        this.entity.getWorldTransform().transformPoint(pos, pos);  // Convert to world space
        return pos;
    }
    
    return hitData.point;
}

RailEditor.prototype.approximateAltitudeForSelectedSpheres = function(){
    this.selectedSpheres.forEach(sphere => {
        const floorPosition = this.getFloorPositionFromLineItem(sphere.coord, sphere.nextCoord);
        sphere.setPosition(floorPosition);
        pc.patcher.patchNodeFromSphere(sphere, this.entity);
    });
}


RailEditor.prototype.update = function(){
    const cameraPosition = this.camera.getPosition();

    const distCameraPositionSpheres = this.v1.sub2(cameraPosition, this.cameraPositionSpheres).length();
    if(distCameraPositionSpheres > 500){
        this.query();
        this.cameraPositionSpheres.copy(cameraPosition);
    }

    if (this.app.keyboard.wasPressed(pc.KEY_SPACE)){
        this.approximateAltitudeForSelectedSpheres();
    }

    if(this.app.keyboard.isPressed(pc.KEY_UP)){
        this.alt.value = this.alt.value + 0.01;
    } else if(this.app.keyboard.isPressed(pc.KEY_DOWN)){
        this.alt.value = this.alt.value - 0.01;
    }
}