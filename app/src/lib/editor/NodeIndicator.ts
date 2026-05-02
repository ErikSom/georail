import { Mesh, ConeGeometry, MeshBasicMaterial, GreaterDepth, SphereGeometry, Color } from 'three';

const sharedGeometry = (() => {
    const geometry = new ConeGeometry(2, 4, 4);
    geometry.rotateX(Math.PI);
    geometry.rotateY(Math.PI / 4);
    geometry.translate(0, 2, 0);
    return geometry;
})();

const sharedKeyNodeBadgeGeometry = new SphereGeometry(0.6, 8, 6);
const sharedKeyNodeBadgeMaterial = new MeshBasicMaterial({ color: 0xff0000 });

const sharedMaterials = {
    normal: new MeshBasicMaterial({ color: 0x00ff00, wireframe: false }),
    selected: new MeshBasicMaterial({ color: 0xffff00, wireframe: false }),
    station: new MeshBasicMaterial({ color: 0x00bfff, wireframe: false }),
};

function createXrayMaterial(color: number | Color): MeshBasicMaterial {
    return new MeshBasicMaterial({
        color,
        transparent: true,
        opacity: 0.55,
        depthFunc: GreaterDepth,
        depthWrite: false,
    });
}

export type NodeMode = 'normal' | 'keyNode' | 'selected' | 'station';

export class NodeIndicator {
    public mesh: Mesh;
    private xrayMesh: Mesh;
    private xrayMaterial: MeshBasicMaterial;
    private keyNodeBadge: Mesh;
    private currentMode: NodeMode = 'normal';
    private baseMaterial: MeshBasicMaterial;

    constructor(scale: number = 1, baseColor?: Color) {
        this.baseMaterial = baseColor ? new MeshBasicMaterial({ color: baseColor }) : sharedMaterials.normal;
        this.xrayMaterial = createXrayMaterial(baseColor ?? 0xff69b4);

        this.mesh = new Mesh(sharedGeometry, this.baseMaterial);
        this.mesh.scale.set(scale, scale, scale);

        this.xrayMesh = new Mesh(sharedGeometry, this.xrayMaterial);
        this.xrayMesh.renderOrder = -1;
        this.mesh.add(this.xrayMesh);

        this.keyNodeBadge = new Mesh(sharedKeyNodeBadgeGeometry, sharedKeyNodeBadgeMaterial);
        this.keyNodeBadge.position.set(0, 5.5, 0);
        this.keyNodeBadge.visible = false;
        this.mesh.add(this.keyNodeBadge);
    }

    public setMode(mode: NodeMode): void {
        this.currentMode = mode;
        switch (mode) {
            case 'normal':
                this.mesh.material = this.baseMaterial;
                this.keyNodeBadge.visible = false;
                break;
            case 'keyNode':
                this.mesh.material = this.baseMaterial;
                this.keyNodeBadge.visible = true;
                break;
            case 'selected':
                this.mesh.material = sharedMaterials.selected;
                // Preserve badge state — selected can apply to keynodes too
                break;
            case 'station':
                this.mesh.material = sharedMaterials.station;
                this.keyNodeBadge.visible = false;
                break;
        }
    }

    public getMode(): NodeMode {
        return this.currentMode;
    }

    /** Per-chain colour used in 'normal' and 'keyNode' modes. The xray overlay tracks the same colour. */
    public setBaseMaterial(material: MeshBasicMaterial): void {
        this.baseMaterial = material;
        this.xrayMaterial.color.copy(material.color);
        if (this.currentMode === 'normal' || this.currentMode === 'keyNode') {
            this.mesh.material = material;
        }
    }

    public dispose(): void {
        this.mesh.remove(this.xrayMesh);
        this.mesh.remove(this.keyNodeBadge);
        this.xrayMaterial.dispose();
    }

    public static disposeSharedResources(): void {
        sharedGeometry.dispose();
        sharedKeyNodeBadgeGeometry.dispose();
        sharedKeyNodeBadgeMaterial.dispose();
        Object.values(sharedMaterials).forEach(material => material.dispose());
    }
}
