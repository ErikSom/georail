import { GeoUtils, WGS84_ELLIPSOID, TilesRenderer } from '3d-tiles-renderer';
import {
    TilesFadePlugin,
    TileCompressionPlugin,
    GLTFExtensionsPlugin,
    GoogleCloudAuthPlugin,
    ReorientationPlugin
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
    return 'https://unpkg.com/three@0.153.0/examples/jsm/libs/draco/gltf/';
};

export class MapViewer {
    private scene: Scene | null = null;
    private camera: PerspectiveCamera | null = null;
    private renderer: WebGLRenderer | null = null;
 
    public tiles: TilesRenderer | null = null;
    private reorientationPlugin: ReorientationPlugin | null = null;

    private tempMatrix = new Matrix4();
    private tempVec = new Vector3();

    constructor() {}

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
    }

    private reinstantiateTiles(): void {
        if (!this.scene || !this.camera || !this.renderer) return;

        this.tiles = new TilesRenderer();
        
        this.tiles.registerPlugin(new GoogleCloudAuthPlugin({ 
            apiToken: import.meta.env.PUBLIC_GOOGLE_MAPS_API_KEY, 
            autoRefreshToken: true 
        }));
        this.tiles.registerPlugin(new TileCompressionPlugin());
        this.tiles.registerPlugin(new TilesFadePlugin());
        this.tiles.registerPlugin(new GLTFExtensionsPlugin({
            dracoLoader: new DRACOLoader().setDecoderPath(getDracoDecoderPath())
        }));

        const { lat, lon } = this.getInitiaLocation();
        
        this.reorientationPlugin = new ReorientationPlugin({
            lat: lat * MathUtils.DEG2RAD,
            lon: lon * MathUtils.DEG2RAD
        });
    
        this.tiles.registerPlugin(this.reorientationPlugin);

        this.scene.add(this.tiles.group);
        this.tiles.setResolutionFromRenderer(this.camera, this.renderer);
        this.tiles.setCamera(this.camera);
    }

    private getInitiaLocation(): { lat: number, lon: number } {
        const hash = window.location.hash.replace(/^#/, '');
        const tokens = hash.split(/,/g).map(t => parseFloat(t));
        
        if (tokens.length !== 2 || tokens.findIndex(t => Number.isNaN(t)) !== -1) {
            return { lat: 35.6586, lon: 139.7454 }; // Default: Tokyo Tower
        }
        
        const [lat, lon] = tokens;
        return { lat, lon };
    }

    public reorient(latRad: number, lonRad: number, height: number): void {
        if (!this.reorientationPlugin) return;
        this.reorientationPlugin.transformLatLonHeightToOrigin(latRad, lonRad, height);
    }

    public getLatLonHeightFromWorldPosition(worldPosition: Vector3): { lat: number, lon: number, height: number } {
        if (!this.tiles) {
            return { lat: 0, lon: 0, height: 0 };
        }
        this.tempMatrix.copy(this.tiles.group.matrixWorld).invert();
        this.tempVec.copy(worldPosition).applyMatrix4(this.tempMatrix);
        const res: { lat: number; lon: number; height?: number } = { lat: 0, lon: 0 };
        WGS84_ELLIPSOID.getPositionToCartographic(this.tempVec, res);

        return res as { lat: number, lon: number, height: number };
    }

    public update(): void {
        if (!this.tiles || !this.camera || !this.renderer) {
            return;
        }
        this.tiles.setResolutionFromRenderer(this.camera, this.renderer);
        this.tiles.setCamera(this.camera);
        this.tiles.update();
    }

    public getCredits(): string {
        if (!this.tiles || !this.camera) {
            return '';
        }

        const mat = this.tiles.group.matrixWorld.clone().invert();
        const vec = this.camera.position.clone().applyMatrix4(mat);
        
        const res: { lat: number; lon: number; height?: number } = { lat: 0, lon: 0 };
        
        WGS84_ELLIPSOID.getPositionToCartographic(vec, res);

        const attributions = this.tiles.getAttributions()
                                .map(a => a.value)
                                .filter(Boolean)
                                .join(', ');
        
        // @ts-ignore
        return GeoUtils.toLatLonString(res.lat, res.lon, true) + '\n' + attributions;
    }
}