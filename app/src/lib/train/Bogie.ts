import { Vector3, Group } from 'three';
import type { BogieConfig } from './TrainConfig';

export class Bogie {
    public group: Group;

    private tempObject: Group = new Group();

    constructor() {
        this.group = new Group();
        this.group.name = 'Bogie';
    }

    public orientOnRail(frontRailPos: Vector3, backRailPos: Vector3): void {
        this.tempObject.position.copy(backRailPos);
        this.tempObject.lookAt(frontRailPos);

        this.group.quaternion.copy(this.tempObject.quaternion);
    }
}
