import {
    Group,
    Mesh,
    PlaneGeometry,
    BufferGeometry,
    Float32BufferAttribute,
    ShaderMaterial,
    DoubleSide,
    AdditiveBlending,
    Vector3,
} from 'three';
import Path from './utils/Path';
import { stops, stopDistances, stopStatuses } from '../store/journey';
import { trainLength, trainDistanceTraveled } from '../store/train';
import { configs } from '../store/globals';

const WALL_HEIGHT = 6;
const WALL_WIDTH = 6;
const BEAM_HEIGHT = 500;
const BEAM_WIDTH = 16;
const BEAM_FADE_DISTANCE = 300;
const WALL_Y_OFFSET = 0.3;
const ACTIVE_COLOR = new Vector3(0.1, 0.9, 0.7);

const wallVertex = /* glsl */ `
varying vec2 vUv;
varying float vWorldH; // world-space horizontal coordinate for continuous waves
void main() {
    vUv = uv;
    vec4 wp = modelMatrix * vec4(position, 1.0);
    vWorldH = wp.x + wp.z;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`;

const wallFragment = /* glsl */ `
uniform float uTime;
uniform float uOpacity;
uniform vec3 uColor;
varying vec2 vUv;
varying float vWorldH;

void main() {
    // Gentle wavy distortion using world position — continuous across segments
    float wave = sin(vWorldH * 0.5 + uTime * 0.6) * 0.10
               + sin(vWorldH * 0.9 - uTime * 0.4) * 0.07
               + sin(vWorldH * 0.3 + uTime * 0.25) * 0.08;

    // Vertical gradient: solid at bottom, wavy fade at top
    float fadeStart = 0.4 + wave;
    float vertFade = 1.0 - smoothstep(fadeStart, 1.0, vUv.y);

    // Extra brightness at the base
    float baseBright = smoothstep(0.25, 0.0, vUv.y) * 0.3;

    float intensity = (vertFade + baseBright) * uOpacity;
    gl_FragColor = vec4(uColor * intensity * 1.5, intensity);
}
`;

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

const SIDE_WALL_SEGMENT_LENGTH = 5;

let endWallGeom: PlaneGeometry | null = null;
let beamGeom: PlaneGeometry | null = null;

interface StopVisual {
    group: Group;
    wallMaterial: ShaderMaterial;
    beamMaterial: ShaderMaterial;
    sideWallGeoms: BufferGeometry[];
    stopDistanceM: number;
    currentOpacity: number;
    targetOpacity: number;
}

export class StationIndicator {
    public group: Group;
    private visual: StopVisual | null = null;
    private activeIndex: number = -1;
    private time = 0;
    private path: Path | null = null;
    private zoneLengthM = 0;
    private halfWidth = WALL_WIDTH / 2;
    private showAtCurrentStation = false;
    private _tmpDir = new Vector3();
    private _tmpPerp = new Vector3();
    private _tmpPoint = new Vector3();

    constructor() {
        this.group = new Group();
        this.group.name = 'StationIndicators';
    }

    public createIndicators(path: Path): void {
        this.dispose();

        const stopsArr = stops.value;
        const distances = stopDistances.value;
        if (stopsArr.length === 0 || distances.length === 0) return;

        this.path = path;
        this.zoneLengthM = Math.max(1, trainLength.value + configs.value.stationStopLeniencyM);
        this.halfWidth = WALL_WIDTH / 2;

        if (!endWallGeom) endWallGeom = new PlaneGeometry(WALL_WIDTH, WALL_HEIGHT);
        if (!beamGeom) beamGeom = new PlaneGeometry(BEAM_WIDTH, BEAM_HEIGHT);

        const statuses = stopStatuses.value;
        let firstIdx = 0;
        for (let i = 0; i < statuses.length; i++) {
            const s = statuses[i];
            if (this.showAtCurrentStation ? !s?.departed : !s?.arrived) {
                firstIdx = i;
                break;
            }
        }

        this.createIndicatorForStop(firstIdx);
    }

