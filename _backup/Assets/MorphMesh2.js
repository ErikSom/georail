var MeshMorpher = pc.createScript('meshMorpher2');

MeshMorpher.attributes.add('material', { type: 'asset', assetType: 'material' });

MeshMorpher.prototype.initialize = function() {
    this.originalBoundingBoxVertices = new Array(8).fill().map(() => new pc.Vec3());
    this.currentBoundingBoxVertices = new Array(8).fill().map(() => new pc.Vec3());

    if (this.material && this.material.resource) {
        var material = this.material.resource;
        
        // Set up custom vertex shader
        material.chunks.transformVS = this.getCustomVertexShader();
        
        // Initialize bounding box vertices
        this.updateBoundingBox();

        // Create control spheres
        this.createControlSpheres();

        // Update shader
        material.update();
    }
};

MeshMorpher.prototype.getCustomVertexShader = function() {
    return `
    uniform vec3 uOriginalBoundingBoxVertices[8];
    uniform vec3 uCurrentBoundingBoxVertices[8];
   
    vec3 trilinearCoordinates(vec3 p, vec3 vmin, vec3 vmax) {
        vec3 size = vmax - vmin;
        size = max(size, vec3(0.0001)); // Prevent division by zero
        return (p - vmin) / size;
    }

    vec3 trilinearInterpolate(vec3 t, vec3 v000, vec3 v100, vec3 v010, vec3 v110, vec3 v001, vec3 v101, vec3 v011, vec3 v111) {
        vec3 c00 = mix(v000, v100, t.x);
        vec3 c10 = mix(v010, v110, t.x);
        vec3 c01 = mix(v001, v101, t.x);
        vec3 c11 = mix(v011, v111, t.x);
        vec3 c0 = mix(c00, c10, t.y);
        vec3 c1 = mix(c01, c11, t.y);
        return mix(c0, c1, t.z);
    }

    mat4 getModelMatrix() {
        #ifdef DYNAMICBATCH
        return getBoneMatrix(vertex_boneIndices);
        #elif defined(SKIN)
        return matrix_model * getSkinMatrix(vertex_boneIndices, vertex_boneWeights);
        #elif defined(INSTANCING)
        return mat4(instance_line1, instance_line2, instance_line3, instance_line4);
        #else
        return matrix_model;
        #endif
    }

    vec4 getPosition() {
        dModelMatrix = getModelMatrix();
        vec3 localPos = vertex_position;

        // Calculate the original position relative to the bounding box
        vec3 originalMin = min(uOriginalBoundingBoxVertices[0], uOriginalBoundingBoxVertices[7]);
        vec3 originalMax = max(uOriginalBoundingBoxVertices[0], uOriginalBoundingBoxVertices[7]);
        vec3 t = trilinearCoordinates(localPos, originalMin, originalMax);

        // Apply the deformation using trilinear interpolation
        vec3 deformedPos = trilinearInterpolate(t, 
            uCurrentBoundingBoxVertices[0], uCurrentBoundingBoxVertices[1], 
            uCurrentBoundingBoxVertices[2], uCurrentBoundingBoxVertices[3],
            uCurrentBoundingBoxVertices[4], uCurrentBoundingBoxVertices[5], 
            uCurrentBoundingBoxVertices[6], uCurrentBoundingBoxVertices[7]);

        vec4 posW = dModelMatrix * vec4(deformedPos, 1.0);
        dPositionW = posW.xyz;
        return matrix_viewProjection * posW;
    }

    vec3 getWorldPosition() {
        return dPositionW;
    }
    `;
};

MeshMorpher.prototype.updateBoundingBox = function() {
    var meshInstances = this.entity.render.meshInstances;
    if (meshInstances && meshInstances.length > 0) {
        var mesh = meshInstances[0].mesh;
        var aabb = mesh.aabb; // Use mesh's local AABB
        var min = aabb.getMin();
        var max = aabb.getMax();

        // Define the 8 vertices of the bounding box
        this.originalBoundingBoxVertices[0].set(min.x, min.y, min.z); // v000
        this.originalBoundingBoxVertices[1].set(max.x, min.y, min.z); // v100
        this.originalBoundingBoxVertices[2].set(min.x, max.y, min.z); // v010
        this.originalBoundingBoxVertices[3].set(max.x, max.y, min.z); // v110
        this.originalBoundingBoxVertices[4].set(min.x, min.y, max.z); // v001
        this.originalBoundingBoxVertices[5].set(max.x, min.y, max.z); // v101
        this.originalBoundingBoxVertices[6].set(min.x, max.y, max.z); // v011
        this.originalBoundingBoxVertices[7].set(max.x, max.y, max.z); // v111

        // Initialize current vertices to match original vertices
        for (var i = 0; i < 8; i++) {
            this.currentBoundingBoxVertices[i].copy(this.originalBoundingBoxVertices[i]);
        }

        if (this.material && this.material.resource) {
            this.updateShaderParameters();
        }
    }
};

