import * as THREE from "three";
import { ensureClosedRing } from "../../helpers/polygon-clipper";

export class PolygonTool {
	private scene: THREE.Scene;
	private getCamera: () => THREE.Camera;
	private container: HTMLElement;

	private enabled = false;
	private isDrawing = false;
	private anchor: THREE.Vector3 | null = null;
	private previewMesh: THREE.Mesh | null = null;
	private dimOverlay: HTMLInputElement | null = null;

	private sides = 6;

	private mouse = new THREE.Vector2();
	private raycaster = new THREE.Raycaster();
	private planeXZ = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);

	constructor(
		scene: THREE.Scene,
		camera: THREE.Camera | (() => THREE.Camera),
		container: HTMLElement
	) {
		this.scene = scene;
		this.getCamera = typeof camera === "function" ? camera : () => camera;
		this.container = container;
	}

	public enable() {
		if (this.enabled) return;
		this.enabled = true;
		this.container.style.cursor = "crosshair";

		this.container.addEventListener("pointermove", this.onPointerMove, { capture: true });
		this.container.addEventListener("pointerdown", this.onPointerDown, { capture: true });
		this.container.addEventListener("wheel", this.onWheel, { passive: true });
		window.addEventListener("keydown", this.onKeyDown);
	}

	public disable() {
		if (!this.enabled) return;
		this.enabled = false;
		this.container.style.cursor = "default";

		this.container.removeEventListener("pointermove", this.onPointerMove, { capture: true });
		this.container.removeEventListener("pointerdown", this.onPointerDown, { capture: true });
		this.container.removeEventListener("wheel", this.onWheel as any);
		window.removeEventListener("keydown", this.onKeyDown);

		this.cleanup();
	}

	private onPointerDown = (event: PointerEvent) => {
		if (!this.enabled || event.button !== 0) return;

		const hit = this.raycast(event);
		if (!hit) return;

		event.preventDefault();
		event.stopPropagation();

		if (!this.isDrawing) {
			this.isDrawing = true;
			this.anchor = hit.clone();
			this.showDimInput(event.clientX, event.clientY);
		} else {
			this.finalize();
		}
	};

	private onPointerMove = (event: PointerEvent) => {
		if (!this.enabled || !this.isDrawing || !this.anchor) return;

		const hit = this.raycast(event);
		if (!hit) return;

		event.preventDefault();
		event.stopPropagation();

		const radius = this.anchor.distanceTo(hit);
		this.updatePreview(this.anchor, radius);

		if (this.dimOverlay) {
			this.dimOverlay.placeholder = `R: ${radius.toFixed(2)}m (Sides: ${this.sides})`;
		}
	};

	private onWheel = (event: WheelEvent) => {
		if (!this.enabled || !this.isDrawing) return;

		const delta = Math.sign(event.deltaY) * -1;
		if (delta === 0) return;

		this.sides = Math.max(3, Math.min(64, this.sides + delta));

		if (this.anchor && this.previewMesh) {
			const r = this.previewMesh.scale.x;
			this.updatePreview(this.anchor, r);
		}
	};

	private onKeyDown = (event: KeyboardEvent) => {
		if (!this.enabled) return;
		if (event.key === "Escape") this.cancel();
	};

	private raycast(event: PointerEvent): THREE.Vector3 | null {
		const rect = this.container.getBoundingClientRect();
		this.mouse.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
		this.mouse.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;

		this.raycaster.setFromCamera(this.mouse, this.getCamera());

		const hit = new THREE.Vector3();
		if (this.raycaster.ray.intersectPlane(this.planeXZ, hit)) return hit;
		return null;
	}

	private updatePreview(center: THREE.Vector3, radius: number) {
		if (this.previewMesh) {
			const params = (this.previewMesh.geometry as any).parameters as
				| { segments?: number; segmentsRadial?: number }
				| undefined;
			const currentSegments = params?.segments ?? params?.segmentsRadial;
			if (currentSegments !== this.sides) {
				this.previewMesh.removeFromParent();
				this.previewMesh.geometry.dispose();
				(this.previewMesh.material as THREE.Material).dispose();
				this.previewMesh = null;
			}
		}

		if (!this.previewMesh) {
			const geometry = new THREE.CircleGeometry(1, this.sides);
			geometry.rotateX(-Math.PI / 2);
			const material = new THREE.MeshBasicMaterial({
				color: 0x99ccff,
				// transparent: true,
				opacity: 1.0,
				side: THREE.DoubleSide,
			});
			this.previewMesh = new THREE.Mesh(geometry, material);
			this.previewMesh.userData.isHelper = true;
			this.previewMesh.userData.selectable = false;
			this.scene.add(this.previewMesh);
		}

		this.previewMesh.position.set(center.x, -0.5, center.z);
		this.previewMesh.scale.set(radius, 1, radius);
	}

	private finalize() {
		if (!this.previewMesh || !this.anchor) return;

		const radius = this.previewMesh.scale.x;
		const center = this.previewMesh.position.clone();
		const sides = this.sides;

		const pts: THREE.Vector2[] = [];
		for (let i = 0; i < sides; i++) {
			const theta = (i / sides) * Math.PI * 2;
			pts.push(new THREE.Vector2(Math.cos(theta) * radius, Math.sin(theta) * radius));
		}

		const shape = new THREE.Shape();
		shape.setFromPoints(pts);
		const geom = new THREE.ShapeGeometry(shape);
		geom.rotateX(-Math.PI / 2);

		const mat = new THREE.MeshStandardMaterial({
			color: 0xcccccc,
			transparent: true,
			opacity: 0.5,
			side: THREE.DoubleSide,
		});
		const mesh = new THREE.Mesh(geom, mat);
		mesh.position.copy(center);

		const ring = ensureClosedRing(pts.map((p) => [center.x + p.x, center.z + p.y] as [number, number]));

		mesh.userData = {
			...(mesh.userData || {}),
			type: "surface",
			mode: "poly",
			label: "Polygon",
			category: "Plane/Sketch",
			QreaseeCategory: "Floor",
			selectable: true,
			locked: false,
			depth: 0,
			polyVertices: ring.map(([x, z]) => ({ x, z })),
			surfaceMeta: {
				kind: "poly",
				center: [center.x, center.z],
				vertices: ring,
				normal: { x: 0, y: 1, z: 0 },
			},
		};

		this.scene.add(mesh);
		this.cleanup();
	}

	private cancel() {
		this.cleanup();
	}

	private cleanup() {
		this.isDrawing = false;
		this.anchor = null;
		this.sides = 6;

		if (this.previewMesh) {
			this.previewMesh.removeFromParent();
			this.previewMesh.geometry.dispose();
			(this.previewMesh.material as THREE.Material).dispose();
			this.previewMesh = null;
		}

		if (this.dimOverlay) {
			this.dimOverlay.remove();
			this.dimOverlay = null;
		}
	}

	private showDimInput(x: number, y: number) {
		if (this.dimOverlay) return;

		const input = document.createElement("input");
		input.type = "text";
		input.placeholder = `Radius (Sides: ${this.sides})`;
		Object.assign(input.style, {
			position: "fixed",
			left: `${x + 10}px`,
			top: `${y + 10}px`,
			zIndex: "1000",
			padding: "4px",
			borderRadius: "4px",
			border: "1px solid #ccc",
			background: "rgba(255,255,255,0.95)",
		});

		input.addEventListener("keydown", (event) => {
			if (event.key !== "Enter") return;

			const valStr = input.value.trim().toLowerCase();

			// contoh: "8s" buat sides
			if (valStr.endsWith("s")) {
				const s = parseInt(valStr.slice(0, -1), 10);
				if (Number.isFinite(s) && s >= 3) {
					this.sides = Math.max(3, Math.min(64, s));
					input.value = "";
					if (this.anchor && this.previewMesh) {
						const r = this.previewMesh.scale.x;
						this.updatePreview(this.anchor, r);
					}
				}
				return;
			}

			const val = parseFloat(valStr);
			if (Number.isFinite(val) && val > 0 && this.anchor) {
				this.updatePreview(this.anchor, val);
				this.finalize();
			}
		});

		document.body.appendChild(input);
		this.dimOverlay = input;
		setTimeout(() => input.focus(), 10);
	}
}
