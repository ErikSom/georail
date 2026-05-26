import type { TrainConfig } from './TrainConfig';

export interface IPhysicsTarget {
    distanceTraveled: number;
}

// Acceleration = (Engine Force - Resistance) / Effective Mass
// Engine Force = Power * Efficiency / Velocity, capped by adhesion
// Effective Mass includes rotating mass factor (wheels, motors, drivetrain)
// Resistance = Rolling + Air drag
export class TrainPhysics {
    private target: IPhysicsTarget;

    private totalMass: number = 0; // kg
    private totalEnginePower: number = 0; // kW
    private totalBrakingForce: number = 0; // kN (force, not power)

    private velocity: number = 0; // m/s
    private powerSetting: number = 0; // -1..1
    private direction: -1 | 1 = 1; // -1 reverse, 1 forward

    // Physics constants (tunable)
    private readonly ROLLING_RESISTANCE_COEFF = 0.0015;
    private readonly AIR_RESISTANCE_COEFF = 1.8;
    private readonly FRONTAL_AREA = 10; // m^2
    private readonly AIR_DENSITY = 1.225; // kg/m^3
    private readonly GRAVITY = 9.81; // m/s^2
    private readonly ENGINE_EFFICIENCY = 1.0;
    private readonly MIN_SPEED_FOR_POWER = 0.5; // m/s
    private readonly BRAKE_THRESHOLD = 0.1;
    private readonly COAST_BRAKE_APPLICATION = 0.05;
private readonly DRAG_SCALE = 2.3;

    // Acceleration realism knobs
    private readonly ADHESION_COEFF = 0.14;        // 0.10–0.18 (dry rail vs sporty game feel)
    private readonly ROTATING_MASS_FACTOR = 1.08;  // 1.05–1.15 (effective mass multiplier)

    // Boundary enforcement
    private readonly BOUNDARY_POWER_DECAY = 0.90;   // Power multiplier per frame toward 0 (gradual)
    private minBound: number = -Infinity;
    private maxBound: number = Infinity;

    constructor(target: IPhysicsTarget, config: TrainConfig) {
        this.target = target;
        this.updateConfiguration(config);
    }

    public updateConfiguration(config: TrainConfig): void {
        this.totalMass = 0;
        this.totalEnginePower = 0;
        this.totalBrakingForce = 0;

        this.totalMass += config.cab.weight * 1000;
        if (config.cab.engine) {
            this.totalEnginePower += config.cab.enginePower;
            this.totalBrakingForce += config.cab.brakingPower;
        }

        config.wagons.forEach(wagon => {
            this.totalMass += wagon.weight * 1000;
            if (wagon.engine) {
                this.totalEnginePower += wagon.enginePower;
                this.totalBrakingForce += wagon.brakingPower;
            }
        });

        if (config.rearCab) {
            this.totalMass += config.rearCab.weight * 1000;
            if (config.rearCab.engine) {
                this.totalEnginePower += config.rearCab.enginePower;
                this.totalBrakingForce += config.rearCab.brakingPower;
            }
        }
    }

    public getMaxTractiveEffort(): number {
        return this.ADHESION_COEFF * this.totalMass * this.GRAVITY;
    }

    public getNormalizedTraction(): number {
        const currentForce = Math.abs(this.calculateEngineForce());
        const maxForce = this.getMaxTractiveEffort();

        if (maxForce === 0) return 0;
        return Math.min(1, Math.max(0, currentForce / maxForce));
    }

    public setPower(value: number): void {
        this.powerSetting = Math.max(-1, Math.min(1, value));
    }

    public setDirection(dir: 1 | -1): void {
        this.direction = dir;
    }

    public getDirection(): -1 | 1 {
        return this.direction;
    }

    /** True when dial opposes the current gear direction (brake mode) */
    public isBraking(): boolean {
        return (
            (this.direction === 1 && this.powerSetting < 0) ||
            (this.direction === -1 && this.powerSetting > 0)
        );
    }

    public getPower(): number {
        return this.powerSetting;
    }

    public getVelocity(): number {
        return this.velocity;
    }

    public getVelocityKmh(): number {
        return this.velocity * 3.6;
    }

    public setBounds(min: number, max: number): void {
        if (min <= max) {
            this.minBound = min;
            this.maxBound = max;
        } else {
            const midpoint = (min + max) / 2;
            this.minBound = midpoint;
            this.maxBound = midpoint;
        }
        this.clampTargetToBounds();
    }

    public reset(): void {
        this.velocity = 0;
        this.powerSetting = 0;
        this.direction = 1;
    }

