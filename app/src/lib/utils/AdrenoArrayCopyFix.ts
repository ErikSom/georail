import {
    ShaderMaterial,
    WebGLArrayRenderTarget,
    type WebGLRenderer,
} from 'three';
import { FullScreenQuad } from 'three/examples/jsm/postprocessing/Pass.js';

// Adreno (and some Mali) drivers have a broken copyTexSubImage3D: after
// expanding a texture array via renderer.copyTextureToTexture, every layer
// reads from layer 0. Workaround from 3DTilesRendererJS#1527 — render each
// layer through a fullscreen quad sampling the source array.
// Remove this once we can bump 3d-tiles-renderer to a version that exposes
// the `useShaderCopy` option on BatchedTilesPlugin.

let _layerCopyQuad: FullScreenQuad | null = null;

function getLayerCopyQuad(): FullScreenQuad {
    if (_layerCopyQuad) return _layerCopyQuad;
    _layerCopyQuad = new FullScreenQuad(new ShaderMaterial({
        uniforms: {
            srcTexture: { value: null },
            layer: { value: 0 },
        },
        vertexShader: /* glsl */`
            varying vec2 vUv;
            void main() {
                vUv = uv;
                gl_Position = projectionMatrix * modelViewMatrix * vec4( position, 1.0 );
            }
        `,
        fragmentShader: /* glsl */`
            precision highp sampler2DArray;
            uniform sampler2DArray srcTexture;
            uniform float layer;
            varying vec2 vUv;
            void main() {
                gl_FragColor = texture( srcTexture, vec3( vUv, layer ) );
            }
        `,
    }));
    return _layerCopyQuad;
}

export function isAdrenoGPU(renderer: WebGLRenderer): boolean {
    try {
        const gl = renderer.getContext();
        const ext = gl.getExtension('WEBGL_debug_renderer_info');
        if (!ext) return false;
        const name = String(gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) || '');
        return /Adreno/i.test(name);
    } catch {
        return false;
    }
}

// Monkey-patches expandArrayTargetIfNeeded on a BatchedTilesPlugin instance
// to avoid the broken copyTexSubImage3D path on Adreno devices.
export function applyAdrenoArrayCopyFix(plugin: any, renderer: WebGLRenderer): void {
    plugin.expandArrayTargetIfNeeded = function () {
        const { batchedMesh, arrayTarget } = this;
        const targetDepth = Math.min(batchedMesh.maxInstanceCount, this.maxInstanceCount);
        if (targetDepth <= arrayTarget.depth) return;

        const textureOptions = {
            colorSpace: arrayTarget.texture.colorSpace,
            wrapS: arrayTarget.texture.wrapS,
            wrapT: arrayTarget.texture.wrapT,
            generateMipmaps: arrayTarget.texture.generateMipmaps,
            minFilter: arrayTarget.texture.minFilter,
            magFilter: arrayTarget.texture.magFilter,
        };

        const newArrayTarget = new WebGLArrayRenderTarget(
            arrayTarget.width,
            arrayTarget.height,
            targetDepth,
        );
        Object.assign(newArrayTarget.texture, textureOptions);
        renderer.initRenderTarget(newArrayTarget);

        const previousRenderTarget = renderer.getRenderTarget();
        const quad = getLayerCopyQuad();
        const material = quad.material as ShaderMaterial;
        material.uniforms.srcTexture.value = arrayTarget.texture;

        for (let i = 0; i < arrayTarget.depth; i++) {
            material.uniforms.layer.value = i;
            renderer.setRenderTarget(newArrayTarget, i);
            quad.render(renderer);
        }

        material.uniforms.srcTexture.value = null;
        renderer.setRenderTarget(previousRenderTarget);

        arrayTarget.dispose();
        batchedMesh.material.map = newArrayTarget.texture;
        this.arrayTarget = newArrayTarget;
    };
}
