import {
    Scene,
    Vector3,
    Vector2,
    Color,
    Mesh,
    SphereGeometry,
    ShaderMaterial,
    DirectionalLight,
    AmbientLight,
    DataTexture,
    RGBAFormat,
    RepeatWrapping,
    LinearMipMapLinearFilter,
    LinearFilter,
    BackSide,
    MathUtils,
    Camera
} from 'three';

// --- UTILITY CLASSES ---
class Gradient {
    private stops: Array<{ t: number; hex: string }>;

    constructor(stops: Array<{ t: number; hex: string }>) {
        this.stops = stops.sort((a, b) => a.t - b.t);
    }

    sample(t: number): Color {
        t = MathUtils.clamp(t, 0, 1);
        let lower = this.stops[0];
        let upper = this.stops[this.stops.length - 1];

        for (let i = 0; i < this.stops.length - 1; i++) {
            if (t >= this.stops[i].t && t <= this.stops[i + 1].t) {
                lower = this.stops[i];
                upper = this.stops[i + 1];
                break;
            }
        }

        if (lower === upper) return new Color(lower.hex);
        const localT = (t - lower.t) / (upper.t - lower.t);
        return new Color(lower.hex).lerp(new Color(upper.hex), localT);
    }
}

class Curve {
    private points: Array<{ t: number; v: number }>;

    constructor(points: Array<{ t: number; v: number }>) {
        this.points = points.sort((a, b) => a.t - b.t);
    }

    sample(t: number): number {
        t = MathUtils.clamp(t, 0, 1);
        let lower = this.points[0];
        let upper = this.points[this.points.length - 1];

        for (let i = 0; i < this.points.length - 1; i++) {
            if (t >= this.points[i].t && t <= this.points[i + 1].t) {
                lower = this.points[i];
                upper = this.points[i + 1];
                break;
            }
        }

        if (lower === upper) return lower.v;
        return MathUtils.lerp(lower.v, upper.v, (t - lower.t) / (upper.t - lower.t));
    }
}

// --- GODOT PRESET ---
const godotPreset = {
    baseSkyColor: new Gradient([
        { t: 0.3125, hex: '#040616' },
        { t: 0.4142, hex: '#180b47' },
        { t: 0.4692, hex: '#554d73' },
        { t: 0.5744, hex: '#cac2ee' },
        { t: 0.8031, hex: '#345790' }
    ]),
    baseCloudColor: new Gradient([
        { t: 0.4191, hex: '#0f1533' },
        { t: 0.5531, hex: '#61201a' },
        { t: 0.6010, hex: '#a35519' },
        { t: 0.6914, hex: '#ffffff' }
    ]),
    horizonFogColor: new Gradient([
        { t: 0.1747, hex: '#04061a' },
        { t: 0.4757, hex: '#2b376f' },
        { t: 0.6601, hex: '#eab37a' },
        { t: 0.8244, hex: '#aec2cb' },
        { t: 1.0, hex: '#d3eafe' }
    ]),
    sunDiscColor: new Gradient([
        { t: 0.3663, hex: '#000000' },
        { t: 0.4956, hex: '#c6804f' },
        { t: 0.9016, hex: '#bcB19a' }
    ]),
    sunGlowColor: new Gradient([
        { t: 0.4431, hex: '#000000' },
        { t: 0.5663, hex: '#f2e100' },
        { t: 0.6601, hex: '#fff3d3' }
    ]),
    sunLightColor: new Gradient([
        { t: 0.0258, hex: '#000000' },
        { t: 0.3656, hex: '#000000' },
        { t: 0.4627, hex: '#b63400' },
        { t: 0.5436, hex: '#fabb63' },
        { t: 0.9935, hex: '#fefeff' }
    ]),
    sunLightIntensity: new Curve([
        { t: 0, v: 0 },
        { t: 0.477, v: 0 },
        { t: 0.589, v: 1 },
        { t: 1, v: 1 }
    ]),
    moonLightColor: new Gradient([
        { t: 0.1618, hex: '#323857' },
        { t: 0.521, hex: '#7883b2' },
        { t: 0.612, hex: '#000000' }
    ]),
    moonGlowColor: new Gradient([
        { t: 0.4827, hex: '#8aa6ff' },
        { t: 0.612, hex: '#ffffff' }
    ]),
    moonLightIntensity: new Curve([
        { t: 0, v: 0.04 },
        { t: 0.4775, v: 0.06 },
        { t: 0.5608, v: 0 },
        { t: 1, v: 0 }
    ]),

    // Fixed Scalar Values
    horizonSize: 3.0,
    horizonAlpha: 1.0,
    cloudDensity: 4.25,
    cloudGlow: 0.92,
    cloudSpeed: 0.0003,
    cloudDirection: new Vector2(1.0, 1.0),
    cloudLightAbsorption: 5.0,
    cloudBrightness: 0.9,
    cloudUvCurvature: 0.5,
    cloudEdge: 0.0,
    anisotropy: 0.69,
    sunRadius: 0.0002,
    sunEdgeBlur: 3600.0,
    sunGlowIntensity: 0.45,
    moonRadius: 0.0003,
    moonEdgeBlur: 10000.0,
    moonGlowIntensity: 0.8
};

