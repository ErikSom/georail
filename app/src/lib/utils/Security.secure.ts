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

export const blobString = 'blob:';

export const loadEncryptedAsset = async (mangledUrl: string, originalPath: string): Promise<ArrayBuffer> => {
    const response = await fetch(mangledUrl);

    if (!response.ok) {
        throw new Error(`Asset not found: ${mangledUrl} (${response.status})`);
    }

    const buffer = await response.arrayBuffer();
    const data = new Uint8Array(buffer); // Create a view to edit bytes
    const key = new TextEncoder().encode(originalPath);
    const keyLen = key.length;

    // Decrypt in place (modifies the underlying buffer)
    for (let i = 0; i < data.length; i++) {
        data[i] = data[i] ^ key[i % keyLen];
    }

    return buffer; // Return the raw, decrypted ArrayBuffer
};

const protectedAssetLookup = JSON.parse("{\"train/NS-SGM/NS SGM motornoise version 2.wav\":\"56ae16c0c529.ewv\",\"train/NS-SGM/NS SGM high speed motor throb.wav\":\"8c03ea5a39be.ewv\",\"train/NS-SGM/NS SGM electrical current.wav\":\"968ef8348f96.ewv\",\"train/NS-SGM/NS SGM door open.wav\":\"7d991e61255f.ewv\",\"train/NS-SGM/NS SGM door close.wav\":\"e212eddc7edd.ewv\",\"train/NS-SGM/NS SGM Tyfoon.wav\":\"a9db1eafd641.ewv\",\"train/NS-SGM/NS SGM Tyfoon low.wav\":\"e61ebe740aef.ewv\",\"train/NS-SGM/ns-sgmm3-bk2.glb\":\"39b0d1cdd747.clt\",\"train/NS-SGM/ns-sgmm3-bk1.glb\":\"0c60cdca95c9.clt\",\"train/NS-SGM/ns-sgmm3-abopt.glb\":\"68b3084a6f2c.clt\",\"train/NS-SGM/ns-sgmm3-ab.glb\":\"b1a564823b8b.clt\",\"train/APT/apt-wip.glb\":\"1a446d6f930f.clt\",\"train/APT/apt-std-carriage.glb\":\"419d3af46833.clt\"}");

export function getProtectedAssetPath(modelFileName: string) {
    return protectedAssetLookup[modelFileName] || modelFileName;
}

export const isDebugAdmin = (): boolean => {
    // Simple check for debug admin mode via URL parameter
    if (typeof window !== 'undefined') {
        const urlParams = new URLSearchParams(window.location.search);
        return urlParams.get('debugAdmin') === 'true';
    }
    return false;
}
