import * as THREE from "three";
import { buildExtrusionGeometry } from "../helpers/csg";

type ControlsLike = {
  enabled: boolean;
};

export type ExtrudeToolOptions = {
  getSelectedObjects: () => Set<THREE.Object3D>;
  getControls?: () => ControlsLike | null;
  wallThickness?: number;
  floorThickness?: number;
};

type ActiveExtrudeState = {
  mesh: THREE.Mesh;
  shape: THREE.Shape;
  originalGeometry: THREE.BufferGeometry;
  startDepth: number;
  lastDepth: number;
  lastHollow: boolean;
  axisVector: THREE.Vector3;
  dragPlane: THREE.Plane;
  startPlanePoint: THREE.Vector3;
  pointerId: number;
  previousControlsEnabled: boolean | null;
};

export class ExtrudeTool {
  private getCamera: () => THREE.Camera;
  private container: HTMLElement;
  private options: ExtrudeToolOptions;

  private enabled = false;
  private raycaster = new THREE.Raycaster();
  private mouse = new THREE.Vector2();
  private active: ActiveExtrudeState | null = null;

  constructor(
    camera: THREE.Camera | (() => THREE.Camera),
    container: HTMLElement,
    options: ExtrudeToolOptions
  ) {
    this.getCamera = typeof camera === "function" ? camera : () => camera;
    this.container = container;
    this.options = options;
  }

  public enable() {
    if (this.enabled) return;
    this.enabled = true;
    this.container.style.cursor = "ns-resize";

    this.container.addEventListener("pointerdown", this.onPointerDown, {
      capture: true,
    });
    window.addEventListener("keydown", this.onKeyDown);
  }

  public disable() {
    if (!this.enabled) return;
    this.enabled = false;
    this.container.style.cursor = "default";

    this.container.removeEventListener("pointerdown", this.onPointerDown, {
      capture: true,
    });
    window.removeEventListener("keydown", this.onKeyDown);

    this.cancelActiveExtrude();
  }

  private onKeyDown = (event: KeyboardEvent) => {
    if (!this.enabled) return;
    if (event.key === "Escape") {
      this.cancelActiveExtrude();
    }
  };

  private onPointerDown = (event: PointerEvent) => {
    if (!this.enabled) return;
    if (event.button !== 0) return;
    if (this.active) return;

    const selectedMesh = this.getSelectedExtrudableMesh();
    if (!selectedMesh) return;

    // Require the pointer to actually hit the selected mesh.
    const hit = this.raycastMesh(event, selectedMesh);
    if (!hit) return;

    const shape = this.getShapeFromGeometry(selectedMesh.geometry);
    if (!shape) {
      console.warn("[ExtrudeTool] Selected mesh has no Shape/Extrude parameters.");
      return;
    }

    const startDepth = this.getDepthFromMesh(selectedMesh);
    const axisVector = this.getMeshNormalWorld(selectedMesh);
    const dragPlane = this.computeDragPlane(axisVector, hit.point.clone());
    if (!dragPlane) return;

    const controls = this.options.getControls?.() ?? null;
    const previousControlsEnabled = controls ? controls.enabled : null;
    if (controls) controls.enabled = false;

    this.active = {
      mesh: selectedMesh,
      shape: shape.clone(),
      originalGeometry: selectedMesh.geometry,
      startDepth,
      lastDepth: startDepth,
      lastHollow: false,
      axisVector,
      dragPlane,
      startPlanePoint: hit.point.clone(),
      pointerId: event.pointerId,
      previousControlsEnabled,
    };

    try {
      (event.target as Element | null)?.setPointerCapture?.(event.pointerId);
    } catch {
      // ignore
    }

    window.addEventListener("pointermove", this.onPointerMove, { capture: true });
    window.addEventListener("pointerup", this.onPointerUp, { capture: true });

    event.preventDefault();
    event.stopPropagation();
  };

