import {
    Group,
    Mesh,
    BoxGeometry,
    CylinderGeometry,
    MeshBasicMaterial,
    Vector3,
    DoubleSide,
    Quaternion,
} from 'three';
import Path from '../utils/Path';
import { stops, stopDistances } from '../../store/journey';
import { trainLength } from '../../store/train';
import { configs } from '../../store/globals';

// Shared materials
let zoneMaterial: MeshBasicMaterial | null = null;
let waypointMaterial: MeshBasicMaterial | null = null;

/**
 * Visualizes stop zones as transparent boxes along the track.
 * Stop zones show where the train must stop for arrivals to be detected.
 */
export class StopZoneVisualizer {
    public group: Group;
    private zoneMeshes: Mesh[] = [];
    private waypointMeshes: Mesh[] = [];
    private path: Path | null = null;

    // Shared waypoint geometry (tall thin cylinder)
    private static waypointGeometry: CylinderGeometry | null = null;

    constructor() {
        this.group = new Group();
        this.group.name = 'StopZoneDebugGroup';

        // Create shared materials on first instantiation
        if (!zoneMaterial) {
            zoneMaterial = new MeshBasicMaterial({
                color: 0x4ade80, // Green
                transparent: true,
                opacity: 0.3,
                side: DoubleSide,
                depthWrite: false,
            });
        }
        if (!waypointMaterial) {
            waypointMaterial = new MeshBasicMaterial({
                color: 0xfbbf24, // Amber/yellow for waypoint
                transparent: true,
                opacity: 0.8,
            });
        }
        if (!StopZoneVisualizer.waypointGeometry) {
            // Tall thin cylinder: radius 0.5m, height 8m
            StopZoneVisualizer.waypointGeometry = new CylinderGeometry(0.5, 0.5, 8, 8);
        }
    }

    /**
     * Create stop zone visualizations along the path
     */
    public createZones(path: Path): void {
        this.path = path;
        this.clearZones();

        const stopsArr = stops.value;
        const distances = stopDistances.value;

        if (stopsArr.length === 0 || distances.length === 0) {
            return;
        }

        const fullTrainLengthM = trainLength.value;
        const leniencyM = configs.value.stationStopLeniencyM;

        console.log(`Creating stop zones: trainLength=${fullTrainLengthM}m, leniency=${leniencyM}m`);

        for (let i = 0; i < stopsArr.length; i++) {
            const stopDistanceM = distances[i] * 1000; // Convert km to m

            // Zone is centered on station position
            const zoneLengthM = Math.max(1, fullTrainLengthM + leniencyM);
            const halfZoneLengthM = zoneLengthM / 2;
            const zoneStartM = Math.max(0, stopDistanceM - halfZoneLengthM);
            const zoneEndM = stopDistanceM + halfZoneLengthM;

            // Get positions (zone center is the station position)
            const stopPos = path.getPointAtDistance(stopDistanceM);
            const startPos = path.getPointAtDistance(zoneStartM);
            const centerPos = stopPos; // Station is at center
            const endPos = path.getPointAtDistance(zoneEndM);

            // Create waypoint cylinder at exact station position
            const waypoint = new Mesh(
                StopZoneVisualizer.waypointGeometry!,
                waypointMaterial!
            );
            waypoint.position.copy(stopPos);
            waypoint.position.y += 4; // Lift so it stands on track level
            waypoint.name = `StopWaypoint_${i}_${stopsArr[i].station}`;
            this.waypointMeshes.push(waypoint);
            this.group.add(waypoint);

            // Create zone box: width 10m, height 2m, depth = zone length
            const zoneGeometry = new BoxGeometry(10, 2, zoneLengthM);
            const zoneMesh = new Mesh(zoneGeometry, zoneMaterial!);

            // Position at center, lifted 1m so bottom is at track level
            zoneMesh.position.copy(centerPos);
            zoneMesh.position.y += 1;

            // Orient box to align with track direction
            const direction = new Vector3().subVectors(endPos, startPos);
            if (direction.lengthSq() > 0.001) {
                direction.normalize();
                const defaultDir = new Vector3(0, 0, 1);
                const quaternion = new Quaternion();
                quaternion.setFromUnitVectors(defaultDir, direction);
                zoneMesh.quaternion.copy(quaternion);
            }

            zoneMesh.name = `StopZone_${i}_${stopsArr[i].station}`;
            this.zoneMeshes.push(zoneMesh);
            this.group.add(zoneMesh);
        }

        console.log(`Created ${this.zoneMeshes.length} stop zones with waypoints`);
    }

    /**
     * Update zone visualizations (call if train length changes)
     */
    public updateZones(): void {
        if (this.path) {
            this.createZones(this.path);
        }
    }

    /**
     * Clear all zone visualizations
     */
    public clearZones(): void {
        for (const mesh of this.zoneMeshes) {
            mesh.geometry.dispose();
            this.group.remove(mesh);
        }
        for (const mesh of this.waypointMeshes) {
            this.group.remove(mesh);
        }
        this.zoneMeshes = [];
        this.waypointMeshes = [];
    }

    /**
     * Dispose of all resources
     */
    public dispose(): void {
        this.clearZones();
    }
}
