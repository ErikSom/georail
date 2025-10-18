var Main = pc.createScript('main');

Main.attributes.add('camera', {
    type: 'entity',
});

Main.attributes.add('trainTemplate', {
    type: 'asset',
    assetType: 'template'
});

Main.attributes.add('altitudeData', {type: 'asset', assetType:'json'});

Main.prototype.initialize = function() {
    this.route = [];
    this.showApiInput();

    pc.patcher.setPatch(this.altitudeData.resource);
};

Main.prototype.showApiInput = function(){
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

Main.prototype.spawnTrain = function(route){
    const trainPrefab = this.trainTemplate.resource.instantiate();
    this.entity.addChild(trainPrefab);
    trainPrefab.script.train.setRoute(route);
}

Main.prototype.start = function(apiKey){
    const a = pc.pathFinder.getStationNode('Amsterdam Centraal', 1);
    const b = pc.pathFinder.getStationNode('Schiphol Airport', 1);

    const coord = pc.pathFinder.getCoordFromNode(a);

    pc.geolocation.teleport(coord.x, coord.y);

    // start tiles 3D rendering
    this.entity.script.tileRenderer.start(apiKey);

    this.route = pc.pathFinder.findPath(a, b);

    // get floor position at coord
    this.entity.script.tileRenderer.once('tilesLoaded', () => {
        this.spawnTrain(this.route);
    });
}