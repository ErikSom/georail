import { Vector3, Raycaster, Mesh, SphereGeometry, MeshBasicMaterial, Group, type Object3D } from 'three';
import type Path from '../utils/Path';
import type { MapViewer } from '../MapViewer';
import type { Train } from './Train';
import type { RoutePointMetadata } from '../api/navigation';
import { trainDebugMode } from '../../store/train';

const LOOKAHEAD_POINTS = 20;
const BUDGET_PER_FRAME = 2;
const COOLDOWN_MS = 800;
const MAX_GEOMETRIC_ERROR_M = 2.0;
const MIN_TILE_DEPTH = 6;
const TILE_STABLE_MS = 600;
const LATERAL_SAMPLE_M = 0.5;
const MAX_PER_NODE_DROP_M = 5.0;
const RAY_ORIGIN_HEIGHT_M = 100;
const RAY_RANGE_M = 500;

const DEBUG_SPHERE_RADIUS_M = 0.4;
const DEBUG_SPHERE_CAP = 5000;
const DEBUG_DISAGREE_THRESHOLD_M = 1.0;

type CastStatus = 'accepted' | 'rejected' | 'no-hit';
interface CastResult { status: CastStatus; hitY: number | null; }

export class RailCorrector {
    private path: Path;
    private metadata: (RoutePointMetadata | undefined)[];
    private mapViewer: MapViewer;
    private train: Train;

    private lastSampledAt: Float64Array;
    private cursor = 0;
    private tileSeenAt: WeakMap<object, number> = new WeakMap();

    // Reused scratch.
    private _origin = new Vector3();
    private _down = new Vector3(0, -1, 0);
    private _tangent = new Vector3();
    private _samplePos = new Vector3();
    private _ray = new Raycaster();

    // Debug visualization.
    private debugGroup: Group | null = null;
    private debugSphereGeo: SphereGeometry | null = null;
    private debugMaterials: Record<'green' | 'red' | 'gray' | 'magenta' | 'orange', MeshBasicMaterial> | null = null;
    private debugSphereCount = 0;
    private nodeSpheres: Map<number, Mesh[]> = new Map();

    private onLoadModel = (e: any) => {
        if (e?.scene && e?.tile) {
            (e.scene.userData as any).tile = e.tile;
        }
    };

    constructor(path: Path, metadata: (RoutePointMetadata | null | undefined)[], mapViewer: MapViewer, train: Train) {
        this.path = path;
        this.metadata = metadata as (RoutePointMetadata | undefined)[];
        this.mapViewer = mapViewer;
        this.train = train;
        this.lastSampledAt = new Float64Array(path.points.length);

        // Tag tile scene roots with a back-reference so findTile can locate them.
        const tiles: any = (this.mapViewer as any).tiles;
        if (tiles) {
            tiles.addEventListener?.('load-model', this.onLoadModel);
            // Retro-tag tiles that loaded before this corrector was created.
            tiles.forEachLoadedScene?.((scene: Object3D, tile: any) => {
                (scene.userData as any).tile = tile;
            });
        }
    }

    public tick(now: number): void {
        const tilesGroup = (this.mapViewer as any).tiles?.group;
        if (!tilesGroup) return;
        const points = this.path.points;
        if (points.length < 2) return;

        const leadIdx = this.path.getPointIndexAtDistance(this.train.distanceTraveled);

        let processed = 0;
        for (let n = 0; n < LOOKAHEAD_POINTS && processed < BUDGET_PER_FRAME; n++) {
            const i = leadIdx + ((this.cursor + n) % LOOKAHEAD_POINTS);
            if (i <= 0 || i >= points.length - 1) continue;
            if (this.metadata[i]?.source === 'manual') continue;
            if (now - this.lastSampledAt[i] < COOLDOWN_MS) continue;

            this.cursor = (this.cursor + n + 1) % LOOKAHEAD_POINTS;
            processed++;
            this.sampleNode(i, now, tilesGroup);
        }
    }

    public dispose(): void {
        this.tileSeenAt = new WeakMap();
        const tiles: any = (this.mapViewer as any).tiles;
        tiles?.removeEventListener?.('load-model', this.onLoadModel);
        if (this.debugGroup) {
            this.debugGroup.parent?.remove(this.debugGroup);
            this.debugGroup.clear();
            this.debugGroup = null;
        }
        this.debugSphereGeo?.dispose();
        this.debugSphereGeo = null;
        if (this.debugMaterials) {
            for (const k of Object.keys(this.debugMaterials) as Array<keyof typeof this.debugMaterials>) {
                this.debugMaterials[k].dispose();
            }
            this.debugMaterials = null;
        }
        this.debugSphereCount = 0;
        this.nodeSpheres.clear();
    }

