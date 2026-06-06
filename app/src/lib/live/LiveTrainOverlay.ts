import {
    Box3,
    Group,
    Matrix4,
    Object3D,
    PerspectiveCamera,
    Raycaster,
    Vector2,
    Vector3,
} from 'three';
import type { MapViewer } from '../MapViewer';
import { routePointToWorldPosition } from '../utils/CoordinateHelpers';
import { ChunkStore } from './chunkStore.ts';
import { cellsCoveringBBox, haversineDistanceM, metersPerDegreeLat, metersPerDegreeLon } from './geom.ts';
import {
    fetchLiveConsists,
    fetchLivePositions,
    type LiveTrainConsist,
    type LivePositionsResponse,
    type LiveTrainSummary,
    type RawPosition,
} from './api.ts';
import { TrainTracker, type ConsistSample } from './trainBuffer.ts';
import { LiveTrafficLayer } from './liveTrafficLayer.ts';
import { LiveTrainProxyMeshes, type ProxyCarShape } from './liveTrainProxyMeshes.ts';

const FAR_POLL_INTERVAL_MS = 15_000;
const HIGH_DETAIL_POLL_INTERVAL_MS = 5_000;
const RENDER_DELAY_MS = 30_000;
const HIGH_DETAIL_ALTITUDE_M = 1_000;
const DOT_HIDE_ALTITUDE_M = HIGH_DETAIL_ALTITUDE_M;
const ACTIVE_WINDOW_RADIUS_M = 2_000;
const ACTIVE_WINDOW_REFRESH_MS = 2_000;
const ACTIVE_WINDOW_RECENTER_M = 650;
const POSE_HOLD_MS = 20_000;

const MAX_SCREEN_DOTS = 512;
const MAX_CAR_INSTANCES = 512;
const LIVE_DOT_SIZE_PX = 11;
const LIVE_DOT_COLOR = '#28b7ff';
const SELECTED_DOT_SIZE_PX = 17;
const SELECTED_DOT_COLOR = '#ffbe6b';
const OWN_ACTIVE_DOT_SIZE_PX = 22;
const OWN_INACTIVE_DOT_SIZE_PX = 16;
const OWN_DOT_COLOR = '#f8f0ce';
const FAR_MAP_BOUNDS_PADDING_M = 35_000;

const DEFAULT_CAR_COUNT = 3;
const MAX_CARS_PER_TRAIN = 12;
const CAR_LENGTH_M = 22;
const CAR_WIDTH_M = 3.2;
const CAR_HEIGHT_M = 3.8;
const CAR_GAP_M = 3;
const REVERSE_ANGLE_DEG = 120;
const HOLOGRAM_TRAIN_COLOR = 0x72d6e8;
const HOLOGRAM_WIREFRAME_COLOR = 0x87eaf5;
const HOLOGRAM_BODY_OPACITY = 0.48;
const HOLOGRAM_WIREFRAME_OPACITY = 0.32;

const RAW_DOT_HEIGHT_M = 18;
const FALLBACK_RAIL_HEIGHT_M = 4;
const FOLLOW_TARGET_LIFT_M = 14;

interface ActiveBBox {
    lonMin: number;
    latMin: number;
    lonMax: number;
    latMax: number;
}

interface CarPose {
    center: ConsistSample;
    front: ConsistSample;
    rear: ConsistSample;
    lengthM: number;
}

interface TrainRenderSpec {
    carCount: number;
    carLengthM: number;
    centerOffsetsM: number[];
    consistLengthM: number;
}

interface ConsistRenderState {
    acceptedBearing?: number;
    reverseRouteKey?: string;
    heldPoses?: CarPose[];
    lastPoses?: CarPose[];
    lastPosesAt?: number;
}

const matrix = new Matrix4();
const dummy = new Object3D();
const tmpA = new Vector3();
const tmpB = new Vector3();
const tmpProject = new Vector3();

function latestRaw(train: LiveTrainSummary): RawPosition | null {
    return train.recent[train.recent.length - 1] ?? null;
}

function angleDeltaDeg(a: number, b: number): number {
    const diff = ((((a - b) % 360) + 540) % 360) - 180;
    return Math.abs(diff);
}

export class LiveTrainOverlay {
    public readonly group = new Group();