  private onPointerMove = (event: PointerEvent) => {
    if (!this.enabled || !this.active) return;
    if (event.pointerId !== this.active.pointerId) return;

    event.preventDefault();
    event.stopPropagation();

    const planeHit = this.intersectDragPlane(event, this.active.dragPlane);
    if (!planeHit) return;

    const deltaVec = new THREE.Vector3().subVectors(planeHit, this.active.startPlanePoint);
    const deltaAlongAxis = deltaVec.dot(this.active.axisVector);
    if (!Number.isFinite(deltaAlongAxis)) return;

    const nextDepth = this.active.startDepth + deltaAlongAxis;
    const hollow = event.altKey === true;

    const depthChanged = Math.abs(nextDepth - this.active.lastDepth) > 1e-4;
    const hollowChanged = hollow !== this.active.lastHollow;
    if (!depthChanged && !hollowChanged) return;

    const geometry = buildExtrusionGeometry(this.active.shape, nextDepth, {
      hollow,
      wallThickness: this.options.wallThickness ?? 0.15,
      floorThickness: this.options.floorThickness ?? 0.1,
      extraCut: 0.1,
    });

    const mesh = this.active.mesh;
    const previous = mesh.geometry;
    mesh.geometry = geometry;

    // Dispose intermediate geometries, but keep the original until commit/cancel.
    if (previous !== this.active.originalGeometry) {
      try {
        previous.dispose();
      } catch {
        // ignore
      }
    }

    this.active.lastDepth = nextDepth;
    this.active.lastHollow = hollow;
  };

  private onPointerUp = (event: PointerEvent) => {
    if (!this.active) return;
    if (event.pointerId !== this.active.pointerId) return;

    event.preventDefault();
    event.stopPropagation();

    this.finishActiveExtrude({ commit: true, releaseTarget: event.target as Element | null });
  };

  private finishActiveExtrude(options: { commit: boolean; releaseTarget?: Element | null }) {
    const state = this.active;
    if (!state) return;
    this.active = null;

    window.removeEventListener("pointermove", this.onPointerMove, { capture: true });
    window.removeEventListener("pointerup", this.onPointerUp, { capture: true });

    try {
      options.releaseTarget?.releasePointerCapture?.(state.pointerId);
    } catch {
      // ignore
    }

    const controls = this.options.getControls?.() ?? null;
    if (controls && state.previousControlsEnabled !== null) {
      controls.enabled = state.previousControlsEnabled;
    } else if (controls && state.previousControlsEnabled === null) {
      controls.enabled = true;
    }

    if (options.commit) {
      const ud: any = state.mesh.userData || {};
      ud.extrudeDepth = state.lastDepth;
      ud.extrudeHollow = state.lastHollow;
      state.mesh.userData = ud;

      this.updateEdgesHelper(state.mesh);

      // Free the original geometry if it was replaced.
      if (state.mesh.geometry !== state.originalGeometry) {
        try {
          state.originalGeometry.dispose();
        } catch {
          // ignore
        }
      }
    } else {
      const current = state.mesh.geometry;
      state.mesh.geometry = state.originalGeometry;
      if (current !== state.originalGeometry) {
        try {
          current.dispose();
        } catch {
          // ignore
        }
      }
    }
  }

  private cancelActiveExtrude() {
    if (!this.active) return;
    this.finishActiveExtrude({ commit: false });
  }

  private getSelectedExtrudableMesh(): THREE.Mesh | null {
    const selected = this.options.getSelectedObjects();
    for (const obj of selected) {
      const mesh = this.findExtrudableMesh(obj);
      if (mesh) return mesh;
    }
    return null;
  }

  private findExtrudableMesh(obj: THREE.Object3D): THREE.Mesh | null {
    if ((obj as any).isMesh) {
      const mesh = obj as THREE.Mesh;
      return this.getShapeFromGeometry(mesh.geometry) ? mesh : null;
    }

    let found: THREE.Mesh | null = null;
    obj.traverse((child) => {
      if (found) return;
      if (!(child as any).isMesh) return;
      const mesh = child as THREE.Mesh;
      if ((mesh.userData as any)?.selectable === false) return;
      if (this.getShapeFromGeometry(mesh.geometry)) found = mesh;
    });
    return found;
  }

