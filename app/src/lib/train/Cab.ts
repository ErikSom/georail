import { SpotLight, SpotLightHelper, Object3D, CanvasTexture, Texture, Color, Mesh, MeshStandardMaterial } from 'three';
import { Lensflare, LensflareElement } from './Lensflare';
import type { CabConfig, EmissiveTextureConfig, LightConfig, RollingStockConfig, TrainConfig } from './TrainConfig';
import { RollingStock } from './RollingStock';
import type { FolderApi, Pane } from 'tweakpane';
import { getFolderKey } from './TrainUiUtils';
import { EmissiveTextureEditor } from '../editor/EmissiveTextureEditor';
import { renderEmissiveTexture, compositeEmissiveWithDiffuse } from '../editor/EmissiveTextureRenderer';

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
                        ctx.globalAlpha = 0.2;
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
    private spotLightHelpers: (SpotLightHelper | null)[] = [];
    private lensFlares: Lensflare[] = [];
    private emissiveCanvasTextures: CanvasTexture[] = [];
    private emissiveDataByRole: Map<string, { material: MeshStandardMaterial; texture: CanvasTexture; color: number; intensity: number }[]> = new Map();

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

    protected override onModelLoaded(): void {
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
                    meshPattern: cfg.meshPattern || '',
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
                    cfg.meshPattern = proxy.meshPattern || undefined;
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

                lightFolder.addBinding(proxy, 'meshPattern', { label: 'Mesh Pattern' }).on('change', update);

                lightFolder.addButton({ title: 'Edit Emissive Texture' }).on('click', () => {
                    if (!cfg.meshPattern) {
                        alert('Set a Mesh Pattern first');
                        return;
                    }
                    this.openEmissiveEditor(cfg, config, updateConfig);
                });

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
                    meshPattern: '',
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
            helper?.removeFromParent();
            helper?.dispose();
        }
        for (const flare of this.lensFlares) {
            flare.removeFromParent();
            flare.dispose();
        }
        for (const tex of this.emissiveCanvasTextures) {
            tex.dispose();
        }
        this.spotLights = [];
        this.spotLightHelpers = [];
        this.lensFlares = [];
        this.emissiveCanvasTextures = [];
        this.emissiveDataByRole.clear();
    }

    public rebuildLights(): void {
        const wasOn = this.spotLights.some(l => l.userData.active);
        this.disposeLights();

        const lights = this.config.lights;
        if (!lights?.length) return;

        for (const cfg of lights) {
            const noSpotlight = cfg.distance === 0;
            const active = wasOn && cfg.role === 'headlight';

            // Always create SpotLight for role tracking in setHeadlights/setTaillights
            // Keep visible=true always to avoid shader recompilation when toggling;
            // toggle via intensity instead
            const light = new SpotLight(cfg.color, active ? cfg.intensity : 0, cfg.distance, cfg.angle, cfg.penumbra, cfg.decay);
            light.position.set(cfg.offset.x, cfg.offset.y, cfg.offset.z);
            light.castShadow = false;
            light.userData.role = cfg.role;
            light.userData.configIntensity = cfg.intensity;
            light.userData.active = active;
            this.spotLights.push(light);

            if (noSpotlight) {
                // No actual spotlight — create a positioned anchor for the lens flare
                const anchor = new Object3D();
                anchor.position.set(cfg.offset.x, cfg.offset.y, cfg.offset.z);
                this.group.add(anchor);
                this.spotLightHelpers.push(null);

                const lensflare = new Lensflare();
                lensflare.visible = active;
                anchor.add(lensflare);
                this.lensFlares.push(lensflare);

                loadLensFlareTextures().then((textures) => {
                    populateLensFlare(lensflare, textures, cfg);
                });
            } else {
                const target = new Object3D();
                target.position.set(cfg.target.x, cfg.target.y, cfg.target.z);
                this.group.add(target);
                light.target = target;

                // Always add to scene so shaders compile with full light count
                this.group.add(light);

                const helper = new SpotLightHelper(light);
                helper.visible = active;
                this.globalDebugGroup.add(helper);
                this.spotLightHelpers.push(helper);

                const lensflare = new Lensflare();
                lensflare.visible = active;
                light.add(lensflare);
                this.lensFlares.push(lensflare);

                loadLensFlareTextures().then((textures) => {
                    populateLensFlare(lensflare, textures, cfg);
                });
            }
        }

        this.buildEmissiveTextures();

        // Apply initial emissive state matching spotlight visibility
        this.updateEmissiveTextures();
    }

    public setHeadlights(on: boolean): void {
        this.spotLights.forEach((light, i) => {
            if (light.userData.role === 'headlight') {
                light.userData.active = on;
                light.intensity = on ? light.userData.configIntensity : 0;
                const helper = this.spotLightHelpers[i];
                if (helper) { helper.visible = on; helper.update(); }
                this.lensFlares[i].visible = on;
            }
        });
        this.updateEmissiveTextures();
    }

    public setTaillights(on: boolean): void {
        this.spotLights.forEach((light, i) => {
            if (light.userData.role === 'taillight') {
                light.userData.active = on;
                light.intensity = on ? light.userData.configIntensity : 0;
                const helper = this.spotLightHelpers[i];
                if (helper) { helper.visible = on; helper.update(); }
                this.lensFlares[i].visible = on;
            }
        });
        this.updateEmissiveTextures();
    }

    private updateEmissiveTextures(): void {
        // Determine which roles are currently active
        const activeRoles = new Set<string>();
        for (const light of this.spotLights) {
            if (light.userData.active) activeRoles.add(light.userData.role as string);
        }

        // Apply active role textures, track which materials were set
        const activeMaterials = new Set<MeshStandardMaterial>();
        for (const role of activeRoles) {
            const entries = this.emissiveDataByRole.get(role);
            if (!entries) continue;
            for (const entry of entries) {
                entry.material.emissiveMap = entry.texture;
                entry.material.emissive = new Color(entry.color);
                entry.material.emissiveIntensity = entry.intensity;
                entry.material.needsUpdate = true;
                activeMaterials.add(entry.material);
            }
        }

        // Zero out materials from inactive roles only if not claimed by an active role
        for (const [role, entries] of this.emissiveDataByRole) {
            if (activeRoles.has(role)) continue;
            for (const entry of entries) {
                if (!activeMaterials.has(entry.material)) {
                    entry.material.emissiveIntensity = 0;
                    entry.material.needsUpdate = true;
                }
            }
        }
    }

    private buildEmissiveTextures(): void {
        if (!this.config.emissiveTextures) return;

        const lights = this.config.lights ?? [];

        for (const [key, texConfig] of Object.entries(this.config.emissiveTextures)) {
            if (!texConfig.shapes.length) continue;

            const colonIdx = key.indexOf(':');
            if (colonIdx < 0) continue;
            const role = key.substring(0, colonIdx);
            const meshPattern = key.substring(colonIdx + 1);
            if (!meshPattern) continue;

            // Use the current light color if available, fall back to stored config color
            const matchingLight = lights.find(l => l.role === role && l.meshPattern === meshPattern);
            const color = matchingLight?.color ?? texConfig.color ?? 0xffffff;
            const intensity = texConfig.intensity ?? 1.0;

            const mask = renderEmissiveTexture(texConfig);

            const meshes = this.findMeshesByPattern(meshPattern);
            for (const mesh of meshes) {
                const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
                for (const mat of mats) {
                    const std = mat as MeshStandardMaterial;
                    const diffuse = std.map?.image;
                    const canvas = diffuse
                        ? compositeEmissiveWithDiffuse(mask, diffuse)
                        : mask;
                    const texture = new CanvasTexture(canvas);
                    texture.flipY = false;
                    texture.needsUpdate = true;
                    this.emissiveCanvasTextures.push(texture);

                    // Pre-apply emissiveMap so Three.js compiles the shader now, not on first toggle
                    std.emissiveMap = texture;
                    std.emissive = new Color(color);
                    std.emissiveIntensity = 0;
                    std.needsUpdate = true;

                    // Store by role for toggling in updateEmissiveTextures
                    if (!this.emissiveDataByRole.has(role)) {
                        this.emissiveDataByRole.set(role, []);
                    }
                    this.emissiveDataByRole.get(role)!.push({ material: std, texture, color, intensity });
                }
            }
        }
    }

    private extractReferenceTexture(mesh: Mesh): HTMLCanvasElement | null {
        const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
        console.log(`[Cab] extractReferenceTexture: mesh "${mesh.name}", ${mats.length} material(s)`);

        for (const mat of mats) {
            const std = mat as MeshStandardMaterial;
            console.log(`[Cab]   material "${std.name}", has map: ${!!std.map}, map.image: ${!!std.map?.image}, image type: ${std.map?.image?.constructor?.name}`);
            if (!std.map?.image) continue;

            const image = std.map.image;
            console.log(`[Cab]   image size: ${image.width}x${image.height}`);
            const canvas = document.createElement('canvas');
            canvas.width = image.width || 256;
            canvas.height = image.height || 256;
            const ctx = canvas.getContext('2d')!;

            // ImageBitmap (from GLB) and HTMLImageElement both work with drawImage
            ctx.drawImage(image, 0, 0);
            console.log(`[Cab]   reference texture extracted successfully (${canvas.width}x${canvas.height})`);
            return canvas;
        }

        console.warn('[Cab] extractReferenceTexture: no material with a map texture found');
        return null;
    }

    private openEmissiveEditor(
        lightCfg: LightConfig,
        trainConfig: TrainConfig,
        updateConfig: (config: TrainConfig) => void
    ): void {
        const key = `${lightCfg.role}:${lightCfg.meshPattern}`;
        const cabConfig = this.getConfigTarget(trainConfig) as CabConfig;

        if (!cabConfig.emissiveTextures) cabConfig.emissiveTextures = {};

        const existingConfig = cabConfig.emissiveTextures[key];
        const meshes = this.findMeshesByPattern(lightCfg.meshPattern!);
        console.log(`[Cab] openEmissiveEditor: key="${key}", pattern="${lightCfg.meshPattern}", found ${meshes.length} mesh(es)`);
        for (const m of meshes) {
            console.log(`[Cab]   mesh: "${m.name}", material isArray: ${Array.isArray(m.material)}`);
        }

        let referenceTexture: HTMLCanvasElement | null = null;
        for (const mesh of meshes) {
            referenceTexture = this.extractReferenceTexture(mesh);
            if (referenceTexture) break;
        }
        console.log(`[Cab] referenceTexture: ${referenceTexture ? `${referenceTexture.width}x${referenceTexture.height}` : 'null'}`);

        const editor = new EmissiveTextureEditor(
            key,
            existingConfig,
            meshes,
            referenceTexture,
            lightCfg.color,
            (savedConfig: EmissiveTextureConfig) => {
                cabConfig.emissiveTextures![key] = savedConfig;
                updateConfig(trainConfig);
            }
        );

        editor.open();
    }

    public override cleanup(): void {
        this.disposeLights();
        super.cleanup();
    }
}
