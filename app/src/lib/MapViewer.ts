import { GeoUtils, WGS84_ELLIPSOID, TilesRenderer } from '3d-tiles-renderer';
import {
    TilesFadePlugin,
    TileCompressionPlugin,
    GLTFExtensionsPlugin,
    GoogleCloudAuthPlugin,
    ReorientationPlugin,
    BatchedTilesPlugin,
} from '3d-tiles-renderer/plugins';
import {
    Scene,
    WebGLRenderer,
    PerspectiveCamera,
    Vector3,
    MathUtils,
    Matrix4,
    MeshStandardMaterial,
    Mesh,
    PlaneGeometry,
    MeshBasicMaterial,
    Quaternion,
    AlwaysStencilFunc,
    ReplaceStencilOp,
    KeepStencilOp,
} from 'three';
import { DRACOLoader } from 'three/examples/jsm/loaders/DRACOLoader.js';
import { type PerformanceConfig } from './utils/PerformanceConfig';
import { ATMOSPHERE_COLOR } from '../store/globals';
import type { Tiles3DAttributionCredits } from '../components/HUD/Tiles3DAttribution';

const getDracoDecoderPath = (): string => {
    return 'https://unpkg.com/three@0.180.0/examples/jsm/libs/draco/gltf/';
};

export class MapViewer {
    private scene: Scene | null = null;
    private camera: PerspectiveCamera | null = null;
    private renderer: WebGLRenderer | null = null;
    private perfConfig: PerformanceConfig | null = null;

    public tiles: TilesRenderer | null = null;
    private reorientationPlugin: ReorientationPlugin | null = null;
    private groundPlane: Mesh | null = null;
    public initialized: boolean = false;

    // Reorientation origin tracking
    private originLat = 0;
    private originLon = 0;
    private static readonly REORIENT_THRESHOLD_M = 50_000; // 50km

    /** Called after automatic reorientation with the delta transform matrix. */
    public onReorient: ((deltaMatrix: Matrix4) => void) | null = null;
    public onInitialized: (() => void) | null = null;
    private reorientCheckCounter = 0;
    private static readonly REORIENT_CHECK_INTERVAL = 30;

    private tempMatrix = new Matrix4();
    private deltaMatrix = new Matrix4();
    private tempVec = new Vector3();
    private tempCartographic = { lat: 0, lon: 0, height: 0 };
    private _coordResult = { lat: 0, lon: 0, height: 0 };
    private _creditsResult: Tiles3DAttributionCredits = { latLonStr: '', source: '' };

    constructor() { }

    private applySceneStencil(mat: any): void {
        mat.stencilWrite = true;
        mat.stencilFunc = AlwaysStencilFunc;
        mat.stencilRef = 128;
        mat.stencilZPass = ReplaceStencilOp;
        mat.stencilZFail = KeepStencilOp;
        mat.stencilFail = KeepStencilOp;
    }

    public init(
        scene: Scene,
        camera: PerspectiveCamera,
        renderer: WebGLRenderer,
        lat?: number,
        lon?: number,
        height?: number,
        perfConfig?: PerformanceConfig
    ): void {
        this.scene = scene;
        this.camera = camera;
        this.renderer = renderer;
        this.perfConfig = perfConfig || null;

        this.reinstantiateTiles(lat, lon, height);
    }

    public cleanup(): void {
        this.tiles?.dispose();

        if (this.groundPlane) {
            this.groundPlane.geometry.dispose();
            (this.groundPlane.material as MeshBasicMaterial).dispose();
            this.groundPlane = null;
        }

        this.scene = null;
        this.camera = null;
        this.renderer = null;
        this.tiles = null;
        this.reorientationPlugin = null;
        this.initialized = false;
    }

