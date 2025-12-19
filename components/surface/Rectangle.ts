import * as THREE from "three";
import * as OBC from "@thatopen/components";
import { RectangleEntity } from "../../entity/RectangleEntity";
import { splitFloorsWithNewRect } from "../../helpers/polygon-clipper";

// Helper for temporary material
function makeMaterial(color = 0xffffff, opacity = 1.0) {
    return new THREE.MeshStandardMaterial({
        color: color,
        transparent: opacity < 1,
        opacity: opacity,
        side: THREE.DoubleSide,
    });
}

function makeEdgeMaterial(color = 0x000000) {
    return new THREE.LineBasicMaterial({ color: color });
}

export class RectangleTool extends OBC.Component implements OBC.Disposable {
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
    private previewEdge: THREE.LineLoop | null = null;
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

            // Initial input for dimensions
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

        // Calculate dimensions
        // Handle shift/ctrl axis locking if needed (skipped for brevity)

        this.updatePreview(this.anchor, hit);

        // Update input placeholder/value if visible
        if (this.dimOverlay) {
            const w = (Math.abs(hit.x - this.anchor.x)).toFixed(2);
            const l = (Math.abs(hit.z - this.anchor.z)).toFixed(2);
            this.dimOverlay.placeholder = `${w}m x ${l}m`;
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

        // 1. Check vertical faces first? (Skipped for basic impl)

        // 2. Check Plane XZ
        const hit = new THREE.Vector3();
        if (this.raycaster.ray.intersectPlane(this.planeXZ, hit)) {
            return hit;
        }
        return null;
    }

    private updatePreview(p1: THREE.Vector3, p2: THREE.Vector3) {
        const minX = Math.min(p1.x, p2.x);
        const maxX = Math.max(p1.x, p2.x);
        const minZ = Math.min(p1.z, p2.z);
        const maxZ = Math.max(p1.z, p2.z);

        const w = maxX - minX;
        const l = maxZ - minZ;
        const cx = minX + w / 2;
        const cz = minZ + l / 2;

        // Update Mesh
        if (!this.previewMesh) {
            const geom = new THREE.PlaneGeometry(1, 1);
            geom.rotateX(-Math.PI / 2);
            this.previewMesh = new THREE.Mesh(geom, makeMaterial(0x99ccff, 0.5));
            this._scene.add(this.previewMesh);
        }

        this.previewMesh.position.set(cx, 0, cz);
        this.previewMesh.scale.set(w, 1, l);

        // Update Edge
        if (!this.previewEdge) {
            // Unit square
            const pts = [
                new THREE.Vector3(-0.5, 0, -0.5),
                new THREE.Vector3(0.5, 0, -0.5),
                new THREE.Vector3(0.5, 0, 0.5),
                new THREE.Vector3(-0.5, 0, 0.5)
            ];
            const g = new THREE.BufferGeometry().setFromPoints(pts);
            this.previewEdge = new THREE.LineLoop(g, makeEdgeMaterial());
            this._scene.add(this.previewEdge);
        }
        this.previewEdge.position.set(cx, 0, cz);
        this.previewEdge.scale.set(w, 1, l);
    }

    private finalize() {
        if (!this.previewMesh || !this.anchor) return;

        // Get Dimensions from preview
        const width = this.previewMesh.scale.x;
        const length = this.previewMesh.scale.z;
        const cx = this.previewMesh.position.x;
        const cz = this.previewMesh.position.z;

        // Create Entity
        const rectEntity = new RectangleEntity(width, length);
        rectEntity.setPosition(cx, 0, cz);

        this._scene.add(rectEntity.mesh);

        // Perform Boolean on Floors
        // We assume depth=0 for floor cutting, or use specific depth
        splitFloorsWithNewRect(this._scene, rectEntity.mesh as THREE.Mesh, { depth: 0 });

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

        if (this.previewEdge) {
            this.previewEdge.removeFromParent();
            (this.previewEdge.geometry as any).dispose();
            (this.previewEdge.material as any).dispose();
            this.previewEdge = null;
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
        input.placeholder = "0m x 0m";
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
                // Parse dims and finalize
                // For now, basic parsing logic
                const parts = input.value.split(/[x, ]+/);
                if (parts.length >= 2) {
                    // Apply manual dimensions
                    const w = parseFloat(parts[0]);
                    const l = parseFloat(parts[1]);
                    if (w > 0 && l > 0 && this.anchor) {
                        this.updatePreview(this.anchor, new THREE.Vector3(this.anchor.x + w, 0, this.anchor.z + l));
                        this.finalize();
                    }
                }
            }
        });

        document.body.appendChild(input);
        this.dimOverlay = input;
        setTimeout(() => input.focus(), 10);
    }
}
