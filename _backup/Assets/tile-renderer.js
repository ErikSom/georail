var TileRenderer = pc.createScript('tileRenderer');

TileRenderer.attributes.add('apiUrl', {
    type: 'string',
    default: 'https://tile.googleapis.com/'
});
TileRenderer.attributes.add('camera', {
    type: 'entity'
});

TileRenderer.prototype.loadGlb = function (url) {
    return new Promise(async (resolve, reject) => {
        try {
            // First fetch the file with authorization
            const response = await fetch(url, {
                headers: {
                    'Authorization': `Bearer ${this.accessToken}`
                }
            });

            if (!response.ok) {
                throw new Error(`HTTP error! status: ${response.status}`);
            }

            // Get the blob and create object URL
            const blob = await response.blob();
            const objectUrl = URL.createObjectURL(blob);
            const filename = new URL(url).pathname.split("/").pop();

            // Create asset with object URL
            const asset = new pc.Asset(filename, 'container', {
                url: objectUrl
            }, null, {
                image: {
                    postprocess: (gltfImage, textureAsset) => {
                        textureAsset.resource.anisotropy = this.app.graphicsDevice.maxAnisotropy;
                    }
                }
            });

            // Set up load handlers
            asset.once('load', (containerAsset) => {
                URL.revokeObjectURL(objectUrl); // Clean up object URL
                resolve(containerAsset);
            });

            asset.once('error', (err) => {
                URL.revokeObjectURL(objectUrl); // Clean up object URL even on error
                reject(err);
            });

            this.app.assets.add(asset);
            this.app.assets.load(asset);

        } catch (error) {
            reject(error);
        }
    });
};

// initialize code called once per entity
TileRenderer.prototype.initialize = function () {
    this._tempSphere = new pc.BoundingSphere();
    this._v1 = new pc.Vec3();
    this._v2 = new pc.Vec3();
    this._v3 = new pc.Vec3();
    this._v4 = new pc.Vec3();
    this._v5 = new pc.Vec3();
    this._v6 = new pc.Vec3();
    this._v7 = new pc.Vec3();
    this.nodesLoadedTicks = 0;

    this.selectedNode = null;
};

TileRenderer.prototype.postInitialize = function(){
    this.setAccessToken();
}

TileRenderer.prototype.setAccessToken = async function(){
    const session = await pc.supabase.api.auth.getSession();
    this.accessToken = session?.data?.session?.access_token;
}

TileRenderer.prototype.start = function (apiKey, editMode = false) {
    /** @type {Map<object, pc.Entity} */
    const nodeToEntity = new Map();

    /** @type {Map<object, pc.Asset} */
    const nodeToAsset = new Map();

    /** @type {Map<pc.MeshInstance, object} */
    const meshInstanceToNode = new Map();

    const load = async (node) => {
        const uri = node.content.uri;
        const url = `${this.apiUrl}${uri}?session=${this.tileManager.session}`;

        /** @type {pc.Asset} */
        let asset;
        try {
            asset = await this.loadGlb(url);
        } catch (err) {
            console.error("An error occurred while loading the GLB:", err);
        }

        /** @type {pc.ContainerResource} */
        const resource = asset.resource;

        const entity = resource.instantiateRenderEntity({
            castShadows: false
        });
        this.entity.addChild(entity);

        // Update all maps
        for (const meshInstance of entity.render.meshInstances) {
            meshInstanceToNode.set(meshInstance, node);
        }
        nodeToAsset.set(node, asset);
        nodeToEntity.set(node, entity);
    };
    const unload = (node) => {
        const entity = nodeToEntity.get(node);
        if (entity) {
            for (const meshInstance of entity.render.meshInstances) {
                meshInstanceToNode.delete(meshInstance);
            }

            entity.destroy();
            nodeToEntity.delete(node);
        }

        const asset = nodeToAsset.get(node);
        if (asset) {
            asset.unload();
            nodeToAsset.delete(node);
        }
    };
    const show = (node) => {
        const entity = nodeToEntity.get(node);
        if (entity) {
            entity.render.enabled = true;
        }
    };
    const hide = (node) => {
        const entity = nodeToEntity.get(node);
        if (entity) {
            entity.render.enabled = false;
        }
    };

    this.tileManager = new earthatile.TileManager(apiKey, this.apiUrl, { load, unload, show, hide });

    if(!editMode){
        this.tileManager.isInView = (node) => {
            const [cx, cy, cz, xx, xy, xz, yx, yy, yz, zx, zy, zz] = node.boundingVolume.box;
            const camera = this.camera.camera;

            const offset = this.entity.getPosition();

            // Set the center of the temp sphere
            const center = this._v1.set(cx, cz, -cy);
            const xaxis = this._v2.set(xx, xz, -xy);
            const yaxis = this._v3.set(yx, yz, -yy);
            const zaxis = this._v4.set(zx, zz, -zy);

            // Calculate eight vertices of the box
            const min = this._v5.copy(center).sub(xaxis).sub(yaxis).sub(zaxis).add(offset);
            const max = this._v6.copy(center).add(xaxis).add(yaxis).add(zaxis).add(offset);

            // Calculate extents
            const extent = this._v7.sub2(min, max);

            this._tempSphere.center.set(center.x + offset.x, center.y + offset.y, center.z + offset.z);
            this._tempSphere.radius = extent.length();

            return camera.frustum.containsSphere(this._tempSphere);
        };
    }

    this.tileManager.start();

    // Create a picker for debugging tile data
    const canvas = this.app.graphicsDevice.canvas;
    this.picker = new pc.Picker(this.app, canvas.width, canvas.height);
    canvas.addEventListener('click', (e) => {
        if (e.shiftKey) {
            this.picker.prepare(this.camera.camera, this.app.scene);
            const results = pc.utils.raycastChildNodesAABB(this.camera.getPosition(), this.camera.forward, this.entity);

            for (const meshInstance of results) {
                this.selectedNode = meshInstanceToNode.get(meshInstance);
            }

            console.log("******* Selected node:", this.selectedNode);
        }
    });
};

