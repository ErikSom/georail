import {
    Group,
    Mesh,
    PlaneGeometry,
    ShaderMaterial,
    DoubleSide,
    AdditiveBlending,
    Vector3,
} from 'three';
import Path from './utils/Path';
import { stops, stopDistances, stopStatuses } from '../store/journey';
import { trainLength, trainDistanceTraveled } from '../store/train';
import { configs } from '../store/globals';

// --- Geometry sizes ---
const WALL_HEIGHT = 6;
const WALL_WIDTH = 10;
const BEAM_HEIGHT = 200;
const BEAM_WIDTH = 8;

// --- Beam proximity fade ---
const BEAM_FADE_DISTANCE = 300; // meters — beam fully visible beyond this, invisible at 0

// --- Colors (RGB) ---
const ACTIVE_COLOR = new Vector3(0.1, 0.9, 0.7);
const INACTIVE_COLOR = new Vector3(0.15, 0.4, 0.35);

// ─── Wall Shader ───────────────────────────────────────────
const wallVertex = /* glsl */ `
varying vec2 vUv;
void main() {
    vUv = uv;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`;

const wallFragment = /* glsl */ `
uniform float uTime;
uniform float uOpacity;
uniform vec3 uColor;
uniform float uAspect;
varying vec2 vUv;

void main() {
    // Correct UV for aspect ratio so pattern has uniform world-space density
    vec2 uv = vec2(vUv.x * uAspect, vUv.y);

    // Edge fade on all four sides (still in raw UV space)
    vec2 edge = smoothstep(0.0, 0.15, vUv) * smoothstep(0.0, 0.15, 1.0 - vUv);
    float edgeFade = edge.x * edge.y;

    // Vertical scan lines (aspect-corrected)
    float scan = sin(uv.x * 24.0) * 0.5 + 0.5;
    scan = smoothstep(0.3, 0.7, scan) * 0.3;

    // Horizontal grid (aspect-corrected)
    float grid = sin(uv.y * 20.0) * 0.5 + 0.5;
    grid = smoothstep(0.4, 0.6, grid) * 0.15;

    // Animated upward sweep line
    float sweepPos = fract(uTime * 0.3);
    float sweep = 1.0 - smoothstep(0.0, 0.08, abs(vUv.y - sweepPos));
    sweep *= 0.6;

    // Combine with base glow — premultiplied alpha for additive blending
    float intensity = (0.08 + scan + grid + sweep) * edgeFade * uOpacity;
    gl_FragColor = vec4(uColor * intensity * 3.0, intensity);
}
`;

// ─── Beam Shader ───────────────────────────────────────────
const beamVertex = /* glsl */ `
varying vec2 vUv;
void main() {
    vUv = uv;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`;

const beamFragment = /* glsl */ `
uniform float uTime;
uniform float uOpacity;
uniform vec3 uColor;
varying vec2 vUv;

void main() {
    // Vertical gradient: bright at base, fading up
    float vertFade = pow(1.0 - vUv.y, 2.0);

    // Narrow bright core + soft outer glow
    float d = abs(vUv.x - 0.5) * 2.0;
    float core = exp(-d * 8.0);
    float glow = exp(-d * 2.0);
    float horiz = core * 0.7 + glow * 0.3;

    // Animated upward pulses
    float pulse = sin(vUv.y * 10.0 - uTime * 2.0) * 0.5 + 0.5;
    pulse = pulse * 0.3 + 0.7;

    // Subtle shimmer
    float shimmer = sin(vUv.y * 50.0 + uTime * 5.0) * 0.05 + 0.95;

    // Premultiplied alpha for additive blending
    float intensity = vertFade * horiz * pulse * shimmer * uOpacity;
    gl_FragColor = vec4(uColor * intensity * 4.0, intensity);
}
`;

// ─── Shared geometries (created once, reused across all stations) ──
let endWallGeom: PlaneGeometry | null = null;
let beamGeom: PlaneGeometry | null = null;

interface StopVisual {
    group: Group;
    endWallMaterial: ShaderMaterial;
    sideWallMaterial: ShaderMaterial;
    beamMaterial: ShaderMaterial;
    sideWallGeom: PlaneGeometry;
    stopDistanceM: number;
    currentOpacity: number;
    targetOpacity: number;
    currentColor: Vector3;
    targetColor: Vector3;
}

export class StationIndicator {
    public group: Group;
    private visuals: StopVisual[] = [];
    private time = 0;

