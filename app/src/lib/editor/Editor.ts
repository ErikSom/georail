import {
    Scene,
    WebGLRenderer,
    PerspectiveCamera,
    Clock,
    Raycaster,
} from 'three';
import { MapViewer } from '../MapViewer';
import { FlightControls } from '../utils/FlightControls';
import { Input } from '../utils/Input';

export class Editor {
    private scene!: Scene;
    private camera!: PerspectiveCamera;
    private renderer!: WebGLRenderer;
    private clock!: Clock;

    private flightControls!: FlightControls;
    private mapViewer!: MapViewer;
    private raycaster = new Raycaster();

    private rafId: number | null = null;
    private mountElement: HTMLDivElement;
    private setCreditsCallback: (credits: string) => void;

    constructor(mountElement: HTMLDivElement, setCreditsCallback: (credits: string) => void) {
        this.mountElement = mountElement;
        this.setCreditsCallback = setCreditsCallback;

        this.animate = this.animate.bind(this);
        this.onWindowResize = this.onWindowResize.bind(this);
    }

    public init(): void {
        this.scene = new Scene();
        this.clock = new Clock();
        this.renderer = new WebGLRenderer({ antialias: true });
        this.renderer.setClearColor(0x151c1f);
        this.renderer.setPixelRatio(window.devicePixelRatio);
        this.renderer.setSize(this.mountElement.clientWidth, this.mountElement.clientHeight);
        this.mountElement.appendChild(this.renderer.domElement);

        this.camera = new PerspectiveCamera(60, this.mountElement.clientWidth / this.mountElement.clientHeight, 1, 1e6);
        this.camera.position.set(1e3, 1e3, 1e3).multiplyScalar(0.5);

        Input.init(this.renderer.domElement);

        this.mapViewer = new MapViewer();
        this.mapViewer.init(this.scene, this.camera, this.renderer);

        this.flightControls = new FlightControls(this.camera, this.renderer.domElement);
        this.flightControls.init();

        window.addEventListener('resize', this.onWindowResize, false);

        this.animate();
    }

    private handleRaycasting(): void {
        // Check for a left-click (button 0) *only* when not in flight mode
        if (Input.isMousePressed(0) && !this.flightControls.controls.isLocked) {

            // 1. Update the raycaster
            this.raycaster.setFromCamera(Input.mouse, this.camera);
            const intersects = this.raycaster.intersectObject(this.scene, true);

            console.log(intersects);

            if (intersects.length) {

                const { face, object } = intersects[0];
                // @ts-ignore
                const batchidAttr = object.geometry.getAttribute('_batchid');

                if (batchidAttr) {

                    // Traverse the parents to find the batch table.
                    let batchTableObject = object;
                    // @ts-ignore
                    while (!batchTableObject.batchTable) {
                        // @ts-ignore
                        batchTableObject = batchTableObject.parent;

                    }

                    // Log the batch data
                    // @ts-ignore
                    const batchTable = batchTableObject.batchTable;
                    // @ts-ignore
                    const hoveredBatchid = batchidAttr.getX(face.a);
                    const batchData = batchTable.getDataFromId(hoveredBatchid);
                    console.log(batchData);

                }

            }

        }
    }


    public cleanup(): void {
        if (this.rafId) {
            cancelAnimationFrame(this.rafId);
        }

        window.removeEventListener('resize', this.onWindowResize);

        this.flightControls.cleanup();
        this.mapViewer.cleanup();
        Input.cleanup();

        this.renderer.dispose();

        if (this.mountElement) {
            this.mountElement.removeChild(this.renderer.domElement);
        }
    }

    private onWindowResize(): void {
        const width = this.mountElement.clientWidth;
        const height = this.mountElement.clientHeight;

        this.camera.aspect = width / height;
        this.renderer.setSize(width, height);
        this.camera.updateProjectionMatrix();
        this.renderer.setPixelRatio(window.devicePixelRatio);
    }

    private animate(): void {
        this.rafId = requestAnimationFrame(this.animate);
        const dt = this.clock.getDelta();

        this.flightControls.update(dt);
        this.camera.updateMatrixWorld();
        this.mapViewer.update();
        this.renderer.render(this.scene, this.camera);

        this.handleRaycasting();

        this.setCreditsCallback(this.mapViewer.getCredits());

        Input.update();
    }
}