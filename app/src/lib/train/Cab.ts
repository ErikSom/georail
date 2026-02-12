import { SpotLight, SpotLightHelper, Object3D, CanvasTexture, Texture, Color } from 'three';
import { Lensflare, LensflareElement } from './Lensflare';
import type { CabConfig, LightConfig, RollingStockConfig, TrainConfig } from './TrainConfig';
import { RollingStock } from './RollingStock';
import type { FolderApi, Pane } from 'tweakpane';
import { getFolderKey } from './TrainUiUtils';

// Shared lens flare sub-textures (4x4 grid), loaded once
let lensFlareTexturesPromise: Promise<Texture[]> | null = null;

async function loadLensFlareTextures(): Promise<Texture[]> {
    if (!lensFlareTexturesPromise) {
        lensFlareTexturesPromise = new Promise<Texture[]>((resolve) => {
            const img = new Image();
            img.onload = () => {
                const cellW = img.width / 4;
                const cellH = img.height / 4;
                const textures: Texture[] = [];

                for (let row = 0; row < 4; row++) {
                    for (let col = 0; col < 4; col++) {
                        const canvas = document.createElement('canvas');
                        canvas.width = cellW;
                        canvas.height = cellH;
                        const ctx = canvas.getContext('2d')!;
                        ctx.globalAlpha = 0.3;
                        ctx.drawImage(img, col * cellW, row * cellH, cellW, cellH, 0, 0, cellW, cellH);
                        textures.push(new CanvasTexture(canvas));
                    }
                }

                resolve(textures);
            };
            img.src = '/textures/lens-flares.png';
        });
    }
    return lensFlareTexturesPromise;
}

function populateLensFlare(lensflare: Lensflare, textures: Texture[], cfg: LightConfig): void {
    const color = new Color(cfg.color);
    const size = cfg.lensFlareSize || 150;

    // Pick 2-3 random textures for variety
    const count = 2 + Math.floor(Math.random() * 2);
    const used = new Set<number>();

    for (let i = 0; i < count; i++) {
        let idx: number;
        do {
            idx = Math.floor(Math.random() * textures.length);
        } while (used.has(idx) && used.size < textures.length);
        used.add(idx);

        const elementSize = i === 0 ? size : size * (0.3 + Math.random() * 0.4);
        lensflare.addElement(new LensflareElement(textures[idx], elementSize, 0, color));
    }
}

export class Cab extends RollingStock {
    override config: CabConfig;
    private rearCab: boolean;
    private spotLights: SpotLight[] = [];
    private spotLightHelpers: SpotLightHelper[] = [];
    private lensFlares: Lensflare[] = [];

    constructor(config: CabConfig, rearCab: boolean = false, debug: boolean = false) {
        super(config, debug);
        this.config = config;
        this.rearCab = rearCab;
        this.debugPaneName = this.rearCab ? 'Rear Cab' : 'Front Cab';
    }

    protected getConfigTarget(config: TrainConfig): RollingStockConfig {
        return this.rearCab ? (config.rearCab as CabConfig) : config.cab;
    }

    public override updateConfig(config: RollingStockConfig): void {
        super.updateConfig(config);
        this.rebuildLights();
    }