    private buildSideStripGeometry(
        path: Path,
        zoneStartM: number,
        segCount: number,
        segLen: number,
        lateralOffset: number,
    ): BufferGeometry {
        const vertCount = (segCount + 1) * 2;
        const positions = new Float32Array(vertCount * 3);
        const uvs = new Float32Array(vertCount * 2);
        const indices: number[] = [];

        const tmpPerp = this._tmpPerp;
        const tmpPoint = this._tmpPoint;

        for (let e = 0; e <= segCount; e++) {
            const edgeM = zoneStartM + e * segLen;
            const edgePos = path.getPointAtDistance(edgeM, tmpPoint);

            const lookAhead = path.getPointAtDistance(edgeM + 0.5);
            const lookBehind = path.getPointAtDistance(edgeM - 0.5);
            this._tmpDir.subVectors(lookAhead, lookBehind);
            this._tmpDir.y = 0;
            if (this._tmpDir.lengthSq() < 0.001) this._tmpDir.set(1, 0, 0);
            this._tmpDir.normalize();

            tmpPerp.set(-this._tmpDir.z, 0, this._tmpDir.x);

            const bIdx = e * 2;
            positions[bIdx * 3 + 0] = edgePos.x + tmpPerp.x * lateralOffset;
            positions[bIdx * 3 + 1] = edgePos.y + WALL_Y_OFFSET;
            positions[bIdx * 3 + 2] = edgePos.z + tmpPerp.z * lateralOffset;

            const tIdx = bIdx + 1;
            positions[tIdx * 3 + 0] = edgePos.x + tmpPerp.x * lateralOffset;
            positions[tIdx * 3 + 1] = edgePos.y + WALL_HEIGHT + WALL_Y_OFFSET;
            positions[tIdx * 3 + 2] = edgePos.z + tmpPerp.z * lateralOffset;

            const u = e / segCount;
            uvs[bIdx * 2 + 0] = u;
            uvs[bIdx * 2 + 1] = 0;
            uvs[tIdx * 2 + 0] = u;
            uvs[tIdx * 2 + 1] = 1;
        }

        for (let s = 0; s < segCount; s++) {
            const bl = s * 2;
            const tl = bl + 1;
            const br = (s + 1) * 2;
            const tr = br + 1;
            indices.push(bl, br, tl);
            indices.push(tl, br, tr);
        }

        const geom = new BufferGeometry();
        geom.setAttribute('position', new Float32BufferAttribute(positions, 3));
        geom.setAttribute('uv', new Float32BufferAttribute(uvs, 2));
        geom.setIndex(indices);

        return geom;
    }

