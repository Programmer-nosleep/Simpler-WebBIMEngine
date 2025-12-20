import * as THREE from "three";

export class CircleTool {
	private scene: THREE.Scene;
	private getCamera: () => THREE.Camera;
	private container: HTMLElement;

	private enabled = false;
	private isDrawing = false;
	private anchor: THREE.Vector3 | null = null;
	private previewMesh: THREE.Mesh | null = null;
	private dimOverlay: HTMLInputElement | null = null;

	private readonly segments = 48;

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

		const radius = this.anchor.distanceTo(hit);
		this.updatePreview(this.anchor, radius);

		if (this.dimOverlay) this.dimOverlay.placeholder = `R: ${radius.toFixed(2)}m`;
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
		if (!this.previewMesh) {
			const geometry = new THREE.CircleGeometry(1, this.segments);
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

		this.previewMesh.position.copy(center);
		this.previewMesh.scale.set(radius, 1, radius);
	}

	private finalize() {
		if (!this.previewMesh || !this.anchor) return;

		const radius = this.previewMesh.scale.x;
		const center = this.previewMesh.position.clone();

		const geometry = new THREE.CircleGeometry(1, this.segments);
		geometry.rotateX(-Math.PI / 2);
		const material = new THREE.MeshStandardMaterial({
			color: 0xcccccc,
			transparent: true,
			opacity: 0.5,
			side: THREE.DoubleSide,
		});
		const mesh = new THREE.Mesh(geometry, material);
		mesh.position.copy(center);
		mesh.scale.set(radius, 1, radius);

		mesh.userData = {
			...(mesh.userData || {}),
			type: "surface",
			mode: "circle",
			label: "Circle",
			category: "Plane/Sketch",
			QreaseeCategory: "Floor",
			selectable: true,
			locked: false,
			depth: 0,
			surfaceMeta: {
				kind: "circle",
				center: [center.x, center.z],
				radius,
				segments: this.segments,
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
		input.placeholder = "Radius";
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
			const val = parseFloat(input.value);
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

