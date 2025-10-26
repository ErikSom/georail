import { GeoUtils, WGS84_ELLIPSOID, TilesRenderer } from '3d-tiles-renderer';
import {
    TilesFadePlugin,
    TileCompressionPlugin,
    GLTFExtensionsPlugin,
    GoogleCloudAuthPlugin,
    ReorientationPlugin,
    DebugTilesPlugin
} from '3d-tiles-renderer/plugins';
import {
    Scene,
    WebGLRenderer,
    PerspectiveCamera,
    Vector3,
    MathUtils,
    Matrix4
} from 'three';
import { DRACOLoader } from 'three/examples/jsm/loaders/DRACOLoader.js';

const getDracoDecoderPath = (): string => {
    return 'https://unpkg.com/three@0.180.0/examples/jsm/libs/draco/gltf/';
};

export class MapViewer {
    private scene: Scene | null = null;
    private camera: PerspectiveCamera | null = null;
    private renderer: WebGLRenderer | null = null;

    public tiles: TilesRenderer | null = null;
    private reorientationPlugin: ReorientationPlugin | null = null;

    private tempMatrix = new Matrix4();
    private tempVec = new Vector3();
    private tempCartographic = { lat: 0, lon: 0, height: 0 };

    constructor() { }

    public init(
        scene: Scene,
        camera: PerspectiveCamera,
        renderer: WebGLRenderer
    ): void {
        this.scene = scene;
        this.camera = camera;
        this.renderer = renderer;

        this.reinstantiateTiles();
    }

    public cleanup(): void {
        this.tiles?.dispose();
        this.scene = null;
        this.camera = null;
        this.renderer = null;
        this.tiles = null;
        this.reorientationPlugin = null;
    }

    private reinstantiateTiles(): void {
        if (!this.scene || !this.camera || !this.renderer) return;

        this.tiles?.dispose();

        this.tiles = new TilesRenderer();

        this.tiles.registerPlugin(new GoogleCloudAuthPlugin({
            apiToken: import.meta.env.PUBLIC_GOOGLE_MAPS_API_KEY,
            autoRefreshToken: true
        }));
        this.tiles.registerPlugin(new TileCompressionPlugin());
        this.tiles.registerPlugin(new TilesFadePlugin());
        this.tiles.registerPlugin(new DebugTilesPlugin({ displayBoxBounds: true }));
        this.tiles.registerPlugin(new GLTFExtensionsPlugin({
            dracoLoader: new DRACOLoader().setDecoderPath(getDracoDecoderPath())
        }));

        const { lat, lon } = this.getInitialLocation();

        this.reorientationPlugin = new ReorientationPlugin({
            lat: lat * MathUtils.DEG2RAD,
            lon: lon * MathUtils.DEG2RAD,
        });
        this.tiles.registerPlugin(this.reorientationPlugin);

        this.scene.add(this.tiles.group);

        this.tiles.setResolutionFromRenderer(this.camera, this.renderer);
        this.tiles.setCamera(this.camera);

        console.log("MapViewer initialized and tiles created.");
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

    public reorient(lat: number, lon: number, height: number = 0): void {
        if (!this.reorientationPlugin) {
            console.error("ReorientationPlugin not initialized.");
            return;
        }
        console.log(`Reorienting map to Lat: ${lat}, Lon: ${lon}, Height: ${height}`);
        this.reorientationPlugin.transformLatLonHeightToOrigin(
            lat * MathUtils.DEG2RAD,
            lon * MathUtils.DEG2RAD,
            height
        );
        this.tiles?.group.updateMatrixWorld(true);
    }

    public getLatLonHeightFromWorldPosition(worldPosition: Vector3): { lat: number, lon: number, height: number } | null {
        if (!this.tiles) {
            console.warn("TilesRenderer not available for coordinate conversion.");
            return null;
        }

        this.tempMatrix.copy(this.tiles.group.matrixWorld).invert();
        this.tempVec.copy(worldPosition).applyMatrix4(this.tempMatrix);

        WGS84_ELLIPSOID.getPositionToCartographic(this.tempVec, this.tempCartographic);

        return {
            lat: MathUtils.radToDeg(this.tempCartographic.lat),
            lon: MathUtils.radToDeg(this.tempCartographic.lon),
            height: this.tempCartographic.height ?? 0
        };
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
        this.tiles.setResolutionFromRenderer(this.camera, this.renderer);
        this.tiles.update();
    }

    public getCredits(): string {
        if (!this.tiles || !this.camera) {
            return '';
        }

        this.tempMatrix.copy(this.tiles.group.matrixWorld).invert();
        this.tempVec.copy(this.camera.position).applyMatrix4(this.tempMatrix);

        WGS84_ELLIPSOID.getPositionToCartographic(this.tempVec, this.tempCartographic);

        const attributions = this.tiles.getAttributions()
            .map(a => a.value)
            .filter(Boolean)
            .join(', ');

        // @ts-ignore - GeoUtils types might be outdated or incorrect
        const latLonStr = GeoUtils.toLatLonString(this.tempCartographic.lat, this.tempCartographic.lon, true);

        return `${latLonStr}\n${attributions}`;
    }
}