    private reinstantiateTiles(lat?: number, lon?: number, height?: number): void {
        if (!this.scene || !this.camera || !this.renderer) return;

        this.tiles?.dispose();

        this.tiles = new TilesRenderer();

        this.tiles.registerPlugin(new GoogleCloudAuthPlugin({
            apiToken: import.meta.env.PUBLIC_GOOGLE_MAPS_API_KEY,
            autoRefreshToken: true
        }));
        this.tiles.registerPlugin(new TileCompressionPlugin());
        this.tiles.registerPlugin(new TilesFadePlugin());
        // this.tiles.registerPlugin(new DebugTilesPlugin({ displayBoxBounds: true }));
        this.tiles.registerPlugin(new GLTFExtensionsPlugin({
            dracoLoader: new DRACOLoader().setDecoderPath(getDracoDecoderPath())
        } as any));
        const sceneMat = new MeshStandardMaterial({
            metalness: 0.0,
            roughness: 1.0,
            flatShading: true,
        });
        this.applySceneStencil(sceneMat);

        this.tiles.registerPlugin(new BatchedTilesPlugin({
            renderer: this.renderer,
            material: sceneMat,
        } as any));

        let finalLat = lat;
        let finalLon = lon;

        if (finalLat === undefined || finalLon === undefined) {
            const defaultLocation = this.getInitialLocation();
            finalLat = defaultLocation.lat;
            finalLon = defaultLocation.lon;
        }

        this.reorientationPlugin = new ReorientationPlugin({
            lat: finalLat * MathUtils.DEG2RAD,
            lon: finalLon * MathUtils.DEG2RAD,
        });
        this.tiles.registerPlugin(this.reorientationPlugin);

        if (this.perfConfig) {
            this.tiles.errorTarget = this.perfConfig.tilesErrorTarget;
            this.tiles.maxDepth = this.perfConfig.tilesMaxDepth;
        }

        // Prepare tile meshes: reset color to white (color is baked in textures)
        // and compute normals for lighting
        this.tiles.addEventListener('load-model', ({ scene }) => {
            scene.traverse((child: any) => {
                if (child.isMesh) {
                    child.castShadow = false;
                    child.receiveShadow = false;

                    if (child.material?.color) {
                        child.material.color.setHex(0xffffff);
                    }

                    if (child.material) {
                        this.applySceneStencil(child.material);
                    }

                    if (child.geometry && !child.geometry.attributes.normal) {
                        child.geometry.computeVertexNormals();
                    }
                }
            });
        });

        this.scene.add(this.tiles.group);

        this.createGroundPlane(finalLat, finalLon, -1000);

        this.tiles.setResolutionFromRenderer(this.camera, this.renderer);
        this.tiles.setCamera(this.camera);

        this.tiles.addEventListener('tiles-load-end', () => {
            if (!this.initialized) {
                this.initialized = true;
                this.onInitialized?.();
                console.log('MapViewer initialized: Initial tiles loaded');
            }
        });
    }

