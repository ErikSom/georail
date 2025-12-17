import { Mesh, ConeGeometry, MeshBasicMaterial, GreaterDepth } from 'three';

// Shared geometries and materials (created once, used by all NodeIndicator instances)
const sharedGeometry = (() => {
    const geometry = new ConeGeometry(2, 4, 4);
    // Rotate geometry so cone points down (-Y) but local Z points forward (+Z)
    geometry.rotateX(Math.PI); // Flip to point down
    geometry.rotateY(Math.PI / 4); // Rotate to align with forward direction
    // Translate geometry up by half its height so the tip sits on the floor
    geometry.translate(0, 2, 0); // Height is 4, so translate up by 4/2 = 2
    return geometry;
})();

const sharedMaterials = {
    normal: new MeshBasicMaterial({ color: 0x00ff00, wireframe: false }),
    keyNode: new MeshBasicMaterial({ color: 0xff0000, wireframe: false }),
    selected: new MeshBasicMaterial({ color: 0xffff00, wireframe: false }),
    xray: new MeshBasicMaterial({
        color: 0xff69b4,
        transparent: true,
        opacity: 0.8,
        depthFunc: GreaterDepth,
        depthWrite: false,
    }),
};

export type NodeMode = 'normal' | 'keyNode' | 'selected';

export class NodeIndicator {
    public mesh: Mesh;
    private xrayMesh: Mesh;
    private currentMode: NodeMode = 'normal';

    constructor(scale: number = 1) {
        // Create main mesh with shared geometry and normal material
        this.mesh = new Mesh(sharedGeometry, sharedMaterials.normal);
        this.mesh.scale.set(scale, scale, scale);

        // Add x-ray overlay mesh as child (renders through geometry)
        this.xrayMesh = new Mesh(sharedGeometry, sharedMaterials.xray);
        this.xrayMesh.scale.set(scale, scale, scale);
        this.xrayMesh.renderOrder = -1; // Render before main mesh
        this.mesh.add(this.xrayMesh);
    }

    /**
     * Set the visual mode of the node indicator
     * @param mode - 'normal' (green), 'keyNode' (red), or 'selected' (yellow)
     */
    public setMode(mode: NodeMode): void {
        this.currentMode = mode;
        this.mesh.material = sharedMaterials[mode];
    }

    /**
     * Get the current mode
     */
    public getMode(): NodeMode {
        return this.currentMode;
    }

    /**
     * Dispose of this indicator (mesh will need to be removed from scene separately)
     */
    public dispose(): void {
        // Don't dispose shared geometry or materials
        // Just remove the x-ray mesh from parent
        this.mesh.remove(this.xrayMesh);
    }

    /**
     * Static method to dispose shared resources (call when completely done with all NodeIndicators)
     */
    public static disposeSharedResources(): void {
        sharedGeometry.dispose();
        Object.values(sharedMaterials).forEach(material => material.dispose());
    }
}