    private readonly mapViewer: MapViewer;
    private readonly camera: PerspectiveCamera;
    private readonly store = new ChunkStore({ country: 'NL' });
    private readonly tracker = new TrainTracker(this.store);
    private readonly proxyMeshes: LiveTrainProxyMeshes;
    private readonly raycaster = new Raycaster();
    private readonly pointerNdc = new Vector2();
    private readonly boundPickLiveTrain = (event: MouseEvent) => this.pickLiveTrainFromClick(event);
    private readonly trafficLayer: LiveTrafficLayer;
    private readonly stateByTrain = new Map<string, ConsistRenderState>();
    private readonly ownTrainWorldPosition = new Vector3();
    private readonly followTargetWorldPosition = new Vector3();
    private readonly onFollowTargetChanged?: (position: Vector3 | null) => void;
    private readonly onFarMapPanBoundsChanged?: (enabled: boolean, bounds: Box3 | null) => void;

    private summary: LivePositionsResponse | null = null;
    private pollTimer: number | null = null;
    private pollTimerDueAt = 0;
    private lastPollCompletedAt = 0;
    private pollAbort: AbortController | null = null;
    private activeAbort: AbortController | null = null;
    private consistAbort: AbortController | null = null;
    private activeBBox: ActiveBBox | null = null;
    private activeCenter: { lon: number; lat: number } | null = null;
    private lastActiveRefreshAt = 0;
    private activeSeq = 0;
    private highDetailActive = false;
    private screenDotsHidden = false;
    private ownTrainVisible = false;
    private selectedTrainId: string | null = null;
    private ownTrainSelected = true;
    private readonly farMapBounds = new Box3();
    private readonly consists = new Map<string, LiveTrainConsist | null>();
    private readonly consistInflightIds = new Set<string>();
    private started = false;

    constructor(
        mapViewer: MapViewer,
        camera: PerspectiveCamera,
        onFollowTargetChanged?: (position: Vector3 | null) => void,
        onFarMapPanBoundsChanged?: (enabled: boolean, bounds: Box3 | null) => void,
        liveTrafficElement?: HTMLElement | null,
        wheelTargetElement?: HTMLElement | null,
    ) {
        this.mapViewer = mapViewer;
        this.camera = camera;
        this.onFollowTargetChanged = onFollowTargetChanged;
        this.onFarMapPanBoundsChanged = onFarMapPanBoundsChanged;

        this.trafficLayer = new LiveTrafficLayer({
            parent: liveTrafficElement,
            wheelTarget: wheelTargetElement,
            maxDots: MAX_SCREEN_DOTS,
            onSelectTrain: id => this.selectLiveTrain(id),
            onSelectOwnTrain: () => this.selectOwnTrain(),
        });

        this.proxyMeshes = new LiveTrainProxyMeshes({
            maxInstances: MAX_CAR_INSTANCES,
            carWidthM: CAR_WIDTH_M,
            carHeightM: CAR_HEIGHT_M,
            carLengthM: CAR_LENGTH_M,
            bodyColor: HOLOGRAM_TRAIN_COLOR,
            wireColor: HOLOGRAM_WIREFRAME_COLOR,
            bodyOpacity: HOLOGRAM_BODY_OPACITY,
            wireOpacity: HOLOGRAM_WIREFRAME_OPACITY,
        });
        this.group.add(this.proxyMeshes.group);

        document.addEventListener('click', this.boundPickLiveTrain, true);
    }

    public start(): void {
        if (this.started) return;
        this.started = true;
        void this.pollOnce().finally(() => {
            this.lastPollCompletedAt = performance.now();
            this.scheduleNextPoll();
        });
    }

    public update(): void {
        if (!this.started) return;
        const cameraGeo = this.mapViewer.getLatLonHeightFromWorldPosition(this.camera.position);
        this.highDetailActive = !!cameraGeo && cameraGeo.height < HIGH_DETAIL_ALTITUDE_M;
        this.screenDotsHidden = !!cameraGeo && cameraGeo.height < DOT_HIDE_ALTITUDE_M;
        this.reschedulePollForCurrentTier();
        this.refreshActiveWindowIfNeeded(cameraGeo);
        this.updateFollowTarget();
        this.renderInstances();
    }