  private getShapeFromGeometry(geometry: THREE.BufferGeometry): THREE.Shape | null {
    const params = (geometry as any).parameters as any;
    const shapes = params?.shapes as unknown;
    if (!shapes) return null;

    if (Array.isArray(shapes)) {
      const first = shapes[0] as any;
      if (first && typeof first.getPoints === "function") return first as THREE.Shape;
      return null;
    }

    if (typeof (shapes as any).getPoints === "function") return shapes as THREE.Shape;
    return null;
  }

  private getDepthFromMesh(mesh: THREE.Mesh): number {
    const ud: any = mesh.userData || {};
    const stored = Number(ud.extrudeDepth);
    if (Number.isFinite(stored)) return stored;

    const params = (mesh.geometry as any).parameters as any;
    const optDepth = Number(params?.options?.depth);
    if (Number.isFinite(optDepth)) return optDepth;

    return 0;
  }

  private getMeshNormalWorld(mesh: THREE.Mesh): THREE.Vector3 {
    const dir = new THREE.Vector3();
    mesh.getWorldDirection(dir);
    if (dir.lengthSq() < 1e-10) dir.set(0, 0, 1);
    return dir.normalize();
  }

  private computeDragPlane(axisVector: THREE.Vector3, anchor: THREE.Vector3): THREE.Plane | null {
    const camera = this.getCamera();
    const cameraDirection = new THREE.Vector3();
    camera.getWorldDirection(cameraDirection);

    // Build a plane that contains the pull axis, and is view-aligned.
    let planeNormal = cameraDirection
      .clone()
      .sub(axisVector.clone().multiplyScalar(cameraDirection.dot(axisVector)));

    if (planeNormal.lengthSq() < 1e-8) {
      // Fallback when camera is aligned to axis.
      planeNormal = Math.abs(axisVector.y) > 0.75 ? new THREE.Vector3(0, 0, 1) : new THREE.Vector3(0, 1, 0);
    }

    planeNormal.normalize();
    const plane = new THREE.Plane();
    plane.setFromNormalAndCoplanarPoint(planeNormal, anchor);
    return plane;
  }

  private intersectDragPlane(event: PointerEvent, plane: THREE.Plane): THREE.Vector3 | null {
    const rect = this.container.getBoundingClientRect();
    this.mouse.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
    this.mouse.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;
    this.raycaster.setFromCamera(this.mouse, this.getCamera());

    const hit = new THREE.Vector3();
    if (!this.raycaster.ray.intersectPlane(plane, hit)) return null;
    return hit;
  }

  private raycastMesh(event: PointerEvent, mesh: THREE.Mesh): THREE.Intersection | null {
    const rect = this.container.getBoundingClientRect();
    this.mouse.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
    this.mouse.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;
    this.raycaster.setFromCamera(this.mouse, this.getCamera());

    try {
      const hits = this.raycaster.intersectObject(mesh, true);
      return hits[0] ?? null;
    } catch {
      return null;
    }
  }

  private updateEdgesHelper(mesh: THREE.Mesh) {
    const ud: any = mesh.userData || {};
    const prev = ud.__extrudeEdges as THREE.LineSegments | undefined;
    if (prev) {
      prev.removeFromParent();
      try {
        (prev.geometry as THREE.BufferGeometry).dispose();
      } catch {
        // ignore
      }
      try {
        (prev.material as THREE.Material).dispose();
      } catch {
        // ignore
      }
      delete ud.__extrudeEdges;
    }

    const edges = new THREE.EdgesGeometry(mesh.geometry, 25);
    const mat = new THREE.LineBasicMaterial({
      color: 0x1f1f1f,
      depthWrite: false,
      depthTest: true,
    });
    const helper = new THREE.LineSegments(edges, mat);
    helper.renderOrder = 2;
    helper.userData = { selectable: false, isHelper: true, isExtrudeOutline: true };
    mesh.add(helper);
    ud.__extrudeEdges = helper;
    mesh.userData = ud;
  }
}
