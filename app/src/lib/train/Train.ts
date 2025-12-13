import { Group, Vector3, Mesh, SphereGeometry, MeshBasicMaterial, Scene } from 'three';
import { Pane } from 'tweakpane';
import type { TrainConfig } from './TrainConfig';
import { Cab } from './Cab';

export class Train {
    public group: Group;
    private config: TrainConfig;
    private cab: Cab;
    private debug: boolean;
    private pane: Pane | null = null;

    // Route path for positioning on rails
    private pathPoints: Vector3[] = [];
    private currentPathIndex: number = 0;

    // Global debug visualization (added directly to scene, not affected by hierarchy)
    public globalDebugGroup: Group = new Group();
    private globalWheelSpheres: {
        frontBogieFront: Mesh | null;
        frontBogieBack: Mesh | null;
        rearBogieFront: Mesh | null;
        rearBogieBack: Mesh | null;
        cabCenter: Mesh | null;
    } = {
        frontBogieFront: null,
        frontBogieBack: null,
        rearBogieFront: null,
        rearBogieBack: null,
        cabCenter: null
    };

    constructor(config: TrainConfig, debug: boolean = false) {
        this.config = config;
        this.debug = debug;
        this.group = new Group();
        this.group.name = 'Train';

        // Create cab
        this.cab = new Cab(config.cab);
        this.group.add(this.cab.group);

        // Create Tweakpane UI if debug mode is enabled
        if (this.debug) {
            this.createDebugUI();
            this.createGlobalDebugSpheres();
        }
    }

    /**
     * Create global debug spheres that show wheel and cab positions in world space
     */
    private createGlobalDebugSpheres(): void {
        const geometry = new SphereGeometry(0.5, 16, 16);

        // Front bogie front wheel - Bright Green
        this.globalWheelSpheres.frontBogieFront = new Mesh(
            geometry,
            new MeshBasicMaterial({ color: 0x00ff00 })
        );
        this.globalDebugGroup.add(this.globalWheelSpheres.frontBogieFront);

        // Front bogie back wheel - Dark Green
        this.globalWheelSpheres.frontBogieBack = new Mesh(
            geometry,
            new MeshBasicMaterial({ color: 0x00aa00 })
        );
        this.globalDebugGroup.add(this.globalWheelSpheres.frontBogieBack);

        // Rear bogie front wheel - Bright Red
        this.globalWheelSpheres.rearBogieFront = new Mesh(
            geometry,
            new MeshBasicMaterial({ color: 0xff0000 })
        );
        this.globalDebugGroup.add(this.globalWheelSpheres.rearBogieFront);

        // Rear bogie back wheel - Dark Red
        this.globalWheelSpheres.rearBogieBack = new Mesh(
            geometry,
            new MeshBasicMaterial({ color: 0xaa0000 })
        );
        this.globalDebugGroup.add(this.globalWheelSpheres.rearBogieBack);

        // Cab center - Blue
        this.globalWheelSpheres.cabCenter = new Mesh(
            geometry,
            new MeshBasicMaterial({ color: 0x0000ff })
        );
        this.globalDebugGroup.add(this.globalWheelSpheres.cabCenter);

        this.globalDebugGroup.name = 'TrainGlobalDebug';
        console.log('Created global debug spheres for train');
    }

    public updateConfig(config: TrainConfig): void {
        this.config = config;
        this.cab.updateConfig(config.cab);

        // Reposition train on path if we have a path loaded
        // This ensures bogies orient correctly with new offsets
        if (this.pathPoints.length > 0) {
            this.positionOnPath(this.currentPathIndex);
        }
    }

    public getConfig(): TrainConfig {
        return JSON.parse(JSON.stringify(this.config));
    }

    /**
     * Set the rail path that the train will follow
     */
    public setPath(pathPoints: Vector3[]): void {
        this.pathPoints = pathPoints;
        this.currentPathIndex = 0;
    }