    private getInitialLocation(): { lat: number, lon: number } {
        const hash = window.location.hash.replace(/^#/, '');
        const tokens = hash.split(/,/g).map(t => parseFloat(t));

        let defaultLat = 52.3792;
        let defaultLon = 4.9004;

        if (tokens.length !== 2 || tokens.some(isNaN)) {
            console.log(`Using default location: Lat ${defaultLat}, Lon ${defaultLon}`);
            return { lat: defaultLat, lon: defaultLon };
        }

        const [lat, lon] = tokens;
        console.log(`Using location from hash: Lat ${lat}, Lon ${lon}`);
        return { lat, lon };
    }

    private createGroundPlane(lat: number, lon: number, height: number): void {
        if (!this.tiles) return;

        if (this.groundPlane) {
            this.tiles.group.remove(this.groundPlane);
            this.groundPlane.geometry.dispose();
            (this.groundPlane.material as MeshBasicMaterial).dispose();
        }

        const planeGeometry = new PlaneGeometry(1e5, 1e5);
        const planeMaterial = new MeshBasicMaterial({
            color: ATMOSPHERE_COLOR,
            side: 2
        });
        this.groundPlane = new Mesh(planeGeometry, planeMaterial);
        this.groundPlane.frustumCulled = false;

        const cartographic = { lat: lat * MathUtils.DEG2RAD, lon: lon * MathUtils.DEG2RAD, height };
        const position = new Vector3();
        WGS84_ELLIPSOID.getCartographicToPosition(cartographic.lat, cartographic.lon, cartographic.height, position);

        this.groundPlane.position.copy(position);

        const normalizedPos = position.clone().normalize();
        const quaternion = new Quaternion();
        quaternion.setFromUnitVectors(new Vector3(0, 0, 1), normalizedPos);
        this.groundPlane.setRotationFromQuaternion(quaternion);

        this.tiles.group.add(this.groundPlane);

        console.log(`Ground plane created at lat: ${lat}, lon: ${lon}, height: ${height}`);
    }

    public reorient(lat: number, lon: number, height: number = 0): void {
        if (!this.reorientationPlugin) {
            console.error("ReorientationPlugin not initialized.");
            return;
        }
        this.reorientationPlugin.transformLatLonHeightToOrigin(
            lat * MathUtils.DEG2RAD,
            lon * MathUtils.DEG2RAD,
            height
        );
        this.tiles?.group.updateMatrixWorld(true);
        this.originLat = lat;
        this.originLon = lon;
    }

    /**
     * Check if a position is far enough from the current origin to warrant reorientation.
     * If so, reorient and return true so callers can recalculate positions.
     */
    private needsReorientation(lat: number, lon: number): boolean {
        const dlat = (lat - this.originLat) * 111319.49;
        const dlon = (lon - this.originLon) * 111319.49 * Math.cos(this.originLat * MathUtils.DEG2RAD);
        const distSq = dlat * dlat + dlon * dlon;
        return distSq > MapViewer.REORIENT_THRESHOLD_M * MapViewer.REORIENT_THRESHOLD_M;
    }

    public getLatLonHeightFromWorldPosition(worldPosition: Vector3): { lat: number, lon: number, height: number } | null {
        if (!this.tiles) {
            console.warn("TilesRenderer not available for coordinate conversion.");
            return null;
        }

        this.tempMatrix.copy(this.tiles.group.matrixWorld).invert();
        this.tempVec.copy(worldPosition).applyMatrix4(this.tempMatrix);

        WGS84_ELLIPSOID.getPositionToCartographic(this.tempVec, this.tempCartographic);

        this._coordResult.lat = MathUtils.radToDeg(this.tempCartographic.lat);
        this._coordResult.lon = MathUtils.radToDeg(this.tempCartographic.lon);
        this._coordResult.height = this.tempCartographic.height ?? 0;
        return this._coordResult;
    }

    public latLonHeightToWorldPosition(lat: number, lon: number, height: number): Vector3 | null {
        if (!this.tiles) {
            console.warn("TilesRenderer not available for coordinate conversion.");
            return null;
        }

        const latRad = MathUtils.degToRad(lat);
        const lonRad = MathUtils.degToRad(lon);

        WGS84_ELLIPSOID.getCartographicToPosition(latRad, lonRad, height, this.tempVec);

        this.tempVec.applyMatrix4(this.tiles.group.matrixWorld);

        return this.tempVec.clone();
    }

    public update(): void {
        if (!this.tiles || !this.camera || !this.renderer) {
            return;
        }

        // Auto-reorient when camera moves far from origin (throttled)
        if (this.onReorient && ++this.reorientCheckCounter >= MapViewer.REORIENT_CHECK_INTERVAL) {
            this.reorientCheckCounter = 0;

            this.tempMatrix.copy(this.tiles.group.matrixWorld).invert();
            this.tempVec.copy(this.camera.position).applyMatrix4(this.tempMatrix);
            WGS84_ELLIPSOID.getPositionToCartographic(this.tempVec, this.tempCartographic);
            const camLat = MathUtils.radToDeg(this.tempCartographic.lat);
            const camLon = MathUtils.radToDeg(this.tempCartographic.lon);

            if (this.needsReorientation(camLat, camLon)) {
                // Capture old matrix, reorient, compute delta
                const oldMatrixInv = this.tiles.group.matrixWorld.clone().invert();
                this.reorient(camLat, camLon, 0);
                this.deltaMatrix.copy(this.tiles.group.matrixWorld).multiply(oldMatrixInv);
                this.onReorient(this.deltaMatrix);
            }
        }

        this.tiles.setResolutionFromRenderer(this.camera, this.renderer);
        this.tiles.update();
    }

    public getCredits(): Tiles3DAttributionCredits {
        if (!this.tiles || !this.camera) {
            return null;
        }

        this.tempMatrix.copy(this.tiles.group.matrixWorld).invert();
        this.tempVec.copy(this.camera.position).applyMatrix4(this.tempMatrix);

        WGS84_ELLIPSOID.getPositionToCartographic(this.tempVec, this.tempCartographic);

        const rawAttributions = this.tiles.getAttributions();
        let attributions = '';
        for (let i = 0; i < rawAttributions.length; i++) {
            const v = rawAttributions[i].value;
            if (v) {
                if (attributions) attributions += ', ';
                attributions += v;
            }
        }

        // @ts-ignore - GeoUtils types might be outdated or incorrect
        this._creditsResult!.latLonStr = GeoUtils.toLatLonString(this.tempCartographic.lat, this.tempCartographic.lon, true);
        this._creditsResult!.source = attributions;
        return this._creditsResult;
    }
}
