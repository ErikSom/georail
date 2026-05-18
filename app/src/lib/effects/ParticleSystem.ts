import {
    BufferAttribute,
    Color,
    DynamicDrawUsage,
    InstancedBufferAttribute,
    InstancedBufferGeometry,
    LinearMipmapLinearFilter,
    Mesh,
    NormalBlending,
    AdditiveBlending,
    Scene,
    ShaderMaterial,
    SRGBColorSpace,
    Texture,
    TextureLoader,
    Vector3,
    type Blending,
} from 'three';
import type { BlendMode, ParticleEmitterConfig } from '../train/TrainConfig';

const textureCache = new Map<string, Texture>();
const textureLoader = new TextureLoader();

function loadTexture(path: string): Texture {
    const cached = textureCache.get(path);
    if (cached) return cached;
    const tex = textureLoader.load(path);
    tex.colorSpace = SRGBColorSpace;
    tex.minFilter = LinearMipmapLinearFilter;
    tex.generateMipmaps = true;
    textureCache.set(path, tex);
    return tex;
}

const vertexShader = /* glsl */ `
attribute vec3 aOrigin;
attribute vec3 aVelocity;
attribute vec3 aColor;
attribute float aSpawnTime;
attribute float aLifetime;
attribute float aSize;
attribute float aSeed;
attribute float aOpacity;

uniform float uTime;
uniform vec3 uAccel;
uniform float uDrag;
uniform vec2 uSizeOverLife;
uniform vec2 uOpacityOverLife;
uniform vec3 uColorStart;
uniform vec3 uColorEnd;

varying vec2 vUv;
varying vec4 vColor;

void main() {
    float age = uTime - aSpawnTime;
    float life01 = age / max(aLifetime, 1e-3);

    if (age < 0.0 || life01 >= 1.0 || aLifetime <= 0.0) {
        gl_Position = vec4(2.0, 2.0, 2.0, 1.0);
        vColor = vec4(0.0);
        vUv = vec2(0.0);
        return;
    }

    // Closed-form drag-integrated trajectory: pos = origin + v*(1-e^{-k t})/k + 0.5 a t^2
    float k = max(uDrag, 1e-4);
    float dragDecay = (1.0 - exp(-k * age)) / k;
    vec3 worldPos = aOrigin + aVelocity * dragDecay + 0.5 * uAccel * age * age;

    float sizeMul = mix(uSizeOverLife.x, uSizeOverLife.y, life01);
    float size = aSize * sizeMul;

    float rot = aSeed * 6.2831853;
    float c = cos(rot);
    float s = sin(rot);
    vec2 rotated = vec2(position.x * c - position.y * s, position.x * s + position.y * c);

    // Billboard in view space: 2D offset auto-faces the camera.
    vec4 viewCenter = viewMatrix * vec4(worldPos, 1.0);
    viewCenter.xy += rotated * size;
    gl_Position = projectionMatrix * viewCenter;

    vUv = uv;
    float alpha = mix(uOpacityOverLife.x, uOpacityOverLife.y, life01) * aOpacity;
    vec3 tint = mix(uColorStart, uColorEnd, life01) * aColor;
    vColor = vec4(tint, alpha);
}
`;

const fragmentShader = /* glsl */ `
uniform sampler2D uTexture;
varying vec2 vUv;
varying vec4 vColor;

void main() {
    vec4 tex = texture2D(uTexture, vUv);
    vec4 c = vec4(vColor.rgb * tex.rgb, vColor.a * tex.a);
    if (c.a < 0.005) discard;
    gl_FragColor = c;
}
`;

function blendingFor(mode: BlendMode): Blending {
    return mode === 'additive' ? AdditiveBlending : NormalBlending;
}

export class ParticleSystem {
    private readonly poolSize: number;
    private readonly geometry: InstancedBufferGeometry;
    private readonly material: ShaderMaterial;
    public readonly mesh: Mesh;
    private readonly scene: Scene;

