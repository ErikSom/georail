import { Color, Group, Scene, Vector3 } from 'three';
import type { ParticleEmitterConfig } from '../train/TrainConfig';
import type { TrainState } from '../train/TrainState';
import { evaluateCurves } from './CurveEvaluator';
import { ParticleSystem } from './ParticleSystem';

const _originWorld = new Vector3();
const _velocityWorld = new Vector3();
const _spread = new Vector3();
const _spawnColor = new Color();

export class ParticleEmitter {
    private readonly cfg: ParticleEmitterConfig;
    private readonly anchor: Group;
    private readonly system: ParticleSystem;
    private nextSlot = 0;
    private spawnAccumulator = 0;
    private liveCount = 0;
    private overflowWarned = false;
    private readonly liveLifetimes: Float32Array;
    private readonly liveExpiresAt: Float32Array;
    private velocityInheritOverride: number | null = null;

    public setVelocityInheritOverride(v: number | null): void {
        this.velocityInheritOverride = v;
    }

    constructor(cfg: ParticleEmitterConfig, anchor: Group, scene: Scene) {
        this.cfg = cfg;
        this.anchor = anchor;
        this.system = new ParticleSystem(cfg, scene);
        this.liveLifetimes = new Float32Array(cfg.poolSize);
        this.liveExpiresAt = new Float32Array(cfg.poolSize);
    }

    public update(
        delta: number,
        state: TrainState,
        time: number,
        trainWorldVel: Vector3,
    ): void {
        this.system.setTime(time);

        const curves = evaluateCurves(this.cfg.curves, state);

        const rate = curves.get('Emission Rate') ?? 0;
        if (rate <= 0) return;

        const sizeMul = curves.get('Size') ?? 1;
        const opacityMul = curves.get('Opacity') ?? 1;
        const lifetimeMul = curves.get('Lifetime') ?? 1;
        const velocityMul = curves.get('Velocity Magnitude') ?? 1;
        const colorBrightness = curves.get('Color Brightness') ?? 1;

        this.spawnAccumulator += rate * delta;

        const anchor = this.anchor;
        anchor.updateWorldMatrix(true, false);

        while (this.spawnAccumulator >= 1) {
            this.spawnAccumulator -= 1;
            this.spawnOne(
                time,
                delta,
                trainWorldVel,
                sizeMul,
                opacityMul,
                lifetimeMul,
                velocityMul,
                colorBrightness,
            );
        }
    }

    private spawnOne(
        time: number,
        delta: number,
        trainWorldVel: Vector3,
        sizeMul: number,
        opacityMul: number,
        lifetimeMul: number,
        velocityMul: number,
        colorBrightness: number,
    ): void {
        const cfg = this.cfg;

        // Spread temporal+spatial across the frame to avoid visible clumping at low rates.
        const jitter = Math.random();
        const spawnTime = time - jitter * delta;

        _originWorld.set(cfg.offset.x, cfg.offset.y, cfg.offset.z);
        _originWorld.applyMatrix4(this.anchor.matrixWorld);
        if (trainWorldVel.lengthSq() > 0) {
            _originWorld.addScaledVector(trainWorldVel, -jitter * delta);
        }

        const sp = cfg.velocitySpread;
        _spread.set(
            (Math.random() - 0.5) * 2 * sp,
            (Math.random() - 0.5) * 2 * sp,
            (Math.random() - 0.5) * 2 * sp,
        );
        _velocityWorld.set(
            cfg.baseVelocity.x + _spread.x,
            cfg.baseVelocity.y + _spread.y,
            cfg.baseVelocity.z + _spread.z,
        );
        _velocityWorld.multiplyScalar(velocityMul);
        _velocityWorld.applyQuaternion(this.anchor.quaternion);
        const inherit = this.velocityInheritOverride ?? cfg.velocityInherit;
        if (inherit > 0) {
            _velocityWorld.addScaledVector(trainWorldVel, inherit);
        }

        const lifetime = cfg.baseLifetime * lifetimeMul;
        const size = cfg.baseSize * sizeMul;
        const opacity = opacityMul;
        const seed = Math.random();

        _spawnColor.setRGB(colorBrightness, colorBrightness, colorBrightness);

        const slot = this.nextSlot;
        if (this.liveExpiresAt[slot] > time && !this.overflowWarned) {
            console.warn(`ParticleEmitter "${this.cfg.name}": pool size ${this.cfg.poolSize} overflowed — oldest live particle clobbered. Increase poolSize or reduce emission rate.`);
            this.overflowWarned = true;
        }
        this.liveLifetimes[slot] = lifetime;
        this.liveExpiresAt[slot] = spawnTime + lifetime;

        this.system.spawn(slot, _originWorld, _velocityWorld, spawnTime, lifetime, size, _spawnColor, opacity, seed);

        this.nextSlot = (slot + 1) % cfg.poolSize;
        this.liveCount = Math.min(this.liveCount + 1, cfg.poolSize);
    }

    public applyConfig(cfg: ParticleEmitterConfig): void {
        // Mutate in place; per-spawn reads from this.cfg pick up slider edits without rebuild.
        Object.assign(this.cfg, cfg);
        this.system.applyConfig(this.cfg);
    }

    public getActiveCount(time: number): number {
        return this.system.getActiveCount(time);
    }

    public dispose(): void {
        this.system.dispose();
    }
}