// --- NOISE TEXTURE GENERATOR ---
function createNoiseTexture(): DataTexture {
    const size = 512;
    const data = new Uint8Array(size * size * 4);

    // Permutation Table
    const p = new Uint8Array(256);
    for (let i = 0; i < 256; i++) p[i] = i;
    for (let i = 255; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [p[i], p[j]] = [p[j], p[i]];
    }
    const perm = new Uint8Array(512);
    for (let i = 0; i < 512; i++) perm[i] = p[i & 255];

    function grad(hash: number, x: number, y: number, z: number): number {
        const h = hash & 15;
        const u = h < 8 ? x : y;
        const v = h < 4 ? y : h === 12 || h === 14 ? x : z;
        return ((h & 1) === 0 ? u : -u) + ((h & 2) === 0 ? v : -v);
    }

    function fade(t: number): number {
        return t * t * t * (t * (t * 6 - 15) + 10);
    }

    function lerp(t: number, a: number, b: number): number {
        return a + t * (b - a);
    }

    function noise(x: number, y: number, z: number): number {
        const X = Math.floor(x) & 255;
        const Y = Math.floor(y) & 255;
        const Z = Math.floor(z) & 255;
        x -= Math.floor(x);
        y -= Math.floor(y);
        z -= Math.floor(z);
        const u = fade(x), v = fade(y), w = fade(z);
        const A = perm[X] + Y, AA = perm[A] + Z, AB = perm[A + 1] + Z;
        const B = perm[X + 1] + Y, BA = perm[B] + Z, BB = perm[B + 1] + Z;
        return lerp(w,
            lerp(v,
                lerp(u, grad(perm[AA], x, y, z), grad(perm[BA], x - 1, y, z)),
                lerp(u, grad(perm[AB], x, y - 1, z), grad(perm[BB], x - 1, y - 1, z))
            ),
            lerp(v,
                lerp(u, grad(perm[AA + 1], x, y, z - 1), grad(perm[BA + 1], x - 1, y, z - 1)),
                lerp(u, grad(perm[AB + 1], x, y - 1, z - 1), grad(perm[BB + 1], x - 1, y - 1, z - 1))
            )
        );
    }

    function fbmTileable(u: number, v: number, scale: number): number {
        let total = 0;
        let amplitude = 0.5;
        let freq = 1.0;
        let maxVal = 0;

        for (let i = 0; i < 6; i++) {
            const s = scale * freq;
            const nx = Math.cos(u * Math.PI * 2) * s / (Math.PI * 2);
            const ny = Math.sin(u * Math.PI * 2) * s / (Math.PI * 2);
            const nz = Math.cos(v * Math.PI * 2) * s / (Math.PI * 2);
            const nw = Math.sin(v * Math.PI * 2) * s / (Math.PI * 2);

            total += noise(nx + nz, ny + nw, nx - nz) * amplitude;

            maxVal += amplitude;
            amplitude *= 0.5;
            freq *= 2.0;
        }
        return (total / maxVal) * 0.5 + 0.5;
    }

    for (let y = 0; y < size; y++) {
        for (let x = 0; x < size; x++) {
            const u = x / size;
            const v = y / size;
            let n = fbmTileable(u, v, 4.0);
            const val = Math.floor(MathUtils.clamp(n, 0, 1) * 255);
            const idx = (y * size + x) * 4;
            data[idx] = val;
            data[idx + 1] = val;
            data[idx + 2] = val;
            data[idx + 3] = 255;
        }
    }

    const tex = new DataTexture(data, size, size, RGBAFormat);
    tex.wrapS = RepeatWrapping;
    tex.wrapT = RepeatWrapping;
    tex.minFilter = LinearMipMapLinearFilter;
    tex.magFilter = LinearFilter;
    tex.generateMipmaps = true;
    tex.needsUpdate = true;
    return tex;
}