    private readonly aOrigin: InstancedBufferAttribute;
    private readonly aVelocity: InstancedBufferAttribute;
    private readonly aColor: InstancedBufferAttribute;
    private readonly aSpawnTime: InstancedBufferAttribute;
    private readonly aLifetime: InstancedBufferAttribute;
    private readonly aSize: InstancedBufferAttribute;
    private readonly aSeed: InstancedBufferAttribute;
    private readonly aOpacity: InstancedBufferAttribute;

    private readonly colorStart = new Color();
    private readonly colorEnd = new Color();

    constructor(cfg: ParticleEmitterConfig, scene: Scene) {
        this.poolSize = Math.max(1, cfg.poolSize);
        this.scene = scene;

        this.geometry = new InstancedBufferGeometry();
        const quad = new Float32Array([
            -0.5, -0.5, 0,
             0.5, -0.5, 0,
             0.5,  0.5, 0,
            -0.5,  0.5, 0,
        ]);
        const uvs = new Float32Array([0, 0, 1, 0, 1, 1, 0, 1]);
        const indices = new Uint16Array([0, 1, 2, 0, 2, 3]);
        this.geometry.setAttribute('position', new BufferAttribute(quad, 3));
        this.geometry.setAttribute('uv', new BufferAttribute(uvs, 2));
        this.geometry.setIndex(new BufferAttribute(indices, 1));

        const n = this.poolSize;
        const origins = new Float32Array(n * 3);
        const velocities = new Float32Array(n * 3);
        const colors = new Float32Array(n * 3);
        const spawnTimes = new Float32Array(n);
        const lifetimes = new Float32Array(n).fill(-1);
        const sizes = new Float32Array(n);
        const seeds = new Float32Array(n);
        const opacities = new Float32Array(n);

        this.aOrigin = new InstancedBufferAttribute(origins, 3);
        this.aVelocity = new InstancedBufferAttribute(velocities, 3);
        this.aColor = new InstancedBufferAttribute(colors, 3);
        this.aSpawnTime = new InstancedBufferAttribute(spawnTimes, 1);
        this.aLifetime = new InstancedBufferAttribute(lifetimes, 1);
        this.aSize = new InstancedBufferAttribute(sizes, 1);
        this.aSeed = new InstancedBufferAttribute(seeds, 1);
        this.aOpacity = new InstancedBufferAttribute(opacities, 1);

        this.aOrigin.setUsage(DynamicDrawUsage);
        this.aVelocity.setUsage(DynamicDrawUsage);
        this.aColor.setUsage(DynamicDrawUsage);
        this.aSpawnTime.setUsage(DynamicDrawUsage);
        this.aLifetime.setUsage(DynamicDrawUsage);
        this.aSize.setUsage(DynamicDrawUsage);
        this.aSeed.setUsage(DynamicDrawUsage);
        this.aOpacity.setUsage(DynamicDrawUsage);

        this.geometry.setAttribute('aOrigin', this.aOrigin);
        this.geometry.setAttribute('aVelocity', this.aVelocity);
        this.geometry.setAttribute('aColor', this.aColor);
        this.geometry.setAttribute('aSpawnTime', this.aSpawnTime);
        this.geometry.setAttribute('aLifetime', this.aLifetime);
        this.geometry.setAttribute('aSize', this.aSize);
        this.geometry.setAttribute('aSeed', this.aSeed);
        this.geometry.setAttribute('aOpacity', this.aOpacity);
        this.geometry.instanceCount = n;

        this.colorStart.setHex(cfg.baseColor);
        this.colorEnd.setHex(cfg.baseColorEnd);

        this.material = new ShaderMaterial({
            uniforms: {
                uTime: { value: 0 },
                uAccel: { value: new Vector3(cfg.acceleration.x, cfg.acceleration.y, cfg.acceleration.z) },
                uDrag: { value: cfg.drag },
                uSizeOverLife: { value: new Float32Array([cfg.sizeOverLife.start, cfg.sizeOverLife.end]) },
                uOpacityOverLife: { value: new Float32Array([cfg.opacityOverLife.start, cfg.opacityOverLife.end]) },
                uColorStart: { value: this.colorStart },
                uColorEnd: { value: this.colorEnd },
                uTexture: { value: loadTexture(cfg.texturePath) },
            },
            vertexShader,
            fragmentShader,
            transparent: true,
            depthWrite: false,
            blending: blendingFor(cfg.blendMode),
        });

        this.mesh = new Mesh(this.geometry, this.material);
        this.mesh.frustumCulled = false;
        this.mesh.renderOrder = 1;
        this.scene.add(this.mesh);
    }

