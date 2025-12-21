import * as THREE from "three";
import { buildExtrusionGeometry } from "../helpers/csg";
import type { FaceRegion } from "../utils/faceRegion";
import { mergeVertices } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import { Brush, Evaluator, ADDITION } from "three-bvh-csg";

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
  extrudeNormalWorld: THREE.Vector3;
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
    pullDir?: 'depth' | 'width' | 'length' | 'radius'; // NEW
    dragSign?: number; // NEW
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
      if (Number.isFinite(val)) {
        const nextHollow = val * this.active.extrudeNormalWorld.y < 0;
        this.updatePullGeometry(this.active.mesh, val, this.active.pullKind!, this.active.pullState!, nextHollow);
        // Note: For width/length pulls, 'val' input handling is ambiguous here. 
        // We assume numeric input primarily targets Depth for now (or whatever active param is).
        this.active.lastDepth = val;
        this.active.lastHollow = nextHollow;
        this.finishActiveExtrude({ commit: true });
      } else {
        this.finishActiveExtrude({ commit: true });
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
      hit = this.raycastMesh(event, selectedMesh);
    } else {
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

      // Hover logic (can be removed or kept as is)
      if (hits.length > 0) {
        const first = hits[0];
        const mesh = this.findExtrudableMesh(first.object);
        this.options.onHover?.(mesh || null, mesh ? first.faceIndex ?? null : null);
      } else {
        this.options.onHover?.(null, null);
      }

      for (const h of hits) {
        const mesh = this.findExtrudableMesh(h.object);
        if (mesh) {
          selectedMesh = mesh;
          hit = h;
          break;
        }
      }
    }

    if (!selectedMesh || !hit) return;

    const shape = this.getShapeFromMesh(selectedMesh);
    if (!shape) {
      console.warn("[ExtrudeTool] Selected mesh has no Shape/Extrude parameters.");
      return;
    }

    const startDepth = this.getDepthFromMesh(selectedMesh);
    let axisVector = this.getMeshNormalWorld(selectedMesh);
    const extrudeNormalWorld = new THREE.Vector3();
    {
      const q = new THREE.Quaternion();
      selectedMesh.getWorldQuaternion(q);
      extrudeNormalWorld.set(0, 1, 0).applyQuaternion(q).normalize();
      if (extrudeNormalWorld.lengthSq() < 1e-10) extrudeNormalWorld.set(0, 1, 0);
    }

    // We determine pull direction based on the clicked face normal
    let pullDir: 'depth' | 'width' | 'length' | 'radius' = 'depth';
    let dragSign = 1;

    // Check for Pull Mode (surfaceMeta)
    const ud: any = selectedMesh.userData || {};
    let mode: 'normal' | 'pull' = 'normal';
    let pullKind: 'rect' | 'circle' | 'poly' | undefined;
    let pullState: ActiveExtrudeState['pullState'];

    const meta = ud.surfaceMeta;
    if (meta && (meta.kind === 'rect' || meta.kind === 'circle' || meta.kind === 'poly')) {
      mode = 'pull';
      pullKind = meta.kind;
    }

    if (hit.face && hit.face.normal) {
      const faceNormalWorld = hit.face.normal.clone().transformDirection(selectedMesh.matrixWorld).normalize();

      // We assume standard "Floor" orientation: Up is Y (Depth).
      // Check dot product with Y axis.
      // But we must convert to proper local space (ignoring rotation) if we want "Alignment".
      // Actually, simplest is to check Local Normal.
      const invWorldRot = new THREE.Quaternion();
      selectedMesh.getWorldQuaternion(invWorldRot);
      invWorldRot.invert();
      const localFaceNormal = faceNormalWorld.clone().applyQuaternion(invWorldRot).normalize();

      // Standard Extruded Floor (after my fix): 
      // Depth is Y (0,1,0). Width is X (1,0,0). Length is Z (0,0,1).
      const ax = Math.abs(localFaceNormal.x);
      const ay = Math.abs(localFaceNormal.y);
      const az = Math.abs(localFaceNormal.z);

      if (ay > ax && ay > az) {
        pullDir = 'depth';
        axisVector = faceNormalWorld; // Align drag axis to this normal
      } else if (ax > ay && ax > az) {
        pullDir = 'width';
        axisVector = faceNormalWorld;
        dragSign = Math.sign(localFaceNormal.x);
      } else {
        pullDir = 'length';
        axisVector = faceNormalWorld;
        dragSign = Math.sign(localFaceNormal.z);
      }
    }

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

    if (meta && (meta.kind === 'rect' || meta.kind === 'circle' || meta.kind === 'poly')) {
      // Setup Input
      const input = document.createElement('input');
      input.type = 'text';
      input.placeholder = 'dim';
      input.className = 'qreasee-pull-input';
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

      input.value = startDepth.toFixed(2); // Fallback
      input.select();
      setTimeout(() => input.focus(), 10);

      let center, width, length, radius, vertices;
      if (pullKind === 'rect') {
        center = { x: meta.center[0], z: meta.center[1] };
        width = meta.width;
        length = meta.length;
      } else if (pullKind === 'circle') {
        center = { x: meta.center[0], z: meta.center[1] };
        radius = meta.radius;
        if (pullDir !== 'depth') pullDir = 'radius'; // Override for circle logic if side clicked
      } else if (pullKind === 'poly') {
        vertices = meta.vertices.map((p: any) => ({ x: p[0], z: p[1] }));
        pullDir = 'depth'; // Poly only supports height pull for now
      }

      pullState = {
        center, width, length, radius, vertices,
        startMouseY: event.clientY,
        inputEl: input,
        pullDir, dragSign
      };
    }

    // In Pull Mode, keep extrusion orientation stable (surface normal), and only
    // use face normals to pick which dimension to manipulate.
    if (mode === 'pull') {
      axisVector =
        pullDir === 'depth'
          ? extrudeNormalWorld.clone()
          : axisVector.clone();
    }

    // Do not force selection/highlight on extrude.

    const dragPlane = this.computeDragPlane(axisVector, hit.point.clone());
    if (!dragPlane) return;

    this.active = {
      mesh: selectedMesh,
      shape: shape.clone(),
      originalGeometry: selectedMesh.geometry,
      startDepth,
      lastDepth: startDepth,
      lastHollow: mode === "pull" ? startDepth < 0 : false,
      axisVector,
      extrudeNormalWorld: extrudeNormalWorld.clone(),
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
    } catch { }

    window.addEventListener("pointermove", this.onPointerMove, { capture: true });
    window.addEventListener("pointerup", this.onPointerUp, { capture: true });

    event.preventDefault();
    event.stopPropagation();
  };

  private onPointerMove = (event: PointerEvent) => {
    if (!this.enabled) return;

    if (!this.active) {
      // Hover logic omitted for brevity, handled in onPointerDown generally or check prev implementation
      return;
    }

    if (event.pointerId !== this.active.pointerId) return;

    const isPull = this.active.mode === 'pull';

    // Pull Mode Logic
    if (isPull && this.active.pullState) {
      event.preventDefault();
      event.stopPropagation();

      const state = this.active.pullState;

      // Calculate delta based on 3D drag plane if possible, falling back to 2D
      const planeHit = this.intersectDragPlane(event, this.active.dragPlane);

      let delta = 0;
      if (planeHit) {
        const deltaVec = new THREE.Vector3().subVectors(planeHit, this.active.startPlanePoint);
        delta = deltaVec.dot(this.active.axisVector);
      } else {
        // Fallback to 2D
        const dy = (state.startMouseY - event.clientY);
        delta = dy * 0.05;
      }


      const activeDir = state.pullDir;
      if (activeDir === 'depth') {
        // Unclamped depth
        const nextDepth = this.active.startDepth + delta;
        const nextHollow = nextDepth * this.active.axisVector.y < 0;
        if (Math.abs(nextDepth - this.active.lastDepth) > 1e-4 || nextHollow !== this.active.lastHollow) {
          this.updatePullGeometry(this.active.mesh, nextDepth, this.active.pullKind!, state, nextHollow);
          this.active.lastDepth = nextDepth;
          this.active.lastHollow = nextHollow;
          state.inputEl.value = nextDepth.toFixed(3);
        }
      } else if (activeDir === 'width' && state.width != null && state.center) {
        // Parametric Width
        // Delta is along the normal (e.g. +X).
        // New Width = Old Width + Delta * Sign (Wait, delta is ALREADY along normal).
        // If we pull +X face by +5, width grows by 5. Center moves +2.5.
        // If we pull -X face by +5 (away from center), normal is -X. axisVector is -X.
        // Dragging OUT generates positive delta vs axis.

        // Actually, if axisVector is aligned with Face Normal, 'delta' is expansion amount.
        // So newWidth = oldWidth + delta.
        // Center shift = axisVector * (delta / 2).

        // Base width/center from ON DOWN (snapshot needed? or accumulative?)
        // We have startPlanePoint, so 'delta' is from START.
        // We need original width/center. We didn't store them specifically, but we have them in 'state' (which acts as current? No, state is init from meta).
        // We should ideally store 'startWidth' etc.
        // Quick hack: 'state.width' will be updated. But wait, delta is total from start.
        // So we need 'startWidth'.

        // RE-READ: I didn't store startWidth in onPointerDown.
        // Assuming state.width IS startWidth initially. 
        // I will use `this.active.pullState.width` as current, BUT I need `initial`.
        // For now, let's assume `state.width` currently holds the INITIAL value (from meta).
        // I will compute `currentWidth` and PASS IT to update function.
        // But `updatePullGeometry` reads `state.width`. 
        // I should clone state or update state?
        // If I update state, next frame 'delta' is from start, so I would apply delta to *changed* width? WRONG.
        // Delta is always from start (since I subtract `startPlanePoint`).

        // FIX: Add `startWidth`, `startLength`, `startCenter` to state on first move or in onPointerDown.
        if ((state as any).startWidth == null) {
          (state as any).startWidth = state.width;
          (state as any).startLength = state.length;
          (state as any).startRadius = state.radius;
          (state as any).startCenter = { ...state.center };
        }

        const startW = (state as any).startWidth;
        const startC = (state as any).startCenter;

        const currentW = Math.max(0.1, startW + delta);
        const expansion = currentW - startW;

        // Shift center: aligned with axisVector
        // Center move = axisVector * (expansion / 2)
        // We need to map axisVector (World) to Top-Down 2D shift (x, z).
        // axisVector is predominantly X or Z.

        // Convert axis to flat XZ vector
        // We know Face Normal (axisVector) corresponds to X or Z local.
        // If local X -> World direction?
        // We need the world shift.
        const shiftWorld = this.active.axisVector.clone().multiplyScalar(expansion / 2);

        // mesh is Extruded. Center is relative to what? 
        // state.center is (x, z) on the floor plane.
        // We need to apply shiftWorld to state.center... but state.center is Local Floor coords? 
        // Or World?
        // polygon-clipper says `meta.center` is World XZ (usually).
        // Yes: `const [cx, cz] = meta.center`.
        // So we simply add shiftWorld.x and shiftWorld.z to startC.

        state.width = currentW;
        state.center = {
          x: startC.x + shiftWorld.x,
          z: startC.z + shiftWorld.z
        };

        this.updatePullGeometry(this.active.mesh, this.active.lastDepth, this.active.pullKind!, state, this.active.lastHollow); // Use constant depth
        state.inputEl.value = currentW.toFixed(3);

      } else if (activeDir === 'length' && state.length != null && state.center) {
        if ((state as any).startLength == null) {
          (state as any).startWidth = state.width;
          (state as any).startLength = state.length;
          (state as any).startCenter = { ...state.center };
        }
        const startL = (state as any).startLength;
        const startC = (state as any).startCenter;

        const currentL = Math.max(0.1, startL + delta);
        const expansion = currentL - startL;

        const shiftWorld = this.active.axisVector.clone().multiplyScalar(expansion / 2);

        state.length = currentL;
        state.center = {
          x: startC.x + shiftWorld.x,
          z: startC.z + shiftWorld.z
        };

        this.updatePullGeometry(this.active.mesh, this.active.lastDepth, this.active.pullKind!, state, this.active.lastHollow);
        state.inputEl.value = currentL.toFixed(3);
      }

      return;
    }

    event.preventDefault();
    event.stopPropagation();

    // Fallback for Normal Mode (non-surfaceMeta meshes)
    const planeHit = this.intersectDragPlane(event, this.active.dragPlane);
    if (!planeHit) return;

    const deltaVec = new THREE.Vector3().subVectors(planeHit, this.active.startPlanePoint);
    const deltaAlongAxis = deltaVec.dot(this.active.axisVector);
    const nextDepth = this.active.startDepth + deltaAlongAxis;

    // Normal Extrude Logic (collisions etc) would go here... for now simplistic update:

    const depthChanged = Math.abs(nextDepth - this.active.lastDepth) > 1e-4;
    const hollowRequested = event.altKey;
    const openHole = hollowRequested && nextDepth * this.active.axisVector.y < 0;
    const hollowChanged = openHole !== this.active.lastHollow;
    if (!depthChanged && !hollowChanged) return;

    let geometry = buildExtrusionGeometry(this.active.shape, nextDepth, { hollow: false });
    if (openHole && Math.abs(nextDepth) > 1e-4) {
      const stripped = this.stripCapAtZ(geometry, 0);
      if (stripped !== geometry) {
        geometry.dispose();
        geometry = stripped;
      }
    }

    const mesh = this.active.mesh;
    const previous = mesh.geometry;
    mesh.geometry = geometry;
    if (previous !== this.active.originalGeometry) previous.dispose(); // safe cleanup

    this.active.lastDepth = nextDepth;
    this.active.lastHollow = openHole;
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
      ud.extrudeWallThickness = 0;
      ud.extrudeFloorThickness = 0;
      ud.extrudeExtraCut = 0.1;
      ud.extrudeShape = state.shape;
      ud.isExtruded = true;

      // Update surfaceMeta if we changed dimensions in Pull Mode
      if (state.mode === 'pull' && state.pullState && ud.surfaceMeta) {
        if (state.pullState.width != null) ud.surfaceMeta.width = state.pullState.width;
        if (state.pullState.length != null) ud.surfaceMeta.length = state.pullState.length;
        if (state.pullState.radius != null) ud.surfaceMeta.radius = state.pullState.radius;
        if (state.pullState.center) {
          ud.surfaceMeta.center = [state.pullState.center.x, state.pullState.center.z];
        }
      }

      state.mesh.userData = ud;
      if (ud.type === "surface") {
        this.removeFloorOutlines(state.mesh);
      }

      // Attempt merge if confirmed and hollow (updates geometry again).
      if (state.mesh.userData.extrudeHollow) {
        this.tryMergeSimpleHollows(state.mesh);
      }

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

  private tryMergeSimpleHollows(target: THREE.Mesh) {
    const shape = this.getShapeFromMesh(target);
    const depth = this.getDepthFromMesh(target);

    // Target is assumed to be a fresh simple extrusion (has shape & depth).
    if (!shape) return;

    const scene = this.options.getScene();
    const targetBox = new THREE.Box3().setFromObject(target);
    const candidates: THREE.Mesh[] = [];

    scene.traverse((obj) => {
      if (obj === target) return;
      if (!(obj as any).isMesh) return;
      const mesh = obj as THREE.Mesh;
      if (!mesh.visible || mesh.userData.isHelper) return;
      if (mesh.userData.extrudeHollow !== true) return;

      // If candidate is already merged, we require its Solid Geometry to mix safely.
      // If Simple, we can rebuild.
      const isSimple = !!this.getShapeFromMesh(mesh);
      const isMerged = mesh.userData.extrudeMerged === true;
      const hasSolid = !!(mesh.userData as any)._solidGeometry;

      if (!isSimple && (!isMerged || !hasSolid)) return;

      // Check overlap
      const otherBox = new THREE.Box3().setFromObject(mesh);
      if (!targetBox.intersectsBox(otherBox)) return;

      candidates.push(mesh);
    });

    if (candidates.length === 0) return;

    // 1. Target Brush (Rebuild Solid)
    const targetSolidGeom = buildExtrusionGeometry(shape, depth, { hollow: false });
    targetSolidGeom.rotateX(-Math.PI / 2);
    const targetBrush = new Brush(targetSolidGeom);
    targetBrush.applyMatrix4(target.matrixWorld);
    targetBrush.updateMatrixWorld(true);

    // 2. Evaluator
    const evaluator = new Evaluator();
    evaluator.useGroups = false;

    let resultBrush = targetBrush;
    const brushesToCleanup: Brush[] = [targetBrush];

    for (const cand of candidates) {
      let cBrush: Brush;

      if (cand.userData.extrudeMerged === true && (cand.userData as any)._solidGeometry) {
        // Use Cached Solid
        const geom = (cand.userData as any)._solidGeometry.clone();
        cBrush = new Brush(geom);
        cBrush.applyMatrix4(cand.matrixWorld);
        cBrush.updateMatrixWorld(true);
      } else {
        // Rebuild Simple
        const cShape = this.getShapeFromMesh(cand)!;
        const cDepth = this.getDepthFromMesh(cand);
        const cGeom = buildExtrusionGeometry(cShape, cDepth, { hollow: false });
        cGeom.rotateX(-Math.PI / 2);
        cBrush = new Brush(cGeom);
        cBrush.applyMatrix4(cand.matrixWorld);
        cBrush.updateMatrixWorld(true);
      }

      const nextResult = evaluator.evaluate(resultBrush, cBrush, ADDITION);

      brushesToCleanup.push(cBrush);
      if (resultBrush !== targetBrush) brushesToCleanup.push(resultBrush);
      resultBrush = nextResult;
    }

    // 3. Process Result
    // Result is World Space Solid (conceptually), but the Brush might have a transform.
    const resultBrushMesh = resultBrush as any;
    if (resultBrushMesh.updateMatrixWorld) resultBrushMesh.updateMatrixWorld();

    // We want to move from ResultBrush Space -> World -> Target Local
    // T_final = invTarget * ResultBrush.MatrixWorld
    const transform = target.matrixWorld.clone().invert().multiply(resultBrushMesh.matrixWorld);

    const resultGeomWorld = resultBrush.geometry as THREE.BufferGeometry;

    // Check if resultGeomWorld needs to be cloned or if it's new. It is new from Evaluator.
    const solidLocal = resultGeomWorld.clone();
    solidLocal.applyMatrix4(transform);

    (target.userData as any)._solidGeometry = solidLocal;

    // Create Display Geometry (Stripped Cap)
    const openGeom = this.stripCapAtAxis(solidLocal.clone(), "y", 0, 1e-4);

    // 4. Update Target
    const prevGeom = target.geometry;
    target.geometry = openGeom;
    prevGeom.dispose();

    target.userData.extrudeMerged = true;
    delete target.userData.extrudeShape;
    delete target.userData.surfaceMeta;

    // 5. Cleanup Candidates
    for (const cand of candidates) {
      cand.removeFromParent();
      cand.geometry.dispose();
      if ((cand.userData as any)._solidGeometry) {
        try { (cand.userData as any)._solidGeometry.dispose(); } catch { }
      }
    }

    // Cleanup Brushes
    for (const b of brushesToCleanup) {
      if (b.geometry) b.geometry.dispose();
      if (b.disposeCacheData) b.disposeCacheData();
    }
  }

  private stripCapAtAxis(
    geometry: THREE.BufferGeometry,
    axis: "x" | "y" | "z",
    value = 0,
    eps = 1e-5
  ): THREE.BufferGeometry {
    const working = geometry.index ? geometry.toNonIndexed() : geometry;
    const pos = working.getAttribute("position") as THREE.BufferAttribute | undefined;
    if (!pos || pos.count < 3) {
      if (working !== geometry) working.dispose();
      return geometry;
    }

    const normal = working.getAttribute("normal") as THREE.BufferAttribute | undefined;
    const uv = working.getAttribute("uv") as THREE.BufferAttribute | undefined;

    const positions: number[] = [];
    const normals: number[] = [];
    const uvs: number[] = [];

    const getAxis = (attr: THREE.BufferAttribute, idx: number) => {
      if (axis === "x") return attr.getX(idx);
      if (axis === "y") return attr.getY(idx);
      return attr.getZ(idx);
    };

    for (let i = 0; i < pos.count; i += 3) {
      const a0 = getAxis(pos, i);
      const a1 = getAxis(pos, i + 1);
      const a2 = getAxis(pos, i + 2);

      const isCap =
        Math.abs(a0 - value) <= eps &&
        Math.abs(a1 - value) <= eps &&
        Math.abs(a2 - value) <= eps;

      if (isCap) continue;

      for (let j = 0; j < 3; j++) {
        const idx = i + j;
        positions.push(pos.getX(idx), pos.getY(idx), pos.getZ(idx));
        if (normal) normals.push(normal.getX(idx), normal.getY(idx), normal.getZ(idx));
        if (uv) uvs.push(uv.getX(idx), uv.getY(idx));
      }
    }

    if (working !== geometry) working.dispose();
    if (positions.length === 0) return geometry;

    const stripped = new THREE.BufferGeometry();
    stripped.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));

    if (normals.length > 0) {
      stripped.setAttribute("normal", new THREE.Float32BufferAttribute(normals, 3));
    } else {
      stripped.computeVertexNormals();
    }

    if (uvs.length > 0) {
      stripped.setAttribute("uv", new THREE.Float32BufferAttribute(uvs, 2));
    }

    stripped.computeBoundingBox();
    stripped.computeBoundingSphere();
    return stripped;
  }

  private stripCapAtZ(geometry: THREE.BufferGeometry, z = 0, eps = 1e-5): THREE.BufferGeometry {
    return this.stripCapAtAxis(geometry, "z", z, eps);
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
      return this.getShapeFromMesh(mesh) ? mesh : null;
    }

    let found: THREE.Mesh | null = null;
    obj.traverse((child) => {
      if (found) return;
      if (!(child as any).isMesh) return;
      const mesh = child as THREE.Mesh;
      if ((mesh.userData as any)?.selectable === false) return;
      if (this.getShapeFromMesh(mesh)) found = mesh;
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

  private getShapeFromMesh(mesh: THREE.Mesh): THREE.Shape | null {
    const ud: any = mesh.userData || {};
    const stored = ud.extrudeShape as unknown;
    if (stored && typeof (stored as any).getPoints === "function") return stored as THREE.Shape;
    return this.getShapeFromGeometry(mesh.geometry as THREE.BufferGeometry);
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

  private removeFloorOutlines(root: THREE.Object3D) {
    const toRemove: THREE.Object3D[] = [];
    root.traverse((child) => {
      if ((child.userData as any)?.isFloorOutline) toRemove.push(child);
    });

    for (const obj of toRemove) {
      try {
        obj.removeFromParent();
      } catch {
        // ignore
      }

      const anyObj = obj as any;
      if (anyObj.geometry?.dispose) {
        try {
          anyObj.geometry.dispose();
        } catch {
          // ignore
        }
      }

      if (anyObj.material) {
        const materials = Array.isArray(anyObj.material) ? anyObj.material : [anyObj.material];
        for (const mat of materials) {
          try {
            mat.dispose?.();
          } catch {
            // ignore
          }
        }
      }
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
      polygonOffset: true,
      polygonOffsetFactor: -1,
      polygonOffsetUnits: -1
    });
    const helper = new THREE.LineSegments(edges, mat);
    helper.renderOrder = 2;
    helper.userData = { selectable: false, isHelper: true, isExtrudeOutline: true };
    mesh.add(helper);
    ud.__extrudeEdges = helper;
    mesh.userData = ud;
  }

  private updatePullGeometry(mesh: THREE.Mesh, depth: number, kind: string, state: any, hollow: boolean) {
    if (!this.active) return;

    // 1. Get Target Orientation (Local)
    // We want to align the extrusion direction (initially +Z in ExtrudeGeometry) to this.
    const worldNormal = this.active.extrudeNormalWorld.clone();

    // Hide edges helper during manipulation
    const meshUd = mesh.userData as any;
    if (meshUd.__extrudeEdges) {
      (meshUd.__extrudeEdges as THREE.Object3D).visible = false;
    }

    // Transform direction by inverse world matrix to get Local Normal
    const invWorldRot = new THREE.Quaternion();
    mesh.getWorldQuaternion(invWorldRot);
    invWorldRot.invert();
    const localNormal = worldNormal.clone().applyQuaternion(invWorldRot).normalize();

    // 2. Construct Base Shape & Initial Geometry
    // We strictly follow polygon-clipper logic: Map (x, z) -> Shape (x, -z).
    // Then Rotate X -90 to get back to (x, 0, z) orientation with Up=Y.

    let shape: THREE.Shape | null = null;
    let geometry: THREE.BufferGeometry | null = null;

    if (kind === 'rect' && state.width != null && state.length != null) {
      shape = new THREE.Shape();
      const w = state.width;
      const l = state.length;
      shape.moveTo(-w / 2, -l / 2);
      shape.lineTo(w / 2, -l / 2);
      shape.lineTo(w / 2, l / 2);
      shape.lineTo(-w / 2, l / 2);
      shape.lineTo(-w / 2, -l / 2);
    } else if (kind === 'circle' && state.radius != null) {
      shape = new THREE.Shape();
      shape.absarc(0, 0, state.radius, 0, Math.PI * 2, false);
    } else if (kind === 'poly' && state.vertices && state.vertices.length > 0) {
      // Use absolute coordinates, mapping z -> -y for shape
      shape = new THREE.Shape(state.vertices.map((v: any) =>
        new THREE.Vector2(v.x, -(v.z ?? v.y))
      ));
    }

    if (!shape) return;

    // Build a zero-thickness extrusion (faces only). If `hollow` is true we
    // create an opening by removing the cap on the original surface (z=0).
    geometry = buildExtrusionGeometry(shape, depth, { hollow: false });
    if (hollow && Math.abs(depth) > 1e-4) {
      const stripped = this.stripCapAtZ(geometry, 0);
      if (stripped !== geometry) {
        geometry.dispose();
        geometry = stripped;
      }
    }

    // 3. Apply Standard Floor Rotation (X -90)
    // This converts the Extrude (Z-up) + Shape (XY) -> Mesh (Y-up) + Shape (XZ).
    // This puts the base on the Local XZ plane, matching standard floor coords.
    geometry.rotateX(-Math.PI / 2);

    // 4. Align to Actual Local Normal (if different from Y-up)
    // If the mesh is a standard floor, localNormal should be (0,1,0).
    const defaultUp = new THREE.Vector3(0, 1, 0);
    const alignQuat = new THREE.Quaternion().setFromUnitVectors(defaultUp, localNormal);
    geometry.applyQuaternion(alignQuat);

    // 5. Position Correction
    // For Rect/Circle, we constructed centered shape, so we translate to center.
    // For Poly, we used absolute coordinates, so NO translation needed.
    if ((kind === 'rect' || kind === 'circle') && state.center) {
      const offset = new THREE.Vector3(
        state.center.x,
        this.active.startPlanePoint.y,
        state.center.z
      );
      try {
        mesh.worldToLocal(offset);
      } catch {
        // ignore
      }
      geometry.translate(offset.x, offset.y, offset.z);
    }

    // 6. Update Mesh
    const old = mesh.geometry;
    mesh.geometry = geometry;

    if (old !== this.active.originalGeometry) {
      old.dispose();
    }

    const ud: any = mesh.userData || {};
    ud.depth = depth;
    ud.isExtruded = true;
    mesh.userData = ud;
  }
}