MeshMorpher.prototype.updateShaderParameters = function() {
    var material = this.material.resource;
    
    // Convert Vec3 arrays to flat Float32Arrays
    var originalVerticesFlat = new Float32Array(24);
    var currentVerticesFlat = new Float32Array(24);

    for (var i = 0; i < 8; i++) {
        originalVerticesFlat[i*3] = this.originalBoundingBoxVertices[i].x;
        originalVerticesFlat[i*3+1] = this.originalBoundingBoxVertices[i].y;
        originalVerticesFlat[i*3+2] = this.originalBoundingBoxVertices[i].z;

        currentVerticesFlat[i*3] = this.currentBoundingBoxVertices[i].x;
        currentVerticesFlat[i*3+1] = this.currentBoundingBoxVertices[i].y;
        currentVerticesFlat[i*3+2] = this.currentBoundingBoxVertices[i].z;
    }

    material.setParameter('uOriginalBoundingBoxVertices[0]', originalVerticesFlat);
    material.setParameter('uCurrentBoundingBoxVertices[0]', currentVerticesFlat);
    material.update();
};

MeshMorpher.prototype.setVertexPosition = function(index, x, y, z) {
    if (index >= 0 && index < 8) {
        this.currentBoundingBoxVertices[index].set(x, y, z);
        if (this.material && this.material.resource) {
            this.updateShaderParameters();
        }
    }
};

MeshMorpher.prototype.createControlSpheres = function() {
    this.controlSpheres = [];
    this.controlSphereOriginalPositions = [];
    for (var i = 0; i < 8; i++) {
        var sphere = new pc.Entity('ControlSphere_' + i);
        sphere.addComponent('model', {
            type: 'sphere',
            castShadows: false,
            receiveShadows: false
        });
        sphere.setLocalPosition(this.currentBoundingBoxVertices[i]);

        // Add the sphere as a child of the entity with the MeshMorpher script
        this.entity.addChild(sphere);

        // Store the sphere for later use
        this.controlSpheres.push(sphere);

        this.controlSphereOriginalPositions.push(this.currentBoundingBoxVertices[i].clone());
    }
};

MeshMorpher.prototype.resetMorph = function() {
    for (var i = 0; i < 8; i++) {
        this.currentBoundingBoxVertices[i].copy(this.originalBoundingBoxVertices[i]);
    }
    if (this.material && this.material.resource) {
        this.updateShaderParameters();
    }
};

MeshMorpher.prototype.update = function(dt) {
    // Update the time variable
    this.time = performance.now() / 50;

    var amplitude = 2; // Adjust this value to control the deformation strength
    var frequency = 0.1; // Adjust this value to control the speed of the movement

    // Alter the positions of the control spheres based on sin(time)
    for (var i = 0; i < this.controlSpheres.length; i++) {
        var sphere = this.controlSpheres[i];
        var originalPos = this.controlSphereOriginalPositions[i];

        // Compute new position using sin(time)
        var offsetY = amplitude * Math.sin(this.time * frequency + i);
        var newPos = originalPos.clone();
        newPos.y += offsetY;

        // Optionally, you can add movement in x and z for more complex patterns
        var offsetX = amplitude * Math.sin(this.time * frequency + i);
        var offsetZ = amplitude * Math.cos(this.time * frequency + i);
        newPos.x += offsetX;
        newPos.z += offsetZ;

        sphere.setLocalPosition(newPos);

        // Update currentBoundingBoxVertices based on the sphere positions
        this.currentBoundingBoxVertices[i].copy(newPos);
    }

    // Update the shader parameters with the new positions
    if (this.material && this.material.resource) {
        this.updateShaderParameters();
    }
};
