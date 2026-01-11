import type { CabConfig, RollingStockConfig, TrainConfig } from './TrainConfig';
import { RollingStock } from './RollingStock';

export class Cab extends RollingStock {
    override config: CabConfig;
    private rearCab: boolean;

    constructor(config: CabConfig, rearCab: boolean = false, debug: boolean = false) {
        super(config, debug);

        this.config = config;
        this.rearCab = rearCab;

        this.debugPaneName = this.rearCab ? 'Rear Cab' : 'Front Cab';
    }

    protected getConfigTarget(config: TrainConfig): RollingStockConfig {
        return this.rearCab ? (config.rearCab as CabConfig) : config.cab;
    }
}