    public setOwnTrainWorldPosition(position: Vector3 | null): void {
        if (!position) {
            this.ownTrainVisible = false;
            return;
        }
        this.ownTrainWorldPosition.copy(position);
        this.ownTrainVisible = true;
    }

    public dispose(): void {
        this.started = false;
        if (this.pollTimer !== null) {
            window.clearTimeout(this.pollTimer);
            this.pollTimer = null;
            this.pollTimerDueAt = 0;
        }
        this.pollAbort?.abort();
        this.activeAbort?.abort();
        this.consistAbort?.abort();
        document.removeEventListener('click', this.boundPickLiveTrain, true);
        this.onFollowTargetChanged?.(null);
        this.onFarMapPanBoundsChanged?.(false, null);
        this.trafficLayer.dispose();
        this.proxyMeshes.dispose();
        this.group.parent?.remove(this.group);
    }

    private currentPollIntervalMs(): number {
        return this.highDetailActive ? HIGH_DETAIL_POLL_INTERVAL_MS : FAR_POLL_INTERVAL_MS;
    }

    private scheduleNextPoll(): void {
        this.schedulePoll(this.currentPollIntervalMs());
    }

    private schedulePoll(delayMs: number): void {
        if (!this.started) return;
        if (this.pollTimer !== null) window.clearTimeout(this.pollTimer);
        const boundedDelay = Math.max(0, delayMs);
        this.pollTimerDueAt = performance.now() + boundedDelay;
        this.pollTimer = window.setTimeout(() => {
            this.pollTimer = null;
            this.pollTimerDueAt = 0;
            void this.pollOnce().finally(() => {
                this.lastPollCompletedAt = performance.now();
                this.scheduleNextPoll();
            });
        }, boundedDelay);
    }

    private reschedulePollForCurrentTier(): void {
        if (!this.started || this.pollTimer === null) return;

        const now = performance.now();
        const anchor = this.lastPollCompletedAt || now;
        const desiredDueAt = anchor + this.currentPollIntervalMs();
        if (desiredDueAt + 50 < this.pollTimerDueAt) {
            this.schedulePoll(desiredDueAt - now);
        }
    }

    private async pollOnce(): Promise<void> {
        this.pollAbort?.abort();
        this.pollAbort = new AbortController();
        try {
            this.summary = await fetchLivePositions({ all: true }, { signal: this.pollAbort.signal });
            if (this.selectedTrainId && !this.summary.trains.some((train) => train.id === this.selectedTrainId)) {
                this.selectOwnTrain();
            }
            this.ingestActiveTrains();
        } catch (err) {
            if ((err as any)?.name !== 'AbortError') {
                console.warn('[LiveTrainOverlay] live position fetch failed', err);
            }
        }
    }

    private refreshActiveWindowIfNeeded(cameraGeo: { lon: number; lat: number; height: number } | null): void {
        if (!this.highDetailActive) {
            if (this.activeBBox) {
                this.activeAbort?.abort();
                this.activeBBox = null;
                this.activeCenter = null;
                this.lastActiveRefreshAt = 0;
            }
            return;
        }

        const now = performance.now();
        if (now - this.lastActiveRefreshAt < ACTIVE_WINDOW_REFRESH_MS) return;

        const windowPlan = this.activeWindowPlan(cameraGeo);
        if (!windowPlan) return;
        const { center, bbox } = windowPlan;
        const movedM = this.activeCenter
            ? haversineDistanceM(this.activeCenter, center)
            : Infinity;

        if (this.activeBBox && movedM < ACTIVE_WINDOW_RECENTER_M) {
            this.lastActiveRefreshAt = now;
            return;
        }

        this.lastActiveRefreshAt = now;
        this.activeCenter = center;
        this.activeBBox = bbox;
        const cells = cellsCoveringBBox(
            this.activeBBox.lonMin,
            this.activeBBox.latMin,
            this.activeBBox.lonMax,
            this.activeBBox.latMax,
        );

        const seq = ++this.activeSeq;
        this.activeAbort?.abort();
        this.activeAbort = new AbortController();
        void Promise.all(cells.map((cell) => this.store.ensureChunk(cell, this.activeAbort?.signal))).then(() => {
            if (seq !== this.activeSeq) return;
            this.ingestActiveTrains();
        });
    }

