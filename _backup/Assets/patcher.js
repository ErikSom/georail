(() => {
    let patch = {};
    const mutatedPatch = {};

    function patchNodeFromSphere(sphere, world){
        const {lineData, coordinateIndex} = sphere;

        const way = patch[lineData.id] || [];

        const pos = sphere.getPosition().clone();

        const offset = world.getPosition();
        pos.sub(offset);

        const [lon, lat, alt] = earthatile.cartesianToGeodetic(pos.x, pos.y, pos.z);

        way[coordinateIndex] = alt;

        patch[lineData.id] = way;
        mutatedPatch[lineData.id] = way;
    }

    function getPatchedAltitude(id, index){
        if(!patch[id]){
            return undefined;
        }

        return patch[id][index];
    }

    function exportData(data){
        // export patch file as json and download it
        const a = document.createElement('a');
        const file = new Blob([JSON.stringify(data)], {type: 'application/json'});
        a.href = URL.createObjectURL(file);
        // set date as filename
        a.download = `patch-${new Date().toISOString().split('T')[0]}.json`;
        a.click();
    }

    function getAltitudesData(){
        exportData(patch);
    }

    function exportPatch(){
        exportData(mutatedPatch);
    }

    function uploadPatch(){
        // show file dialog
        const input = document.createElement('input');
        input.type = 'file';
        input.accept = '.json';
        input.onchange = function(e){
            const file = e.target.files[0];
            const reader = new FileReader();
            reader.onload = function(e){
                const data = JSON.parse(e.target.result);
                mergePatch(data);
            };
            reader.readAsText(file);
        };
        input.click();


    }

    function mergePatch(jsonData){
        // merge patch data from json
        for(const id in jsonData){
            if(!patch[id]){
                patch[id] = jsonData[id];
            }else{
                patch[id] = patch[id].map((alt, index) => {
                    return jsonData[id][index] || alt;
                });
            }
        }
    }

    function setPatch(jsonData){
        patch = jsonData;
    }

    pc.patcher = {patchNodeFromSphere, getPatchedAltitude, exportPatch, mergePatch, uploadPatch, setPatch};
    window.blabla = getAltitudesData;
})();