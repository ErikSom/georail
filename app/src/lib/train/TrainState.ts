import { trainPower, trainVelocityKmh, trainTractiveEffort, trainDieselRPM, trainBraking } from '../../store/train';

export interface TrainState {
    throttlePower: number;
    velocityKmh: number;
    brakePower: number;
    tractiveEffort: number;
    dieselRPM: number;
}

export function createTrainState(): TrainState {
    return { throttlePower: 0, velocityKmh: 0, brakePower: 0, tractiveEffort: 0, dieselRPM: 0 };
}

export function readTrainState(out: TrainState): TrainState {
    const power = trainPower.value;
    const velocityKmh = trainVelocityKmh.value;
    const braking = trainBraking.value;
    const absPower = Math.abs(power);

    let brakePower = 0;
    if (braking) {
        brakePower = absPower;
    } else if (absPower <= 0.1 && Math.abs(velocityKmh) > 0.1) {
        brakePower = 0.3;
    }

    out.throttlePower = braking ? 0 : absPower;
    out.velocityKmh = Math.abs(velocityKmh);
    out.brakePower = brakePower;
    out.tractiveEffort = braking ? 0 : trainTractiveEffort.value;
    out.dieselRPM = trainDieselRPM.value;
    return out;
}

export function getInputValue(state: TrainState, axisLabel: string): number | null {
    switch (axisLabel) {
        case 'Throttle Power': return state.throttlePower;
        case 'Velocity (km/h)': return state.velocityKmh;
        case 'Brake Power': return state.brakePower;
        case 'Tractive Effort': return state.tractiveEffort;
        case 'Diesel RPM': return state.dieselRPM;
        default: return null;
    }
}
