import {
    Mesh,
    PlaneGeometry,
    ShaderMaterial,
    LessEqualStencilFunc,
    KeepStencilOp,
} from 'three';

/**
 * Full-screen dither overlay for occluded train silhouette.
 * Scene writes stencil=128, visible train zeros it, occluded train increments to 129+.
 * This quad only renders where stencil >= 129 (1 draw call).
 */

const vertexShader = /* glsl */ `
void main() {
    gl_Position = vec4(position.xy, 0.0, 1.0);
}
`;

const fragmentShader = /* glsl */ `
uniform vec3 color;
uniform float opacity;

void main() {
    // 8x8 Bayer matrix for fine-grained dither
    // Divide by 2 to double the pattern size (chunkier pixels)
    int x = (int(gl_FragCoord.x) / 2) & 7;
    int y = (int(gl_FragCoord.y) / 2) & 7;
    int index = x + y * 8;

    // Bayer 8x8 (values 0..63 normalized to 0..1)
    float threshold;
    if      (index == 0)  threshold = 0.0;   else if (index == 1)  threshold = 32.0;
    else if (index == 2)  threshold = 8.0;   else if (index == 3)  threshold = 40.0;
    else if (index == 4)  threshold = 2.0;   else if (index == 5)  threshold = 34.0;
    else if (index == 6)  threshold = 10.0;  else if (index == 7)  threshold = 42.0;
    else if (index == 8)  threshold = 48.0;  else if (index == 9)  threshold = 16.0;
    else if (index == 10) threshold = 56.0;  else if (index == 11) threshold = 24.0;
    else if (index == 12) threshold = 50.0;  else if (index == 13) threshold = 18.0;
    else if (index == 14) threshold = 58.0;  else if (index == 15) threshold = 26.0;
    else if (index == 16) threshold = 12.0;  else if (index == 17) threshold = 44.0;
    else if (index == 18) threshold = 4.0;   else if (index == 19) threshold = 36.0;
    else if (index == 20) threshold = 14.0;  else if (index == 21) threshold = 46.0;
    else if (index == 22) threshold = 6.0;   else if (index == 23) threshold = 38.0;
    else if (index == 24) threshold = 60.0;  else if (index == 25) threshold = 28.0;
    else if (index == 26) threshold = 52.0;  else if (index == 27) threshold = 20.0;
    else if (index == 28) threshold = 62.0;  else if (index == 29) threshold = 30.0;
    else if (index == 30) threshold = 54.0;  else if (index == 31) threshold = 22.0;
    else if (index == 32) threshold = 3.0;   else if (index == 33) threshold = 35.0;
    else if (index == 34) threshold = 11.0;  else if (index == 35) threshold = 43.0;
    else if (index == 36) threshold = 1.0;   else if (index == 37) threshold = 33.0;
    else if (index == 38) threshold = 9.0;   else if (index == 39) threshold = 41.0;
    else if (index == 40) threshold = 51.0;  else if (index == 41) threshold = 19.0;
    else if (index == 42) threshold = 59.0;  else if (index == 43) threshold = 27.0;
    else if (index == 44) threshold = 49.0;  else if (index == 45) threshold = 17.0;
    else if (index == 46) threshold = 57.0;  else if (index == 47) threshold = 25.0;
    else if (index == 48) threshold = 15.0;  else if (index == 49) threshold = 47.0;
    else if (index == 50) threshold = 7.0;   else if (index == 51) threshold = 39.0;
    else if (index == 52) threshold = 13.0;  else if (index == 53) threshold = 45.0;
    else if (index == 54) threshold = 5.0;   else if (index == 55) threshold = 37.0;
    else if (index == 56) threshold = 63.0;  else if (index == 57) threshold = 31.0;
    else if (index == 58) threshold = 55.0;  else if (index == 59) threshold = 23.0;
    else if (index == 60) threshold = 61.0;  else if (index == 61) threshold = 29.0;
    else if (index == 62) threshold = 53.0;  else                  threshold = 21.0;

    threshold /= 64.0;

    // Scale down coordinates to make the pattern larger/chunkier
    if (threshold >= opacity) discard;

    gl_FragColor = vec4(color, 0.6);
}
`;

export class DitherOverlay {
    public readonly mesh: Mesh;

    constructor() {
        const geometry = new PlaneGeometry(2, 2);

        const material = new ShaderMaterial({
            vertexShader,
            fragmentShader,
            uniforms: {
                color: { value: [0.55, 0.75, 1.0] },
                opacity: { value: 0.25 },
            },
            depthTest: false,
            depthWrite: false,
            transparent: true,
        });

        material.stencilWrite = true;
        material.stencilWriteMask = 0x00;
        material.stencilFunc = LessEqualStencilFunc;
        material.stencilRef = 129;
        material.stencilFuncMask = 0xFF;
        material.stencilFail = KeepStencilOp;
        material.stencilZFail = KeepStencilOp;
        material.stencilZPass = KeepStencilOp;

        this.mesh = new Mesh(geometry, material);
        this.mesh.name = 'DitherOverlay';
        this.mesh.frustumCulled = false;
        this.mesh.renderOrder = 9999;
    }

    dispose(): void {
        this.mesh.geometry.dispose();
        (this.mesh.material as ShaderMaterial).dispose();
    }
}
