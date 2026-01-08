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
    Matrix4,
    MeshStandardMaterial,
    Mesh,
    PlaneGeometry,
    MeshBasicMaterial,
    Quaternion
} from 'three';
import { DRACOLoader } from 'three/examples/jsm/loaders/DRACOLoader.js';
import { type PerformanceConfig } from './utils/PerformanceConfig';

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

    private tempMatrix = new Matrix4();
    private tempVec = new Vector3();
    private tempCartographic = { lat: 0, lon: 0, height: 0 };

    constructor() { }

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
        // Don't set initialized here - wait for tiles to load
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
        }));

        // Use provided coordinates or fall back to default location
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

        // Apply performance config to tiles
        if (this.perfConfig) {
            console.log("default error target:", this.tiles.errorTarget, "default max depth:", this.tiles.maxDepth);


            this.tiles.errorTarget = this.perfConfig.tilesErrorTarget;
            this.tiles.maxDepth = this.perfConfig.tilesMaxDepth;
            // this.tiles.displayActiveTiles = false;
        }

        // Replace unlit materials with lit materials to enable sun/moon lighting
        this.tiles.addEventListener('load-model', ({ scene }) => {
            scene.traverse((child: any) => {
                if (child.isMesh) {
                    // Disable shadow casting and receiving
                    child.castShadow = false;
                    child.receiveShadow = false;

                    // Google 3D tiles often lack normals. We must calculate them
                    // for MeshStandardMaterial to react to light.
                    if (child.geometry && !child.geometry.attributes.normal) {
                        child.geometry.computeVertexNormals();
                    }
                    if (child.material) {
                        const oldMaterial = child.material;

                        // Only replace if it's an unlit material (MeshBasicMaterial)
                        if (oldMaterial.isMeshBasicMaterial) {
                            const newMaterial = new MeshStandardMaterial({
                                map: oldMaterial.map,
                                color: oldMaterial.color,
                                opacity: oldMaterial.opacity,
                                transparent: oldMaterial.transparent,
                                side: oldMaterial.side,
                                metalness: 0.0,
                                roughness: 1.0,
                                flatShading: true,
                            });

                            newMaterial.needsUpdate = true;
                            child.material = newMaterial;
                            oldMaterial.dispose();
                        }
                    }
                }
            });
        });

        this.scene.add(this.tiles.group);

        // Create ground plane at altitude 30 using proper geodetic positioning
        this.createGroundPlane(finalLat, finalLon, -1000);

        this.tiles.setResolutionFromRenderer(this.camera, this.renderer);
        this.tiles.setCamera(this.camera);

        // Mark as initialized after initial tiles have loaded
        this.tiles.addEventListener('tiles-load-end', () => {
            if (!this.initialized) {
                this.initialized = true;
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

        // Dispose old ground plane if exists
        if (this.groundPlane) {
            this.tiles.group.remove(this.groundPlane);
            this.groundPlane.geometry.dispose();
            (this.groundPlane.material as MeshBasicMaterial).dispose();
        }

        // Create large plane geometry
        const planeGeometry = new PlaneGeometry(1e5, 1e5);
        const planeMaterial = new MeshBasicMaterial({
            color: 0x000000,
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