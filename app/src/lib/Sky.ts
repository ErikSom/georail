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
    Camera,
    Object3D
} from 'three';
import { RGBELoader } from 'three/addons/loaders/RGBELoader.js';

// --- 1. UTILITY CLASSES ---

// Optimized: Stores Color objects directly to prevent GC thrashing during render loop
class Gradient {
    private stops: Array<{ t: number; color: Color }>;

    constructor(stops: Array<{ t: number; color: Color }>) {
        this.stops = stops.sort((a, b) => a.t - b.t);
    }

    sample(t: number): Color {
        if (t <= this.stops[0].t) return this.stops[0].color.clone();
        if (t >= this.stops[this.stops.length - 1].t) return this.stops[this.stops.length - 1].color.clone();

        for (let i = 0; i < this.stops.length - 1; i++) {
            if (t >= this.stops[i].t && t < this.stops[i + 1].t) {
                const stop1 = this.stops[i];
                const stop2 = this.stops[i + 1];
                // Linear interpolation on existing Color objects
                return stop1.color.clone().lerp(stop2.color, (t - stop1.t) / (stop2.t - stop1.t));
            }
        }
        return this.stops[this.stops.length - 1].color.clone();
    }
}

class Curve {
    private points: Array<{ t: number; v: number }>;

    constructor(points: Array<{ t: number; v: number }>) {
        this.points = points.sort((a, b) => a.t - b.t);
    }

    sample(t: number): number {
        if (t <= this.points[0].t) return this.points[0].v;
        if (t >= this.points[this.points.length - 1].t) return this.points[this.points.length - 1].v;

        for (let i = 0; i < this.points.length - 1; i++) {
            if (t >= this.points[i].t && t < this.points[i + 1].t) {
                const p1 = this.points[i];
                const p2 = this.points[i + 1];
                return MathUtils.lerp(p1.v, p2.v, (t - p1.t) / (p2.t - p1.t));
            }
        }
        return this.points[this.points.length - 1].v;
    }
}

// --- 2. PRESETS (Restored Float Precision) ---
// Using exact float RGB values maintains the correct Linear color space
const godotPreset = {
    baseCloudColor: new Gradient([
        { t: 0.419118, color: new Color(0.0601829, 0.0849014, 0.199897) },
        { t: 0.553191, color: new Color(0.381723, 0.127307, 0.10311) },
        { t: 0.601064, color: new Color(0.638549, 0.335553, 0.0995967) },
        { t: 0.691489, color: new Color(1, 1, 1) }
    ]),
    overcastCloudColor: new Gradient([
        { t: 0.345745, color: new Color(0, 0, 0.038) },
        { t: 0.62234, color: new Color(1, 1, 1) }
    ]),
    baseSkyColor: new Gradient([
        { t: 0.3125, color: new Color(0.0145395, 0.0244694, 0.0874464) },
        { t: 0.414239, color: new Color(0.0949225, 0.045259, 0.27951) },
        { t: 0.469256, color: new Color(0.334622, 0.303664, 0.453753) },
        { t: 0.574468, color: new Color(0.792964, 0.761777, 0.932676) },
        { t: 0.803191, color: new Color(0.204346, 0.344014, 0.5625) }
    ]),
    horizonFogColor: new Gradient([
        { t: 0.174757, color: new Color(0.0166131, 0.0263546, 0.101967) },
        { t: 0.475728, color: new Color(0.168694, 0.216311, 0.435438) },
        { t: 0.660194, color: new Color(0.916989, 0.704468, 0.478476) },
        { t: 0.824468, color: new Color(0.684128, 0.761883, 0.794691) },
        { t: 1.0, color: new Color(0.828826, 0.919115, 1) }
    ]),
    sunDiscColor: new Gradient([
        { t: 0.366379, color: new Color(0, 0, 0) },
        { t: 0.49569, color: new Color(0.776471, 0.501961, 0.309804) },
        { t: 0.901639, color: new Color(0.737255, 0.694118, 0.603922) }
    ]),
    sunGlowColor: new Gradient([
        { t: 0.443182, color: new Color(0, 0, 0) },
        { t: 0.566343, color: new Color(0.94902, 0.882353, 0) },
        { t: 0.660194, color: new Color(1, 0.955033, 0.827864) }
    ]),
    sunLightColor: new Gradient([
        { t: 0.02589, color: new Color(0, 0, 0) },
        { t: 0.365696, color: new Color(0, 0, 0) },
        { t: 0.462783, color: new Color(0.71298, 0.203695, 1.47464e-07) },
        { t: 0.543689, color: new Color(0.979906, 0.738618, 0.391285) },
        { t: 0.993528, color: new Color(0.996078, 0.996078, 1) }
    ]),
    sunLightIntensity: new Curve([
        { t: 0, v: 0 },
        { t: 0.477012, v: 0 },
        { t: 0.58908, v: 1 },
        { t: 1, v: 1 }
    ]),
    moonGlowColor: new Gradient([
        { t: 0.482759, color: new Color(0.544003, 0.651053, 1) },
        { t: 0.612069, color: new Color(1, 1, 1) }
    ]),
    moonLightColor: new Gradient([
        { t: 0.161812, color: new Color(0.195465, 0.222085, 0.341751) },
        { t: 0.521036, color: new Color(0.471032, 0.514768, 0.697211) },
        { t: 0.612069, color: new Color(0, 0, 0) }
    ]),
    moonLightIntensity: new Curve([
        { t: 0, v: 0.0423728 },
        { t: 0.477528, v: 0.0677966 },
        { t: 0.5608, v: 0 },
        { t: 1, v: 0 }
    ]),

    horizonSize: 3.0, horizonAlpha: 1.0,
    cloudDensity: 4.25, cloudGlow: 0.92, cloudSpeed: 0.0003,
    cloudDirection: new Vector2(1.0, 1.0),
    cloudLightAbsorption: 5.0, cloudBrightness: 0.9, cloudUvCurvature: 0.5,
    cloudEdge: 0.0, anisotropy: 0.69,
    sunRadius: 0.0002, sunEdgeBlur: 3600.0, sunGlowIntensity: 0.45,
    moonRadius: 0.0003, moonEdgeBlur: 10000.0, moonGlowIntensity: 0.8,
    starBrightness: 0.5, twinkleSpeed: 0.025
};