// --- SHADERS ---
const vertexShader = `
    varying vec3 vWorldPosition;
    void main() {
        vec4 worldPosition = modelMatrix * vec4(position, 1.0);
        vWorldPosition = worldPosition.xyz;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    }
`;

const fragmentShader = `
    uniform float time;
    uniform vec3 sunPosition;
    uniform vec3 moonPosition;

    // Colors
    uniform vec3 baseColor;
    uniform vec3 baseCloudColor;
    uniform vec3 horizonFogColor;
    uniform vec3 sunDiscColor;
    uniform vec3 sunGlowColor;
    uniform vec3 moonGlowColor;

    // Params
    uniform float horizonSize;
    uniform float horizonAlpha;
    uniform float cloudDensity;
    uniform float mgSize;
    uniform float cloudCoverage;
    uniform float absorption;
    uniform float henyeyGreensteinLevel;
    uniform float cloudBrightness;
    uniform float horizonUVCurve;
    uniform float cloudEdge;

    uniform float sunRadius;
    uniform float sunEdgeBlur;
    uniform float sunGlowIntensity;

    uniform float moonRadius;
    uniform float moonEdgeBlur;
    uniform float moonGlowIntensity;

    uniform sampler2D cloudTexture;
    uniform vec2 cloudDirection;
    uniform float cloudSpeed;

    varying vec3 vWorldPosition;

    const float PI = 3.14159265359;

    float henyey_greenstein(float cos_theta, float g) {
        const float k = 0.0795774715459;
        return k * (1.0 - g * g) / (pow(1.0 + g * g - 2.0 * g * cos_theta, 1.5));
    }

    vec3 createSunMoonDisc(vec3 dir, vec3 sunDir, vec3 color, float r, float edgeBlur) {
        float disc = 0.0;
        float discSizeCheck = (1.0 - (r * 2.0));
        if (dot(dir,sunDir) > discSizeCheck) {
            disc = pow((dot(dir,sunDir) - discSizeCheck) * edgeBlur, 5.0);
        }
        return clamp(vec3(disc) * color, 0.0, 1.0);
    }

    vec3 createSunGlow(vec3 dir, vec3 sunDir, float r) {
        float sunGlow = 0.0;
        float glowSize = (1.0 - ((0.0003 * 800.0) * 2.0));
        if (dot(dir,sunDir) > glowSize) {
            sunGlow = mix(0.0,(dot(dir,sunDir) - glowSize * 1.05) * (1.0 - dir.y), sunGlowIntensity);
        }
        return clamp((pow(sunGlow - 0.1, 1.0) * sunGlowColor), 0.0, 1.0);
    }

    vec3 createMoonGlow(vec3 dir, vec3 moonDir, float r) {
        float moonGlow = 0.0;
        float glowSize = (1.0 - ((0.0003 * 400.0) * 2.0));
        if (dot(dir,moonDir) > glowSize) {
            moonGlow = mix(0.0,(dot(dir,moonDir) - glowSize), moonGlowIntensity);
        }
        return pow(vec3(moonGlow),vec3(3.0)) * moonGlowColor;
    }

    float createHorizonFog(vec3 vertexColor) {
        float clampedVertexColor = 0.0;
        if (vertexColor.y < 0.0) {
            clampedVertexColor = 1.0;
        } else {
            clampedVertexColor = vertexColor.y;
        }
        return clamp(pow((1.0 - clampedVertexColor), horizonSize) - (1.0 - horizonAlpha), 0.0, 1.0);
    }

    vec2 generate2DClouds(vec3 dir, vec3 sunDir, vec3 moonDir) {
        float horizonCurve = dir.y / horizonUVCurve;
        vec2 uvBase = vec2(dir.x / horizonCurve, dir.z / horizonCurve);

        vec2 uv1 = uvBase / 5.0 + (time * 4.0 * cloudSpeed * cloudDirection);
        float clouds = texture2D(cloudTexture, uv1).r;

        vec2 uv2 = uvBase / 10.0 + (time * 4.0 * cloudSpeed * cloudDirection);
        float cloudDetail = texture2D(cloudTexture, uv2).r;

        clouds *= cloudDetail;

        clouds = clamp(mix(cloudCoverage, cloudCoverage + 1.0, clouds), cloudCoverage, 1.0);
        clouds = clamp(pow(clouds, 1.0 + cloudEdge), 0.0, 1.0);

        float weather = 0.5 + 0.5;

        float cloudFade = clamp(dir.y, 0.0, 1.0);
        float cloudsFinal = clamp(clouds - (clamp(weather + 0.5,0.0,1.0) * (1.0 - cloudCoverage / 2.0)),0.0,1.0);
        float cloudsFinal2 = cloudsFinal * mix(5.0, cloudDensity, dir.y) * (cloudFade * 2.0);
        float transmittance = exp(-cloudsFinal2);

        return vec2(transmittance, weather);
    }

    void main() {
        vec3 dir = normalize(vWorldPosition);
        vec3 sunDir = normalize(sunPosition);
        vec3 moonDir = normalize(moonPosition);

        vec3 skyColor = baseColor;

        float fogA = createHorizonFog(dir);

        vec2 dynClouds = generate2DClouds(dir, sunDir, moonDir);
        float dynCloudAlpha = 1.0 - dynClouds.x;

        float sun = dot(sunDir, dir);
        float moon = dot(moonDir, dir);
        float hg = max(henyey_greenstein(sun, henyeyGreensteinLevel - 0.15), henyey_greenstein(moon, henyeyGreensteinLevel + 0.05));

        skyColor = skyColor * dynClouds.x + (baseCloudColor * cloudBrightness * dynCloudAlpha);
        skyColor = skyColor + ((baseCloudColor * ((dynClouds.x) * hg * absorption)) * dynCloudAlpha);

        float horizonCurve = dir.y / horizonUVCurve;
        float noiseVal = texture2D(cloudTexture, vec2(dir.x / horizonCurve, dir.z / horizonCurve) / 5.0).r - 0.5;
        skyColor -= (clamp(noiseVal, 0.0, 1.0) * baseCloudColor) * dynCloudAlpha;

        skyColor = mix(skyColor, horizonFogColor, fogA);

        float cloudMask = 1.0 - dynCloudAlpha;

        skyColor += createSunMoonDisc(dir, sunDir, sunDiscColor, sunRadius, sunEdgeBlur) * cloudMask;
        skyColor += createSunMoonDisc(dir, moonDir, vec3(1.0), moonRadius, moonEdgeBlur) * cloudMask;

        skyColor += createSunGlow(dir, sunDir, sunRadius);
        skyColor += createMoonGlow(dir, moonDir, moonRadius);

        if (dir.y < 0.0) {
            skyColor = horizonFogColor;
        }

        gl_FragColor = vec4(skyColor, 1.0);
    }
`;

