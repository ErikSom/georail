import {
    Scene,
    Vector3,
    Vector2,
    Color,
    Mesh,
    SphereGeometry,
    ShaderMaterial,
    DirectionalLight,
    DirectionalLightHelper,
    AmbientLight,
    TextureLoader,
    RepeatWrapping,
    LinearMipMapLinearFilter,
    LinearFilter,
    BackSide,
    MathUtils,
    Object3D
} from 'three';
import { RGBELoader } from 'three/addons/loaders/RGBELoader.js';
import * as Tweakpane from 'tweakpane';


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
    starBrightness: 0.8, twinkleSpeed: 0.5
};


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
        // Use spherical coordinates for stable star field
        vec2 starUV = vec2(atan(dir.z, dir.x), asin(clamp(dir.y, -1.0, 1.0))) * 40.0;
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
                // Fewer stars by increasing threshold
                if(brightness > 0.85) {
                    // More pronounced twinkle (0.3 to 1.0 instead of 0.5 to 1.0)
                    float twinkle = sin(time * twinkleSpeed * (hash(cellID + 300.0) * 5.0 + 1.0)) * 0.5 + 0.5;
                    twinkle = mix(0.3, 1.0, twinkle);
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

            // Apply cloud base color and brightness
            skyColor = skyColor * dynClouds.x + (baseCloudColor * cloudBrightness * dynCloudAlpha);

            // Add scattering (this brightens clouds near sun/moon)
            skyColor = skyColor + ((baseCloudColor * (dynClouds.x * hg * absorption)) * dynCloudAlpha);

            // Subtract noise detail (darkens cloud edges)
            float safeY = max(dir.y, 0.05);
            float horizonCurve = safeY / horizonUVCurve;
            vec2 uvNoise = vec2(dir.x / horizonCurve, dir.z / horizonCurve) / 5.0;
            vec2 animOffset = time * 4.0 * cloudSpeed * cloudDirection;

            float rawNoise = texture2D(cloudNoise, uvNoise + animOffset).r;
            skyColor -= (clamp(rawNoise - 0.5, 0.0, 1.0) * baseCloudColor) * dynCloudAlpha;
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

export class Sky {
    private scene: Scene;
    private skyMesh: Mesh;
    private skyMaterial: ShaderMaterial;
    public sunLight: DirectionalLight;
    public moonLight: DirectionalLight;
    public ambientLight: AmbientLight;
    private sunLightHelper?: DirectionalLightHelper;
    private moonLightHelper?: DirectionalLightHelper;

    public timeOfDay: number = 1200.0;
    public rateOfTime: number = 1.0;
    public simulateTime: boolean = true;
    public cloudCoverage: number = 0.558;
    private sunPosAlpha: number = 0.0;
    public debugLights: boolean = false;
    public timeConversionFactor = (60 * 60 * 24) / 2400; // seconds in a day divided by timeOfDay range

    private pane: Tweakpane.Pane | null = null;
    private isPaneVisible: boolean = false;

    constructor(scene: Scene, lutPath: string = '/textures/scatteringLUT.HDR') {
        this.scene = scene;

        // Load cloud textures from files
        const textureLoader = new TextureLoader();
        const cloudNoiseTex = textureLoader.load('/textures/cloud-noise.png');
        cloudNoiseTex.wrapS = cloudNoiseTex.wrapT = RepeatWrapping;
        cloudNoiseTex.minFilter = LinearMipMapLinearFilter;
        cloudNoiseTex.magFilter = LinearFilter;

        const weatherMapTex = textureLoader.load('/textures/cloud-weather.png');
        weatherMapTex.wrapS = weatherMapTex.wrapT = RepeatWrapping;
        weatherMapTex.minFilter = LinearMipMapLinearFilter;
        weatherMapTex.magFilter = LinearFilter;

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

        this.sunLight = new DirectionalLight(0xffffff, 1.5);
        this.scene.add(this.sunLight);

        this.moonLight = new DirectionalLight(0x445566, 0.4);
        this.scene.add(this.moonLight);

        this.ambientLight = new AmbientLight(0x404040, 1.0);
        this.scene.add(this.ambientLight);

        // Add debug helpers for lights
        if (this.debugLights) {
            this.sunLightHelper = new DirectionalLightHelper(this.sunLight, 100, 0xffff00);
            this.scene.add(this.sunLightHelper);

            this.moonLightHelper = new DirectionalLightHelper(this.moonLight, 100, 0x8888ff);
            this.scene.add(this.moonLightHelper);

            console.log('Light debug helpers enabled');
        }
    }


    public update(deltaTime: number, camera: Object3D): void {
        this.skyMesh.position.copy(camera.position);

        if (this.simulateTime) {
            this.timeOfDay += (deltaTime / this.timeConversionFactor) * this.rateOfTime;
            if (this.timeOfDay >= 2400.0) this.timeOfDay -= 2400.0;
        }

        this.updateRotation();
        this.updateSkyColors();

        if (this.debugLights) {
            this.sunLightHelper?.update();
            this.moonLightHelper?.update();
        }

        this.skyMaterial.uniforms.time.value = this.timeOfDay * this.timeConversionFactor;
    }

    private updateRotation(): void {
        const hourMapped = this.timeOfDay / 2400.0;
        const angle = (hourMapped * Math.PI * 2) - (Math.PI / 2);
        const sunY = Math.sin(angle);
        const sunZ = Math.cos(angle);
        const sunVec = new Vector3(0, sunY, sunZ).normalize();

        this.skyMaterial.uniforms.sunPosition.value.copy(sunVec);
        this.skyMaterial.uniforms.moonPosition.value.copy(sunVec.clone().negate());


        this.sunLight.position.copy(sunVec).multiplyScalar(50000);
        this.sunLight.target.position.set(0, 0, 0);
        this.sunLight.target.updateMatrixWorld();

        this.moonLight.position.copy(sunVec).negate().multiplyScalar(50000);
        this.moonLight.target.position.set(0, 0, 0);
        this.moonLight.target.updateMatrixWorld();

        this.sunPosAlpha = sunVec.y * 0.5 + 0.5;
    }

    private updateSkyColors(): void {
        const pos = this.sunPosAlpha;
        const preset = godotPreset;

        if (!this.skyMaterial.uniforms.useLUT.value) {
            this.skyMaterial.uniforms.baseColor.value.copy(preset.baseSkyColor.sample(pos));
        } else {
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

        if (this.sunLightHelper) {
            this.scene.remove(this.sunLightHelper);
            this.sunLightHelper.dispose();
        }
        if (this.moonLightHelper) {
            this.scene.remove(this.moonLightHelper);
            this.moonLightHelper.dispose();
        }

        this.skyMaterial.dispose();
        this.skyMesh.geometry.dispose();

        // Dispose generated textures
        this.skyMaterial.uniforms.cloudNoise.value.dispose();
        this.skyMaterial.uniforms.weatherMap.value.dispose();

        // Dispose UI pane if exists
        if (this.pane) {
            this.pane.dispose();
            this.pane = null;
        }
    }

    private createUI(): void {
        if (this.pane) return; // Already created

        this.pane = new Tweakpane.Pane({ title: 'Sky Settings' });

        // Time controls
        this.pane.addBinding(this, 'timeOfDay', {
            min: 0,
            max: 2400,
            step: 1
        });
        this.pane.addBinding(this, 'simulateTime');
        this.pane.addBinding(this, 'rateOfTime', {
            min: 0,
            max: 100,
            step: 0.1
        });

        this.pane.addBlade({ view: 'separator' });

        // Cloud controls
        this.pane.addBinding(this, 'cloudCoverage', {
            min: 0,
            max: 1,
            step: 0.01
        });
        this.pane.addBinding(this.skyMaterial.uniforms.cloudSpeed, 'value', {
            min: 0,
            max: 5,
            step: 0.1,
            label: 'cloudSpeed'
        });
        this.pane.addBinding(this.skyMaterial.uniforms.cloudDensity, 'value', {
            min: 0,
            max: 1,
            step: 0.01,
            label: 'cloudDensity'
        });

        this.pane.addBlade({ view: 'separator' });

        // Sun/Moon controls
        this.pane.addBinding(this.skyMaterial.uniforms.sunRadius, 'value', {
            min: 0.0001,
            max: 0.001,
            step: 0.00001,
            label: 'sunRadius'
        });
        this.pane.addBinding(this.skyMaterial.uniforms.moonRadius, 'value', {
            min: 0.0001,
            max: 0.001,
            step: 0.00001,
            label: 'moonRadius'
        });

        this.pane.addBlade({ view: 'separator' });

        // Star controls
        this.pane.addBinding(this.skyMaterial.uniforms.starBrightness, 'value', {
            min: 0,
            max: 2,
            step: 0.1,
            label: 'starBrightness'
        });
        this.pane.addBinding(this.skyMaterial.uniforms.twinkleSpeed, 'value', {
            min: 0,
            max: 2,
            step: 0.01,
            label: 'twinkleSpeed'
        });

        this.pane.addBlade({ view: 'separator' });

        // Light controls
        this.pane.addBinding(this.sunLight, 'intensity', {
            min: 0,
            max: 5,
            step: 0.1,
            label: 'sunIntensity'
        });
        this.pane.addBinding(this.moonLight, 'intensity', {
            min: 0,
            max: 2,
            step: 0.1,
            label: 'moonIntensity'
        });
        this.pane.addBinding(this.ambientLight, 'intensity', {
            min: 0,
            max: 2,
            step: 0.1,
            label: 'ambientIntensity'
        });
        this.pane.addBinding(this, 'debugLights').on('change', (ev: any) => {
            if (ev.value) {
                if (!this.sunLightHelper) {
                    this.sunLightHelper = new DirectionalLightHelper(this.sunLight, 100, 0xffff00);
                    this.scene.add(this.sunLightHelper);
                }
                if (!this.moonLightHelper) {
                    this.moonLightHelper = new DirectionalLightHelper(this.moonLight, 100, 0x8888ff);
                    this.scene.add(this.moonLightHelper);
                }
            } else {
                if (this.sunLightHelper) {
                    this.scene.remove(this.sunLightHelper);
                    this.sunLightHelper.dispose();
                    this.sunLightHelper = undefined;
                }
                if (this.moonLightHelper) {
                    this.scene.remove(this.moonLightHelper);
                    this.moonLightHelper.dispose();
                    this.moonLightHelper = undefined;
                }
            }
        });

        // Hide pane by default
        if (!this.isPaneVisible) {
            this.pane.element.style.display = 'none';
        }
    }

    public toggleUI(): void {
        if (!this.pane) {
            this.createUI();
        }

        this.isPaneVisible = !this.isPaneVisible;
        if (this.pane) {
            this.pane.element.style.display = this.isPaneVisible ? 'block' : 'none';
        }
    }
}