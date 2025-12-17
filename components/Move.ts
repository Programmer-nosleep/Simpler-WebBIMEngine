// c:\Users\Ahmad Zani Syechkar\Documents\project\website\jsts\Three.js\my-three3d\components\Move.ts

import * as THREE from "three";
import { SnappingHelper } from "../helpers/snapping-helper";

export class MoveTool {
  private scene: THREE.Scene;
  private camera: THREE.Camera;
  private container: HTMLElement;

  private enabled = false;
  private raycaster = new THREE.Raycaster();
  private mouse = new THREE.Vector2();
  private plane = new THREE.Plane(new THREE.Vector3(0, 0, 1), 0); // XY Plane
  private snappingHelper: SnappingHelper;
  private tempVec3 = new THREE.Vector3();

  // State
  private selectedObject: THREE.Object3D | null = null;
  private isDragging = false;
  private startPoint = new THREE.Vector3(); // The point on the object where we clicked (snapped)
  private initialObjectPos = new THREE.Vector3();
  private ignoreIds = new Set<number>(); // IDs to ignore during raycasting (the moving object)

  // Visuals
  private connectorDot: THREE.Sprite | null = null;
  private selectionBox: THREE.BoxHelper | null = null;
  private dragLine: THREE.Line | null = null;

  // Constants
  private readonly SNAP_THRESHOLD = 0.3;

  constructor(
    scene: THREE.Scene,
    camera: THREE.Camera,
    container: HTMLElement
  ) {
    this.scene = scene;
    this.camera = camera;
    this.container = container;
    this.snappingHelper = new SnappingHelper(
      this.scene,
      this.camera,
      this.container,
      this.raycaster,
      this.SNAP_THRESHOLD
    );
  }

  public enable() {
    if (this.enabled) return;
    this.enabled = true;
    this.container.style.cursor = "default";

    this.container.addEventListener("pointermove", this.onPointerMove);
    this.container.addEventListener("pointerdown", this.onPointerDown);
    this.container.addEventListener("pointerup", this.onPointerUp);
    window.addEventListener("keydown", this.onKeyDown);
  }

  public disable() {
    if (!this.enabled) return;
    this.enabled = false;
    this.container.style.cursor = "default";

    this.container.removeEventListener("pointermove", this.onPointerMove);
    this.container.removeEventListener("pointerdown", this.onPointerDown);
    this.container.removeEventListener("pointerup", this.onPointerUp);
    window.removeEventListener("keydown", this.onKeyDown);

    this.cancelMove();
  }

  // --- Event Handlers ---

  private onPointerDown = (e: PointerEvent) => {
    if (!this.enabled || e.button !== 0) return;

    // 1. Find Object to Move
    const intersect = this.raycastObject(e);
    if (intersect) {
      // Find the actual moveable object (handle groups/parents like Cube+Outline)
      const root = this.getSelectableObject(intersect.object);
      if (!root) return;

      this.selectedObject = root;
      this.initialObjectPos.copy(this.selectedObject.position);

      // 2. Determine Base Point (Patokan)
      // Try to snap the click point to the object's geometry (Endpoint/Midpoint)
      const snapResult = this.snappingHelper.getBestSnap(intersect.point, []);
      
      if (snapResult) {
        this.startPoint.copy(snapResult.point);
        this.updateConnectorDot(this.startPoint, snapResult.kind);
      } else {
        this.startPoint.copy(intersect.point);
        this.updateConnectorDot(this.startPoint);
      }

      // 3. Start Dragging
      this.isDragging = true;
      this.container.style.cursor = "grabbing";
      this.updateSelectionBox(this.selectedObject);

      // Populate ignore list so we don't snap to the object being moved
      this.ignoreIds.clear();
      this.selectedObject.traverse((child) => {
        this.ignoreIds.add(child.id);
      });
      this.ignoreIds.add(this.selectedObject.id);
    }
  };

