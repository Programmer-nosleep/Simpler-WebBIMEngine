import * as THREE from "three";
import * as OBC from "@thatopen/components";
import { CircleEntity } from "../../entity/CircleEntity";

export class PolygonTool extends OBC.Component implements OBC.Disposable {
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

    private sides = 6;

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
        this._canvas.addEventListener("wheel", this.onWheel);
        window.addEventListener("keydown", this.onKeyDown);
    }

    dispose() {
        this.enabled = false;
        this.onDisposed.trigger();
        this.cleanup();
        this._canvas?.removeEventListener("pointermove", this.onPointerMove);
        this._canvas?.removeEventListener("pointerdown", this.onPointerDown);
        this._canvas?.removeEventListener("wheel", this.onWheel);
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
            this.dimOverlay.placeholder = `R: ${radius.toFixed(2)}m (Sides: ${this.sides})`;
            // Also update text if user didn't type??
        }
    };

    private onWheel = (e: WheelEvent) => {
        if (!this.enabled || !this.isDrawing) return;

        const delta = Math.sign(e.deltaY) * -1;
        if (delta !== 0) {
            this.sides = Math.max(3, Math.min(64, this.sides + delta));

            // Refresh preview if active
            if (this.anchor && this.previewMesh) {
                // Rebuild geometry
                const currentRadius = this.previewMesh.scale.x;
                // Actually scale is applied to unit geometry, so we need to destroy/recreate 
                // OR set geometry. CircleGeometry allows sides params.
                this.updatePreview(this.anchor, currentRadius);
            }
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
        if (this.previewMesh) {
            // Check if sides changed, need dispose
            const currentSides = (this.previewMesh.geometry as any).parameters?.segments;
            if (currentSides !== this.sides) {
                this.previewMesh.removeFromParent();
                this.previewMesh.geometry.dispose();
                (this.previewMesh.material as any).dispose();
                this.previewMesh = null;
            }
        }

        if (!this.previewMesh) {
            const geometry = new THREE.CircleGeometry(1, this.sides); // Unit poly
            geometry.rotateX(-Math.PI / 2); // Lay flat
            // Rotate texture/shape to align first vertex?
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
        const sides = this.sides;

        // Create Generic Mesh/Entity for Polygon
        // We can just use CircleEntity logic with 'segments' = sides, or custom Logic
        // Since CircleEntity handles segments, let's reuse it for now but maybe alias it?
        // Or create a direct Mesh here.

        const shape = new THREE.Shape();
        // Calculate vertices
        const pts: THREE.Vector2[] = [];
        for (let i = 0; i < sides; i++) {
            const theta = (i / sides) * Math.PI * 2;
            const x = Math.cos(theta) * radius;
            const y = Math.sin(theta) * radius; // y is Z on ground
            pts.push(new THREE.Vector2(x, y));
        }
        shape.setFromPoints(pts);
        const geom = new THREE.ShapeGeometry(shape);
        geom.rotateX(-Math.PI / 2);

        const mat = new THREE.MeshStandardMaterial({ color: 0xcccccc, side: THREE.DoubleSide });
        const mesh = new THREE.Mesh(geom, mat);
        mesh.position.copy(center);

        mesh.userData = {
            type: "surface",
            entityType: "polygon",
            mode: "poly",
            surfaceMeta: {
                kind: "poly",
                center: [center.x, center.z],
                vertices: pts.map(p => ({ x: center.x + p.x, z: center.z + p.y })) // World coords
            },
            selectable: true
        };

        this._scene.add(mesh);
        this.cleanup();
    }

    private cancel() {
        this.cleanup();
    }

    private cleanup() {
        this.isDrawing = false;
        this.anchor = null;
        this.sides = 6; // Reset default

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
        input.placeholder = `Radius (Sides: ${this.sides})`;
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
                // Support "3m" or "6s" (sides) parsing from original snippet?
                const valStr = input.value.trim().toLowerCase();
                if (valStr.endsWith('s')) {
                    const s = parseInt(valStr);
                    if (Number.isFinite(s) && s >= 3) {
                        this.sides = s;
                        input.value = "";
                        if (this.anchor && this.previewMesh) {
                            const r = this.previewMesh.scale.x;
                            this.updatePreview(this.anchor, r); // Rebuild with new sides
                        }
                        return;
                    }
                }

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