    private bboxAround(point: { lon: number; lat: number }, radiusM = ACTIVE_WINDOW_RADIUS_M): ActiveBBox {
        const lonRadiusDeg = radiusM / Math.max(1, metersPerDegreeLon(point.lat));
        const latRadiusDeg = radiusM / metersPerDegreeLat();
        return {
            lonMin: point.lon - lonRadiusDeg,
            latMin: point.lat - latRadiusDeg,
            lonMax: point.lon + lonRadiusDeg,
            latMax: point.lat + latRadiusDeg,
        };
    }

    private trainInsideActiveWindow(train: LiveTrainSummary): boolean {
        const latest = latestRaw(train);
        const bbox = this.activeBBox;
        return !!latest && !!bbox &&
            latest.lon >= bbox.lonMin && latest.lon <= bbox.lonMax &&
            latest.lat >= bbox.latMin && latest.lat <= bbox.latMax;
    }

    private trainById(id: string | null): LiveTrainSummary | null {
        if (!id || !this.summary) return null;
        return this.summary.trains.find((train) => train.id === id) ?? null;
    }

    private activeWindowPlan(cameraGeo: { lon: number; lat: number; height: number } | null): { center: { lon: number; lat: number }; bbox: ActiveBBox } | null {
        const selected = this.trainById(this.selectedTrainId);
        if (selected) {
            const raw = latestRaw(selected);
            const bbox = this.bboxForTrainHistory(selected);
            if (raw && bbox) return { center: { lon: raw.lon, lat: raw.lat }, bbox };
        }
        return cameraGeo
            ? { center: { lon: cameraGeo.lon, lat: cameraGeo.lat }, bbox: this.bboxAround(cameraGeo) }
            : null;
    }

    private bboxForTrainHistory(train: LiveTrainSummary): ActiveBBox | null {
        const points = train.recent.filter((point) => Number.isFinite(point.lon) && Number.isFinite(point.lat));
        if (points.length === 0) return null;

        let lonMin = Infinity, latMin = Infinity, lonMax = -Infinity, latMax = -Infinity;
        let latSum = 0;
        for (const point of points) {
            lonMin = Math.min(lonMin, point.lon);
            latMin = Math.min(latMin, point.lat);
            lonMax = Math.max(lonMax, point.lon);
            latMax = Math.max(latMax, point.lat);
            latSum += point.lat;
        }

        const averageLat = latSum / points.length;
        const lonPad = ACTIVE_WINDOW_RADIUS_M / Math.max(1, metersPerDegreeLon(averageLat));
        const latPad = ACTIVE_WINDOW_RADIUS_M / metersPerDegreeLat();
        return {
            lonMin: lonMin - lonPad,
            latMin: latMin - latPad,
            lonMax: lonMax + lonPad,
            latMax: latMax + latPad,
        };
    }

    private selectLiveTrain(id: string): void {
        this.selectedTrainId = id;
        this.ownTrainSelected = false;
        void this.fetchMissingConsists(new Set([id]));

        this.resetActiveWindow();
        this.updateFarMapPanBounds();
    }

    private selectOwnTrain(): void {
        this.selectedTrainId = null;
        this.ownTrainSelected = true;
        this.onFollowTargetChanged?.(null);
        this.resetActiveWindow();
        this.updateFarMapPanBounds();
    }

    private deselectTrain(): void {
        this.selectedTrainId = null;
        this.ownTrainSelected = false;
        this.onFollowTargetChanged?.(null);
        this.resetActiveWindow();
        this.updateFarMapPanBounds();
    }

    private resetActiveWindow(): void {
        this.activeBBox = null;
        this.activeCenter = null;
        this.lastActiveRefreshAt = 0;
    }

    private ingestActiveTrains(): void {
        if (!this.summary || !this.activeBBox) return;
        const activeIds = new Set<string>();
        for (const train of this.summary.trains) {
            if (!this.trainInsideActiveWindow(train)) continue;
            activeIds.add(train.id);
            for (const raw of train.recent) {
                this.tracker.ingest(train.id, {
                    lon: raw.lon,
                    lat: raw.lat,
                    ts: raw.t,
                    speedMs: raw.spd,
                    bearingDeg: raw.brg,
                });
            }
        }
        for (const id of this.stateByTrain.keys()) {
            if (id !== this.selectedTrainId && !activeIds.has(id)) this.stateByTrain.delete(id);
        }
        void this.fetchMissingConsists(activeIds);
    }