    /**
     * Find the closest point on the path to a given position
     */
    private findClosestPathIndex(position: Vector3): number {
        let closestIndex = 0;
        let closestDistance = Infinity;

        for (let i = 0; i < this.pathPoints.length; i++) {
            const distance = position.distanceTo(this.pathPoints[i]);
            if (distance < closestDistance) {
                closestDistance = distance;
                closestIndex = i;
            }
        }

        return closestIndex;
    }

    /**
     * Get a point on the path at a specific distance from a starting index
     * This allows us to find where the wheels should be positioned
     * Extrapolates beyond path endpoints if necessary
     */
    private getPointAtDistance(startIndex: number, distance: number): { point: Vector3; index: number } | null {
        if (this.pathPoints.length < 2) return null;

        let currentIndex = startIndex;
        let remainingDistance = Math.abs(distance);
        const forward = distance >= 0;

        let currentPoint = this.pathPoints[currentIndex].clone();

        while (remainingDistance > 0 && currentIndex >= 0 && currentIndex < this.pathPoints.length - 1) {
            const nextIndex = forward ? currentIndex + 1 : currentIndex - 1;

            // If we've reached the bounds, extrapolate
            if (nextIndex < 0) {
                // Extrapolate backward from index 0 using direction from point 1 to point 0
                const direction = new Vector3().subVectors(this.pathPoints[0], this.pathPoints[1]).normalize();
                currentPoint.copy(this.pathPoints[0]).add(direction.multiplyScalar(remainingDistance));
                break;
            } else if (nextIndex >= this.pathPoints.length) {
                // Extrapolate forward from last index
                const lastIndex = this.pathPoints.length - 1;
                const direction = new Vector3().subVectors(this.pathPoints[lastIndex], this.pathPoints[lastIndex - 1]).normalize();
                currentPoint.copy(this.pathPoints[lastIndex]).add(direction.multiplyScalar(remainingDistance));
                break;
            }

            const segmentVector = new Vector3().subVectors(this.pathPoints[nextIndex], this.pathPoints[currentIndex]);
            const segmentLength = segmentVector.length();

            if (segmentLength >= remainingDistance) {
                // The point is within this segment
                const t = remainingDistance / segmentLength;
                currentPoint.lerpVectors(this.pathPoints[currentIndex], this.pathPoints[nextIndex], t);
                currentIndex = nextIndex;
                break;
            } else {
                // Move to next segment
                remainingDistance -= segmentLength;
                currentIndex = nextIndex;
                currentPoint.copy(this.pathPoints[currentIndex]);
            }
        }

        return { point: currentPoint, index: currentIndex };
    }

