import { Mesh, Material, Object3D } from 'three';

const OBFUSCATION_KEY = 16.28;
const OBFUSCATION_STRENGTH = 0.5;
const OBFUSCATION_FREQUENCY = 10.0;

export function applyDeobfuscation(scene: Object3D) {
    scene.traverse((child) => {
        if (child instanceof Mesh) {
            child.frustumCulled = false;

            const materials = Array.isArray(child.material) ? child.material : [child.material];

            materials.forEach((mat: Material) => {
                mat.onBeforeCompile = (shader) => {
                    shader.uniforms.uKe = { value: OBFUSCATION_KEY };
                    shader.uniforms.uSt = { value: OBFUSCATION_STRENGTH };
                    shader.uniforms.uFq = { value: OBFUSCATION_FREQUENCY };

                    // A. Inject Header (Uniforms + Helper Functions)
                    shader.vertexShader = `
                        uniform float uKe;
                        uniform float uSt;
                        uniform float uFq;

                        float gtSi(float val) { return sin(val * uFq + uKe) * uSt; }
                        float gtCo(float val) { return cos(val * uFq + uKe) * uSt; }
                    ` + shader.vertexShader;

                    // B. Inject Reverse Logic
                    // Node Order: X -> Y -> Z
                    // Shader Order: Z -> Y -> X
                    shader.vertexShader = shader.vertexShader.replace(
                        '#include <begin_vertex>',
                        `
                        vec3 transformed = vec3( position );
                        transformed.z = transformed.z - gtSi(transformed.x + transformed.y);
                        transformed.y = transformed.y - gtCo(transformed.x);  
                        transformed.x = transformed.x - gtSi(transformed.y);
                        `
                    );
                };

                mat.needsUpdate = true;
            });
        }
    });
}

export const loadEncryptedAsset = async (mangledUrl: string, originalPath: string) => {
    const response = await fetch(mangledUrl);
    const buffer = await response.arrayBuffer();

    const data = new Uint8Array(buffer);
    const key = new TextEncoder().encode(originalPath); // originalPath is the key
    const keyLen = key.length;

    // 3. Decrypt (XOR)
    for (let i = 0; i < data.length; i++) {
        data[i] = data[i] ^ key[i % keyLen];
    }

    // 4. Create Object URL
    const blob = new Blob([data]);
    return URL.createObjectURL(blob);
};


export const isDebugAdmin = (): boolean => {
    // Simple check for debug admin mode via URL parameter
    if (typeof window !== 'undefined') {
        const urlParams = new URLSearchParams(window.location.search);
        return urlParams.get('debugAdmin') === 'true';
    }
    return false;
}