    private createIndicatorForStop(index: number): void {
        this.disposeVisual();

        const distances = stopDistances.value;
        const stopsArr = stops.value;
        if (index < 0 || index >= stopsArr.length || !this.path) return;

        const path = this.path;
        const stopDistanceM = distances[index] * 1000;
        const halfZoneM = this.zoneLengthM / 2;
        const zoneStartM = stopDistanceM - halfZoneM;
        const zoneEndM = stopDistanceM + halfZoneM;

        const centerPos = path.getPointAtDistance(stopDistanceM);
        const startPos = path.getPointAtDistance(zoneStartM);
        const endPos = path.getPointAtDistance(zoneEndM);

        const tmpDir = this._tmpDir;
        const tmpPerp = this._tmpPerp;

        tmpDir.subVectors(endPos, startPos);
        if (tmpDir.lengthSq() < 0.001) {
            const before = path.getPointAtDistance(Math.max(0, stopDistanceM - 5));
            const after = path.getPointAtDistance(stopDistanceM + 5);
            tmpDir.subVectors(after, before);
        }
        tmpDir.y = 0;
        if (tmpDir.lengthSq() < 0.001) tmpDir.set(1, 0, 0);
        tmpDir.normalize();

        tmpPerp.set(-tmpDir.z, 0, tmpDir.x);

        const stopGroup = new Group();
        stopGroup.name = `Station_${index}_${stopsArr[index].station}`;

        const wallMat = new ShaderMaterial({
            vertexShader: wallVertex,
            fragmentShader: wallFragment,
            uniforms: {
                uTime: { value: 0 },
                uOpacity: { value: 0 },
                uColor: { value: ACTIVE_COLOR.clone() },
            },
            transparent: true,
            depthWrite: false,
            side: DoubleSide,
            blending: AdditiveBlending,
        });

        const beamMat = new ShaderMaterial({
            vertexShader: beamVertex,
            fragmentShader: beamFragment,
            uniforms: {
                uTime: { value: 0 },
                uOpacity: { value: 0 },
                uColor: { value: ACTIVE_COLOR.clone() },
            },
            transparent: true,
            depthWrite: false,
            side: DoubleSide,
            blending: AdditiveBlending,
        });

        const wStart = new Mesh(endWallGeom!, wallMat);
        wStart.position.copy(startPos);
        wStart.position.y += WALL_HEIGHT / 2 + WALL_Y_OFFSET;
        wStart.lookAt(wStart.position.x + tmpDir.x, wStart.position.y + tmpDir.y, wStart.position.z + tmpDir.z);
        stopGroup.add(wStart);

        const wEnd = new Mesh(endWallGeom!, wallMat);
        wEnd.position.copy(endPos);
        wEnd.position.y += WALL_HEIGHT / 2 + WALL_Y_OFFSET;
        wEnd.lookAt(wEnd.position.x + tmpDir.x, wEnd.position.y + tmpDir.y, wEnd.position.z + tmpDir.z);
        stopGroup.add(wEnd);

        const segCount = Math.max(1, Math.ceil(this.zoneLengthM / SIDE_WALL_SEGMENT_LENGTH));
        const segLen = this.zoneLengthM / segCount;
        const sideWallGeoms: BufferGeometry[] = [];

        const leftGeom = this.buildSideStripGeometry(path, zoneStartM, segCount, segLen, this.halfWidth);
        sideWallGeoms.push(leftGeom);
        const leftMesh = new Mesh(leftGeom, wallMat);
        stopGroup.add(leftMesh);

        const rightGeom = this.buildSideStripGeometry(path, zoneStartM, segCount, segLen, -this.halfWidth);
        sideWallGeoms.push(rightGeom);
        const rightMesh = new Mesh(rightGeom, wallMat);
        stopGroup.add(rightMesh);

        const b1 = new Mesh(beamGeom!, beamMat);
        b1.position.copy(centerPos);
        b1.position.y += BEAM_HEIGHT / 2;
        b1.lookAt(b1.position.x + tmpPerp.x, b1.position.y + tmpPerp.y, b1.position.z + tmpPerp.z);
        b1.frustumCulled = false;
        stopGroup.add(b1);

        const b2 = new Mesh(beamGeom!, beamMat);
        b2.position.copy(centerPos);
        b2.position.y += BEAM_HEIGHT / 2;
        b2.lookAt(b2.position.x + tmpDir.x, b2.position.y + tmpDir.y, b2.position.z + tmpDir.z);
        b2.frustumCulled = false;
        stopGroup.add(b2);

        this.group.add(stopGroup);

        this.visual = {
            group: stopGroup,
            wallMaterial: wallMat,
            beamMaterial: beamMat,
            sideWallGeoms,
            stopDistanceM,
            currentOpacity: 0,
            targetOpacity: 1.0,
        };
        this.activeIndex = index;
    }

    private disposeVisual(): void {
        if (!this.visual) return;
        this.visual.wallMaterial.dispose();
        this.visual.beamMaterial.dispose();
        for (const g of this.visual.sideWallGeoms) g.dispose();
        this.visual.group.removeFromParent();
        this.visual = null;
        this.activeIndex = -1;
    }

    public update(deltaTime: number): void {
        this.time += deltaTime;

        const statuses = stopStatuses.value;
        if (statuses.length === 0) return;

        let nextIdx = -1;
        for (let i = 0; i < statuses.length; i++) {
            const s = statuses[i];
            if (this.showAtCurrentStation ? !s?.departed : !s?.arrived) {
                nextIdx = i;
                break;
            }
        }

        if (nextIdx !== this.activeIndex) {
            if (nextIdx === -1) {
                this.disposeVisual();
                return;
            }
            this.createIndicatorForStop(nextIdx);
        }

        const v = this.visual;
        if (!v) return;

        const status = statuses[this.activeIndex];
        if (!status) return;

        v.targetOpacity = status.arrived ? 0.6 : 1.0;

        const fadeSpeed = 3.0;
        const t = Math.min(1, fadeSpeed * deltaTime);
        v.currentOpacity += (v.targetOpacity - v.currentOpacity) * t;

        if (v.currentOpacity < 0.005) {
            v.group.visible = false;
            return;
        }
        v.group.visible = true;

        const trainPosM = trainDistanceTraveled.value;
        const distToStation = Math.abs(trainPosM - v.stopDistanceM);
        const proximityFade = Math.min(1, distToStation / BEAM_FADE_DISTANCE);

        v.wallMaterial.uniforms.uTime.value = this.time;
        v.wallMaterial.uniforms.uOpacity.value = v.currentOpacity;
        v.beamMaterial.uniforms.uTime.value = this.time;
        v.beamMaterial.uniforms.uOpacity.value = v.currentOpacity * proximityFade;
    }

    public dispose(): void {
        this.disposeVisual();
        this.group.clear();
        this.path = null;
    }
}