    /**
     * Position the train on the rails at a specific path index
     * This will:
     * 1. Find where each bogie's wheels should be on the path
     * 2. Orient each bogie based on its wheel positions
     * 3. Orient the cab based on the bogie orientations
     */
    public positionOnPath(pathIndex: number): void {
        if (this.pathPoints.length < 2) {
            console.warn('Train: Not enough path points to position train');
            return;
        }

        // Clamp path index
        pathIndex = Math.max(0, Math.min(pathIndex, this.pathPoints.length - 1));
        this.currentPathIndex = pathIndex;

        // Get cab center position (approximately at pathIndex)
        const cabCenterPos = this.pathPoints[pathIndex].clone();

        // Calculate where each wheel should be on the path
        // Front bogie, front wheel
        const frontBogieConfig = this.config.cab.frontBogie;
        const frontBogieOffset = frontBogieConfig.zOffset;
        const frontBogieWheelFrontOffset = frontBogieOffset + frontBogieConfig.frontWheelOffset;
        const frontBogieWheelBackOffset = frontBogieOffset + frontBogieConfig.backWheelOffset;

        // Rear bogie, front wheel
        const rearBogieConfig = this.config.cab.rearBogie;
        const rearBogieOffset = rearBogieConfig.zOffset;
        const rearBogieWheelFrontOffset = rearBogieOffset + rearBogieConfig.frontWheelOffset;
        const rearBogieWheelBackOffset = rearBogieOffset + rearBogieConfig.backWheelOffset;

        // Find positions on path for each wheel
        const frontBogieFrontWheel = this.getPointAtDistance(pathIndex, frontBogieWheelFrontOffset);
        const frontBogieBackWheel = this.getPointAtDistance(pathIndex, frontBogieWheelBackOffset);
        const rearBogieFrontWheel = this.getPointAtDistance(pathIndex, rearBogieWheelFrontOffset);
        const rearBogieBackWheel = this.getPointAtDistance(pathIndex, rearBogieWheelBackOffset);

        if (!frontBogieFrontWheel || !frontBogieBackWheel || !rearBogieFrontWheel || !rearBogieBackWheel) {
            console.warn('Train: Could not find all wheel positions on path');
            return;
        }

        // ===== NEW APPROACH: Calculate global positions first, then orient top-down =====

        // Store all global world positions - these are the TRUE positions on the rails
        const globalPositions = {
            frontBogieFrontWheel: frontBogieFrontWheel.point.clone(),
            frontBogieBackWheel: frontBogieBackWheel.point.clone(),
            rearBogieFrontWheel: rearBogieFrontWheel.point.clone(),
            rearBogieBackWheel: rearBogieBackWheel.point.clone(),
            cabCenter: cabCenterPos.clone()
        };

        // Step 1: Position the train group at the cab center in world space
        this.group.position.copy(globalPositions.cabCenter);

        // Step 2: Orient the entire train to follow the overall direction
        // Use the direction from the rearmost wheel to the frontmost wheel
        const rearPoint = globalPositions.rearBogieBackWheel;
        const frontPoint = globalPositions.frontBogieFrontWheel;
        const overallDirection = new Vector3().subVectors(frontPoint, rearPoint);

        if (overallDirection.length() > 0.001) {
            const tempObj = new Group();
            tempObj.position.copy(rearPoint);
            tempObj.up.set(0, 1, 0);
            tempObj.lookAt(frontPoint);
            this.group.quaternion.copy(tempObj.quaternion);
            this.group.rotateY(Math.PI); // Adjust based on model forward direction
        }

        // Step 3: Orient bogies relative to the train's local space
        // Convert global wheel positions to local space of the train group
        const frontBogie = this.cab.getFrontBogie();
        const rearBogie = this.cab.getRearBogie();

        const localFrontFront = globalPositions.frontBogieFrontWheel.clone();
        const localFrontBack = globalPositions.frontBogieBackWheel.clone();
        const localRearFront = globalPositions.rearBogieFrontWheel.clone();
        const localRearBack = globalPositions.rearBogieBackWheel.clone();

        this.group.worldToLocal(localFrontFront);
        this.group.worldToLocal(localFrontBack);
        this.group.worldToLocal(localRearFront);
        this.group.worldToLocal(localRearBack);

        // Orient bogies based on their local wheel positions
        frontBogie.orientOnRail(localFrontFront, localFrontBack);
        rearBogie.orientOnRail(localRearFront, localRearBack);

        // Orient cab model between the bogies (optional, for visual smoothness)
        this.cab.orientOnBogies();

        // Update global debug spheres with world positions
        if (this.debug) {
            if (this.globalWheelSpheres.frontBogieFront) {
                this.globalWheelSpheres.frontBogieFront.position.copy(frontBogieFrontWheel.point);
            }
            if (this.globalWheelSpheres.frontBogieBack) {
                this.globalWheelSpheres.frontBogieBack.position.copy(frontBogieBackWheel.point);
            }
            if (this.globalWheelSpheres.rearBogieFront) {
                this.globalWheelSpheres.rearBogieFront.position.copy(rearBogieFrontWheel.point);
            }
            if (this.globalWheelSpheres.rearBogieBack) {
                this.globalWheelSpheres.rearBogieBack.position.copy(rearBogieBackWheel.point);
            }
            if (this.globalWheelSpheres.cabCenter) {
                this.globalWheelSpheres.cabCenter.position.copy(cabCenterPos);
            }
        }

        // Debug logging (only log occasionally to avoid spam)
        if (pathIndex % 100 === 0 || pathIndex === 0) {
            console.log(`Train positioned at path index ${pathIndex}:`, {
                position: this.group.position,
                frontBogieRotation: frontBogie.group.rotation,
                rearBogieRotation: rearBogie.group.rotation,
                wheelPositions: {
                    frontFront: frontBogieFrontWheel.point,
                    frontBack: frontBogieBackWheel.point,
                    rearFront: rearBogieFrontWheel.point,
                    rearBack: rearBogieBackWheel.point
                }
            });
        }
    }