// --- 3. NOISE GENERATION ---

// Encapsulating Noise state to avoid global pollution
const Permutation = new Uint8Array(512);
(function initNoise() {
    const p = new Uint8Array(256);
    for (let i = 0; i < 256; i++) p[i] = i;
    let seed = 123;
    function random() { return (Math.sin(seed++) * 10000) % 1; }
    for (let i = 255; i > 0; i--) {
        const j = Math.floor((random() * 0.5 + 0.5) * (i + 1));
        [p[i], p[j]] = [p[j], p[i]];
    }
    for (let i = 0; i < 512; i++) Permutation[i] = p[i & 255];
})();

function periodicPerlin(x: number, y: number, period: number): number {
    let X = Math.floor(x); let Y = Math.floor(y);
    const xf = x - X; const yf = y - Y;
    X = (X % period + period) % period;
    Y = (Y % period + period) % period;
    const X1 = (X + 1) % period; const Y1 = (Y + 1) % period;

    const fade = (t: number) => t * t * t * (t * (t * 6 - 15) + 10);
    const u = fade(xf); const v = fade(yf);

    const aa = Permutation[Permutation[X] + Y];
    const ab = Permutation[Permutation[X] + Y1];
    const ba = Permutation[Permutation[X1] + Y];
    const bb = Permutation[Permutation[X1] + Y1];

    const g = (hash: number, x: number, y: number) => {
        const h = hash & 15;
        const u = h < 8 ? x : y;
        const v = h < 4 ? y : h === 12 || h === 14 ? x : 0;
        return ((h & 1) === 0 ? u : -u) + ((h & 2) === 0 ? v : -v);
    };

    const x1 = MathUtils.lerp(g(aa, xf, yf), g(ba, xf - 1, yf), u);
    const x2 = MathUtils.lerp(g(ab, xf, yf - 1), g(bb, xf - 1, yf - 1), u);
    return MathUtils.lerp(x1, x2, v);
}

