/**
 * Custom Lensflare with distance-based fade.
 * Based on Three.js Lensflare addon with a `distanceFade` uniform added.
 */
import {
    AdditiveBlending,
    Box2,
    BufferGeometry,
    Color,
    FramebufferTexture,
    InterleavedBuffer,
    InterleavedBufferAttribute,
    Mesh,
    MeshBasicMaterial,
    RawShaderMaterial,
    UnsignedByteType,
    Vector2,
    Vector3,
    Vector4,
    type Camera,
    type Scene,
    type Texture,
    type WebGLRenderer,
} from 'three';

class LensflareElement {
    texture: Texture;
    size: number;
    distance: number;
    color: Color;

    constructor(texture: Texture, size = 1, distance = 0, color = new Color(0xffffff)) {
        this.texture = texture;
        this.size = size;
        this.distance = distance;
        this.color = color;
    }

    static Shader = {
        name: 'LensflareElementShader',
        uniforms: {
            'map': { value: null },
            'occlusionMap': { value: null },
            'color': { value: null },
            'scale': { value: null },
            'screenPosition': { value: null },
            'distanceFade': { value: 1.0 },
        },
        vertexShader: /* glsl */`
            precision highp float;

            uniform vec3 screenPosition;
            uniform vec2 scale;
            uniform sampler2D occlusionMap;

            attribute vec3 position;
            attribute vec2 uv;

            varying vec2 vUV;
            varying float vVisibility;

            void main() {
                vUV = uv;
                vec2 pos = position.xy;

                vec4 visibility = texture2D( occlusionMap, vec2( 0.1, 0.1 ) );
                visibility += texture2D( occlusionMap, vec2( 0.5, 0.1 ) );
                visibility += texture2D( occlusionMap, vec2( 0.9, 0.1 ) );
                visibility += texture2D( occlusionMap, vec2( 0.9, 0.5 ) );
                visibility += texture2D( occlusionMap, vec2( 0.9, 0.9 ) );
                visibility += texture2D( occlusionMap, vec2( 0.5, 0.9 ) );
                visibility += texture2D( occlusionMap, vec2( 0.1, 0.9 ) );
                visibility += texture2D( occlusionMap, vec2( 0.1, 0.5 ) );
                visibility += texture2D( occlusionMap, vec2( 0.5, 0.5 ) );

                vVisibility =        visibility.r / 9.0;
                vVisibility *= 1.0 - visibility.g / 9.0;
                vVisibility *=       visibility.b / 9.0;

                gl_Position = vec4( ( pos * scale + screenPosition.xy ).xy, screenPosition.z, 1.0 );
            }`,
        fragmentShader: /* glsl */`
            precision highp float;

            uniform sampler2D map;
            uniform vec3 color;
            uniform float distanceFade;

            varying vec2 vUV;
            varying float vVisibility;

            void main() {
                vec4 texture = texture2D( map, vUV );
                texture.a *= vVisibility * distanceFade;
                gl_FragColor = texture;
                gl_FragColor.rgb *= color;
            }`,
    };
}

const Geometry = (() => {
    const geometry = new BufferGeometry();
    const float32Array = new Float32Array([
        -1, -1, 0, 0, 0,
        1, -1, 0, 1, 0,
        1, 1, 0, 1, 1,
        -1, 1, 0, 0, 1,
    ]);
    const interleavedBuffer = new InterleavedBuffer(float32Array, 5);
    geometry.setIndex([0, 1, 2, 0, 2, 3]);
    geometry.setAttribute('position', new InterleavedBufferAttribute(interleavedBuffer, 3, 0, false));
    geometry.setAttribute('uv', new InterleavedBufferAttribute(interleavedBuffer, 2, 3, false));
    return geometry;
})();

class Lensflare extends Mesh {
    isLensflare = true;

    /** Global intensity multiplier for all lensflares (0 = invisible, 1 = full). Set by scene lighting. */
    static globalIntensity = 1.0;

    /** Distance (in world units) at which the flare starts fading */
    fadeNear: number;
    /** Distance at which the flare is fully invisible */
    fadeFar: number;

    private _addElement: (element: LensflareElement) => void;
    private _dispose: () => void;

