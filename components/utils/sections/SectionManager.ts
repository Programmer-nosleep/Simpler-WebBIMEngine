import * as THREE from "three";
import type { CameraSceneApi } from "../../CameraScene";
import type { LeftSidebarHandle, SidebarSectionItem } from "../../ui/LeftSidebar";
import { SectionGizmo } from "./SectionGizmo";

export type SectionMode = "horizontal" | "vertical";

type SectionRecord = {
  id: string;
  label: string;
  mode: SectionMode;
  plane: {
    normal: THREE.Vector3Tuple;
    constant: number;
  };
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
  private previewPlane: THREE.Plane;
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
    this.previewPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
    this.gizmoVisible = false;
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
    this.setPreviewPlane(this.previewPlane);
  }

  public setPreviewPlane(plane: THREE.Plane) {
    const normalizedPlane = plane.clone().normalize();
    this.previewPlane.copy(normalizedPlane);
    this.gizmo?.setPlane(this.previewPlane);
  }

  public setGizmoVisible(state: boolean) {
    this.gizmoVisible = state;
    this.gizmo?.setVisible(state || this.activeSectionId !== null);
  }

  public createSection(label: string, mode: SectionMode, plane: THREE.Plane) {
    const id = crypto.randomUUID();
    const normalizedPlane = plane.clone().normalize();
    const record: SectionRecord = {
      id,
      label,
      mode,
      plane: {
        normal: [normalizedPlane.normal.x, normalizedPlane.normal.y, normalizedPlane.normal.z],
        constant: normalizedPlane.constant,
      },
    };
    this.sections.push(record);
    this.setPreviewPlane(normalizedPlane);
    this.updateSidebar();
    this.activateSection(id);
  }

  public activateSection(id: string) {
    const section = this.sections.find((entry) => entry.id === id);
    if (!section) return;
    this.activeSectionId = id;
    this.applyClipping(new THREE.Plane(new THREE.Vector3(...section.plane.normal), section.plane.constant));
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

  private applyClipping(plane: THREE.Plane) {
    this.clippingPlane.copy(plane).normalize();
    this.cameraScene.renderer.clippingPlanes = [this.clippingPlane];
    this.setPreviewPlane(this.clippingPlane);
    this.gizmo?.setVisible(true);
  }

  private formatSectionLabel(section: SectionRecord) {
    const normal = new THREE.Vector3(...section.plane.normal);
    const plane = new THREE.Plane(normal, section.plane.constant).normalize();

    if (section.mode === "horizontal") {
      const height = plane.normal.y !== 0 ? -plane.constant / plane.normal.y : -plane.constant;
      return `${section.label} (H @ ${height.toFixed(2)}m)`;
    }

    const center = this.bounds.getCenter(new THREE.Vector3());
    const distance = plane.distanceToPoint(center);
    const pointOnPlane = center.clone().sub(plane.normal.clone().multiplyScalar(distance));
    return `${section.label} (V @ ${pointOnPlane.x.toFixed(2)}, ${pointOnPlane.z.toFixed(2)})`;
  }

  private updateSidebar() {
    const items: SidebarSectionItem[] = this.sections.map((section) => ({
      id: section.id,
      label: this.formatSectionLabel(section),
      icon: "grid",
      active: section.id === this.activeSectionId,
      onSelect: () => {
        if (section.id === this.activeSectionId) {
          this.clearActiveSection();
        } else {
          this.activateSection(section.id);
        }
      },
    }));
    this.sidebar.setSectionItems(items);
  }

  public handleToolActive(active: boolean) {
    if (active) {
      this.gizmo?.setVisible(true);
      return;
    }

    // Hide gizmo when the tool is inactive and there's no active clipping section.
    this.gizmo?.setVisible(this.gizmoVisible || this.activeSectionId !== null);
  }

  public getSectionCount() {
    return this.sections.length;
  }
}