    private renderInstances(): void {
        this.renderScreenDots();
        this.renderOwnDot();
        this.updateFarMapPanBounds();
        this.renderCars();
    }

    private renderScreenDots(): void {
        let count = 0;
        if (this.screenDotsHidden) {
            this.trafficLayer.hideDots();
            return;
        }

        this.camera.updateMatrixWorld();
        const { width, height } = this.trafficLayer.root.getBoundingClientRect();
        const renderTs = Date.now() - RENDER_DELAY_MS;
        if (this.summary) {
            this.trafficLayer.ensureDotCapacity(this.summary.trains.length);
            for (const train of this.summary.trains) {
                if (count >= this.trafficLayer.dots.length) break;
                const position = this.dotWorldPositionForTrain(train, renderTs);
                if (!position) continue;

                tmpProject.copy(position).project(this.camera);
                if (
                    tmpProject.z < -1 || tmpProject.z > 1 ||
                    tmpProject.x < -1.08 || tmpProject.x > 1.08 ||
                    tmpProject.y < -1.08 || tmpProject.y > 1.08
                ) {
                    continue;
                }

                const x = (tmpProject.x * 0.5 + 0.5) * width;
                const y = (-tmpProject.y * 0.5 + 0.5) * height;
                const dot = this.trafficLayer.dots[count++];
                dot.dataset.trainId = train.id;
                const selected = train.id === this.selectedTrainId;
                const size = selected ? SELECTED_DOT_SIZE_PX : LIVE_DOT_SIZE_PX;
                const visual = this.dotVisual(dot);
                dot.classList.toggle('is-selected', selected);
                visual.style.width = `${size}px`;
                visual.style.height = `${size}px`;
                visual.style.background = selected ? SELECTED_DOT_COLOR : LIVE_DOT_COLOR;
                visual.style.border = selected ? '3px solid rgba(255,255,255,0.96)' : '2px solid rgba(255,255,255,0.92)';
                visual.style.boxShadow = selected
                    ? '0 0 0 4px rgba(255,190,107,0.34), 0 3px 10px rgba(0,0,0,0.45)'
                    : '0 2px 7px rgba(0,0,0,0.42)';
                dot.style.zIndex = selected ? '2' : '1';
                dot.style.opacity = selected ? '1' : '0.9';
                dot.style.transform = `translate3d(${x.toFixed(1)}px, ${y.toFixed(1)}px, 0) translate(-50%, -50%)`;
                dot.style.display = 'block';
            }
        }
        this.trafficLayer.setVisibleDotCount(count);
    }

    private dotWorldPositionForTrain(train: LiveTrainSummary, renderTs: number): Vector3 | null {
        const playback = this.tracker.playbackAt(train.id, renderTs);
        if (playback) {
            const snapped = this.worldPositionForGeo(playback);
            if (snapped) return snapped;
        }

        const raw = latestRaw(train);
        return raw
            ? this.mapViewer.latLonHeightToWorldPosition(raw.lat, raw.lon, RAW_DOT_HEIGHT_M)
            : null;
    }

    private updateFollowTarget(): void {
        if (!this.selectedTrainId) {
            this.onFollowTargetChanged?.(null);
            return;
        }

        const renderTs = Date.now() - RENDER_DELAY_MS;
        const playback = this.tracker.playbackAt(this.selectedTrainId, renderTs);
        if (playback) {
            const snappedFollowTarget = this.followTargetForGeo(playback);
            if (snappedFollowTarget) {
                this.onFollowTargetChanged?.(snappedFollowTarget);
                return;
            }
        }

        const selected = this.trainById(this.selectedTrainId);
        const raw = selected ? latestRaw(selected) : null;
        if (!raw) {
            this.onFollowTargetChanged?.(null);
            return;
        }

        const rawWorld = this.mapViewer.latLonHeightToWorldPosition(raw.lat, raw.lon, RAW_DOT_HEIGHT_M + FOLLOW_TARGET_LIFT_M);
        this.onFollowTargetChanged?.(rawWorld);
    }