// --- SKY CLASS ---
export class Sky {
    private scene: Scene;
    private skyMesh: Mesh;
    private skyMaterial: ShaderMaterial;
    private sunLight: DirectionalLight;
    private moonLight: DirectionalLight;
    private ambientLight: AmbientLight;

    public timeOfDay: number = 1200.0;
    public rateOfTime: number = 1.0;
    public simulateTime: boolean = true;
    public cloudCoverage: number = 0.5;
    private sunPosAlpha: number = 0.0;

    constructor(scene: Scene) {
        this.scene = scene;

        // Generate cloud noise texture
        const cloudTex = createNoiseTexture();

        // Create sky material
        this.skyMaterial = new ShaderMaterial({
            vertexShader,
            fragmentShader,
            uniforms: {
                time: { value: 0 },
                sunPosition: { value: new Vector3() },
                moonPosition: { value: new Vector3() },
                baseColor: { value: new Color() },
                baseCloudColor: { value: new Color() },
                horizonFogColor: { value: new Color() },
                sunDiscColor: { value: new Color() },
                sunGlowColor: { value: new Color() },
                moonGlowColor: { value: new Color() },
                horizonSize: { value: godotPreset.horizonSize },
                horizonAlpha: { value: godotPreset.horizonAlpha },
                cloudDensity: { value: godotPreset.cloudDensity },
                mgSize: { value: godotPreset.cloudGlow },
                cloudCoverage: { value: 0.5 },
                absorption: { value: godotPreset.cloudLightAbsorption },
                henyeyGreensteinLevel: { value: godotPreset.anisotropy },
                cloudBrightness: { value: godotPreset.cloudBrightness },
                horizonUVCurve: { value: godotPreset.cloudUvCurvature },
                cloudEdge: { value: godotPreset.cloudEdge },
                sunRadius: { value: godotPreset.sunRadius },
                sunEdgeBlur: { value: godotPreset.sunEdgeBlur },
                sunGlowIntensity: { value: godotPreset.sunGlowIntensity },
                moonRadius: { value: godotPreset.moonRadius },
                moonEdgeBlur: { value: godotPreset.moonEdgeBlur },
                moonGlowIntensity: { value: godotPreset.moonGlowIntensity },
                cloudTexture: { value: cloudTex },
                cloudDirection: { value: godotPreset.cloudDirection },
                cloudSpeed: { value: godotPreset.cloudSpeed }
            },
            side: BackSide,
            depthWrite: false // Don't write to depth buffer so tiles render on top
        });

        // Create sky dome mesh with large radius
        this.skyMesh = new Mesh(new SphereGeometry(1e5, 64, 64), this.skyMaterial);
        this.skyMesh.renderOrder = -1; // Render before other objects
        this.scene.add(this.skyMesh);

        // Create lights
        this.sunLight = new DirectionalLight(0xffffff, 1.0);
        this.scene.add(this.sunLight);

        this.moonLight = new DirectionalLight(0x445566, 0.2);
        this.scene.add(this.moonLight);

        this.ambientLight = new AmbientLight(0x404040);
        this.scene.add(this.ambientLight);
    }

