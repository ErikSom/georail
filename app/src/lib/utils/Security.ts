import { Mesh, Material, Object3D } from 'three';

const OBFUSCATION_KEY = 123.45;
const OBFUSCATION_STRENGTH = 0.5;
const OBFUSCATION_FREQUENCY = 10.0;

export function applyDeobfuscation(scene: Object3D) {
    scene.traverse((child) => {
        if (child instanceof Mesh) {
            child.frustumCulled = false;

            const materials = Array.isArray(child.material) ? child.material : [child.material];

            materials.forEach((mat: Material) => {
                mat.onBeforeCompile = (shader) => {
                    shader.uniforms.uSecKey = { value: OBFUSCATION_KEY };
                    shader.uniforms.uSecStr = { value: OBFUSCATION_STRENGTH };
                    shader.uniforms.uSecFreq = { value: OBFUSCATION_FREQUENCY };

                    // A. Inject Header (Uniforms + Helper Functions)
                    shader.vertexShader = `
                        uniform float uSecKey;
                        uniform float uSecStr;
                        uniform float uSecFreq;

                        // Helper functions to keep main logic clean
                        float getSin(float val) { return sin(val * uSecFreq + uSecKey) * uSecStr; }
                        float getCos(float val) { return cos(val * uSecFreq + uSecKey) * uSecStr; }
                    ` + shader.vertexShader;

                    // B. Inject Reverse Logic
                    // Node Order: X -> Y -> Z
                    // Shader Order: Z -> Y -> X
                    shader.vertexShader = shader.vertexShader.replace(
                        '#include <begin_vertex>',
                        `
                        vec3 transformed = vec3( position );

                        transformed.z = transformed.z - getSin(transformed.x + transformed.y);
                        transformed.y = transformed.y - getCos(transformed.x);  
                        transformed.x = transformed.x - getSin(transformed.y);
                        `
                    );
                };

                mat.needsUpdate = true;
            });
        }
    });
}