    constructor() {
        this.group = new Group();
        this.group.name = 'StationIndicators';
    }

    public createIndicators(path: Path): void {
        this.dispose();

        const stopsArr = stops.value;
        const distances = stopDistances.value;
        if (stopsArr.length === 0 || distances.length === 0) return;

        const fullTrainLengthM = trainLength.value;
        const leniencyM = configs.value.stationStopLeniencyM;
        const zoneLengthM = Math.max(1, fullTrainLengthM + leniencyM);
        const halfWidth = WALL_WIDTH / 2;

        const endWallAspect = WALL_WIDTH / WALL_HEIGHT;
        const sideWallAspect = zoneLengthM / WALL_HEIGHT;

        // Ensure shared geometries exist
        if (!endWallGeom) endWallGeom = new PlaneGeometry(WALL_WIDTH, WALL_HEIGHT);
        if (!beamGeom) beamGeom = new PlaneGeometry(BEAM_WIDTH, BEAM_HEIGHT);

        const tmpDir = new Vector3();
        const tmpPerp = new Vector3();

        for (let i = 0; i < stopsArr.length; i++) {
            const stopDistanceM = distances[i] * 1000;
            const halfZoneM = zoneLengthM / 2;
            const zoneStartM = stopDistanceM - halfZoneM;
            const zoneEndM = stopDistanceM + halfZoneM;

            // Sample positions along path
            const centerPos = path.getPointAtDistance(stopDistanceM);
            const startPos = path.getPointAtDistance(zoneStartM);
            const endPos = path.getPointAtDistance(zoneEndM);

            // Compute horizontal track direction
            tmpDir.subVectors(endPos, startPos);
            if (tmpDir.lengthSq() < 0.001) {
                const before = path.getPointAtDistance(Math.max(0, stopDistanceM - 5));
                const after = path.getPointAtDistance(stopDistanceM + 5);
                tmpDir.subVectors(after, before);
            }
            tmpDir.y = 0;
            if (tmpDir.lengthSq() < 0.001) tmpDir.set(1, 0, 0);
            tmpDir.normalize();

            // Perpendicular direction (left side of track)
            tmpPerp.set(-tmpDir.z, 0, tmpDir.x);

            const stopGroup = new Group();
            stopGroup.name = `Station_${i}_${stopsArr[i].station}`;

            // ── Materials: separate end-wall and side-wall for different aspect ratios ──
            const makeWallMat = (aspect: number) => new ShaderMaterial({
                vertexShader: wallVertex,
                fragmentShader: wallFragment,
                uniforms: {
                    uTime: { value: 0 },
                    uOpacity: { value: 0 },
                    uColor: { value: INACTIVE_COLOR.clone() },
                    uAspect: { value: aspect },
                },
                transparent: true,
                depthWrite: false,
                side: DoubleSide,
                blending: AdditiveBlending,
            });

            const endWallMat = makeWallMat(endWallAspect);
            const sideWallMat = makeWallMat(sideWallAspect);

            const beamMat = new ShaderMaterial({
                vertexShader: beamVertex,
                fragmentShader: beamFragment,
                uniforms: {
                    uTime: { value: 0 },
                    uOpacity: { value: 0 },
                    uColor: { value: INACTIVE_COLOR.clone() },
                },
                transparent: true,
                depthWrite: false,
                side: DoubleSide,
                blending: AdditiveBlending,
            });

            // ── End walls (start and end of zone, perpendicular to track) ──
            const wStart = new Mesh(endWallGeom, endWallMat);
            wStart.position.copy(startPos);
            wStart.position.y += WALL_HEIGHT / 2;
            wStart.lookAt(wStart.position.clone().add(tmpDir));
            stopGroup.add(wStart);

            const wEnd = new Mesh(endWallGeom, endWallMat);
            wEnd.position.copy(endPos);
            wEnd.position.y += WALL_HEIGHT / 2;
            wEnd.lookAt(wEnd.position.clone().add(tmpDir));
            stopGroup.add(wEnd);

            // ── Side walls (run along track on each side) ──
            const sideGeom = new PlaneGeometry(zoneLengthM, WALL_HEIGHT);

            const wLeft = new Mesh(sideGeom, sideWallMat);
            wLeft.position.copy(centerPos).addScaledVector(tmpPerp, halfWidth);
            wLeft.position.y += WALL_HEIGHT / 2;
            wLeft.lookAt(wLeft.position.clone().add(tmpPerp));
            stopGroup.add(wLeft);

            const wRight = new Mesh(sideGeom, sideWallMat);
            wRight.position.copy(centerPos).addScaledVector(tmpPerp, -halfWidth);
            wRight.position.y += WALL_HEIGHT / 2;
            wRight.lookAt(wRight.position.clone().add(tmpPerp));
            stopGroup.add(wRight);

            // ── Beam cross (two perpendicular planes — visible from all angles) ──
            const b1 = new Mesh(beamGeom, beamMat);
            b1.position.copy(centerPos);
            b1.position.y += BEAM_HEIGHT / 2;
            b1.lookAt(b1.position.clone().add(tmpPerp));
            b1.frustumCulled = false;
            stopGroup.add(b1);

            const b2 = new Mesh(beamGeom, beamMat);
            b2.position.copy(centerPos);
            b2.position.y += BEAM_HEIGHT / 2;
            b2.lookAt(b2.position.clone().add(tmpDir));
            b2.frustumCulled = false;
            stopGroup.add(b2);

            this.group.add(stopGroup);

            this.visuals.push({
                group: stopGroup,
                endWallMaterial: endWallMat,
                sideWallMaterial: sideWallMat,
                beamMaterial: beamMat,
                sideWallGeom: sideGeom,
                stopDistanceM,
                currentOpacity: 0,
                targetOpacity: 0.25,
                currentColor: INACTIVE_COLOR.clone(),
                targetColor: INACTIVE_COLOR.clone(),
            });
        }
    }