  private onPointerMove = (e: PointerEvent) => {
    if (!this.enabled) return;

    if (this.isDragging && this.selectedObject) {
      // --- Dragging Logic ---
      
      // 1. Find Target Point (Snap to other objects or plane)
      // Since we disabled raycast on selectedObject, pickPoint won't hit it.
      const hitPoint = this.pickPoint(e);

      if (hitPoint) {
        let target = hitPoint.clone();

        // 2. Snap Target to Scene
        const snapResult = this.snappingHelper.getBestSnap(hitPoint, []);
        if (snapResult) {
          target.copy(snapResult.point);
          this.updateConnectorDot(target, snapResult.kind);
        } else {
          this.updateConnectorDot(target);
        }

        // 3. Move Object
        // New Position = InitialPos + (Target - StartPoint)
        const delta = new THREE.Vector3().subVectors(target, this.startPoint);
        this.selectedObject.position.copy(this.initialObjectPos).add(delta);

        // 4. Update Visuals
        this.updateDragLine(this.startPoint, target);
        if (this.selectionBox) this.selectionBox.update();
      }

    } else {
      // --- Hover Logic ---
      const intersect = this.raycastObject(e);
      if (intersect) {
        this.container.style.cursor = "grab";
        
        // Show snap preview on hover
        const snapResult = this.snappingHelper.getBestSnap(intersect.point, []);
        if (snapResult) {
          this.updateConnectorDot(snapResult.point, snapResult.kind);
        } else {
          this.updateConnectorDot(intersect.point);
        }
      } else {
        this.container.style.cursor = "default";
        if (this.connectorDot) this.connectorDot.visible = false;
      }
    }
  };

  private onPointerUp = (e: PointerEvent) => {
    void e;
    if (this.isDragging) {
      this.finishMove();
    }
  };

  private onKeyDown = (e: KeyboardEvent) => {
    if (!this.enabled) return;
    if (e.key === "Escape") {
      this.cancelMove();
    }
  };

  // --- Logic Helpers ---

  private raycastObject(e: PointerEvent): THREE.Intersection | null {
    const rect = this.container.getBoundingClientRect();
    this.mouse.x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
    this.mouse.y = -((e.clientY - rect.top) / rect.height) * 2 + 1;

    this.raycaster.setFromCamera(this.mouse, this.camera);

    const candidates: THREE.Object3D[] = [];
    this.scene.traverse((obj) => {
      if ((obj as any).isMesh || (obj as any).isLine) {
        // Exclude helpers and grid
        if (obj.name === "SkyDome" || obj.name === "Grid" || (obj as any).userData.isHelper) return;
        candidates.push(obj);
      }
    });

    const hits = this.raycaster.intersectObjects(candidates, true);
    if (hits.length > 0) {
      // Find the first selectable object (handle groups if necessary)
      // For now, we return the hit object directly as per LineTool logic
      return hits[0];
    }
    return null;
  }

  private pickPoint(e: PointerEvent): THREE.Vector3 | null {
    // Similar to raycastObject but returns point, and falls back to Plane
    const rect = this.container.getBoundingClientRect();
    this.mouse.x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
    this.mouse.y = -((e.clientY - rect.top) / rect.height) * 2 + 1;

    this.raycaster.setFromCamera(this.mouse, this.camera);

    const candidates: THREE.Object3D[] = [];
    this.scene.traverse((obj) => {
      if (this.ignoreIds.has(obj.id)) return; // Skip the object being moved

      if ((obj as any).isMesh || (obj as any).isLine) {
        if (obj.name === "SkyDome" || obj.name === "Grid" || (obj as any).userData.isHelper) return;
        candidates.push(obj);
      }
    });

    const hits = this.raycaster.intersectObjects(candidates, true);
    if (hits.length > 0) {
      return hits[0].point;
    }

    // Fallback to Plane Z=0
    if (this.raycaster.ray.intersectPlane(this.plane, this.tempVec3)) {
      return this.tempVec3.clone();
    }

    return null;
  }

