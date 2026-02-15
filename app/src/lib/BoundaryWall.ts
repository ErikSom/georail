import {
    Group,
    Mesh,
    PlaneGeometry,
    ShaderMaterial,
    DoubleSide,
    AdditiveBlending,
    Vector3,
    Color,
} from 'three';

// --- Tweakable constants ---
const WALL_WIDTH = 50;
const WALL_HEIGHT = 25;
const FADE_DISTANCE = 100;

const HEX_SCALE = 8.0;
const LINE_WIDTH = 0.05;    // Adjusted slightly for better visibility
const PULSE_SPEED = 4.0;
const PULSE_MIN = 0.2;
const BRIGHTNESS = 4.0;

const vertexShader = /* glsl */ `
varying vec2 vUv;

void main() {
    vUv = uv;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`;

const fragmentShader = /* glsl */ `
uniform float uOpacity;
uniform float uTime;
uniform vec3 uColor;
uniform float uHexScale;
uniform float uLineWidth;
uniform float uPulseSpeed;
uniform float uPulseMin;
uniform float uBrightness;

varying vec2 vUv;

// Function to calculate distance to the edge of a regular hexagon
float hexDist(vec2 p) {
    p = abs(p);
    // 0.866025 is sqrt(3)/2
    float d = dot(p, normalize(vec2(1.0, 1.73205)));
    return max(d, p.x);
}

void main() {
    // 1. Correct for the 2:1 Aspect Ratio (50/25) to prevent stretching
    vec2 aspectRatio = vec2(2.0, 1.0);
    vec2 p = vUv * aspectRatio * uHexScale;

    // 2. Hexagonal Tiling Logic
    vec2 r = vec2(1.0, 1.73205);
    vec2 h = r * 0.5;
    vec2 a = mod(p, r) - h;
    vec2 b = mod(p - h, r) - h;
    vec2 g = dot(a, a) < dot(b, b) ? a : b;

    // 3. Create the grid lines
    // hexDist returns ~0.5 at the edges of a unit hex
    float dist = 0.5 - hexDist(g);
    float line = smoothstep(0.0, uLineWidth, dist);
    line = 1.0 - line; 

    // 4. Radial Fade (vignette effect)
    vec2 centeredUv = (vUv - 0.5) * 2.0;
    float distFromCenter = length(centeredUv);
    float radialFade = 1.0 - smoothstep(0.6, 1.2, distFromCenter);

    // 5. Ripple Pulse Logic
    // Using (uTime - distFromCenter) makes the wave travel outward
    float wave = sin((uTime * uPulseSpeed) - (distFromCenter * 5.0));
    float pulse = uPulseMin + (1.0 - uPulseMin) * (wave * 0.5 + 0.5);

    // 6. Final Composition
    float intensity = line * pulse * radialFade * uOpacity * uBrightness;
    
    // Premultiplied alpha for Additive Blending
    gl_FragColor = vec4(uColor * intensity, intensity);
}
`;

export class BoundaryWall {
    public group: Group;

    private startWall: Mesh;
    private endWall: Mesh;
    private startMaterial: ShaderMaterial;
    private endMaterial: ShaderMaterial;

    private startOpacity = 0;
    private endOpacity = 0;
    private minBound: number;
    private maxBound: number;

    constructor(
        startPoint: Vector3,
        endPoint: Vector3,
        startDir: Vector3,
        endDir: Vector3,
        totalLength: number,
        trainLength: number,
    ) {
        this.group = new Group();
        this.group.name = 'BoundaryWalls';

        const halfTrain = trainLength / 2;
        this.minBound = -halfTrain;
        this.maxBound = totalLength + halfTrain;

        const geometry = new PlaneGeometry(WALL_WIDTH, WALL_HEIGHT);
        const wallColor = new Color(1.0, 0.10, 0.05); // Danger red

        const sharedUniforms = {
            uHexScale: { value: HEX_SCALE },
            uLineWidth: { value: LINE_WIDTH },
            uPulseSpeed: { value: PULSE_SPEED },
            uPulseMin: { value: PULSE_MIN },
            uBrightness: { value: BRIGHTNESS },
            uColor: { value: new Vector3(wallColor.r, wallColor.g, wallColor.b) },
        };

        this.startMaterial = new ShaderMaterial({
            vertexShader,
            fragmentShader,
            uniforms: {
                uOpacity: { value: 0 },
                uTime: { value: 0 },
                ...sharedUniforms,
            },
            transparent: true,
            depthWrite: false,
            side: DoubleSide,
            blending: AdditiveBlending,
        });

        // Clone material so we can fade them independently
        this.endMaterial = this.startMaterial.clone();

        this.startWall = new Mesh(geometry, this.startMaterial);
        this.startWall.name = 'BoundaryWall_Start';
        this.startWall.frustumCulled = false;

        this.endWall = new Mesh(geometry, this.endMaterial);
        this.endWall.name = 'BoundaryWall_End';
        this.endWall.frustumCulled = false;

        const startOffset = startPoint.clone().addScaledVector(startDir, -halfTrain);
        const endOffset = endPoint.clone().addScaledVector(endDir, halfTrain);

        this.positionWall(this.startWall, startOffset, startDir);
        this.positionWall(this.endWall, endOffset, endDir);

        this.startWall.visible = false;
        this.endWall.visible = false;

        this.group.add(this.startWall);
        this.group.add(this.endWall);
    }

    private positionWall(wall: Mesh, point: Vector3, direction: Vector3): void {
        wall.position.copy(point);
        wall.position.y += WALL_HEIGHT / 2 - 2;

        const horizontalDir = new Vector3(direction.x, 0, direction.z).normalize();
        const target = wall.position.clone().add(horizontalDir);
        wall.lookAt(target);
    }

    public update(distanceTraveled: number, power: number, velocity: number, deltaTime: number): void {
        const distFromStart = distanceTraveled - this.minBound;
        const distFromEnd = this.maxBound - distanceTraveled;

        const startTarget = this.computeTargetOpacity(distFromStart, power < 0, velocity > 0);
        const endTarget = this.computeTargetOpacity(distFromEnd, power > 0, velocity < 0);

        const fadeSpeed = 5.0;
        this.startOpacity += (startTarget - this.startOpacity) * Math.min(1, fadeSpeed * deltaTime);
        this.endOpacity += (endTarget - this.endOpacity) * Math.min(1, fadeSpeed * deltaTime);

        if (this.startOpacity < 0.001) this.startOpacity = 0;
        if (this.endOpacity < 0.001) this.endOpacity = 0;

        this.startWall.visible = this.startOpacity > 0;
        this.endWall.visible = this.endOpacity > 0;

        this.startMaterial.uniforms.uOpacity.value = this.startOpacity;
        this.endMaterial.uniforms.uOpacity.value = this.endOpacity;

        const time = this.startMaterial.uniforms.uTime.value + deltaTime;
        this.startMaterial.uniforms.uTime.value = time;
        this.endMaterial.uniforms.uTime.value = time;
    }

    private computeTargetOpacity(distFromEdge: number, powerTowardEdge: boolean, movingAway: boolean): number {
        if (distFromEdge <= 0) return movingAway ? 0 : 1;
        if (!powerTowardEdge) return 0;
        if (distFromEdge < FADE_DISTANCE) return 1.0 - distFromEdge / FADE_DISTANCE;
        return 0;
    }

    public dispose(): void {
        this.startWall.geometry.dispose();
        this.startMaterial.dispose();
        this.endMaterial.dispose();
        this.group.removeFromParent();
    }
}