    public update(deltaTime: number, camera: Camera): void {
        // Make sky follow camera position
        this.skyMesh.position.copy(camera.position);

        // Simulate day progression
        if (this.simulateTime) {
            this.timeOfDay += this.rateOfTime;
            if (this.timeOfDay >= 2400.0) this.timeOfDay = 0.0;
        }

        // Update sun/moon positions
        this.updateRotation();

        // Update sky colors and lighting
        this.updateSkyColors();

        // Update shader time
        this.skyMaterial.uniforms.time.value += deltaTime * 0.001;
    }

    private updateRotation(): void {
        const hourMapped = this.timeOfDay / 2400.0;
        const angle = (hourMapped * Math.PI * 2) - (Math.PI / 2);
        const sunY = Math.sin(angle);
        const sunZ = Math.cos(angle);
        const sunVec = new Vector3(0, sunY, sunZ).normalize();

        this.skyMaterial.uniforms.sunPosition.value.copy(sunVec);
        this.skyMaterial.uniforms.moonPosition.value.copy(sunVec.clone().negate());
        this.sunLight.position.copy(sunVec).multiplyScalar(100);
        this.moonLight.position.copy(sunVec).negate().multiplyScalar(100);
        this.sunPosAlpha = sunVec.y * 0.5 + 0.5;
    }

    private updateSkyColors(): void {
        const pos = this.sunPosAlpha;
        const preset = godotPreset;

        this.skyMaterial.uniforms.baseColor.value.copy(preset.baseSkyColor.sample(pos));
        this.skyMaterial.uniforms.horizonFogColor.value.copy(preset.horizonFogColor.sample(pos));
        this.skyMaterial.uniforms.baseCloudColor.value.copy(preset.baseCloudColor.sample(pos));
        this.skyMaterial.uniforms.sunDiscColor.value.copy(preset.sunDiscColor.sample(pos));
        this.skyMaterial.uniforms.sunGlowColor.value.copy(preset.sunGlowColor.sample(pos));
        this.skyMaterial.uniforms.moonGlowColor.value.copy(preset.moonGlowColor.sample(pos));
        this.skyMaterial.uniforms.cloudCoverage.value = this.cloudCoverage;

        const sunInt = preset.sunLightIntensity.sample(pos);
        const moonInt = preset.moonLightIntensity.sample(pos);

        this.sunLight.color.copy(preset.sunLightColor.sample(pos));
        this.sunLight.intensity = sunInt * 1.5;
        this.moonLight.color.copy(preset.moonLightColor.sample(pos));
        this.moonLight.intensity = moonInt * 0.5;
    }

    public cleanup(): void {
        this.scene.remove(this.skyMesh);
        this.scene.remove(this.sunLight);
        this.scene.remove(this.moonLight);
        this.scene.remove(this.ambientLight);
        this.skyMaterial.dispose();
        this.skyMesh.geometry.dispose();
    }
}