    private renderOwnDot(): void {
        if (!this.ownTrainVisible || this.screenDotsHidden) {
            this.trafficLayer.ownDot.style.display = 'none';
            return;
        }

        tmpProject.copy(this.ownTrainWorldPosition).project(this.camera);
        if (
            tmpProject.z < -1 || tmpProject.z > 1 ||
            tmpProject.x < -1.08 || tmpProject.x > 1.08 ||
            tmpProject.y < -1.08 || tmpProject.y > 1.08
        ) {
            this.trafficLayer.ownDot.style.display = 'none';
            return;
        }

        const { width, height } = this.trafficLayer.root.getBoundingClientRect();
        const x = (tmpProject.x * 0.5 + 0.5) * width;
        const y = (-tmpProject.y * 0.5 + 0.5) * height;
        const active = this.ownTrainSelected;
        const size = active ? OWN_ACTIVE_DOT_SIZE_PX : OWN_INACTIVE_DOT_SIZE_PX;
        const ownDot = this.trafficLayer.ownDot;
        const visual = this.dotVisual(ownDot);
        ownDot.classList.toggle('is-active', active);
        visual.style.width = `${size}px`;
        visual.style.height = `${size}px`;
        visual.style.border = active ? '4px solid rgba(29, 80, 121, 0.96)' : '3px solid rgba(29, 80, 121, 0.9)';
        visual.style.background = OWN_DOT_COLOR;
        visual.style.boxShadow = active
            ? '0 0 0 5px rgba(255, 218, 89, 0.38), 0 0 0 10px rgba(29, 80, 121, 0.18), 0 4px 13px rgba(0,0,0,0.48)'
            : '0 0 0 4px rgba(255, 218, 89, 0.28), 0 2px 9px rgba(0,0,0,0.4)';
        ownDot.style.opacity = active ? '1' : '0.9';
        ownDot.style.zIndex = active ? '4' : '3';
        ownDot.style.transform = `translate3d(${x.toFixed(1)}px, ${y.toFixed(1)}px, 0) translate(-50%, -50%)`;
        ownDot.style.display = 'block';
    }

    private dotVisual(dot: HTMLElement): HTMLElement {
        return dot.firstElementChild instanceof HTMLElement ? dot.firstElementChild : dot;
    }

    private updateFarMapPanBounds(): void {
        if (!this.onFarMapPanBoundsChanged) return;
        if (this.screenDotsHidden) {
            this.onFarMapPanBoundsChanged(false, null);
            return;
        }
        if (this.selectedTrainId || this.ownTrainSelected) {
            this.onFarMapPanBoundsChanged(true, null);
            return;
        }

        this.farMapBounds.makeEmpty();
        if (this.ownTrainVisible) {
            this.farMapBounds.expandByPoint(this.ownTrainWorldPosition);
        }

        if (this.summary) {
            const renderTs = Date.now() - RENDER_DELAY_MS;
            for (const train of this.summary.trains) {
                const position = this.dotWorldPositionForTrain(train, renderTs);
                if (position) this.farMapBounds.expandByPoint(position);
            }
        }

        if (this.farMapBounds.isEmpty()) {
            this.onFarMapPanBoundsChanged(false, null);
            return;
        }

        this.farMapBounds.expandByScalar(FAR_MAP_BOUNDS_PADDING_M);
        this.onFarMapPanBoundsChanged(true, this.farMapBounds);
    }

    private renderCars(): void {
        if (!this.highDetailActive) {
            this.proxyMeshes.clear();
            return;
        }

        const renderTs = Date.now() - RENDER_DELAY_MS;
        let totalCount = 0;
        this.proxyMeshes.beginFrame();
        const renderIds = Array.from(this.tracker.allIds());
        if (this.selectedTrainId) {
            const selectedIndex = renderIds.indexOf(this.selectedTrainId);
            if (selectedIndex > 0) {
                renderIds.splice(selectedIndex, 1);
                renderIds.unshift(this.selectedTrainId);
            }
        }

        for (const id of renderIds) {
            if (!this.shouldRenderHighDetailTrain(id)) continue;
            const spec = this.trainRenderSpecFor(id);
            if (totalCount + spec.carCount > MAX_CAR_INSTANCES && id !== this.selectedTrainId) continue;
            const poses = this.carPosesFor(id, renderTs, spec);
            if (!poses) continue;
            for (let poseIndex = 0; poseIndex < poses.length; poseIndex++) {
                if (totalCount >= MAX_CAR_INSTANCES) break;
                const pose = poses[poseIndex];
                const isSingleCarTrain = poses.length === 1;
                const isFrontCab = poseIndex === 0;
                const isRearCab = poseIndex === poses.length - 1;
                const shape: ProxyCarShape = isSingleCarTrain
                    ? 'doubleCab'
                    : isFrontCab
                        ? 'frontCab'
                        : isRearCab
                            ? 'rearCab'
                            : 'wagon';

                if (this.writeCarMatrix(pose, shape, id)) {
                    totalCount++;
                }
            }
        }
        this.proxyMeshes.endFrame();
    }