    public override createDebugUI(
        pane: Pane | FolderApi,
        config: TrainConfig,
        updateConfig: (config: TrainConfig) => void,
        _onDelete: (() => void) | null,
        _onDuplicate: (() => void) | null,
        registerFolder: (folder: FolderApi, key: string) => void,
        folderPath: string[],
        getFolderExpanded: (key: string, fallback: boolean) => boolean
    ): FolderApi {
        const cabFolder = super.createDebugUI(pane, config, updateConfig, _onDelete, _onDuplicate, registerFolder, folderPath, getFolderExpanded);

        // Find the "Lights" folder and add spot light controls
        const lightsFolder = (cabFolder.children as any[]).find(
            (child: any) => child.title === 'Lights'
        ) as FolderApi | undefined;

        if (lightsFolder) {
            const basePath = [...folderPath, this.debugPaneName, 'Lights'];
            const cabConfig = this.getConfigTarget(config) as CabConfig;
            if (!cabConfig.lights) cabConfig.lights = [];
            const lights = cabConfig.lights;

            for (let i = 0; i < lights.length; i++) {
                const cfg = lights[i];
                const lightKey = getFolderKey([...basePath, `Light ${i}`]);
                const lightFolder = lightsFolder.addFolder({
                    title: `Light ${i}`,
                    expanded: getFolderExpanded(lightKey, false)
                });
                registerFolder(lightFolder, lightKey);

                const proxy = {
                    role: cfg.role,
                    ox: cfg.offset.x, oy: cfg.offset.y, oz: cfg.offset.z,
                    tx: cfg.target.x, ty: cfg.target.y, tz: cfg.target.z,
                    color: {
                        r: (cfg.color >> 16) & 0xff,
                        g: (cfg.color >> 8) & 0xff,
                        b: cfg.color & 0xff,
                    },
                    intensity: cfg.intensity,
                    distance: cfg.distance,
                    angle: cfg.angle,
                    penumbra: cfg.penumbra,
                    decay: cfg.decay,
                    lensFlareSize: cfg.lensFlareSize ?? 150,
                };

                const update = () => {
                    cfg.role = proxy.role;
                    cfg.offset = { x: proxy.ox, y: proxy.oy, z: proxy.oz };
                    cfg.target = { x: proxy.tx, y: proxy.ty, z: proxy.tz };
                    cfg.color = (proxy.color.r << 16) | (proxy.color.g << 8) | proxy.color.b;
                    cfg.intensity = proxy.intensity;
                    cfg.distance = proxy.distance;
                    cfg.angle = proxy.angle;
                    cfg.penumbra = proxy.penumbra;
                    cfg.decay = proxy.decay;
                    cfg.lensFlareSize = proxy.lensFlareSize;
                    updateConfig(config);
                };

                lightFolder.addBinding(proxy, 'role', {
                    label: 'Role',
                    options: { Headlight: 'headlight', Taillight: 'taillight' },
                }).on('change', update);

                lightFolder.addBinding(proxy, 'color', { label: 'Color' }).on('change', update);

                lightFolder.addBinding(proxy, 'ox', { label: 'Offset X', min: -5, max: 5, step: 0.01 }).on('change', update);
                lightFolder.addBinding(proxy, 'oy', { label: 'Offset Y', min: -5, max: 10, step: 0.01 }).on('change', update);
                lightFolder.addBinding(proxy, 'oz', { label: 'Offset Z', min: -20, max: 20, step: 0.01 }).on('change', update);

                lightFolder.addBinding(proxy, 'tx', { label: 'Target X', min: -10, max: 10, step: 0.01 }).on('change', update);
                lightFolder.addBinding(proxy, 'ty', { label: 'Target Y', min: -10, max: 10, step: 0.01 }).on('change', update);
                lightFolder.addBinding(proxy, 'tz', { label: 'Target Z', min: -100, max: 100, step: 0.5 }).on('change', update);

                lightFolder.addBinding(proxy, 'intensity', { label: 'Intensity', min: 0, max: 5000, step: 10 }).on('change', update);
                lightFolder.addBinding(proxy, 'distance', { label: 'Distance', min: 0, max: 1000, step: 10 }).on('change', update);
                lightFolder.addBinding(proxy, 'angle', { label: 'Angle', min: 0.01, max: Math.PI / 2, step: 0.01 }).on('change', update);
                lightFolder.addBinding(proxy, 'penumbra', { label: 'Penumbra', min: 0, max: 1, step: 0.05 }).on('change', update);
                lightFolder.addBinding(proxy, 'decay', { label: 'Decay', min: 0, max: 5, step: 0.1 }).on('change', update);
                lightFolder.addBinding(proxy, 'lensFlareSize', { label: 'Lens Flare Size', min: 0, max: 500, step: 5 }).on('change', update);

                lightFolder.addButton({ title: 'Remove' }).on('click', () => {
                    lights.splice(i, 1);
                    updateConfig(config);
                    _onDelete?.();
                });
            }

            lightsFolder.addButton({ title: 'Add Light' }).on('click', () => {
                const frontZ = this.config.length / 2;
                lights.push({
                    role: 'headlight',
                    offset: { x: 0, y: 2.5, z: frontZ },
                    target: { x: 0, y: 0, z: frontZ + 50 },
                    color: 0xfff4e0,
                    intensity: 1000,
                    distance: 300,
                    angle: 0.45,
                    penumbra: 0.4,
                    decay: 2,
                    lensFlareSize: 150,
                });
                updateConfig(config);
                _onDelete?.();
            });
        }

        return cabFolder;
    }

    public disposeLights(): void {
        for (const light of this.spotLights) {
            light.target?.removeFromParent();
            light.removeFromParent();
            light.dispose();
        }
        for (const helper of this.spotLightHelpers) {
            helper.removeFromParent();
            helper.dispose();
        }
        for (const flare of this.lensFlares) {
            flare.removeFromParent();
            flare.dispose();
        }
        this.spotLights = [];
        this.spotLightHelpers = [];
        this.lensFlares = [];
    }

    public rebuildLights(): void {
        const wasOn = this.spotLights.some(l => l.visible);
        this.disposeLights();

        const lights = this.config.lights;
        if (!lights?.length) return;

        for (const cfg of lights) {
            const light = new SpotLight(cfg.color, cfg.intensity, cfg.distance, cfg.angle, cfg.penumbra, cfg.decay);
            light.position.set(cfg.offset.x, cfg.offset.y, cfg.offset.z);
            light.castShadow = false;
            light.userData.role = cfg.role;

            const target = new Object3D();
            target.position.set(cfg.target.x, cfg.target.y, cfg.target.z);
            this.group.add(target);
            light.target = target;

            light.visible = wasOn && cfg.role === 'headlight';
            this.group.add(light);
            this.spotLights.push(light);

            const helper = new SpotLightHelper(light);
            helper.visible = light.visible;
            this.globalDebugGroup.add(helper);
            this.spotLightHelpers.push(helper);

            // Lens flare attached to the spot light (populated once textures load)
            const lensflare = new Lensflare();
            lensflare.visible = light.visible;
            light.add(lensflare);
            this.lensFlares.push(lensflare);

            loadLensFlareTextures().then((textures) => {
                populateLensFlare(lensflare, textures, cfg);
            });
        }
    }

    public setHeadlights(on: boolean): void {
        this.spotLights.forEach((light, i) => {
            if (light.userData.role === 'headlight') {
                light.visible = on;
                this.spotLightHelpers[i].visible = on;
                this.spotLightHelpers[i].update();
                this.lensFlares[i].visible = on;
            }
        });
    }

    public setTaillights(on: boolean): void {
        this.spotLights.forEach((light, i) => {
            if (light.userData.role === 'taillight') {
                light.visible = on;
                this.spotLightHelpers[i].visible = on;
                this.spotLightHelpers[i].update();
                this.lensFlares[i].visible = on;
            }
        });
    }

    public override cleanup(): void {
        this.disposeLights();
        super.cleanup();
    }
}
