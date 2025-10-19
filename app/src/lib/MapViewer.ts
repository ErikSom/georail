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
    // Ensure this path is correct for your setup or use a local path
    return 'https://unpkg.com/three@0.153.0/examples/jsm/libs/draco/gltf/';
};

export class MapViewer {
    private scene: Scene | null = null;
    private camera: PerspectiveCamera | null = null;
    private renderer: WebGLRenderer | null = null;

    public tiles: TilesRenderer | null = null;
    // Keep ReorientationPlugin accessible if needed, but conversion mainly uses tiles group matrix
    private reorientationPlugin: ReorientationPlugin | null = null;

    // Temporary variables for calculations
    private tempMatrix = new Matrix4();
    private tempVec = new Vector3();
    private tempCartographic = { lat: 0, lon: 0, height: 0 }; // Reusable object for conversions

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
        // Nullify references if necessary
        this.scene = null;
        this.camera = null;
        this.renderer = null;
        this.tiles = null;
        this.reorientationPlugin = null;
    }

    private reinstantiateTiles(): void {
        if (!this.scene || !this.camera || !this.renderer) return;

        // Dispose existing tiles if any before creating new ones
        this.tiles?.dispose();

        this.tiles = new TilesRenderer();

        // --- Plugins ---
        this.tiles.registerPlugin(new GoogleCloudAuthPlugin({
            apiToken: import.meta.env.PUBLIC_GOOGLE_MAPS_API_KEY,
            autoRefreshToken: true
        }));
        this.tiles.registerPlugin(new TileCompressionPlugin());
        this.tiles.registerPlugin(new TilesFadePlugin());
        this.tiles.registerPlugin(new GLTFExtensionsPlugin({
            dracoLoader: new DRACOLoader().setDecoderPath(getDracoDecoderPath())
        }));

        const { lat, lon } = this.getInitialLocation(); // Renamed for clarity

        // --- Reorientation ---
        // This plugin modifies the tiles.group matrix to center the world on lat/lon
        this.reorientationPlugin = new ReorientationPlugin({
            lat: lat * MathUtils.DEG2RAD,
            lon: lon * MathUtils.DEG2RAD,
            // You might add an initial height here if desired
        });
        this.tiles.registerPlugin(this.reorientationPlugin);

        // --- Scene Setup ---
        this.scene.add(this.tiles.group); // Add the tiles group to the main scene
        this.tiles.setResolutionFromRenderer(this.camera, this.renderer);
        this.tiles.setCamera(this.camera);

        console.log("MapViewer initialized and tiles created.");
    }

    private getInitialLocation(): { lat: number, lon: number } {
        const hash = window.location.hash.replace(/^#/, '');
        const tokens = hash.split(/,/g).map(t => parseFloat(t));

        // Default: Amsterdam Centraal Station (approximate)
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

    /**
     * Re-centers the map origin to the specified geographic coordinates.
     * @param lat Latitude in degrees.
     * @param lon Longitude in degrees.
     * @param height Altitude in meters above the WGS84 ellipsoid.
     */
    public reorient(lat: number, lon: number, height: number = 0): void {
        if (!this.reorientationPlugin) {
            console.error("ReorientationPlugin not initialized.");
            return;
        }
        console.log(`Reorienting map to Lat: ${lat}, Lon: ${lon}, Height: ${height}`);
        // transformLatLonHeightToOrigin expects radians
        this.reorientationPlugin.transformLatLonHeightToOrigin(
            lat * MathUtils.DEG2RAD,
            lon * MathUtils.DEG2RAD,
            height
        );
        // Crucial: Update the tiles group matrix immediately after reorientation
        this.tiles?.group.updateMatrixWorld(true);
    }

    /**
     * Converts a Three.js world position vector back to geographic coordinates.
     * @param worldPosition The Vector3 position in the Three.js scene.
     * @returns Object containing { lat, lon, height } in degrees and meters.
     */
    public getLatLonHeightFromWorldPosition(worldPosition: Vector3): { lat: number, lon: number, height: number } | null {
        if (!this.tiles) {
            console.warn("TilesRenderer not available for coordinate conversion.");
            return null;
        }

        // The world position needs to be transformed into the ECEF coordinate system
        // used internally by the ellipsoid calculations. This requires applying the
        // inverse of the tiles group's world matrix.
        this.tempMatrix.copy(this.tiles.group.matrixWorld).invert();
        this.tempVec.copy(worldPosition).applyMatrix4(this.tempMatrix);

        // Convert the resulting ECEF-relative position to cartographic (lat/lon/height)
        // WGS84_ELLIPSOID expects radians
        WGS84_ELLIPSOID.getPositionToCartographic(this.tempVec, this.tempCartographic);

        // Convert radians back to degrees for the return value
        return {
            lat: MathUtils.radToDeg(this.tempCartographic.lat),
            lon: MathUtils.radToDeg(this.tempCartographic.lon),
            height: this.tempCartographic.height ?? 0 // Use ?? 0 to handle potential undefined height
        };
    }

    // ---=== NEW FUNCTION ===---
    /**
     * Converts geographic coordinates (Lat/Lon/Height) to a Three.js world position vector.
     * Takes into account the current map origin set by ReorientationPlugin.
     * @param lat Latitude in degrees.
     * @param lon Longitude in degrees.
     * @param height Height in meters above the WGS84 ellipsoid.
     * @returns A Vector3 representing the position in the Three.js scene, or null if conversion fails.
     */
    public latLonHeightToWorldPosition(lat: number, lon: number, height: number): Vector3 | null {
        if (!this.tiles) {
            console.warn("TilesRenderer not available for coordinate conversion.");
            return null;
        }

        // 1. Convert input degrees to radians for the ellipsoid functions
        const latRad = MathUtils.degToRad(lat);
        const lonRad = MathUtils.degToRad(lon);

        // 2. Convert radians + height to ECEF (Earth-Centered, Earth-Fixed) coordinates
        WGS84_ELLIPSOID.getCartographicToPosition(latRad, lonRad, height, this.tempVec);
        // tempVec now holds the position in the ECEF coordinate system

        // 3. Apply the tiles group's world matrix.
        // The ReorientationPlugin modifies this matrix so that applying it to an ECEF coordinate
        // effectively transforms it into the local coordinate system of the tiles group,
        // which is the coordinate system used within the Three.js scene.
        this.tempVec.applyMatrix4(this.tiles.group.matrixWorld);
        // tempVec now holds the position relative to the scene's origin, matching Three.js coordinates

        return this.tempVec.clone(); // Return a clone to avoid issues with the temporary vector
    }
    // ---===================---


    public update(): void {
        if (!this.tiles || !this.camera || !this.renderer) {
            return;
        }
        // It's generally good practice to update the camera matrix before updating tiles
        this.camera.updateMatrixWorld();

        // Update tiles renderer
        this.tiles.setResolutionFromRenderer(this.camera, this.renderer);
        this.tiles.setCamera(this.camera);
        this.tiles.update();
    }

    public getCredits(): string {
        if (!this.tiles || !this.camera) {
            return '';
        }

        // Correctly get camera position in ECEF-relative space for GeoUtils
        this.tempMatrix.copy(this.tiles.group.matrixWorld).invert();
        this.tempVec.copy(this.camera.position).applyMatrix4(this.tempMatrix);

        WGS84_ELLIPSOID.getPositionToCartographic(this.tempVec, this.tempCartographic);

        const attributions = this.tiles.getAttributions()
            .map(a => a.value)
            .filter(Boolean) // Remove empty strings
            .join(', ');

        // GeoUtils expects radians
        // @ts-ignore - GeoUtils types might be outdated or incorrect
        const latLonStr = GeoUtils.toLatLonString(this.tempCartographic.lat, this.tempCartographic.lon, true);

        return `${latLonStr}\n${attributions}`;
    }
}