    private shouldRenderHighDetailTrain(id: string): boolean {
        if (id === this.selectedTrainId) return true;
        const train = this.trainById(id);
        return !!train && this.trainInsideActiveWindow(train);
    }

    private trainRenderSpecFor(id: string): TrainRenderSpec {
        const consist = this.consists.get(id) ?? this.consists.get(id.replace(/^ns:/i, '')) ?? null;
        const rawCarCount = Number(consist?.carCount);
        const carCount = Number.isFinite(rawCarCount)
            ? Math.max(1, Math.min(MAX_CARS_PER_TRAIN, Math.round(rawCarCount)))
            : DEFAULT_CAR_COUNT;

        const lengthM = Number(consist?.lengthM);
        if (Number.isFinite(lengthM) && lengthM > carCount * 8) {
            const spacing = lengthM / carCount;
            const carLengthM = Math.max(10, Math.min(30, spacing * 0.9));
            const centerOffsetsM = Array.from({ length: carCount }, (_, i) => spacing * (i + 0.5));
            return { carCount, carLengthM, centerOffsetsM, consistLengthM: lengthM };
        }

        const carLengthM = CAR_LENGTH_M;
        const centerOffsetsM = Array.from({ length: carCount }, (_, i) =>
            (carLengthM / 2) + i * (carLengthM + CAR_GAP_M)
        );
        return {
            carCount,
            carLengthM,
            centerOffsetsM,
            consistLengthM: centerOffsetsM[centerOffsetsM.length - 1] + carLengthM / 2,
        };
    }

    private carPosesFor(id: string, renderTs: number, spec: TrainRenderSpec): CarPose[] | null {
        const state = this.stateByTrain.get(id) ?? {};
        this.stateByTrain.set(id, state);

        const offsets: number[] = [];
        for (const centerOffset of spec.centerOffsetsM) {
            offsets.push(Math.max(0, centerOffset - spec.carLengthM / 2));
            offsets.push(centerOffset);
            offsets.push(centerOffset + spec.carLengthM / 2);
        }
        const samples = this.tracker.samplesAtOffsets(id, renderTs, offsets);
        if (!samples) return this.recentHeldPoses(state);

        const head = samples[0];
        const playback = this.tracker.playbackAt(id, renderTs);
        const routeKey = playback?.routeKey ?? head.routeKey;
        const routeDistanceM = playback?.routeDistanceM ?? head.routeDistanceM;
        const bearing = playback?.bearing ?? head.bearing;

        const poses: CarPose[] = [];
        for (let i = 0; i < spec.carCount; i++) {
            const front = samples[i * 3];
            const center = samples[i * 3 + 1];
            const rear = samples[i * 3 + 2];
            if (!front || !center || !rear) return this.recentHeldPoses(state);
            poses.push({ front, center, rear, lengthM: spec.carLengthM });
        }
        if (poses.length === 0) return this.recentHeldPoses(state);

        if (state.acceptedBearing != null && angleDeltaDeg(bearing, state.acceptedBearing) > REVERSE_ANGLE_DEG) {
            if (state.reverseRouteKey !== routeKey) {
                state.reverseRouteKey = routeKey;
                state.heldPoses = state.lastPoses;
            }
            if (routeDistanceM < spec.consistLengthM && state.heldPoses?.length) {
                return state.heldPoses;
            }
        } else {
            state.reverseRouteKey = undefined;
        }

        state.acceptedBearing = bearing;
        state.lastPoses = poses;
        state.lastPosesAt = performance.now();
        state.heldPoses = undefined;
        return poses;
    }