function periodicCellularD2A(x: number, y: number, period: number): number {
    const xi = Math.floor(x); const yi = Math.floor(y);
    const xf = x - xi; const yf = y - yi;
    let f1 = 9999.0; let f2 = 9999.0;

    for (let j = -1; j <= 1; j++) {
        for (let i = -1; i <= 1; i++) {
            let ni = (xi + i) % period; if (ni < 0) ni += period;
            let nj = (yi + j) % period; if (nj < 0) nj += period;
            const h = Permutation[Permutation[ni] + nj];
            const jx = ((h & 15) / 15.0) * 0.7;
            const jy = (((h >> 4) & 15) / 15.0) * 0.7;
            const dx = i + jx - xf;
            const dy = j + jy - yf;
            const dist = Math.sqrt(dx * dx + dy * dy);
            if (dist < f1) { f2 = f1; f1 = dist; }
            else if (dist < f2) { f2 = dist; }
        }
    }
    return (f1 + f2) - 1.0;
}

function periodicValueNoise(x: number, y: number, period: number): number {
    let xi = Math.floor(x); let yi = Math.floor(y);
    const xf = x - xi; const yf = y - yi;
    xi = (xi % period + period) % period;
    yi = (yi % period + period) % period;
    const x1 = (xi + 1) % period; const y1 = (yi + 1) % period;

    const cubic = (t: number) => t * t * (3.0 - 2.0 * t);
    const u = cubic(xf); const v = cubic(yf);
    const val = (i: number, j: number) => (Permutation[Permutation[i] + j] % 256) / 255.0;

    const i1 = val(xi, yi); const i2 = val(x1, yi);
    const i3 = val(xi, y1); const i4 = val(x1, y1);

    const k1 = MathUtils.lerp(i1, i2, u);
    const k2 = MathUtils.lerp(i3, i4, u);
    return MathUtils.lerp(k1, k2, v) * 2.0 - 1.0;
}

function createNoiseTexture(): DataTexture {
    const size = 512;
    const data = new Uint8Array(size * size * 4);
    const periodBase = Math.round(size * 0.021);
    const periodWarp = 512;
    const warpAmp = 6.0;

    for (let y = 0; y < size; y++) {
        for (let x = 0; x < size; x++) {
            let nx = x; let ny = y;
            const wx = periodicPerlin(nx, ny, periodWarp) * warpAmp;
            const wy = periodicPerlin(nx + 50.0, ny + 50.0, periodWarp) * warpAmp;
            nx += wx; ny += wy;

            let total = 0; let amp = 1.0; let max = 0; let p = periodBase;
            for (let i = 0; i < 4; i++) {
                const scale = p / size;
                total += periodicCellularD2A(nx * scale, ny * scale, p) * amp;
                max += amp; amp *= 0.547; p *= 2.0;
            }
            let n = 1.0 - (total / max * 0.5 + 0.5);
            const val = Math.floor(MathUtils.clamp(n, 0, 1) * 255);
            const idx = (y * size + x) * 4;
            data[idx] = val; data[idx + 1] = val; data[idx + 2] = val; data[idx + 3] = 255;
        }
    }
    const tex = new DataTexture(data, size, size, RGBAFormat);
    tex.wrapS = tex.wrapT = RepeatWrapping;
    tex.minFilter = LinearMipMapLinearFilter;
    tex.magFilter = LinearFilter;
    tex.generateMipmaps = true;
    tex.needsUpdate = true;
    return tex;
}

function createWeatherMap(): DataTexture {
    const size = 512;
    const data = new Uint8Array(size * size * 4);
    const periodBase = Math.round(size * 0.042);

    for (let y = 0; y < size; y++) {
        for (let x = 0; x < size; x++) {
            let total = 0; let amp = 1.0; let max = 0; let p = periodBase;
            for (let i = 0; i < 3; i++) {
                const cycles = Math.round(p);
                const scale = cycles / size;
                total += periodicValueNoise(x * scale, y * scale, cycles) * amp;
                max += amp; amp *= 2.397; p *= 1.605;
            }
            let n = total / max * 0.5 + 0.5;
            const val = Math.floor(MathUtils.clamp(n, 0, 1) * 255);
            const idx = (y * size + x) * 4;
            data[idx] = val; data[idx + 1] = val; data[idx + 2] = val; data[idx + 3] = 255;
        }
    }
    const tex = new DataTexture(data, size, size, RGBAFormat);
    tex.wrapS = tex.wrapT = RepeatWrapping;
    tex.minFilter = LinearMipMapLinearFilter;
    tex.magFilter = LinearFilter;
    tex.generateMipmaps = true;
    tex.needsUpdate = true;
    return tex;
}