    public setTime(time: number): void {
        this.material.uniforms.uTime.value = time;
    }

    public applyConfig(cfg: ParticleEmitterConfig): void {
        (this.material.uniforms.uAccel.value as Vector3).set(cfg.acceleration.x, cfg.acceleration.y, cfg.acceleration.z);
        this.material.uniforms.uDrag.value = cfg.drag;
        (this.material.uniforms.uSizeOverLife.value as Float32Array).set([cfg.sizeOverLife.start, cfg.sizeOverLife.end]);
        (this.material.uniforms.uOpacityOverLife.value as Float32Array).set([cfg.opacityOverLife.start, cfg.opacityOverLife.end]);
        this.colorStart.setHex(cfg.baseColor);
        this.colorEnd.setHex(cfg.baseColorEnd);
        this.material.uniforms.uTexture.value = loadTexture(cfg.texturePath);
        this.material.blending = blendingFor(cfg.blendMode);
        this.material.needsUpdate = true;
    }

    public spawn(
        slot: number,
        originWorld: Vector3,
        velocityWorld: Vector3,
        spawnTime: number,
        lifetime: number,
        size: number,
        color: Color,
        opacity: number,
        seed: number,
    ): void {
        const s = slot % this.poolSize;
        const i3 = s * 3;
        const arr3 = (a: InstancedBufferAttribute) => a.array as Float32Array;
        const arr1 = (a: InstancedBufferAttribute) => a.array as Float32Array;

        const o = arr3(this.aOrigin);
        o[i3] = originWorld.x; o[i3 + 1] = originWorld.y; o[i3 + 2] = originWorld.z;
        const v = arr3(this.aVelocity);
        v[i3] = velocityWorld.x; v[i3 + 1] = velocityWorld.y; v[i3 + 2] = velocityWorld.z;
        const c = arr3(this.aColor);
        c[i3] = color.r; c[i3 + 1] = color.g; c[i3 + 2] = color.b;

        arr1(this.aSpawnTime)[s] = spawnTime;
        arr1(this.aLifetime)[s] = lifetime;
        arr1(this.aSize)[s] = size;
        arr1(this.aSeed)[s] = seed;
        arr1(this.aOpacity)[s] = opacity;

        const upd3 = (a: InstancedBufferAttribute) => {
            a.addUpdateRange(i3, 3);
            a.needsUpdate = true;
        };
        const upd1 = (a: InstancedBufferAttribute) => {
            a.addUpdateRange(s, 1);
            a.needsUpdate = true;
        };
        upd3(this.aOrigin);
        upd3(this.aVelocity);
        upd3(this.aColor);
        upd1(this.aSpawnTime);
        upd1(this.aLifetime);
        upd1(this.aSize);
        upd1(this.aSeed);
        upd1(this.aOpacity);
    }

    public getActiveCount(time: number): number {
        const spawn = this.aSpawnTime.array as Float32Array;
        const life = this.aLifetime.array as Float32Array;
        let count = 0;
        for (let i = 0; i < this.poolSize; i++) {
            if (life[i] > 0 && time < spawn[i] + life[i]) count++;
        }
        return count;
    }

    public dispose(): void {
        this.scene.remove(this.mesh);
        this.geometry.dispose();
        this.material.dispose();
    }
}
