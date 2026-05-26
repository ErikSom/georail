import {
    AdditiveBlending,
    BufferGeometry,
    DoubleSide,
    Float32BufferAttribute,
    Group,
    InstancedMesh,
    Matrix4,
    MeshBasicMaterial,
    Raycaster,
} from 'three';

export type ProxyCarShape = 'wagon' | 'frontCab' | 'rearCab' | 'doubleCab';

export interface LiveTrainProxyMeshesOptions {
    maxInstances: number;
    carWidthM: number;
    carHeightM: number;
    carLengthM: number;
    bodyColor: number;
    wireColor: number;
    bodyOpacity: number;
    wireOpacity: number;
}

interface MeshPool {
    body: InstancedMesh;
    wire: InstancedMesh;
    ids: string[];
    count: number;
}

function createHologramTrainCarGeometry(
    widthM: number,
    heightM: number,
    lengthM: number,
    shape: ProxyCarShape,
): BufferGeometry {
    const halfWidth = widthM / 2;
    const halfLength = lengthM / 2;
    const noseLengthM = Math.min(5.4, lengthM * 0.28);
    const roofShoulderY = heightM * 0.68;
    const roofHalfWidth = widthM * 0.24;

    const section = (z: number, scale: number, heightScale: number, noseDrop = 0): Array<[number, number, number]> => {
        const sideY = roofShoulderY * heightScale;
        const topY = heightM * heightScale - noseDrop;
        return [
            [-halfWidth * scale, 0, z],
            [halfWidth * scale, 0, z],
            [halfWidth * scale, sideY, z],
            [roofHalfWidth * scale, topY, z],
            [-roofHalfWidth * scale, topY, z],
            [-halfWidth * scale, sideY, z],
        ];
    };

    const hasFrontNose = shape === 'frontCab' || shape === 'doubleCab';
    const hasRearNose = shape === 'rearCab' || shape === 'doubleCab';
    const frontNoseStart = halfLength - noseLengthM;
    const rearNoseStart = -halfLength + noseLengthM;
    const sections: Array<Array<[number, number, number]>> = [];

    if (hasRearNose) {
        sections.push(section(-halfLength, 0.30, 0.45, heightM * 0.18));
        sections.push(section(-halfLength + noseLengthM * 0.45, 0.70, 0.82, heightM * 0.05));
        sections.push(section(rearNoseStart, 1, 1));
    } else {
        sections.push(section(-halfLength, 0.92, 0.92));
        sections.push(section(-halfLength + Math.min(1.2, lengthM * 0.08), 1, 1));
    }

    const bodyStart = hasRearNose ? rearNoseStart : -halfLength + Math.min(1.2, lengthM * 0.08);
    const bodyEnd = hasFrontNose ? frontNoseStart : halfLength - Math.min(1.2, lengthM * 0.08);
    if (bodyEnd - bodyStart > 1) {
        sections.push(section((bodyStart + bodyEnd) / 2, 1, 1));
    }

    if (hasFrontNose) {
        sections.push(section(frontNoseStart, 1, 1));
        sections.push(section(halfLength - noseLengthM * 0.45, 0.70, 0.82, heightM * 0.05));
        sections.push(section(halfLength, 0.30, 0.45, heightM * 0.18));
    } else {
        sections.push(section(halfLength - Math.min(1.2, lengthM * 0.08), 1, 1));
        sections.push(section(halfLength, 0.92, 0.92));
    }

    const vertices: number[] = [];
    const pushVertex = (v: [number, number, number]) => vertices.push(v[0], v[1], v[2]);
    const pushTri = (a: [number, number, number], b: [number, number, number], c: [number, number, number]) => {
        pushVertex(a);
        pushVertex(b);
        pushVertex(c);
    };

    for (let sectionIndex = 0; sectionIndex < sections.length - 1; sectionIndex++) {
        const a = sections[sectionIndex];
        const b = sections[sectionIndex + 1];
        for (let i = 0; i < a.length; i++) {
            const next = (i + 1) % a.length;
            pushTri(a[i], a[next], b[next]);
            pushTri(a[i], b[next], b[i]);
        }
    }

    const cap = (points: Array<[number, number, number]>, reverse = false) => {
        const center: [number, number, number] = [
            points.reduce((sum, point) => sum + point[0], 0) / points.length,
            points.reduce((sum, point) => sum + point[1], 0) / points.length,
            points[0][2],
        ];
        for (let i = 0; i < points.length; i++) {
            const next = (i + 1) % points.length;
            if (reverse) {
                pushTri(center, points[next], points[i]);
            } else {
                pushTri(center, points[i], points[next]);
            }
        }
    };
    cap(sections[0], true);
    cap(sections[sections.length - 1]);

    const geometry = new BufferGeometry();
    geometry.setAttribute('position', new Float32BufferAttribute(vertices, 3));
    geometry.computeVertexNormals();
    geometry.computeBoundingBox();
    geometry.computeBoundingSphere();
    return geometry;
}

