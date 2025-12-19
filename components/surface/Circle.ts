import * as THREE from "three";
import * as OBC from "@thatopen/components";
import { CircleEntity } from "../../entity/CircleEntity";

export class CircleTool extends OBC.Component implements OBC.Disposable {
    enabled = false;
    readonly onDisposed = new OBC.Event();

    private _scene!: THREE.Scene;
    private _camera!: THREE.Camera;
    private _renderer!: THREE.WebGLRenderer;
    private _canvas!: HTMLCanvasElement;

    // State
    private isDrawing = false;
    private anchor: THREE.Vector3 | null = null;
    private previewMesh: THREE.Mesh | null = null;
    private dimOverlay: HTMLInputElement | null = null;

    private mouse = new THREE.Vector2();
    private raycaster = new THREE.Raycaster();
    private planeXZ = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);

    constructor(components: OBC.Components) {
        super(components);
    }

    setup(scene: THREE.Scene, camera: THREE.Camera, renderer: THREE.WebGLRenderer) {
        this._scene = scene;
        this._camera = camera;
        this._renderer = renderer;
        this._canvas = renderer.domElement;

        this._canvas.addEventListener("pointermove", this.onPointerMove);
        this._canvas.addEventListener("pointerdown", this.onPointerDown);
        window.addEventListener("keydown", this.onKeyDown);
    }

    dispose() {
        this.enabled = false;
        this.onDisposed.trigger();
        this.cleanup();
        this._canvas?.removeEventListener("pointermove", this.onPointerMove);
        this._canvas?.removeEventListener("pointerdown", this.onPointerDown);
        window.removeEventListener("keydown", this.onKeyDown);
    }

    private onPointerDown = (e: PointerEvent) => {
        if (!this.enabled || e.button !== 0) return;

        const hit = this.raycast(e);
        if (!hit) return;

        if (!this.isDrawing) {
            // Start drawing
            this.isDrawing = true;
            this.anchor = hit.clone();
            this.showDimInput(e.clientX, e.clientY);
        } else {
            // Finish drawing
            this.finalize();
        }
    };

    private onPointerMove = (e: PointerEvent) => {
        if (!this.enabled || !this.isDrawing || !this.anchor) return;

        const hit = this.raycast(e);
        if (!hit) return;

        const radius = this.anchor.distanceTo(hit);
        this.updatePreview(this.anchor, radius);

        if (this.dimOverlay) {
            this.dimOverlay.placeholder = `R: ${radius.toFixed(2)}m`;
        }
    };

    private onKeyDown = (e: KeyboardEvent) => {
        if (!this.enabled) return;

        if (e.key === 'Escape') {
            this.cancel();
        }
    };

    private raycast(e: PointerEvent): THREE.Vector3 | null {
        const rect = this._canvas.getBoundingClientRect();
        this.mouse.x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
        this.mouse.y = -((e.clientY - rect.top) / rect.height) * 2 + 1;

        this.raycaster.setFromCamera(this.mouse, this._camera);

        const hit = new THREE.Vector3();
        if (this.raycaster.ray.intersectPlane(this.planeXZ, hit)) {
            return hit;
        }
        return null;
    }

    private updatePreview(center: THREE.Vector3, radius: number) {
        if (!this.previewMesh) {
            const geometry = new THREE.CircleGeometry(1, 48); // Unit circle
            geometry.rotateX(-Math.PI / 2); // Lay flat
            const material = new THREE.MeshBasicMaterial({ color: 0x99ccff, transparent: true, opacity: 0.5, side: THREE.DoubleSide });
            this.previewMesh = new THREE.Mesh(geometry, material);
            this._scene.add(this.previewMesh);
        }

        this.previewMesh.position.copy(center);
        this.previewMesh.scale.set(radius, 1, radius); // Scale X and Z for radius
    }

    private finalize() {
        if (!this.previewMesh || !this.anchor) return;

        const radius = this.previewMesh.scale.x;
        const center = this.previewMesh.position.clone();

        const circle = new CircleEntity(radius);
        circle.setPosition(center.x, center.y, center.z);

        this._scene.add(circle.mesh);
        this.cleanup();
    }

    private cancel() {
        this.cleanup();
    }

    private cleanup() {
        this.isDrawing = false;
        this.anchor = null;

        if (this.previewMesh) {
            this.previewMesh.removeFromParent();
            (this.previewMesh.geometry as any).dispose();
            (this.previewMesh.material as any).dispose();
            this.previewMesh = null;
        }

        if (this.dimOverlay) {
            this.dimOverlay.remove();
            this.dimOverlay = null;
        }
    }

    private showDimInput(x: number, y: number) {
        if (this.dimOverlay) return;

        const input = document.createElement('input');
        input.type = 'text';
        input.placeholder = "Radius";
        Object.assign(input.style, {
            position: "fixed",
            left: `${x + 10}px`,
            top: `${y + 10}px`,
            zIndex: "1000",
            padding: "4px",
            borderRadius: "4px",
            border: "1px solid #ccc"
        });

        input.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') {
                const val = parseFloat(input.value);
                if (val > 0 && this.anchor) {
                    this.updatePreview(this.anchor, val);
                    this.finalize();
                }
            }
        });

        document.body.appendChild(input);
        this.dimOverlay = input;
        setTimeout(() => input.focus(), 10);
    }
}
