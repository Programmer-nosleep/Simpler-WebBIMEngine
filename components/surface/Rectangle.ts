import * as THREE from "three";
import { splitFloorsWithNewRect } from "../../helpers/polygon-clipper";

function makeMaterial(color = 0xffffff, opacity = 1.0) {
	return new THREE.MeshStandardMaterial({
		color,
		transparent: opacity < 1,
		opacity,
		side: THREE.DoubleSide,
	});
}

function makeEdgeMaterial(color = 0x000000) {
	return new THREE.LineBasicMaterial({ color });
}

export class RectangleTool {
	private scene: THREE.Scene;
	private getCamera: () => THREE.Camera;
	private container: HTMLElement;

	private enabled = false;
	private isDrawing = false;
	private anchor: THREE.Vector3 | null = null;
	private previewMesh: THREE.Mesh | null = null;
	private previewEdge: THREE.LineLoop | null = null;
	private dimOverlay: HTMLInputElement | null = null;

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
		window.addEventListener("keydown", this.onKeyDown);
	}

	public disable() {
		if (!this.enabled) return;
		this.enabled = false;
		this.container.style.cursor = "default";

		this.container.removeEventListener("pointermove", this.onPointerMove, { capture: true });
		this.container.removeEventListener("pointerdown", this.onPointerDown, { capture: true });
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
			return;
		}

		this.finalize();
	};

	private onPointerMove = (event: PointerEvent) => {
		if (!this.enabled || !this.isDrawing || !this.anchor) return;

		const hit = this.raycast(event);
		if (!hit) return;

		event.preventDefault();
		event.stopPropagation();

		this.updatePreview(this.anchor, hit);

		if (this.dimOverlay) {
			const w = Math.abs(hit.x - this.anchor.x).toFixed(2);
			const l = Math.abs(hit.z - this.anchor.z).toFixed(2);
			this.dimOverlay.placeholder = `${w}m x ${l}m`;
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

	private updatePreview(p1: THREE.Vector3, p2: THREE.Vector3) {
		const minX = Math.min(p1.x, p2.x);
		const maxX = Math.max(p1.x, p2.x);
		const minZ = Math.min(p1.z, p2.z);
		const maxZ = Math.max(p1.z, p2.z);

		const width = maxX - minX;
		const length = maxZ - minZ;
		const cx = minX + width / 2;
		const cz = minZ + length / 2;

		if (!this.previewMesh) {
			const geom = new THREE.PlaneGeometry(1, 1);
			geom.rotateX(-Math.PI / 2);
			this.previewMesh = new THREE.Mesh(geom, makeMaterial(0x99ccff, 0.5));
			this.previewMesh.userData.isHelper = true;
			this.previewMesh.userData.selectable = false;
			this.scene.add(this.previewMesh);
		}

		this.previewMesh.position.set(cx, 0, cz);
		this.previewMesh.scale.set(width, 1, length);

		if (!this.previewEdge) {
			const pts = [
				new THREE.Vector3(-0.5, 0, -0.5),
				new THREE.Vector3(0.5, 0, -0.5),
				new THREE.Vector3(0.5, 0, 0.5),
				new THREE.Vector3(-0.5, 0, 0.5),
			];
			const g = new THREE.BufferGeometry().setFromPoints(pts);
			this.previewEdge = new THREE.LineLoop(g, makeEdgeMaterial());
			this.previewEdge.userData.isHelper = true;
			this.previewEdge.userData.selectable = false;
			this.scene.add(this.previewEdge);
		}

		this.previewEdge.position.set(cx, 0.001, cz);
		this.previewEdge.scale.set(width, 1, length);
	}

	private finalize() {
		if (!this.previewMesh || !this.anchor) return;

		const width = this.previewMesh.scale.x;
		const length = this.previewMesh.scale.z;
		const cx = this.previewMesh.position.x;
		const cz = this.previewMesh.position.z;

		const geometry = new THREE.PlaneGeometry(1, 1);
		geometry.rotateX(-Math.PI / 2);
		const mesh = new THREE.Mesh(geometry, makeMaterial(0xcccccc, 0.5));
		mesh.position.set(cx, 0, cz);
		mesh.scale.set(width, 1, length);

		mesh.userData = {
			...(mesh.userData || {}),
			type: "surface",
			mode: "rect",
			label: "Rectangle",
			category: "Plane/Sketch",
			QreaseeCategory: "Floor",
			selectable: true,
			locked: false,
			depth: 0,
			surfaceMeta: {
				kind: "rect",
				center: [cx, cz],
				width,
				length,
				normal: { x: 0, y: 1, z: 0 },
			},
		};

		splitFloorsWithNewRect(this.scene, mesh, { depth: 0 });
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
			this.previewMesh.geometry.dispose();
			(this.previewMesh.material as THREE.Material).dispose();
			this.previewMesh = null;
		}

		if (this.previewEdge) {
			this.previewEdge.removeFromParent();
			this.previewEdge.geometry.dispose();
			(this.previewEdge.material as THREE.Material).dispose();
			this.previewEdge = null;
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
		input.placeholder = "0m x 0m";
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

			const parts = input.value.trim().split(/[x, ]+/).filter(Boolean);
			if (parts.length < 2) return;

			const w = parseFloat(parts[0]);
			const l = parseFloat(parts[1]);

			if (Number.isFinite(w) && Number.isFinite(l) && w > 0 && l > 0 && this.anchor) {
				this.updatePreview(
					this.anchor,
					new THREE.Vector3(this.anchor.x + w, 0, this.anchor.z + l)
				);
				this.finalize();
			}
		});

		document.body.appendChild(input);
		this.dimOverlay = input;
		setTimeout(() => input.focus(), 10);
	}
}