  private finishMove() {
    this.isDragging = false;
    this.selectedObject = null;
    this.ignoreIds.clear();
    this.container.style.cursor = "grab";
    this.cleanupVisuals();
  }

  private cancelMove() {
    if (this.selectedObject) {
      this.selectedObject.position.copy(this.initialObjectPos);
    }
    this.isDragging = false;
    this.selectedObject = null;
    this.ignoreIds.clear();
    this.cleanupVisuals();
  }

  // Helper to find the root selectable object (e.g. Cube) when clicking a child (e.g. Outline)
  private getSelectableObject(object: THREE.Object3D): THREE.Object3D | null {
    let current: THREE.Object3D | null = object;
    
    // 1. Traverse up to find explicitly selectable parent
    while (current && current !== this.scene) {
      if (current.userData.selectable === true) return current;
      current = current.parent;
    }

    // 2. If the object itself is explicitly unselectable, return null
    if (object.userData.selectable === false) return null;

    // 3. Default to the object itself (for simple objects without userData)
    return object;
  }

  // --- Visual Updaters ---

  private updateConnectorDot(pos: THREE.Vector3, snapKind?: string) {
    if (!this.connectorDot) {
      const canvas = document.createElement("canvas");
      canvas.width = 64; canvas.height = 64;
      const ctx = canvas.getContext("2d")!;
      ctx.beginPath(); ctx.arc(32, 32, 16, 0, Math.PI * 2); ctx.fillStyle = "#fff"; ctx.fill();
      ctx.lineWidth = 4; ctx.strokeStyle = "#000"; ctx.stroke();

      const tex = new THREE.CanvasTexture(canvas);
      const mat = new THREE.SpriteMaterial({ map: tex, depthTest: false, depthWrite: false });
      this.connectorDot = new THREE.Sprite(mat);
      this.connectorDot.scale.set(0.5, 0.5, 1);
      this.connectorDot.renderOrder = 999;
      this.connectorDot.userData.isHelper = true;
      this.scene.add(this.connectorDot);
    }
    this.connectorDot.visible = true;
    this.connectorDot.position.copy(pos);

    const mat = this.connectorDot.material;
    if (snapKind === "endpoint") mat.color.setHex(0x00ff00);
    else if (snapKind === "midpoint") mat.color.setHex(0x00ffff);
    else mat.color.setHex(0xffffff);
  }

  private updateSelectionBox(obj: THREE.Object3D) {
    if (!this.selectionBox) {
      this.selectionBox = new THREE.BoxHelper(obj, 0xffff00);
      this.selectionBox.userData.isHelper = true;
      this.scene.add(this.selectionBox);
    } else {
      this.selectionBox.setFromObject(obj);
    }
  }

  private updateDragLine(start: THREE.Vector3, end: THREE.Vector3) {
    if (!this.dragLine) {
      const geom = new THREE.BufferGeometry().setFromPoints([start, end]);
      const mat = new THREE.LineDashedMaterial({ color: 0xaaaaaa, dashSize: 0.2, gapSize: 0.1, scale: 1 });
      this.dragLine = new THREE.Line(geom, mat);
      this.dragLine.computeLineDistances();
      this.dragLine.userData.isHelper = true;
      this.scene.add(this.dragLine);
    } else {
      this.dragLine.geometry.setFromPoints([start, end]);
      this.dragLine.computeLineDistances();
    }
  }

  private cleanupVisuals() {
    const removeObj = (obj: THREE.Object3D | null) => {
      if (obj) {
        this.scene.remove(obj);
        if ((obj as any).geometry) (obj as any).geometry.dispose();
        if ((obj as any).material) (obj as any).material.dispose();
      }
    };
    removeObj(this.connectorDot);
    removeObj(this.selectionBox);
    removeObj(this.dragLine);
    this.connectorDot = null;
    this.selectionBox = null;
    this.dragLine = null;
  }
}