TileRenderer.prototype.renderBoundingVolume = function (node) {
    const offset = this.entity.getPosition();

    const boundingVolume = node.boundingVolume;

    // Extract box properties from bounding volume
    const [cx, cy, cz, xx, xy, xz, yx, yy, yz, zx, zy, zz] = boundingVolume.box;

    // Convert the bounding box data into PlayCanvas vectors (adjusting for Z-up to Y-up)
    const center = new pc.Vec3(cx, cz, -cy);
    const xaxis = new pc.Vec3(xx, xz, -xy);
    const yaxis = new pc.Vec3(yx, yz, -yy);
    const zaxis = new pc.Vec3(zx, zz, -zy);

    // Calculate eight vertices of the box
    const vertices = [
        center.clone().sub(xaxis).sub(yaxis).sub(zaxis).add(offset),
        center.clone().add(xaxis).sub(yaxis).sub(zaxis).add(offset),
        center.clone().add(xaxis).add(yaxis).sub(zaxis).add(offset),
        center.clone().sub(xaxis).add(yaxis).sub(zaxis).add(offset),
        center.clone().sub(xaxis).sub(yaxis).add(zaxis).add(offset),
        center.clone().add(xaxis).sub(yaxis).add(zaxis).add(offset),
        center.clone().add(xaxis).add(yaxis).add(zaxis).add(offset),
        center.clone().sub(xaxis).add(yaxis).add(zaxis).add(offset)
    ];

    // Create line segments that connect vertices of the box
    const positions = [
        // Bottom square
        vertices[0], vertices[1],
        vertices[1], vertices[2],
        vertices[2], vertices[3],
        vertices[3], vertices[0],

        // Top square
        vertices[4], vertices[5],
        vertices[5], vertices[6],
        vertices[6], vertices[7],
        vertices[7], vertices[4],

        // Connecting lines
        vertices[0], vertices[4],
        vertices[1], vertices[5],
        vertices[2], vertices[6],
        vertices[3], vertices[7]
    ];

    const colors = [];
    for (let i = 0; i < 24; i++) {
        colors.push(pc.Color.WHITE);
    }

    this.app.drawLines(positions, colors);
};

// update code called every frame
TileRenderer.prototype.update = function (dt) {
    if (this.tileManager && this.camera) {
        const pos = this.camera.getPosition();
        const offset = this.entity.getPosition();
        pos.sub(offset);
        this.tileManager.update([pos.x, pos.y, pos.z]);

        // if no nodes start to lode after X ticks, fire tilesLoaded
        const nodesLoadingIdleTick = 10;
        if(this.tileManager.nodesLoaded !== 0 && this.tileManager.nodesLoading === 0){
            this.nodesLoadedTicks++
            if(this.nodesLoadedTicks === nodesLoadingIdleTick) this.fire('tilesLoaded');
        } else {
            this.nodesLoadedTicks = 0;
        }

        if (this.selectedNode) {
            this.renderBoundingVolume(this.selectedNode);
        }
    }
};