    constructor(fadeNear = 100, fadeFar = 500) {
        super(Geometry, new MeshBasicMaterial({ opacity: 0, transparent: true }));
        (this as any).type = 'Lensflare';
        this.frustumCulled = false;
        this.renderOrder = Infinity;
        this.fadeNear = fadeNear;
        this.fadeFar = fadeFar;

        const positionScreen = new Vector3();
        const positionView = new Vector3();

        const tempMap = new FramebufferTexture(16, 16);
        const occlusionMap = new FramebufferTexture(16, 16);
        let currentType: any = UnsignedByteType;

        const geometry = Geometry;

        const material1a = new RawShaderMaterial({
            uniforms: {
                'scale': { value: null },
                'screenPosition': { value: null },
            },
            vertexShader: /* glsl */`
                precision highp float;
                uniform vec3 screenPosition;
                uniform vec2 scale;
                attribute vec3 position;
                void main() {
                    gl_Position = vec4( position.xy * scale + screenPosition.xy, screenPosition.z, 1.0 );
                }`,
            fragmentShader: /* glsl */`
                precision highp float;
                void main() {
                    gl_FragColor = vec4( 1.0, 0.0, 1.0, 1.0 );
                }`,
            depthTest: true,
            depthWrite: false,
            transparent: false,
        });

        const material1b = new RawShaderMaterial({
            uniforms: {
                'map': { value: tempMap },
                'scale': { value: null },
                'screenPosition': { value: null },
            },
            vertexShader: /* glsl */`
                precision highp float;
                uniform vec3 screenPosition;
                uniform vec2 scale;
                attribute vec3 position;
                attribute vec2 uv;
                varying vec2 vUV;
                void main() {
                    vUV = uv;
                    gl_Position = vec4( position.xy * scale + screenPosition.xy, screenPosition.z, 1.0 );
                }`,
            fragmentShader: /* glsl */`
                precision highp float;
                uniform sampler2D map;
                varying vec2 vUV;
                void main() {
                    gl_FragColor = texture2D( map, vUV );
                }`,
            depthTest: false,
            depthWrite: false,
            transparent: false,
        });

        const mesh1 = new Mesh(geometry, material1a);

        const elements: LensflareElement[] = [];
        const shader = LensflareElement.Shader;

        const material2 = new RawShaderMaterial({
            name: shader.name,
            uniforms: {
                'map': { value: null },
                'occlusionMap': { value: occlusionMap },
                'color': { value: new Color(0xffffff) },
                'scale': { value: new Vector2() },
                'screenPosition': { value: new Vector3() },
                'distanceFade': { value: 1.0 },
            },
            vertexShader: shader.vertexShader,
            fragmentShader: shader.fragmentShader,
            blending: AdditiveBlending,
            transparent: true,
            depthWrite: false,
        });

        const mesh2 = new Mesh(geometry, material2);

        this._addElement = (element: LensflareElement) => { elements.push(element); };

        const scale = new Vector2();
        const screenPositionPixels = new Vector2();
        const validArea = new Box2();
        const viewport = new Vector4();

        this.onBeforeRender = (renderer: WebGLRenderer, _scene: Scene, camera: Camera) => {
            renderer.getCurrentViewport(viewport);

            const renderTarget = renderer.getRenderTarget();
            const type = renderTarget !== null ? renderTarget.texture.type : UnsignedByteType;

            if (currentType !== type) {
                tempMap.dispose();
                occlusionMap.dispose();
                tempMap.type = occlusionMap.type = type;
                currentType = type;
            }

            const invAspect = viewport.w / viewport.z;
            const halfViewportWidth = viewport.z / 2.0;
            const halfViewportHeight = viewport.w / 2.0;

            let size = 16 / viewport.w;
            scale.set(size * invAspect, size);

            validArea.min.set(viewport.x, viewport.y);
            validArea.max.set(viewport.x + (viewport.z - 16), viewport.y + (viewport.w - 16));

            positionView.setFromMatrixPosition(this.matrixWorld);
            positionView.applyMatrix4(camera.matrixWorldInverse);

            if (positionView.z > 0) return; // behind camera

            positionScreen.copy(positionView).applyMatrix4(camera.projectionMatrix);

            screenPositionPixels.x = viewport.x + (positionScreen.x * halfViewportWidth) + halfViewportWidth - 8;
            screenPositionPixels.y = viewport.y + (positionScreen.y * halfViewportHeight) + halfViewportHeight - 8;

            // Distance-based fade combined with global scene intensity
            const dist = -positionView.z;
            const distFade = dist <= this.fadeNear ? 1.0
                : dist >= this.fadeFar ? 0.0
                    : 1.0 - (dist - this.fadeNear) / (this.fadeFar - this.fadeNear);
            const fadeFactor = distFade * Lensflare.globalIntensity;

            if (fadeFactor <= 0) return;

            if (validArea.containsPoint(screenPositionPixels)) {
                renderer.copyFramebufferToTexture(tempMap, screenPositionPixels);

                let uniforms = material1a.uniforms;
                uniforms['scale'].value = scale;
                uniforms['screenPosition'].value = positionScreen;
                renderer.renderBufferDirect(camera, null as unknown as Scene, geometry, material1a, mesh1, null);

                renderer.copyFramebufferToTexture(occlusionMap, screenPositionPixels);

                uniforms = material1b.uniforms;
                uniforms['scale'].value = scale;
                uniforms['screenPosition'].value = positionScreen;
                renderer.renderBufferDirect(camera, null as unknown as Scene, geometry, material1b, mesh1, null);

                const vecX = -positionScreen.x * 2;
                const vecY = -positionScreen.y * 2;

                for (let i = 0, l = elements.length; i < l; i++) {
                    const element = elements[i];
                    const uniforms = material2.uniforms;

                    uniforms['color'].value.copy(element.color);
                    uniforms['map'].value = element.texture;
                    uniforms['screenPosition'].value.x = positionScreen.x + vecX * element.distance;
                    uniforms['screenPosition'].value.y = positionScreen.y + vecY * element.distance;
                    uniforms['distanceFade'].value = fadeFactor;

                    size = element.size / viewport.w;
                    const invAspect = viewport.w / viewport.z;
                    uniforms['scale'].value.set(size * invAspect, size);

                    material2.uniformsNeedUpdate = true;
                    renderer.renderBufferDirect(camera, null as unknown as Scene, geometry, material2, mesh2, null);
                }
            }
        };

        this._dispose = () => {
            material1a.dispose();
            material1b.dispose();
            material2.dispose();
            tempMap.dispose();
            occlusionMap.dispose();
            for (let i = 0, l = elements.length; i < l; i++) {
                elements[i].texture.dispose();
            }
        };
    }

    addElement(element: LensflareElement): void {
        this._addElement(element);
    }

    dispose(): void {
        this._dispose();
    }
}

export { Lensflare, LensflareElement };
