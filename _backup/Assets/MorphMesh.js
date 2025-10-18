var MeshMorpher = pc.createScript('meshMorpher');

MeshMorpher.attributes.add('material', { type: 'asset', assetType: 'material' });

MeshMorpher.prototype.initialize = function() {
    if (this.material && this.material.resource) {
        var material = this.material.resource;
        
        // Set up custom vertex shader
        material.chunks.transformVS = this.getCustomVertexShader();
        
        // // Set custom uniform: original bounding box vertices
        material.setParameter('uCornerCompressionTopLeft', 0.5);
        material.setParameter('uCornerCompressionTopRight', 1.0);
        material.setParameter('uCornerCompressionBottomLeft', 1.0);
        material.setParameter('uCornerCompressionBottomRight', 1.0);
        material.setParameter('uXAxisOffset', 10.0);
        material.setParameter('uYAxisOffset', 1.2);
        
        // // Set custom uniform: current bounding box vertices
        // material.setParameter('uBoundingBoxVertices', this.currentBoundingBoxVertices);

        // Update shader
        material.update();
    }
};

MeshMorpher.prototype.getCustomVertexShader = function() {
    return `


    uniform float uCornerCompressionTopLeft;
    uniform float uCornerCompressionTopRight;
    uniform float uCornerCompressionBottomLeft;
    uniform float uCornerCompressionBottomRight;
    uniform float uXAxisOffset;
    uniform float uYAxisOffset;

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

        vec3 compressedLocalPos = localPos;

        // compression left
        if(localPos.x > 0.0){
            float xCompressionFactor = clamp(localPos.x / uXAxisOffset, 0.0, 1.0);
            float xCompression = 1.0 - (uCornerCompressionTopLeft * xCompressionFactor);
            compressedLocalPos.z *= xCompression;
        }

	    vec4 posW = dModelMatrix * vec4(compressedLocalPos, 1.0);
	    dPositionW = posW.xyz;
	    vec4 screenPos = matrix_viewProjection * posW;
	    return screenPos;
	}
	vec3 getWorldPosition() {
	    return dPositionW;
	}
    `;
};

MeshMorpher.prototype.updateBoundingBox = function() {
    var meshInstances = this.entity.render.meshInstances;
    if (meshInstances && meshInstances.length > 0) {
        var aabb = meshInstances[0].aabb; // Use the aabb property instead of getAabb method
        var min = aabb.getMin();
        var max = aabb.getMax();

        // Define the 8 vertices of the bounding box
        this.originalBoundingBoxVertices[0].set(min.x, min.y, min.z);
        this.originalBoundingBoxVertices[1].set(max.x, min.y, min.z);
        this.originalBoundingBoxVertices[2].set(min.x, max.y, min.z);
        this.originalBoundingBoxVertices[3].set(max.x, max.y, min.z);
        this.originalBoundingBoxVertices[4].set(min.x, min.y, max.z);
        this.originalBoundingBoxVertices[5].set(max.x, min.y, max.z);
        this.originalBoundingBoxVertices[6].set(min.x, max.y, max.z);
        this.originalBoundingBoxVertices[7].set(max.x, max.y, max.z);

        // Initialize current vertices to match original vertices
        for (var i = 0; i < 8; i++) {
            this.currentBoundingBoxVertices[i].copy(this.originalBoundingBoxVertices[i]);
        }

        if (this.material && this.material.resource) {
            this.material.resource.setParameter('uOriginalBoundingBoxVertices', this.originalBoundingBoxVertices);
            this.material.resource.setParameter('uBoundingBoxVertices', this.currentBoundingBoxVertices);
            this.material.resource.update();
        }
    }
};

MeshMorpher.prototype.setVertexPosition = function(index, x, y, z) {
    if (index >= 0 && index < 8) {
        this.currentBoundingBoxVertices[index].set(x, y, z);
        if (this.material && this.material.resource) {
            this.material.resource.setParameter('uBoundingBoxVertices', this.currentBoundingBoxVertices);
            this.material.resource.update();
        }
    }
};

MeshMorpher.prototype.resetMorph = function() {
    for (var i = 0; i < 8; i++) {
        this.currentBoundingBoxVertices[i].copy(this.originalBoundingBoxVertices[i]);
    }
    if (this.material && this.material.resource) {
        this.material.resource.setParameter('uBoundingBoxVertices', this.currentBoundingBoxVertices);
        this.material.resource.update();
    }
};

MeshMorpher.prototype.update = function(dt) {
    // You can add dynamic updates here if needed
};