    private sampleNode(i: number, now: number, tilesGroup: Object3D): void {
        const points = this.path.points;
        const prev = points[i - 1];
        const next = points[i + 1];
        const cur = points[i];

        // Tangent in horizontal plane only — sample +/- along rail direction.
        this._tangent.set(next.x - prev.x, 0, next.z - prev.z);
        const len = this._tangent.length();
        if (len < 1e-6) {
            this._tangent.set(0, 0, 0);
        } else {
            this._tangent.multiplyScalar(LATERAL_SAMPLE_M / len);
        }

        const corrCur = this.path.getCorrectionY(i);
        const effectiveY = cur.y + corrCur;

        const debug = trainDebugMode.value;
        const samplePositions: Vector3[] = debug ? [] : (null as any);
        const sampleResults: CastResult[] = debug ? [] : (null as any);

        let lowestY: number | null = null;
        for (let s = -1; s <= 1; s++) {
            this._samplePos.set(
                cur.x + this._tangent.x * s,
                cur.y + corrCur,
                cur.z + this._tangent.z * s,
            );
            const result = this.castDown(this._samplePos, now, tilesGroup);
            if (debug) {
                samplePositions.push(this._samplePos.clone());
                sampleResults.push(result);
            }
            if (result.status === 'accepted' && result.hitY != null && (lowestY == null || result.hitY < lowestY)) {
                lowestY = result.hitY;
            }
        }

        // Always cooldown so we don't hammer the same point next frame.
        this.lastSampledAt[i] = now;

        // Decide what correction to apply (if any) — and remember the outcome for
        // debug coloring.
        let outcome: 'no-hit' | 'no-change' | 'applied' | 'skipped-up' = 'no-hit';
        if (lowestY != null) {
            let dy = lowestY - effectiveY;
            if (dy >= -0.005) {
                outcome = dy < 0.005 ? 'no-change' : 'skipped-up';
            } else {
                if (dy < -MAX_PER_NODE_DROP_M) dy = -MAX_PER_NODE_DROP_M;
                this.path.setCorrectionY(i, corrCur + dy);
                outcome = 'applied';
            }
        }

        if (debug) {
            this.clearNodeSpheres(i);
            if (lowestY != null) {
                // Green = correction applied (or no-change). Orange = wanted to rise
                // but up corrections are disabled — train sits below this sphere.
                const color = outcome === 'skipped-up' ? 'orange' : 'green';
                this.dropDebugSphere(cur.x, lowestY, cur.z, color, tilesGroup, i);
                for (let k = 0; k < sampleResults.length; k++) {
                    const r = sampleResults[k];
                    if (r.status !== 'accepted' || r.hitY == null) continue;
                    if (Math.abs(r.hitY - lowestY) > DEBUG_DISAGREE_THRESHOLD_M) {
                        const pos = samplePositions[k];
                        this.dropDebugSphere(pos.x, r.hitY, pos.z, 'red', tilesGroup, i);
                    }
                }
            } else {
                const anyHit = sampleResults.some((r) => r.status === 'rejected');
                this.dropDebugSphere(cur.x, cur.y + corrCur, cur.z, anyHit ? 'magenta' : 'gray', tilesGroup, i);
            }
        }
    }

    private debugAcceptDumpsRemaining = 5;
    private castDown(samplePos: Vector3, now: number, tilesGroup: Object3D): CastResult {
        this._origin.set(samplePos.x, samplePos.y + RAY_ORIGIN_HEIGHT_M, samplePos.z);
        this._ray.set(this._origin, this._down);
        this._ray.near = 0;
        this._ray.far = RAY_RANGE_M;
        const hits = this._ray.intersectObject(tilesGroup, true);
        if (hits.length === 0) return { status: 'no-hit', hitY: null };

        let acceptedY: number | null = null;
        for (const hit of hits) {
            if (this.acceptHit(hit.object, now)) {
                acceptedY = hit.point.y;
                break;
            }
        }

        if (trainDebugMode.value && acceptedY != null && this.debugAcceptDumpsRemaining > 0) {
            this.debugAcceptDumpsRemaining--;
            const hitYs = hits.map(h => h.point.y.toFixed(2)).join(', ');
            console.log(`[RailCorrector] accepted hit — origin.y=${this._origin.y.toFixed(2)} samplePos.y=${samplePos.y.toFixed(2)} acceptedY=${acceptedY.toFixed(2)} allHitYs=[${hitYs}] (${hits.length} hits)`);
        }

        if (acceptedY != null) return { status: 'accepted', hitY: acceptedY };
        return { status: 'rejected', hitY: hits[0].point.y };
    }