    public update(deltaTime: number): void {
        deltaTime = Math.min(deltaTime, 0.1);

        const engineForce = this.calculateEngineForce();
        const resistanceForce = this.calculateResistanceForce();
        const brakeForce = this.calculateBrakeForce();

        const netForce = engineForce - resistanceForce - brakeForce;

        const effectiveMass = this.totalMass * this.ROTATING_MASS_FACTOR;
        const acceleration = netForce / effectiveMass;

        const prevVelocity = this.velocity;
        this.velocity += acceleration * deltaTime;

        // Prevent velocity zero-crossing from braking (causes oscillation/shaking)
        if (prevVelocity !== 0 && Math.sign(this.velocity) !== Math.sign(prevVelocity)) {
            const engineDrivingNewDir =
                (this.velocity > 0 && engineForce > 0) ||
                (this.velocity < 0 && engineForce < 0);
            if (!engineDrivingNewDir) {
                this.velocity = 0;
            }
        }

        // Clamp velocity: never go opposite to gear direction
        if (this.direction === 1 && this.velocity < 0) this.velocity = 0;
        if (this.direction === -1 && this.velocity > 0) this.velocity = 0;

        if (Math.abs(this.powerSetting) <= this.BRAKE_THRESHOLD && Math.abs(this.velocity) < 0.01) {
            this.velocity = 0;
        }

        this.target.distanceTraveled += this.velocity * deltaTime;

        const dist = this.target.distanceTraveled;
        if (dist < this.minBound && this.velocity < 0) {
            this.powerSetting *= this.BOUNDARY_POWER_DECAY;
            if (Math.abs(this.powerSetting) < 0.01) this.powerSetting = 0;
            this.velocity = 0;
        } else if (dist > this.maxBound && this.velocity > 0) {
            this.powerSetting *= this.BOUNDARY_POWER_DECAY;
            if (Math.abs(this.powerSetting) < 0.01) this.powerSetting = 0;
            this.velocity = 0;
        }

        this.clampTargetToBounds();
    }

    private clampTargetToBounds(): void {
        this.target.distanceTraveled = Math.max(
            this.minBound,
            Math.min(this.maxBound, this.target.distanceTraveled)
        );
    }

    private calculateEngineForce(): number {
        if (this.totalEnginePower === 0) return 0;
        if (Math.abs(this.powerSetting) < this.BRAKE_THRESHOLD) return 0;

        const powerWatts = this.totalEnginePower * 1000 * this.ENGINE_EFFICIENCY * this.powerSetting;

        const speedForCalculation = Math.max(Math.abs(this.velocity), this.MIN_SPEED_FOR_POWER);

        let force = powerWatts / speedForCalculation;

        // Adhesion limit: clamps unrealistic low-speed acceleration
        const maxTractiveEffort = this.getMaxTractiveEffort();
        force = Math.max(-maxTractiveEffort, Math.min(maxTractiveEffort, force));

        return force;
    }

    private calculateResistanceForce(): number {
        const rollingResistance = this.ROLLING_RESISTANCE_COEFF * this.totalMass * this.GRAVITY;

        const airResistance =
            this.DRAG_SCALE *
            0.5 * this.AIR_DENSITY *
            this.velocity * this.velocity *
            this.AIR_RESISTANCE_COEFF *
            this.FRONTAL_AREA;

        const totalResistance = rollingResistance + airResistance;

        return Math.sign(this.velocity) * totalResistance;
    }

    private getTargetSpeedForPower(): number {
        const ps = Math.abs(this.powerSetting);
        if (ps < this.BRAKE_THRESHOLD) return 0;

        const P = this.totalEnginePower * 1000 * ps * this.ENGINE_EFFICIENCY; // W
        const Froll = this.ROLLING_RESISTANCE_COEFF * this.totalMass * this.GRAVITY; // N
        const k = this.DRAG_SCALE * 0.5 * this.AIR_DENSITY * this.AIR_RESISTANCE_COEFF * this.FRONTAL_AREA; // N/(m/s)^2

        let v = Math.max(1, Math.abs(this.velocity));
        for (let i = 0; i < 8; i++) {
            const f = Froll * v + k * v * v * v - P;
            const df = Froll + 3 * k * v * v;
            v = v - f / Math.max(df, 1e-6);
            v = Math.max(0, Math.min(v, 120));
        }

        return Math.sign(this.powerSetting) * v;
    }

    private calculateBrakeForce(): number {
        if (this.totalBrakingForce === 0) return 0;

        let brakeApplication = 0;

        if (this.isBraking()) {
            // Opposite direction: brake proportional to dial position
            brakeApplication = Math.abs(this.powerSetting);
        } else if (Math.abs(this.velocity) > 0 && Math.abs(this.powerSetting) <= this.BRAKE_THRESHOLD) {
            brakeApplication = this.COAST_BRAKE_APPLICATION;
        } else {
            const targetSpeed = this.getTargetSpeedForPower();
            const speedError = Math.abs(this.velocity) - Math.abs(targetSpeed);

            if (speedError > 1.0) {
                brakeApplication = Math.min(speedError / 10, 0.5);
            } else if (Math.abs(this.powerSetting) <= this.BRAKE_THRESHOLD) {
                brakeApplication = this.COAST_BRAKE_APPLICATION;
            }
        }

        const maxBrakeForceN = this.totalBrakingForce * 1000;
        const brakeForce = maxBrakeForceN * brakeApplication;

        return Math.sign(this.velocity) * brakeForce;
    }

    public getDebugInfo(): {
        velocity: number;
        velocityKmh: number;
        distanceTraveled: number;
        powerSetting: number;
        totalMass: number;
        engineForce: number;
        resistanceForce: number;
        brakeForce: number;
        netForce: number;
        acceleration: number;
    } {
        const engineForce = this.calculateEngineForce();
        const resistanceForce = this.calculateResistanceForce();
        const brakeForce = this.calculateBrakeForce();
        const netForce = engineForce - resistanceForce - brakeForce;

        const effectiveMass = this.totalMass * this.ROTATING_MASS_FACTOR;
        const acceleration = netForce / effectiveMass;

        return {
            velocity: this.velocity,
            velocityKmh: this.getVelocityKmh(),
            distanceTraveled: this.target.distanceTraveled,
            powerSetting: this.powerSetting,
            totalMass: this.totalMass,
            engineForce,
            resistanceForce,
            brakeForce,
            netForce,
            acceleration
        };
    }
}
