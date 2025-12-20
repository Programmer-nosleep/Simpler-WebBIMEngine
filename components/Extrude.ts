import * as THREE from "three";
import { buildExtrusionGeometry } from "../helpers/csg";
import { getCoplanarFaceRegionLocalToRoot, type FaceRegion } from "../utils/faceRegion";
import { mergeVertices } from "three/examples/jsm/utils/BufferGeometryUtils.js";

type ControlsLike = {
  enabled: boolean;
};

export type ExtrudeToolOptions = {
  getSelectedObjects: () => Set<THREE.Object3D>;
  getControls?: () => ControlsLike | null;
  getScene: () => THREE.Scene;
  onHover?: (object: THREE.Object3D | null, faceIndex: number | null) => void;
  onPickFace?: (
    object: THREE.Object3D,
    normal?: THREE.Vector3,
    region?: FaceRegion
  ) => void;
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
  startPlanePoint: THREE.Vector3; // World point where drag started
  faceCenter: THREE.Vector3; // Approximate center of the face being extruded
  pointerId: number;
  previousControlsEnabled: boolean | null;
  // New Pull Mode State
  mode: 'normal' | 'pull';
  pullKind?: 'rect' | 'circle' | 'poly';
  pullState?: {
    center?: { x: number; z: number };
    width?: number;
    length?: number;
    radius?: number;
    vertices?: Array<{ x: number; z: number }>;
    startMouseY: number;
    inputEl: HTMLInputElement;
  };
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
    if (event.key === "Enter" && this.active?.mode === 'pull') {
      // Commit numeric input
      const val = parseFloat(this.active.pullState?.inputEl.value || '0');
      if (Number.isFinite(val) && val > 0) {
        this.updatePullGeometry(this.active.mesh, val, this.active.pullKind!, this.active.pullState!);
        this.active.lastDepth = val;
        this.finishActiveExtrude({ commit: true });
      } else {
        this.finishActiveExtrude({ commit: true }); // commit current drag? or cancel? usually enter commits.
      }
    }
  };

  private onPointerDown = (event: PointerEvent) => {
    if (!this.enabled) return;
    if (event.button !== 0) return;
    if (this.active) return;

    let selectedMesh = this.getSelectedExtrudableMesh();
    let hit: THREE.Intersection | null = null;

    if (selectedMesh) {
      // Require the pointer to actually hit the selected mesh.
      hit = this.raycastMesh(event, selectedMesh);
    } else {
      // Try to find a mesh under the cursor from the scene
      const scene = this.options.getScene();
      const candidates: THREE.Mesh[] = [];
      scene.traverse((obj) => {
        if ((obj as any).isMesh) {
          const mesh = obj as THREE.Mesh;
          if (mesh.visible && !mesh.userData.isHelper) {
            candidates.push(mesh);
          }
        }
      });

      const rect = this.container.getBoundingClientRect();
      this.mouse.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
      this.mouse.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;
      this.raycaster.setFromCamera(this.mouse, this.getCamera());

      const hits = this.raycaster.intersectObjects(candidates, true);

      // Hover logic
      if (hits.length > 0) {
        const first = hits[0];
        // Check if extrudable
        const mesh = this.findExtrudableMesh(first.object);
        if (mesh) {
          this.options.onHover?.(mesh, first.faceIndex ?? null);
        } else {
          this.options.onHover?.(null, null);
        }
      } else {
        this.options.onHover?.(null, null);
      }

      for (const h of hits) {
        // Check if this object is extrudable
        const mesh = this.findExtrudableMesh(h.object);
        if (mesh) {
          selectedMesh = mesh;
          hit = h;
          break;
        }
      }
    }

    if (!selectedMesh || !hit) return;

    const shape = this.getShapeFromGeometry(selectedMesh.geometry);
    if (!shape) {
      console.warn("[ExtrudeTool] Selected mesh has no Shape/Extrude parameters.");
      return;
    }

    const startDepth = this.getDepthFromMesh(selectedMesh);

    // Use the specific face normal if available, otherwise fallback to mesh direction
    let axisVector = this.getMeshNormalWorld(selectedMesh);
    if (hit.face && hit.face.normal) {
      // Transform local normal to world
      axisVector = hit.face.normal.clone().transformDirection(selectedMesh.matrixWorld).normalize();
    }

    // Update selection overlay to the clicked face (single-face selection).
    try {
      const root = this.findSelectableRoot(selectedMesh);
      if (hit.face?.normal) {
        const normalWorld = hit.face.normal
          .clone()
          .transformDirection(hit.object.matrixWorld)
          .normalize();
        const normalLocalToRoot = this.worldNormalToLocal(root, normalWorld);
        const region = getCoplanarFaceRegionLocalToRoot(hit, root);
        this.options.onPickFace?.(
          root,
          normalLocalToRoot,
          region ?? undefined
        );
      } else {
        this.options.onPickFace?.(root, undefined, undefined);
      }
    } catch {
      // ignore
    }

    const dragPlane = this.computeDragPlane(axisVector, hit.point.clone());
    if (!dragPlane) return;

    const controls = this.options.getControls?.() ?? null;
    const previousControlsEnabled = controls ? controls.enabled : null;
    if (controls) controls.enabled = false;

    const faceCenter = new THREE.Vector3();
    if (selectedMesh.geometry.boundingBox) {
      selectedMesh.geometry.boundingBox.getCenter(faceCenter);
      selectedMesh.localToWorld(faceCenter);
    } else {
      faceCenter.copy(hit.point);
    }

    // Check for Pull Mode (surfaceMeta)
    const ud: any = selectedMesh.userData || {};
    let mode: 'normal' | 'pull' = 'normal';
    let pullKind: 'rect' | 'circle' | 'poly' | undefined;
    let pullState: ActiveExtrudeState['pullState'];

    const meta = ud.surfaceMeta;
    if (meta && (meta.kind === 'rect' || meta.kind === 'circle' || meta.kind === 'poly')) {
      mode = 'pull';
      pullKind = meta.kind;

      // Setup Input
      const input = document.createElement('input');
      input.type = 'text';
      input.placeholder = 'height';
      input.className = 'qreasee-pull-input'; // Keep class name for consistency if styled elsewhere
      Object.assign(input.style, {
        position: 'fixed',
        left: `${event.clientX + 10}px`,
        top: `${event.clientY + 10}px`,
        zIndex: '9999',
        padding: '4px 6px',
        fontSize: '12px',
        border: '1px solid #ccc',
        borderRadius: '4px',
        background: 'rgba(255,255,255,0.95)'
      });
      document.body.appendChild(input);

      // Focus and select all for quick replace
      input.value = startDepth.toFixed(2);
      input.select(); // setTimeout maybe needed? pointerdown might steal focus back.
      // We defer focus? 
      setTimeout(() => input.focus(), 10);

      let center, width, length, radius, vertices;
      if (pullKind === 'rect') {
        center = { x: meta.center[0], z: meta.center[1] };
        width = meta.width;
        length = meta.length;
      } else if (pullKind === 'circle') {
        center = { x: meta.center[0], z: meta.center[1] };
        radius = meta.radius;
      } else if (pullKind === 'poly') {
        vertices = meta.vertices.map((p: any) => ({ x: p[0], z: p[1] }));
      }

      pullState = {
        center, width, length, radius, vertices,
        startMouseY: event.clientY,
        inputEl: input
      };
    }

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
      faceCenter,
      pointerId: event.pointerId,
      previousControlsEnabled,
      mode,
      pullKind,
      pullState
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
    if (!this.enabled) return;

    if (!this.active) {
      // Hover logic
      const scene = this.options.getScene();
      const candidates: THREE.Mesh[] = [];
      scene.traverse((obj) => {
        if ((obj as any).isMesh) {
          const mesh = obj as THREE.Mesh;
          if (mesh.visible && !mesh.userData.isHelper) {
            candidates.push(mesh);
          }
        }
      });

      const rect = this.container.getBoundingClientRect();
      this.mouse.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
      this.mouse.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;
      this.raycaster.setFromCamera(this.mouse, this.getCamera());

      const hits = this.raycaster.intersectObjects(candidates, true);

      let hovered: THREE.Object3D | null = null;
      let faceIndex: number | null = null;

      for (const h of hits) {
        const mesh = this.findExtrudableMesh(h.object);
        if (mesh) {
          hovered = mesh;
          faceIndex = h.faceIndex ?? null;
          break;
        }
      }
      this.options.onHover?.(hovered, faceIndex);
      return;
    }

    if (event.pointerId !== this.active.pointerId) return;

    // Pull Mode Logic
    if (this.active.mode === 'pull' && this.active.pullState) {
      event.preventDefault();
      event.stopPropagation();

      const state = this.active.pullState;
      const dy = (state.startMouseY - event.clientY);
      const scale = 0.05; // Sensitivity
      let nextDepth = Math.max(0.01, this.active.startDepth + dy * scale);

      // Update input value
      state.inputEl.value = nextDepth.toFixed(3);

      if (Math.abs(nextDepth - this.active.lastDepth) > 1e-4) {
        this.updatePullGeometry(this.active.mesh, nextDepth, this.active.pullKind!, state);
        this.active.lastDepth = nextDepth;
      }
      return;
    }

    event.preventDefault();
    event.stopPropagation();

    const planeHit = this.intersectDragPlane(event, this.active.dragPlane);
    if (!planeHit) return;

    const deltaVec = new THREE.Vector3().subVectors(planeHit, this.active.startPlanePoint);
    const deltaAlongAxis = deltaVec.dot(this.active.axisVector);
    if (!Number.isFinite(deltaAlongAxis)) return;

    const nextDepthRaw = this.active.startDepth + deltaAlongAxis;

    // Check for collisions/intersections in the direction of extrusion
    // We raycast from the start point (or face center) in the direction of movement.
    // Ideally, we check from the 'startPlanePoint' because that's where the user clicked/is looking.
    let nextDepth = nextDepthRaw;

    const direction = this.active.axisVector.clone();
    // If deltaAlongAxis < 0, we are pulling "backwards" against the normal?
    // Usually Extrude is along the normal (positive). If dragging opposite, it might be negative depth.
    // Let's assume standard "positive is out".
    const movingForward = deltaAlongAxis > 0;
    const checkDir = direction.clone().multiplyScalar(movingForward ? 1 : -1);

    // Raycast from the point on the face where we clicked.
    // Offset slightly to avoid self-intersection with the starting face itself.
    const rayOrigin = this.active.startPlanePoint.clone().add(checkDir.clone().multiplyScalar(0.01));
    this.raycaster.set(rayOrigin, checkDir);

    const scene = this.options.getScene();
    const candidates: THREE.Object3D[] = [];
    scene.traverse((obj) => {
      if ((obj as any).isMesh && obj !== this.active!.mesh) {
        // Exclude helpers/gizmos
        if (obj.userData.isHelper) return;
        if (!obj.visible) return;
        candidates.push(obj);
      }
    });

    const intersections = this.raycaster.intersectObjects(candidates, false);
    if (intersections.length > 0) {
      // Find the closest intersection
      const hit = intersections[0];
      // The distance is from rayOrigin.
      // We really care about the projected distance along the axis.
      // But since we raycast *along* the axis, the distance IS the delta.

      // Max distance we *want* to go is the mouse cursor distance (deltaAlongAxis).
      // If hit.distance is LESS than the requested mouse distance, we snap.

      // Calculate the raw delta from start
      const currentDeltaAbs = Math.abs(deltaAlongAxis);

      // If the hit is within our drag range (plus a small threshold for "magnetic" snapping)
      if (hit.distance < currentDeltaAbs + 0.2) {
        // We found an obstacle. Snap to it.
        // Allow snapping slightly *before* the mouse position if checking forward

        // If we are pulling 5 units, and there is a wall at 3 units.
        // hit.distance will be ~3.
        // We should limit the delta to hit.distance.

        const limit = hit.distance;
        // Apply direction
        const snappedDelta = movingForward ? limit : -limit;

        // Update nextDepth
        nextDepth = this.active.startDepth + snappedDelta;
      }
    }

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

    // Cleanup Input
    if (state.pullState?.inputEl) {
      state.pullState.inputEl.remove();
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

    const baseGeometry = mesh.geometry as THREE.BufferGeometry | undefined;
    const position = baseGeometry?.getAttribute("position") as THREE.BufferAttribute | undefined;

    let edges: THREE.EdgesGeometry;
    if (baseGeometry && position) {
      const temp = new THREE.BufferGeometry();
      temp.setAttribute("position", position);
      if (baseGeometry.index) temp.setIndex(baseGeometry.index);
      const welded = mergeVertices(temp, 1e-4);
      temp.dispose();
      edges = new THREE.EdgesGeometry(welded, 25);
      welded.dispose();
    } else {
      edges = new THREE.EdgesGeometry(mesh.geometry, 25);
    }
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

  private updatePullGeometry(mesh: THREE.Mesh, depth: number, kind: string, state: any) {
    let newGeom: THREE.BufferGeometry | null = null;
    if (kind === 'rect' && state.center && state.width != null && state.length != null) {
      const shape = new THREE.Shape();
      shape.moveTo(-state.width / 2, -state.length / 2);
      shape.lineTo(state.width / 2, -state.length / 2);
      shape.lineTo(state.width / 2, state.length / 2);
      shape.lineTo(-state.width / 2, state.length / 2);
      shape.lineTo(-state.width / 2, -state.length / 2);
      const g = new THREE.ExtrudeGeometry(shape, { depth, bevelEnabled: false });
      g.rotateX(-Math.PI / 2);
      g.translate(state.center.x, 0, state.center.z);
      newGeom = g;
    } else if (kind === 'circle' && state.center && state.radius != null) {
      const s = new THREE.Shape();
      s.absarc(0, 0, state.radius, 0, Math.PI * 2, false);
      const g = new THREE.ExtrudeGeometry(s, { depth, bevelEnabled: false, curveSegments: 48 });
      g.rotateX(-Math.PI / 2);
      g.translate(state.center.x, 0, state.center.z);
      newGeom = g;
    } else if (kind === 'poly' && state.vertices) {
      const s = new THREE.Shape(state.vertices.map((v: any) => new THREE.Vector2(v.x, v.z)));
      const g = new THREE.ExtrudeGeometry(s, { depth, bevelEnabled: false });
      g.rotateX(-Math.PI / 2);
      // center computation might be needed if original pivot wasn't 0,0?
      // The provided code did:
      const cx = state.vertices.reduce((sum: number, v: any) => sum + v.x, 0) / state.vertices.length;
      const cz = state.vertices.reduce((sum: number, v: any) => sum + v.z, 0) / state.vertices.length;
      g.translate(cx, 0, cz);
      newGeom = g;
    }

    if (newGeom) {
      const old = mesh.geometry;
      mesh.geometry = newGeom;
      if (old !== this.active?.originalGeometry) {
        old.dispose();
      }
      const ud: any = mesh.userData || {};
      ud.depth = depth;
      ud.isExtruded = true;
      mesh.userData = ud;
    }
  }

  private findSelectableRoot(obj: THREE.Object3D): THREE.Object3D {
    let current: THREE.Object3D | null = obj;
    while (current && current.parent) {
      if ((current.userData as any)?.selectable === true) return current;
      current = current.parent;
    }
    return obj;
  }

  private worldNormalToLocal(root: THREE.Object3D, normalWorld: THREE.Vector3): THREE.Vector3 {
    const invRootQuat = new THREE.Quaternion();
    root.getWorldQuaternion(invRootQuat);
    invRootQuat.invert();
    return normalWorld.clone().applyQuaternion(invRootQuat).normalize();
  }

}
