import * as THREE from "three";
import type { CameraSceneApi } from "./CameraScene";
import type { LeftSidebarHandle } from "./ui/LeftSidebar";
import { SectionManager } from "./utils/sections/SectionManager";

export class SectionTool {
	private readonly cameraScene: CameraSceneApi;
	private readonly container: HTMLElement;
	private readonly raycaster = new THREE.Raycaster();
	private readonly pointer = new THREE.Vector2();
	private readonly sectionManager: SectionManager;

	private enabled = false;
	private selectableRoots: THREE.Object3D[] = [];
	private lastPreviewHeight: number | null = null;

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
		this.lastPreviewHeight = null;
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
			this.lastPreviewHeight = null;
			return;
		}

		this.lastPreviewHeight = hit.point.y;
		this.sectionManager.setPreviewHeight(this.lastPreviewHeight);
	};

	private onPointerDown = (event: PointerEvent) => {
		if (!this.enabled) return;
		if (event.button !== 0) return;
		if (this.lastPreviewHeight == null) return;

		const index = this.sectionManager.getSectionCount() + 1;
		this.sectionManager.createSection(`Plan ${index}`, this.lastPreviewHeight);
	};
}
