import * as THREE from "three";
import type { CameraSceneApi } from "../CameraScene";
import type { LeftSidebarHandle, SidebarSectionItem } from "../ui/LeftSidebar";
import { SectionGizmo } from "./SectionGizmo";

type SectionRecord = {
  id: string;
  label: string;
  height: number;
};

type SectionManagerOptions = {
  onSectionActivated?: () => void;
};

export class SectionManager {
  private readonly cameraScene: CameraSceneApi;
  private readonly sidebar: LeftSidebarHandle;
  private readonly options: SectionManagerOptions;
  private sections: SectionRecord[];
  private gizmo: SectionGizmo | null;
  private readonly clippingPlane: THREE.Plane;
  private previewHeight: number;
  private gizmoVisible: boolean;
  private bounds: THREE.Box3;
  private activeSectionId: string | null;

  constructor(
    cameraScene: CameraSceneApi,
    sidebar: LeftSidebarHandle,
    options: SectionManagerOptions = {}
  ) {
    this.cameraScene = cameraScene;
    this.sidebar = sidebar;
    this.options = options;
    this.sections = [];
    this.gizmo = null;
    this.clippingPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
    this.previewHeight = 0;
    this.gizmoVisible = true;
    this.bounds = new THREE.Box3(
      new THREE.Vector3(-2, 0, -2),
      new THREE.Vector3(2, 2, 2)
    );
    this.activeSectionId = null;
    this.sidebar.setSectionItems([]);
  }

  public setBoundsFromObjects(objects: THREE.Object3D[]) {
    const bounds = new THREE.Box3();
    objects.forEach((obj) => bounds.expandByObject(obj));
    if (!bounds.isEmpty()) {
      this.bounds.copy(bounds);
    }
    if (!this.gizmo) {
      this.gizmo = new SectionGizmo(this.bounds);
      this.cameraScene.scene.add(this.gizmo.object3d);
    } else {
      this.gizmo.updateBounds(this.bounds);
    }
    this.gizmo.setVisible(this.gizmoVisible);
    this.setPreviewHeight(this.previewHeight);
  }

  public setPreviewHeight(height: number) {
    this.previewHeight = height;
    this.gizmo?.setHeight(height);
  }

  public setGizmoVisible(state: boolean) {
    this.gizmoVisible = state;
    this.gizmo?.setVisible(state || this.activeSectionId !== null);
  }

  public createSection(label: string, height: number) {
    const id = crypto.randomUUID();
    const record: SectionRecord = { id, label, height };
    this.sections.push(record);
    this.setPreviewHeight(height);
    this.updateSidebar();
    this.activateSection(id);
  }

  public activateSection(id: string) {
    const section = this.sections.find((entry) => entry.id === id);
    if (!section) return;
    this.activeSectionId = id;
    this.applyClipping(section.height);
    this.options.onSectionActivated?.();
    this.updateSidebar();
  }

  public clearActiveSection() {
    this.activeSectionId = null;
    this.cameraScene.renderer.clippingPlanes = [];
    if (!this.gizmoVisible) {
      this.gizmo?.setVisible(false);
    }
    this.updateSidebar();
  }

  private applyClipping(height: number) {
    this.clippingPlane.constant = -height;
    this.cameraScene.renderer.clippingPlanes = [this.clippingPlane];
    this.setPreviewHeight(height);
    this.gizmo?.setVisible(true);
  }

  private updateSidebar() {
    const items: SidebarSectionItem[] = this.sections.map((section) => ({
      id: section.id,
      label: `${section.label} (${section.height.toFixed(2)}m)`,
      icon: "grid",
      active: section.id === this.activeSectionId,
      onSelect: () => this.activateSection(section.id),
    }));
    this.sidebar.setSectionItems(items);
  }

  public handleToolActive(active: boolean) {
    if (active) {
      this.gizmo?.setVisible(true);
    } else if (!this.gizmoVisible && !this.activeSectionId) {
      this.gizmo?.setVisible(false);
    }
  }

  public getSectionCount() {
    return this.sections.length;
  }
}