    private ensureDebugAssets(tilesGroup: Object3D): void {
        // Attach to the scene root (same frame as path coords & raycast hits) instead of
        // tilesGroup, which has a non-trivial reorient transform that's complicating
        // world↔local conversion.
        const scene = this.findSceneRoot(tilesGroup);
        if (this.debugGroup && this.debugGroup.parent === scene) return;
        if (!this.debugGroup) {
            this.debugGroup = new Group();
            this.debugGroup.name = 'RailCorrectorDebug';
            this.debugSphereGeo = new SphereGeometry(DEBUG_SPHERE_RADIUS_M, 8, 6);
            this.debugMaterials = {
                green: new MeshBasicMaterial({ color: 0x00ff00, depthTest: false, transparent: true, opacity: 0.9 }),
                red: new MeshBasicMaterial({ color: 0xff0000, depthTest: false, transparent: true, opacity: 0.9 }),
                gray: new MeshBasicMaterial({ color: 0x888888, depthTest: false, transparent: true, opacity: 0.6 }),
                magenta: new MeshBasicMaterial({ color: 0x00ffff, depthTest: false, transparent: true, opacity: 0.9 }),
                orange: new MeshBasicMaterial({ color: 0xff8800, depthTest: false, transparent: true, opacity: 0.95 }),
            };
            this.debugGroup.renderOrder = 999;
        }
        if (scene && this.debugGroup.parent !== scene) {
            scene.add(this.debugGroup);
        }
    }

    private findSceneRoot(obj: Object3D): Object3D | null {
        let cur: Object3D | null = obj;
        while (cur && cur.parent) cur = cur.parent;
        return cur;
    }

    private dropDebugSphere(x: number, y: number, z: number, color: 'green' | 'red' | 'gray' | 'magenta' | 'orange', tilesGroup: Object3D, nodeIndex: number): void {
        if (this.debugSphereCount >= DEBUG_SPHERE_CAP) return;
        this.ensureDebugAssets(tilesGroup);
        if (!this.debugGroup?.parent) return;
        const mesh = new Mesh(this.debugSphereGeo!, this.debugMaterials![color]);
        mesh.position.set(x, y, z);
        mesh.renderOrder = 999;
        this.debugGroup.add(mesh);
        this.debugSphereCount++;

        let arr = this.nodeSpheres.get(nodeIndex);
        if (!arr) {
            arr = [];
            this.nodeSpheres.set(nodeIndex, arr);
        }
        arr.push(mesh);
    }

    private clearNodeSpheres(i: number): void {
        const existing = this.nodeSpheres.get(i);
        if (!existing) return;
        for (const mesh of existing) mesh.parent?.remove(mesh);
        this.debugSphereCount -= existing.length;
        this.nodeSpheres.delete(i);
    }

    private acceptHit(obj: Object3D, now: number): boolean {
        // BatchedTilesPlugin fuses active tiles into one BatchedMesh — per-tile metadata
        // is discarded, but the renderer has already filtered to current-LOD tiles, so
        // any hit is by definition acceptable.
        if (this.isBatchedTileMesh(obj)) return true;

        const tile = this.findTile(obj);
        if (!tile) {
            this.debugRejectLog('no-tile', null, null);
            return false;
        }

        const ge = tile.geometricError;
        if (typeof ge === 'number' && ge > MAX_GEOMETRIC_ERROR_M) {
            this.debugRejectLog('high-ge', ge, tile.__depth);
            return false;
        }

        const depth = tile.__depth ?? tile.internal?.depth;
        if (typeof depth === 'number' && depth < MIN_TILE_DEPTH) {
            this.debugRejectLog('shallow', ge, depth);
            return false;
        }

        let seen = this.tileSeenAt.get(tile);
        if (seen == null) {
            this.tileSeenAt.set(tile, now);
            this.debugRejectLog('first-seen', ge, depth);
            return false;
        }
        if (now - seen < TILE_STABLE_MS) {
            this.debugRejectLog('unstable', ge, depth);
            return false;
        }
        return true;
    }

    private debugRejectCounts: Record<string, number> = {};
    private debugRejectLastFlush = 0;
    private debugRejectLog(reason: string, ge: number | null, depth: number | null): void {
        if (!trainDebugMode.value) return;
        const key = `${reason}|ge=${ge != null ? ge.toFixed(1) : '?'}|depth=${depth ?? '?'}`;
        this.debugRejectCounts[key] = (this.debugRejectCounts[key] || 0) + 1;
        const now = performance.now();
        if (now - this.debugRejectLastFlush > 2000) {
            this.debugRejectLastFlush = now;
            console.log('[RailCorrector] reject reasons in last 2s:', this.debugRejectCounts);
            this.debugRejectCounts = {};
        }
    }

    private isBatchedTileMesh(obj: Object3D): boolean {
        let cur: Object3D | null = obj;
        while (cur) {
            const anyCur = cur as any;
            if (anyCur.isBatchedMesh) return true;
            if (cur.name === 'BatchTilesPlugin') return true;
            cur = cur.parent;
        }
        return false;
    }

    private findTile(obj: Object3D): any | null {
        let cur: Object3D | null = obj;
        while (cur) {
            const anyCur = cur as any;
            if (anyCur.__tile) return anyCur.__tile;
            if (cur.userData && (cur.userData as any).tile) return (cur.userData as any).tile;
            cur = cur.parent;
        }
        return null;
    }
}