// --- 4. SHADERS (Identical to Source) ---
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
    
    uniform vec3 baseColor;
    uniform vec3 baseCloudColor;
    uniform vec3 horizonFogColor;
    uniform vec3 sunDiscColor;
    uniform vec3 sunGlowColor;
    uniform vec3 moonGlowColor;
    
    uniform sampler2D scatteringLUT;
    uniform bool useLUT;
    uniform float lutIntensity;
    
    uniform float horizonSize;
    uniform float horizonAlpha;
    uniform float cloudDensity;
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
    
    uniform sampler2D cloudNoise;
    uniform sampler2D weatherMap;
    uniform vec2 cloudDirection;
    uniform float cloudSpeed;

    uniform float starBrightness;
    uniform float twinkleSpeed;
    
    varying vec3 vWorldPosition;

    float henyey_greenstein(float cos_theta, float g) {
        const float k = 0.0795774715459;
        return k * (1.0 - g * g) / (pow(1.0 + g * g - 2.0 * g * cos_theta, 1.5));
    }

    float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }

    vec3 createStars(vec3 dir, float time) {
        vec2 starUV = vec2(atan(dir.x, dir.z), asin(dir.y)) * 100.0;
        vec2 gridID = floor(starUV);
        vec2 gridUV = fract(starUV) - 0.5;
        float star = 0.0;
        for(int y = -1; y <= 1; y++) {
            for(int x = -1; x <= 1; x++) {
                vec2 offset = vec2(float(x), float(y));
                vec2 cellID = gridID + offset;
                vec2 starPos = vec2(hash(cellID), hash(cellID + 100.0)) - 0.5;
                vec2 diff = gridUV - offset - starPos;
                float dist = length(diff);
                float brightness = hash(cellID + 200.0);
                if(brightness > 0.7) {
                    float twinkle = sin(time * twinkleSpeed * (hash(cellID + 300.0) * 5.0 + 1.0)) * 0.5 + 0.5;
                    twinkle = mix(0.5, 1.0, twinkle);
                    float starPoint = smoothstep(0.05, 0.0, dist);
                    star += starPoint * brightness * twinkle;
                }
            }
        }
        return vec3(star) * starBrightness;
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
        float clampedVertexColor = (vertexColor.y < 0.0) ? 1.0 : vertexColor.y;
        return clamp(pow((1.0 - clampedVertexColor), horizonSize) - (1.0 - horizonAlpha), 0.0, 1.0);
    }

    vec2 generate2DClouds(vec3 dir) {
        float safeY = max(dir.y, 0.05);
        float horizonCurve = safeY / horizonUVCurve;
        
        vec2 uvBase = vec2(dir.x / horizonCurve, dir.z / horizonCurve);
        
        vec2 uv1 = uvBase / 5.0 + (time * 4.0 * cloudSpeed * cloudDirection);
        float clouds = texture2D(cloudNoise, uv1).r;
        
        vec2 uv2 = uvBase / 10.0 + (time * 4.0 * cloudSpeed * cloudDirection);
        float cloudDetail = texture2D(cloudNoise, uv2).r;
        clouds *= cloudDetail;
        
        vec2 uvWeather = uvBase / 20.0 + (time * 6.0 * cloudSpeed * cloudDirection);
        float weather = texture2D(weatherMap, uvWeather).r + 0.5;
        
        clouds = clamp(mix(cloudCoverage, cloudCoverage + 1.0, clouds), cloudCoverage, 1.0);
        clouds = clamp(pow(clouds, 1.0 + cloudEdge), 0.0, 1.0);
        float cloudFade = clamp(dir.y, 0.0, 1.0);
        
        float cloudsFinal = clamp(clouds - (clamp(weather + 0.5, 0.0, 1.0) * (1.0 - cloudCoverage / 2.0)), 0.0, 1.0);
        
        float cloudsFinal2 = cloudsFinal * mix(5.0, cloudDensity, dir.y) * (cloudFade * 2.0);
        float transmittance = exp(-cloudsFinal2);
        return vec2(transmittance, weather);
    }

    vec3 scatterLight(vec3 vertexColor, vec3 sunDir, vec3 moonDir) {
        float clampedVertexColor = 0.0;
        if (vertexColor.y < 0.0) { clampedVertexColor = 0.0001; }
        else { clampedVertexColor = vertexColor.y; }
        
        float vertexSlope = pow((1.0 - clampedVertexColor), 2.0);
        
        float UVx = mix(vertexSlope, 1.0, 0.5);
        float UVy = clamp(sunDir.y / 2.0, -0.495, 0.495) + 0.5;
        
        float UVx2 = mix(vertexSlope, 1.0, 0.1);
        float UVy2 = clamp(moonDir.y / 2.0, -0.495, 0.495) + 0.5;
        
        vec3 scatterColor = vec3(1.0); 
        vec3 scatterColor2 = vec3(1.0);
        
        vec3 sunLightScattered = texture2D(scatteringLUT, vec2(UVx, UVy)).rgb * scatterColor;
        vec3 moonLightScattered = texture2D(scatteringLUT, vec2(UVx2, UVy2)).rgb * scatterColor2 + 0.15;
        
        vec3 lightScattered = sunLightScattered + moonLightScattered;
        lightScattered *= lutIntensity;
        lightScattered = lightScattered * baseColor;
        
        return lightScattered;
    }

    void main() {
        vec3 dir = normalize(vWorldPosition);
        vec3 sunDir = normalize(sunPosition);
        vec3 moonDir = normalize(moonPosition);
        
        vec3 skyColor = vec3(0.0);
        
        if (useLUT) {
            skyColor = scatterLight(dir, sunDir, moonDir);
        } else {
            skyColor = baseColor;
        }
        
        float fogA = createHorizonFog(dir);
        
        float nightFactor = 1.0 - smoothstep(-0.2, 0.2, sunDir.y);
        if(nightFactor > 0.0 && dir.y > 0.0) {
            skyColor += createStars(dir, time) * nightFactor;
        }

        vec2 dynClouds = vec2(1.0, 0.0);
        float dynCloudAlpha = 0.0;
        if (dir.y > 0.0) {
            dynClouds = generate2DClouds(dir);
            dynCloudAlpha = 1.0 - dynClouds.x;
            
            float sun = dot(sunDir, dir);
            float moon = dot(moonDir, dir);
            float hg = max(henyey_greenstein(sun, henyeyGreensteinLevel - 0.15), 
                        henyey_greenstein(moon, henyeyGreensteinLevel + 0.05));
            
            vec3 finalCloudColor = baseCloudColor; 
            vec3 scatteredLight = finalCloudColor * hg * absorption * dynClouds.x;
            scatteredLight = clamp(scatteredLight, 0.0, 2.0);

            skyColor = skyColor * dynClouds.x + (finalCloudColor * cloudBrightness * dynCloudAlpha);
            skyColor = skyColor + (scatteredLight * dynCloudAlpha);
            
            float safeY = max(dir.y, 0.05);
            float horizonCurve = safeY / horizonUVCurve;
            vec2 uvNoise = vec2(dir.x / horizonCurve, dir.z / horizonCurve) / 5.0;
            vec2 animOffset = time * 4.0 * cloudSpeed * cloudDirection;
            
            float rawNoise = texture2D(cloudNoise, uvNoise + animOffset).r;
            float noiseVal = clamp((rawNoise - 0.4) * 2.0, 0.0, 1.0); 
            
            skyColor -= (noiseVal * baseCloudColor) * dynCloudAlpha;
        }
        
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

// --- 5. SKY CLASS ---

export class Sky {
    private scene: Scene;
    private skyMesh: Mesh;
    private skyMaterial: ShaderMaterial;
    public sunLight: DirectionalLight;
    public moonLight: DirectionalLight;
    public ambientLight: AmbientLight;

    public timeOfDay: number = 1200.0;
    public rateOfTime: number = 1.0;
    public simulateTime: boolean = true;
    public cloudCoverage: number = 0.558;
    private sunPosAlpha: number = 0.0;

    constructor(scene: Scene, lutPath: string = '/textures/scatteringLUT.HDR') {
        this.scene = scene;

        const cloudNoiseTex = createNoiseTexture();
        const weatherMapTex = createWeatherMap();

        const rgbeLoader = new RGBELoader();
        rgbeLoader.load(lutPath, (texture) => {
            texture.minFilter = LinearFilter;
            texture.magFilter = LinearFilter;
            texture.generateMipmaps = false;
            this.skyMaterial.uniforms.scatteringLUT.value = texture;
            this.skyMaterial.uniforms.useLUT.value = true;
            this.skyMaterial.needsUpdate = true;
            console.log('Sky LUT Loaded');
        }, undefined, (err) => {
            console.warn('Sky LUT failed to load, falling back to analytic sky', err);
        });

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
                scatteringLUT: { value: null },
                useLUT: { value: false },
                lutIntensity: { value: 2.0 },
                horizonSize: { value: godotPreset.horizonSize },
                horizonAlpha: { value: godotPreset.horizonAlpha },
                cloudDensity: { value: godotPreset.cloudDensity },
                cloudCoverage: { value: 0.0 },
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
                starBrightness: { value: godotPreset.starBrightness },
                twinkleSpeed: { value: godotPreset.twinkleSpeed },
                cloudNoise: { value: cloudNoiseTex },
                weatherMap: { value: weatherMapTex },
                cloudDirection: { value: godotPreset.cloudDirection },
                cloudSpeed: { value: godotPreset.cloudSpeed }
            },
            side: BackSide,
            depthWrite: false
        });

        this.skyMesh = new Mesh(new SphereGeometry(1e5, 64, 64), this.skyMaterial);
        this.skyMesh.renderOrder = -1;
        this.scene.add(this.skyMesh);

        this.sunLight = new DirectionalLight(0xffffff, 1.0);
        this.scene.add(this.sunLight);

        this.moonLight = new DirectionalLight(0x445566, 0.2);
        this.scene.add(this.moonLight);

        this.ambientLight = new AmbientLight(0x404040);
        this.scene.add(this.ambientLight);
    }

    /**
     * @param deltaTime Time since last frame in SECONDS
     * @param camera The active camera to center the sky on
     */
    public update(deltaTime: number, camera: Object3D): void {
        this.skyMesh.position.copy(camera.position);

        if (this.simulateTime) {
            // this.timeOfDay += this.rateOfTime;
            if (this.timeOfDay >= 2400.0) this.timeOfDay = 0.0;
        }

        this.updateRotation();
        this.updateSkyColors();

        // FIXED: Shader expects seconds. deltaTime is seconds.
        // We accumulate seconds directly. 
        this.skyMaterial.uniforms.time.value += deltaTime;
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

        if (!this.skyMaterial.uniforms.useLUT.value) {
            this.skyMaterial.uniforms.baseColor.value.copy(preset.baseSkyColor.sample(pos));
        } else {
            // Godot specific fallback when using LUT
            this.skyMaterial.uniforms.baseColor.value.setRGB(0.052192, 0.101373, 0.192708);
        }

        this.skyMaterial.uniforms.horizonFogColor.value.copy(preset.horizonFogColor.sample(pos));

        const baseC = preset.baseCloudColor.sample(pos);
        const overcastC = preset.overcastCloudColor.sample(pos);
        const normalizedCoverage = (this.cloudCoverage + 1.0) * 0.5;
        this.skyMaterial.uniforms.baseCloudColor.value.copy(baseC.clone().lerp(overcastC, normalizedCoverage));

        this.skyMaterial.uniforms.sunDiscColor.value.copy(preset.sunDiscColor.sample(pos));
        this.skyMaterial.uniforms.sunGlowColor.value.copy(preset.sunGlowColor.sample(pos));
        this.skyMaterial.uniforms.moonGlowColor.value.copy(preset.moonGlowColor.sample(pos));
        this.skyMaterial.uniforms.cloudCoverage.value = this.cloudCoverage;

        const sunInt = preset.sunLightIntensity.sample(pos);
        const moonInt = preset.moonLightIntensity.sample(pos);
        const cloudDamp = 1.0 - (normalizedCoverage * 0.8);

        this.sunLight.color.copy(preset.sunLightColor.sample(pos));
        this.sunLight.intensity = Math.max(0, sunInt * cloudDamp * 1.5);
        this.moonLight.color.copy(preset.moonLightColor.sample(pos));
        this.moonLight.intensity = Math.max(0, moonInt * cloudDamp * 0.5);
    }

    public cleanup(): void {
        this.scene.remove(this.skyMesh);
        this.scene.remove(this.sunLight);
        this.scene.remove(this.moonLight);
        this.scene.remove(this.ambientLight);
        this.skyMaterial.dispose();
        this.skyMesh.geometry.dispose();
        // Dispose generated textures
        this.skyMaterial.uniforms.cloudNoise.value.dispose();
        this.skyMaterial.uniforms.weatherMap.value.dispose();
    }
}