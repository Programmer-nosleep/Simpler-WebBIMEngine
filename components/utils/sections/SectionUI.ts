import * as THREE from "three";

export class SectionUI {
	private scene: THREE.Scene;
	private camera: THREE.Camera;
	private renderer: THREE.WebGLRenderer;
	private container: HTMLElement;
	private raycaster: THREE.Raycaster;
	private pointer: THREE.Vector2;
	private previewBox: THREE.Mesh;
	private active: boolean = false;
	private sections: THREE.Group;

	constructor(
		scene: THREE.Scene,
		camera: THREE.Camera,
		renderer: any,
		container: HTMLElement
	) {
		this.scene = scene;
		this.camera = camera;
		// Handle if renderer is a wrapper or the THREE renderer itself
		this.renderer = renderer.three || renderer;
		this.container = container;
		this.raycaster = new THREE.Raycaster();
		this.pointer = new THREE.Vector2();
		this.sections = new THREE.Group();
		this.scene.add(this.sections);

		// Preview Box (Blue Box)
		const geometry = new THREE.BoxGeometry(1, 1, 1);
		const material = new THREE.MeshBasicMaterial({
			color: 0x0000ff,
			wireframe: true,
			transparent: true,
			opacity: 0.5,
		});
		this.previewBox = new THREE.Mesh(geometry, material);
		this.previewBox.visible = false;
		// Ensure preview box isn't raycasted
		this.previewBox.raycast = () => {};
		this.scene.add(this.previewBox);

		if (this.renderer) {
			this.renderer.localClippingEnabled = true;
		}

		this.container.addEventListener("pointermove", this.onPointerMove);
		this.container.addEventListener("pointerdown", this.onPointerDown);
	}

	enable() {
		this.active = true;
		this.previewBox.visible = false;
	}

	disable() {
		this.active = false;
		this.previewBox.visible = false;
	}

	private onPointerMove = (event: PointerEvent) => {
		if (!this.active) return;

		const rect = this.container.getBoundingClientRect();
		this.pointer.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
		this.pointer.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;

		this.raycaster.setFromCamera(this.pointer, this.camera);
		const intersects = this.raycaster.intersectObjects(this.scene.children, true);

		// Filter valid meshes (exclude helpers, sky, etc.)
		const hit = intersects.find((i) => {
			if (i.object === this.previewBox) return false;
			if (i.object.userData.isHelper) return false;
			if (i.object.name === "SkyDome" || i.object.name === "Grid" || i.object.name === "AxesWorld") return false;
			return (i.object as any).isMesh;
		});

		if (hit && hit.face) {
			this.previewBox.visible = true;
			this.previewBox.position.copy(hit.point);
			
			// Align box to surface normal
			const normal = hit.face.normal!.clone().transformDirection(hit.object.matrixWorld).normalize();
			const quaternion = new THREE.Quaternion();
			quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), normal);
			this.previewBox.setRotationFromQuaternion(quaternion);
		} else {
			this.previewBox.visible = false;
		}
	};

	private onPointerDown = (event: PointerEvent) => {
		if (!this.active || !this.previewBox.visible) return;
		if (event.button !== 0) return; // Left click only

		this.createSection(this.previewBox.position, this.previewBox.quaternion);
	};

	private createSection(position: THREE.Vector3, quaternion: THREE.Quaternion) {
		const size = 2;
		const geometry = new THREE.BoxGeometry(size, size, size);
		const material = new THREE.MeshBasicMaterial({
			color: 0x0000ff,
			wireframe: true,
			transparent: true,
			opacity: 0.3,
			side: THREE.DoubleSide
		});
		const sectionBox = new THREE.Mesh(geometry, material);
		sectionBox.position.copy(position);
		sectionBox.setRotationFromQuaternion(quaternion);
		sectionBox.userData.isSection = true;
		this.sections.add(sectionBox);

		// Create a clipping plane
		// Plane normal is the box's Y axis (since we aligned Y to surface normal)
		// We point it downwards (0, -1, 0) relative to the box to cut "into" the object
		const normal = new THREE.Vector3(0, -1, 0).applyQuaternion(quaternion).normalize();
		const constant = -position.dot(normal);
		const plane = new THREE.Plane(normal, constant);
		
		// Apply to global clipping planes
		this.renderer.clippingPlanes = [plane];
	}
}