export class LiveTrainProxyMeshes {
    public readonly group = new Group();

    private readonly maxInstances: number;
    private readonly bodyMaterial: MeshBasicMaterial;
    private readonly wireMaterial: MeshBasicMaterial;
    private readonly pools: Record<ProxyCarShape, MeshPool>;

    constructor(options: LiveTrainProxyMeshesOptions) {
        this.maxInstances = options.maxInstances;
        this.bodyMaterial = new MeshBasicMaterial({
            color: options.bodyColor,
            transparent: true,
            opacity: options.bodyOpacity,
            depthWrite: false,
            side: DoubleSide,
        });
        this.wireMaterial = new MeshBasicMaterial({
            color: options.wireColor,
            transparent: true,
            opacity: options.wireOpacity,
            depthWrite: false,
            wireframe: true,
            blending: AdditiveBlending,
        });

        this.pools = {
            wagon: this.createPool('wagon', options),
            frontCab: this.createPool('frontCab', options),
            rearCab: this.createPool('rearCab', options),
            doubleCab: this.createPool('doubleCab', options),
        };
    }

    public beginFrame(): void {
        for (const pool of Object.values(this.pools)) {
            pool.count = 0;
            pool.ids.length = 0;
        }
    }

    public write(shape: ProxyCarShape, trainId: string, matrix: Matrix4): boolean {
        const pool = this.pools[shape];
        if (pool.count >= this.maxInstances) return false;
        pool.body.setMatrixAt(pool.count, matrix);
        pool.wire.setMatrixAt(pool.count, matrix);
        pool.ids[pool.count] = trainId;
        pool.count++;
        return true;
    }

    public endFrame(): void {
        for (const pool of Object.values(this.pools)) {
            pool.body.count = pool.count;
            pool.wire.count = pool.count;
            pool.body.instanceMatrix.needsUpdate = true;
            pool.wire.instanceMatrix.needsUpdate = true;
        }
    }

    public clear(): void {
        this.beginFrame();
        this.endFrame();
    }

    public count(): number {
        return Object.values(this.pools).reduce((sum, pool) => sum + pool.count, 0);
    }

    public pick(raycaster: Raycaster): string | null {
        const hits = Object.values(this.pools)
            .flatMap(pool => raycaster.intersectObject(pool.body, false)
                .filter(hit => typeof hit.instanceId === 'number' && hit.instanceId < pool.body.count)
                .map(hit => ({ hit, ids: pool.ids })))
            .sort((a, b) => a.hit.distance - b.hit.distance);
        const instanceId = hits[0]?.hit.instanceId;
        return typeof instanceId === 'number' ? hits[0]?.ids[instanceId] ?? null : null;
    }

    public dispose(): void {
        for (const pool of Object.values(this.pools)) {
            pool.body.geometry.dispose();
        }
        this.bodyMaterial.dispose();
        this.wireMaterial.dispose();
        this.group.parent?.remove(this.group);
    }

    private createPool(shape: ProxyCarShape, options: LiveTrainProxyMeshesOptions): MeshPool {
        const geometry = createHologramTrainCarGeometry(options.carWidthM, options.carHeightM, options.carLengthM, shape);
        const body = new InstancedMesh(geometry, this.bodyMaterial, this.maxInstances);
        body.count = 0;
        body.frustumCulled = false;
        body.renderOrder = 8;

        const wire = new InstancedMesh(geometry, this.wireMaterial, this.maxInstances);
        wire.count = 0;
        wire.frustumCulled = false;
        wire.renderOrder = 9;

        this.group.add(body);
        this.group.add(wire);
        return { body, wire, ids: [], count: 0 };
    }
}