    public update(deltaTime: number): void {
        this.time += deltaTime;

        const statuses = stopStatuses.value;
        if (statuses.length === 0) return;

        const trainPosM = trainDistanceTraveled.value;

        // Find next unserviced stop
        let nextIdx = -1;
        for (let i = 0; i < statuses.length; i++) {
            if (!statuses[i]?.arrived) {
                nextIdx = i;
                break;
            }
        }

        const fadeSpeed = 3.0;

        for (let i = 0; i < this.visuals.length; i++) {
            const v = this.visuals[i];
            const status = statuses[i];
            if (!status) continue;

            // Determine target state
            if (status.departed) {
                v.targetOpacity = 0;
            } else if (status.arrived) {
                // Currently at stop
                v.targetOpacity = 0.6;
                v.targetColor.copy(ACTIVE_COLOR);
            } else if (i === nextIdx) {
                // Next unserviced stop — full brightness
                v.targetOpacity = 1.0;
                v.targetColor.copy(ACTIVE_COLOR);
            } else {
                // Future stop — dimmed
                v.targetOpacity = 0.25;
                v.targetColor.copy(INACTIVE_COLOR);
            }

            // Smooth lerp
            const t = Math.min(1, fadeSpeed * deltaTime);
            v.currentOpacity += (v.targetOpacity - v.currentOpacity) * t;
            v.currentColor.lerp(v.targetColor, t);

            // Hide if fully transparent
            if (v.currentOpacity < 0.005) {
                v.group.visible = false;
                continue;
            }
            v.group.visible = true;

            // Beam proximity fade — dim when train is close
            const distToStation = Math.abs(trainPosM - v.stopDistanceM);
            const proximityFade = Math.min(1, distToStation / BEAM_FADE_DISTANCE);

            // Push wall uniforms (both end and side materials)
            v.endWallMaterial.uniforms.uTime.value = this.time;
            v.endWallMaterial.uniforms.uOpacity.value = v.currentOpacity;
            (v.endWallMaterial.uniforms.uColor.value as Vector3).copy(v.currentColor);

            v.sideWallMaterial.uniforms.uTime.value = this.time;
            v.sideWallMaterial.uniforms.uOpacity.value = v.currentOpacity;
            (v.sideWallMaterial.uniforms.uColor.value as Vector3).copy(v.currentColor);

            // Push beam uniforms with proximity fade applied
            v.beamMaterial.uniforms.uTime.value = this.time;
            v.beamMaterial.uniforms.uOpacity.value = v.currentOpacity * proximityFade;
            (v.beamMaterial.uniforms.uColor.value as Vector3).copy(v.currentColor);
        }
    }

    public dispose(): void {
        for (const v of this.visuals) {
            v.endWallMaterial.dispose();
            v.sideWallMaterial.dispose();
            v.beamMaterial.dispose();
            v.sideWallGeom.dispose();
            v.group.removeFromParent();
        }
        this.visuals = [];
        this.group.clear();
    }
}
