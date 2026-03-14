import {
    Scene,
    Vector3,
    Color,
    ShaderMaterial,
    InstancedBufferGeometry,
    InstancedBufferAttribute,
    BufferAttribute,
    LineSegments,
    AdditiveBlending,
    Object3D
} from 'three';

const RAIN_DROP_COUNT = 50000;

const rainVertexShader = `
    attribute vec3 aOffset;
    attribute float aSpeed;

    uniform float uTime;
    uniform vec3 uCameraPos;
    uniform float uRainHeight;
    uniform float uRainRadius;
    uniform float uDropLength;
    uniform float uIntensity;

    varying float vDepth;
    varying float vSpeed;

    void main() {
        // Scale fall speed with intensity: light rain is slower, heavy rain is faster
        float speedMult = 0.5 + uIntensity;
        float fallSpeed = 40.0 * aSpeed * speedMult;

        vec3 worldPos = aOffset;

        // Wrap Y (falling) - anchor above camera
        worldPos.y = mod(aOffset.y - uTime * fallSpeed - uCameraPos.y, uRainHeight)
                     - (uRainHeight * 0.5) + uCameraPos.y + (uRainHeight * 0.3);

        // Wrap X and Z (infinite treadmill around camera)
        worldPos.x = mod(worldPos.x - uCameraPos.x + uRainRadius, uRainRadius * 2.0)
                     - uRainRadius + uCameraPos.x;
        worldPos.z = mod(worldPos.z - uCameraPos.z + uRainRadius, uRainRadius * 2.0)
                     - uRainRadius + uCameraPos.z;

        // Stretch geometry based on speed — longer drops at higher intensity
        float dropScale = uDropLength * (0.5 + aSpeed * 0.5) * (0.7 + uIntensity * 0.6);
        vec3 finalPos = worldPos + position * vec3(1.0, dropScale, 1.0);

        vSpeed = aSpeed;

        // Positions are already in world space, bypass modelMatrix
        vec4 viewPos = viewMatrix * vec4(finalPos, 1.0);
        gl_Position = projectionMatrix * viewPos;
        vDepth = -viewPos.z;
    }
`;

const rainFragmentShader = `
    uniform vec3 uColor;
    uniform float uIntensity;
    uniform float uFogDensity;

    varying float vDepth;
    varying float vSpeed;

    void main() {
        // Cull drops based on intensity — fewer visible drops at low intensity
        float dropRandom = (vSpeed - 0.5) / 1.5; // normalize aSpeed (0.5-2.0) to 0-1
        if (dropRandom > uIntensity * 1.3) discard;

        float fog = exp(-vDepth * uFogDensity);
        float alpha = 0.5 * vSpeed * fog * uIntensity;
        gl_FragColor = vec4(uColor, alpha);
    }
`;

export class Rain {
    private scene: Scene;
    private mesh: LineSegments | null = null;
    private material: ShaderMaterial | null = null;
    private elapsedTime: number = 0;
    private _rainTint = new Color(0.6, 0.7, 0.85);

    public intensity: number = 0.0;
    public dropLength: number = 1.0;
    public fogDensity: number = 0.012;
    public radius: number = 100;
    public height: number = 120;

    constructor(scene: Scene) {
        this.scene = scene;
    }

    private create(): void {
        if (this.mesh) return;

        const geometry = new InstancedBufferGeometry();
        const positions = new Float32Array([0, 0, 0, 0, 1, 0]);
        geometry.setAttribute('position', new BufferAttribute(positions, 3));

        const offsets = new Float32Array(RAIN_DROP_COUNT * 3);
        const speeds = new Float32Array(RAIN_DROP_COUNT);

        for (let i = 0; i < RAIN_DROP_COUNT; i++) {
            offsets[i * 3 + 0] = (Math.random() - 0.5) * (this.radius * 2);
            offsets[i * 3 + 1] = (Math.random() - 0.5) * this.height;
            offsets[i * 3 + 2] = (Math.random() - 0.5) * (this.radius * 2);
            speeds[i] = 0.5 + Math.random() * 1.5;
        }

        geometry.setAttribute('aOffset', new InstancedBufferAttribute(offsets, 3));
        geometry.setAttribute('aSpeed', new InstancedBufferAttribute(speeds, 1));

        this.material = new ShaderMaterial({
            uniforms: {
                uTime: { value: 0.0 },
                uCameraPos: { value: new Vector3() },
                uRainHeight: { value: this.height },
                uRainRadius: { value: this.radius },
                uDropLength: { value: this.dropLength },
                uColor: { value: new Color() },
                uIntensity: { value: this.intensity },
                uFogDensity: { value: this.fogDensity },
            },
            vertexShader: rainVertexShader,
            fragmentShader: rainFragmentShader,
            transparent: true,
            blending: AdditiveBlending,
            depthWrite: false
        });

        this.mesh = new LineSegments(geometry, this.material);
        this.mesh.frustumCulled = false;
        this.scene.add(this.mesh);
    }

    /**
     * @param skyFogColor The current horizon fog color from the sky, used to tint rain
     */
    public update(deltaTime: number, camera: Object3D, skyFogColor: Color): void {
        if (this.intensity > 0) {
            if (!this.mesh) this.create();

            this.elapsedTime += deltaTime;

            const uniforms = this.material!.uniforms;
            uniforms.uTime.value = this.elapsedTime;
            uniforms.uCameraPos.value.copy(camera.position);
            uniforms.uIntensity.value = this.intensity;
            uniforms.uDropLength.value = this.dropLength;
            uniforms.uFogDensity.value = this.fogDensity;

            // Blend sky fog color with a neutral rain-blue tint
            uniforms.uColor.value.copy(skyFogColor).lerp(this._rainTint, 0.3);

            this.mesh!.visible = true;
        } else if (this.mesh) {
            this.mesh.visible = false;
        }
    }

    public cleanup(): void {
        if (this.mesh) {
            this.scene.remove(this.mesh);
            this.material!.dispose();
            this.mesh.geometry.dispose();
            this.mesh = null;
            this.material = null;
        }
    }
}