    public getCurrentPathIndex(): number {
        return this.currentPathIndex;
    }

    private openGLBFilePicker(): void {
        // Create a hidden file input element
        const input = document.createElement('input');
        input.type = 'file';
        input.accept = '.glb,.gltf';
        input.style.display = 'none';

        input.onchange = (e) => {
            const file = (e.target as HTMLInputElement).files?.[0];
            if (!file) return;

            // Create a blob URL for the selected file
            const url = URL.createObjectURL(file);

            console.log('Loading GLB file:', file.name, 'from URL:', url);

            // Create a new config object with the new path
            const newConfig: TrainConfig = {
                cab: {
                    ...this.config.cab,
                    modelPath: url
                }
            };

            // Trigger config update to reload the model
            this.updateConfig(newConfig);

            // Refresh the Tweakpane to show the new path
            if (this.pane) {
                this.pane.refresh();
            }
        };

        // Trigger the file picker
        document.body.appendChild(input);
        input.click();
        document.body.removeChild(input);
    }

    private createDebugUI(): void {
        this.pane = new Pane({ title: 'Train Configuration' });

        // Cab folder
        const cabFolder = this.pane.addFolder({ title: 'Cab', expanded: true });

        cabFolder.addBinding(this.config.cab, 'modelPath', {
            label: 'Model Path'
        }).on('change', () => this.updateConfig(this.config));

        // Add file picker button for GLB model
        cabFolder.addButton({ title: 'Load GLB File...' }).on('click', () => {
            this.openGLBFilePicker();
        });

        cabFolder.addBinding(this.config.cab, 'scale', {
            label: 'Scale',
            min: 0.1,
            max: 5.0,
            step: 0.1
        }).on('change', (ev) => {
            // Manually update the config with the new value from Tweakpane
            this.config.cab.scale = ev.value;
            console.log('Scale changed to:', ev.value);

            // Update the cab with the modified config
            this.cab.updateConfig(this.config.cab);

            // Reposition if we have a path
            if (this.pathPoints.length > 0) {
                this.positionOnPath(this.currentPathIndex);
            }
        });

        cabFolder.addBinding(this.config.cab, 'altitudeOffset', {
            label: 'Altitude Offset',
            min: -10.0,
            max: 10.0,
            step: 0.1
        }).on('change', (ev) => {
            // Manually update the config with the new value from Tweakpane
            this.config.cab.altitudeOffset = ev.value;
            console.log('Altitude changed to:', ev.value);

            // Update the cab with the modified config
            this.cab.updateConfig(this.config.cab);

            // Reposition if we have a path
            if (this.pathPoints.length > 0) {
                this.positionOnPath(this.currentPathIndex);
            }
        });

        cabFolder.addBinding(this.config.cab, 'showDebug', {
            label: 'Show Debug'
        }).on('change', () => this.updateConfig(this.config));

        // Front Bogie folder
        const frontBogieFolder = cabFolder.addFolder({ title: 'Front Bogie', expanded: true });

        frontBogieFolder.addBinding(this.config.cab.frontBogie, 'zOffset', {
            label: 'Z Offset',
            min: -20.0,
            max: 20.0,
            step: 0.1
        }).on('change', (ev) => {
            this.config.cab.frontBogie.zOffset = ev.value;
            this.cab.updateConfig(this.config.cab);
            if (this.pathPoints.length > 0) {
                this.positionOnPath(this.currentPathIndex);
            }
        });

        frontBogieFolder.addBinding(this.config.cab.frontBogie, 'frontWheelOffset', {
            label: 'Front Wheel Offset',
            min: -5.0,
            max: 5.0,
            step: 0.1
        }).on('change', (ev) => {
            this.config.cab.frontBogie.frontWheelOffset = ev.value;
            if (this.pathPoints.length > 0) {
                this.positionOnPath(this.currentPathIndex);
            }
        });

        frontBogieFolder.addBinding(this.config.cab.frontBogie, 'backWheelOffset', {
            label: 'Back Wheel Offset',
            min: -5.0,
            max: 5.0,
            step: 0.1
        }).on('change', (ev) => {
            this.config.cab.frontBogie.backWheelOffset = ev.value;
            if (this.pathPoints.length > 0) {
                this.positionOnPath(this.currentPathIndex);
            }
        });

        frontBogieFolder.addBinding(this.config.cab.frontBogie, 'entityName', {
            label: 'Entity Name (GLB)'
        }).on('change', () => this.updateConfig(this.config));

        frontBogieFolder.addBinding(this.config.cab.frontBogie, 'showDebug', {
            label: 'Show Debug'
        }).on('change', () => this.updateConfig(this.config));

        // Rear Bogie folder
        const rearBogieFolder = cabFolder.addFolder({ title: 'Rear Bogie', expanded: true });

        rearBogieFolder.addBinding(this.config.cab.rearBogie, 'zOffset', {
            label: 'Z Offset',
            min: -20.0,
            max: 20.0,
            step: 0.1
        }).on('change', (ev) => {
            this.config.cab.rearBogie.zOffset = ev.value;
            this.cab.updateConfig(this.config.cab);
            if (this.pathPoints.length > 0) {
                this.positionOnPath(this.currentPathIndex);
            }
        });

        rearBogieFolder.addBinding(this.config.cab.rearBogie, 'frontWheelOffset', {
            label: 'Front Wheel Offset',
            min: -5.0,
            max: 5.0,
            step: 0.1
        }).on('change', (ev) => {
            this.config.cab.rearBogie.frontWheelOffset = ev.value;
            if (this.pathPoints.length > 0) {
                this.positionOnPath(this.currentPathIndex);
            }
        });

        rearBogieFolder.addBinding(this.config.cab.rearBogie, 'backWheelOffset', {
            label: 'Back Wheel Offset',
            min: -5.0,
            max: 5.0,
            step: 0.1
        }).on('change', (ev) => {
            this.config.cab.rearBogie.backWheelOffset = ev.value;
            if (this.pathPoints.length > 0) {
                this.positionOnPath(this.currentPathIndex);
            }
        });

        rearBogieFolder.addBinding(this.config.cab.rearBogie, 'entityName', {
            label: 'Entity Name (GLB)'
        }).on('change', () => this.updateConfig(this.config));

        rearBogieFolder.addBinding(this.config.cab.rearBogie, 'showDebug', {
            label: 'Show Debug'
        }).on('change', () => this.updateConfig(this.config));

        // Add button to copy configuration as JSON
        this.pane.addButton({ title: 'Copy Config JSON' }).on('click', () => {
            const configJson = JSON.stringify(this.config, null, 2);
            navigator.clipboard.writeText(configJson).then(() => {
                console.log('Configuration copied to clipboard:', configJson);
                alert('Configuration copied to clipboard!');
            }).catch(err => {
                console.error('Failed to copy configuration:', err);
            });
        });

        // Add path index slider if we have a path
        if (this.pathPoints.length > 0) {
            const params = { pathIndex: this.currentPathIndex };
            this.pane.addBinding(params, 'pathIndex', {
                label: 'Path Position',
                min: 0,
                max: Math.max(0, this.pathPoints.length - 1),
                step: 1
            }).on('change', (ev) => {
                this.positionOnPath(ev.value);
            });
        }
    }

    public cleanup(): void {
        this.cab.cleanup();

        if (this.pane) {
            this.pane.dispose();
            this.pane = null;
        }
    }
}
