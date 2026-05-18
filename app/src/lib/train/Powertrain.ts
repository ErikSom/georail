import type { DieselElectricPowertrainConfig, PowertrainConfig } from './TrainConfig';

export interface Powertrain {
    update(dt: number, throttle01: number, tractiveEffort01: number, isBraking: boolean): void;
    getRPM(): number;
    getRPMNormalized(): number;
    getLoad(): number;
    reset(): void;
}

export class DieselElectricPowertrain implements Powertrain {
    private rpm: number;
    private targetRpm: number;

    constructor(private cfg: DieselElectricPowertrainConfig) {
        this.rpm = cfg.idleRPM;
        this.targetRpm = cfg.idleRPM;
    }

    public update(dt: number, throttle01: number, tractive01: number, isBraking: boolean): void {
        const { idleRPM, maxRPM, revUpTau, revDownTau, brakeRevDownTau, loadInfluence } = this.cfg;

        const t = Math.min(1, Math.max(0, throttle01));
        const l = Math.min(1, Math.max(0, tractive01));
        const driver = t * (1 - loadInfluence) + l * loadInfluence;
        this.targetRpm = idleRPM + (maxRPM - idleRPM) * driver;

        let tau: number;
        if (this.targetRpm > this.rpm) {
            tau = revUpTau;
        } else {
            tau = isBraking ? brakeRevDownTau : revDownTau;
        }
        const alpha = 1 - Math.exp(-dt / Math.max(tau, 1e-3));
        this.rpm += (this.targetRpm - this.rpm) * alpha;
    }

    public getRPM(): number {
        return this.rpm;
    }

    public getRPMNormalized(): number {
        const { idleRPM, maxRPM } = this.cfg;
        const span = maxRPM - idleRPM;
        if (span <= 0) return 0;
        return (this.rpm - idleRPM) / span;
    }

    public getLoad(): number {
        const { idleRPM, maxRPM } = this.cfg;
        const span = maxRPM - idleRPM;
        if (span <= 0) return 0;
        return Math.max(0, (this.targetRpm - this.rpm) / span);
    }

    public reset(): void {
        this.rpm = this.cfg.idleRPM;
        this.targetRpm = this.cfg.idleRPM;
    }
}

export function createPowertrain(cfg: PowertrainConfig | undefined): Powertrain | null {
    if (!cfg) return null;
    if (cfg.type === 'diesel-electric') return new DieselElectricPowertrain(cfg);
    return null;
}