    private recentHeldPoses(state: ConsistRenderState): CarPose[] | null {
        if (!state.lastPoses || state.lastPosesAt == null) return null;
        return performance.now() - state.lastPosesAt < POSE_HOLD_MS ? state.lastPoses : null;
    }

    private writeCarMatrix(
        pose: CarPose,
        shape: ProxyCarShape,
        trainId: string,
    ): boolean {
        const center = this.worldPositionFor(pose.center);
        const front = this.worldPositionFor(pose.front);
        const rear = this.worldPositionFor(pose.rear);
        if (!center || !front || !rear || front.distanceToSquared(rear) < 0.01) return false;

        tmpA.copy(rear);
        tmpB.copy(front);
        dummy.position.copy(tmpA);
        dummy.lookAt(tmpB);
        const q = dummy.quaternion.clone();

        dummy.position.copy(center);
        dummy.quaternion.copy(q);
        dummy.scale.set(1, 1, Math.max(0.1, pose.lengthM / CAR_LENGTH_M));
        dummy.updateMatrix();
        matrix.copy(dummy.matrix);
        return this.proxyMeshes.write(shape, trainId, matrix);
    }

    private worldPositionFor(sample: ConsistSample): Vector3 | null {
        return this.worldPositionForGeo(sample);
    }

    private worldPositionForGeo(sample: { lon: number; lat: number; worldOffset?: [number, number, number] }): Vector3 | null {
        if (sample.worldOffset) {
            const wp = routePointToWorldPosition([
                sample.lon,
                sample.lat,
                sample.worldOffset[0],
                sample.worldOffset[1],
                sample.worldOffset[2],
            ], this.mapViewer);
            if (wp) return wp;
        }
        return this.mapViewer.latLonHeightToWorldPosition(sample.lat, sample.lon, FALLBACK_RAIL_HEIGHT_M);
    }

    private followTargetForGeo(sample: { lon: number; lat: number; worldOffset?: [number, number, number] }): Vector3 | null {
        const railPosition = this.worldPositionForGeo(sample);
        if (!railPosition) return null;

        this.followTargetWorldPosition.copy(railPosition);
        this.followTargetWorldPosition.y += FOLLOW_TARGET_LIFT_M;
        return this.followTargetWorldPosition;
    }

    private pickLiveTrainFromClick(event: MouseEvent): void {
        if (!this.started) return;
        if (!(event.target instanceof HTMLCanvasElement)) return;

        if (!this.screenDotsHidden) {
            event.preventDefault();
            event.stopPropagation();
            this.deselectTrain();
            return;
        }

        if (!this.highDetailActive || this.proxyMeshes.count() <= 0) return;

        const rect = event.target.getBoundingClientRect();
        this.pointerNdc.set(
            ((event.clientX - rect.left) / rect.width) * 2 - 1,
            -((event.clientY - rect.top) / rect.height) * 2 + 1,
        );
        this.raycaster.setFromCamera(this.pointerNdc, this.camera);
        const id = this.proxyMeshes.pick(this.raycaster);
        if (!id) return;
        event.preventDefault();
        event.stopPropagation();
        this.selectLiveTrain(id);
    }

    private async fetchMissingConsists(ids: Set<string>): Promise<void> {
        const candidates = [...ids]
            .filter(id => id.startsWith('ns:'))
            .filter(id => !this.consists.has(id) && !this.consistInflightIds.has(id))
            .slice(0, 30);
        if (candidates.length === 0) return;

        for (const id of candidates) this.consistInflightIds.add(id);
        this.consistAbort?.abort();
        this.consistAbort = new AbortController();
        try {
            const response = await fetchLiveConsists(candidates, { signal: this.consistAbort.signal });
            for (const id of candidates) {
                const ritnummer = id.replace(/^ns:/i, '');
                this.consists.set(id, response.consists[ritnummer] ?? null);
            }
        } catch (err) {
            if ((err as any)?.name !== 'AbortError') {
                console.warn('[LiveTrainOverlay] live train consist fetch failed', err);
            }
        } finally {
            for (const id of candidates) this.consistInflightIds.delete(id);
        }
    }
}
