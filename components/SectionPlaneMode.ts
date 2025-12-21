import * as THREE from "three";
import type { CameraSceneApi } from "./CameraScene";
import type { LeftSidebarHandle } from "./ui/LeftSidebar";
import { SectionManager, type SectionMode } from "./utils/sections/SectionManager";

export class SectionTool {
	private readonly cameraScene: CameraSceneApi;
	private readonly container: HTMLElement;
	private readonly raycaster = new THREE.Raycaster();
	private readonly pointer = new THREE.Vector2();
	private readonly sectionManager: SectionManager;

	private enabled = false;
	private selectableRoots: THREE.Object3D[] = [];
	private lastPreview: { mode: SectionMode; plane: THREE.Plane } | null = null;

	constructor(cameraScene: CameraSceneApi, sidebar: LeftSidebarHandle, container: HTMLElement) {
		this.cameraScene = cameraScene;
		this.container = container;
		this.sectionManager = new SectionManager(cameraScene, sidebar);
		this.cameraScene.renderer.localClippingEnabled = true;
	}

	enable() {
		if (this.enabled) return;
		this.enabled = true;

		this.refreshBounds();
		this.sectionManager.handleToolActive(true);
		this.container.style.cursor = "crosshair";

		this.container.addEventListener("pointermove", this.onPointerMove);
		this.container.addEventListener("pointerdown", this.onPointerDown, { capture: true });
	}

	disable() {
		if (!this.enabled) return;
		this.enabled = false;

		this.sectionManager.handleToolActive(false);
		this.container.style.cursor = "default";

		this.container.removeEventListener("pointermove", this.onPointerMove);
		this.container.removeEventListener("pointerdown", this.onPointerDown, { capture: true });
		this.lastPreview = null;
	}

	refreshBounds() {
		this.selectableRoots = this.getSelectableRoots();
		this.sectionManager.setBoundsFromObjects(this.selectableRoots);
	}

	private getSelectableRoots() {
		const roots: THREE.Object3D[] = [];
		this.cameraScene.scene.traverse((obj) => {
			const ud: any = obj.userData || {};
			if (ud.isHelper) return;
			if (ud.selectable !== true) return;
			roots.push(obj);
		});
		return roots;
	}

	private isValidHit(hit: THREE.Intersection) {
		const obj: any = hit.object as any;
		if (!obj) return false;
		if (obj.userData?.isHelper) return false;
		if (obj.userData?.selectable === false) return false;
		if (obj.userData?.isSection) return false;
		if (obj.name === "SkyDome" || obj.name === "Grid" || obj.name === "AxesWorld") return false;
		return (obj as any).isMesh === true;
	}

	private onPointerMove = (event: PointerEvent) => {
		if (!this.enabled) return;

		const rect = this.container.getBoundingClientRect();
		this.pointer.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
		this.pointer.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;

		this.raycaster.setFromCamera(this.pointer, this.cameraScene.camera.three);

		const targets =
			this.selectableRoots.length > 0 ? this.selectableRoots : this.cameraScene.scene.children;
		const hits = this.raycaster.intersectObjects(targets, true);
		const hit = hits.find((h) => this.isValidHit(h));

		if (!hit) {
			this.lastPreview = null;
			return;
		}

		const worldNormal = this.getWorldNormal(hit);
		const mode = this.getSectionMode(worldNormal);
		const plane = this.getSectionPlane(mode, hit.point, worldNormal);
		this.lastPreview = { mode, plane };
		this.sectionManager.setPreviewPlane(plane);
	};

	private onPointerDown = (event: PointerEvent) => {
		if (!this.enabled) return;
		if (event.button !== 0) return;
		if (!this.lastPreview) return;

		const index = this.sectionManager.getSectionCount() + 1;
		const label = this.lastPreview.mode === "horizontal" ? `Plan ${index}` : `Section ${index}`;
		this.sectionManager.createSection(label, this.lastPreview.mode, this.lastPreview.plane);
	};

	private getWorldNormal(hit: THREE.Intersection) {
		const face = hit.face;
		if (!face) return null;
		return face.normal
			.clone()
			.transformDirection(hit.object.matrixWorld)
			.normalize();
	}

	private getSectionMode(worldNormal: THREE.Vector3 | null): SectionMode {
		if (!worldNormal) return "horizontal";
		return Math.abs(worldNormal.y) > 0.65 ? "horizontal" : "vertical";
	}

	private getSectionPlane(
		mode: SectionMode,
		point: THREE.Vector3,
		worldNormal: THREE.Vector3 | null
	) {
		if (mode === "horizontal") {
			const plane = new THREE.Plane(new THREE.Vector3(0, 1, 0), -point.y);
			this.orientPlaneToClipTowardsCamera(plane);
			return plane;
		}

		const horizontalNormal = worldNormal
			? new THREE.Vector3(worldNormal.x, 0, worldNormal.z)
			: new THREE.Vector3(1, 0, 0);

		if (horizontalNormal.lengthSq() < 1e-6) {
			const cameraDir = new THREE.Vector3();
			this.cameraScene.camera.three.getWorldDirection(cameraDir);
			horizontalNormal.set(cameraDir.x, 0, cameraDir.z);
		}

		if (horizontalNormal.lengthSq() < 1e-6) {
			horizontalNormal.set(1, 0, 0);
		}

		horizontalNormal.normalize();
		const plane = new THREE.Plane(horizontalNormal, -point.dot(horizontalNormal));
		this.orientPlaneToClipTowardsCamera(plane);
		return plane;
	}

	private orientPlaneToClipTowardsCamera(plane: THREE.Plane) {
		plane.normalize();
		const cameraPos = new THREE.Vector3();
		this.cameraScene.camera.three.getWorldPosition(cameraPos);
		if (plane.distanceToPoint(cameraPos) > 0) {
			plane.normal.negate();
			plane.constant *= -1;
		}
	}
}
