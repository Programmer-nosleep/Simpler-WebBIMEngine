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
  basePlaneWorld: THREE.Plane;
  dragPlane: THREE.Plane;
  startPlanePoint: THREE.Vector3; // World point where drag started
  faceCenter: THREE.Vector3; // Approximate center of the face being extruded
  pointerId: number;
  previousControlsEnabled: boolean | null;
  hiddenHelpers: Array<{ obj: THREE.Object3D; visible: boolean }>;
  // New Pull Mode State
  mode: 'normal' | 'pull';
  pullKind?: 'rect' | 'circle' | 'poly';
  pullState?: {
    center?: { x: number; z: number };
    width?: number;
    length?: number;
    radius?: number;
    baseY?: number; // New: Vertical offset for bottom-pull
    vertices?: Array<{ x: number; z: number }>;
    startMouseY: number;
    inputEl: HTMLInputElement;
    pullDir?: 'depth' | 'width' | 'length' | 'radius';
    dragSign?: number;
    // Snapshot of start values for delta calculation
    startWidth?: number;
    startLength?: number;
    startRadius?: number;
    startDepth?: number;
    startCenter?: { x: number; z: number };
    startBaseY?: number;
    // BBox and collapsed axes tracking
    bboxDimensions?: { width: number; length: number; height: number };
    collapsedAxes?: { x?: boolean; y?: boolean; z?: boolean };
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

    // ===== NEW: Support meshes without Shape (already extruded) =====
    const ud: any = selectedMesh.userData || {};
    const meta = ud.surfaceMeta;

    // Try to infer kind from mesh
    const inferKindFromMesh = (): 'rect' | 'circle' | 'poly' | null => {
      if (ud.mode === 'rect' || meta?.kind === 'rect') return 'rect';
      if (ud.mode === 'circle' || meta?.kind === 'circle') return 'circle';
      if (ud.mode === 'poly' || meta?.kind === 'poly') return 'poly';
      // Default to rect for generic extruded meshes
      return 'rect';
    };

    const inferredKind = inferKindFromMesh();
    if (!inferredKind) {
      console.warn("[ExtrudeTool] Cannot determine mesh type.");
      return;
    }

    // Compute bbox dimensions as fallback
    const bbox = new THREE.Box3().setFromObject(selectedMesh);
    const bboxSize = bbox.getSize(new THREE.Vector3());
    const bboxCenter = bbox.getCenter(new THREE.Vector3());

    // Read collapsed axes from metadata
    const collapsedAxesMeta = meta?.collapsedAxes || {};
    const widthCollapsed = !!collapsedAxesMeta.x;
    const lengthCollapsed = !!collapsedAxesMeta.z;
    const heightCollapsed = !!collapsedAxesMeta.y;

    const MIN_LINEAR = 0.02;
    const MIN_HEIGHT = 0.0001;

    const bboxWidth = Math.max(MIN_LINEAR, bboxSize.x);
    const bboxLength = Math.max(MIN_LINEAR, bboxSize.z);
    const bboxHeight = Math.max(MIN_HEIGHT, bboxSize.y);

    // Determine start dimensions (0 if collapsed, bbox otherwise)
    let startWidth = widthCollapsed ? 0 : bboxWidth;
    let startLength = lengthCollapsed ? 0 : bboxLength;

    // For height, prefer stored depth over bbox
    const storedDepth = this.getDepthFromMesh(selectedMesh);
    const startDepth = heightCollapsed ? 0 : (storedDepth !== 0 ? storedDepth : bboxHeight);
    // Get mesh orientation
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

    // Always use pull mode for all extrudable meshes
    const mode: 'normal' | 'pull' = 'pull';
    const pullKind = inferredKind;
    let pullState: ActiveExtrudeState['pullState'];

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

    // Setup Input UI
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

    input.value = startDepth.toFixed(2);
    input.select();
    setTimeout(() => input.focus(), 10);

    const existingShape = this.getShapeFromMesh(selectedMesh);

    // Extract or derive center, dimensions
    let center: { x: number; z: number };
    let width: number;
    let length: number;
    let radius: number | undefined;
    let vertices: Array<{ x: number; z: number }> | undefined;
    const startBaseY = meta?.baseY ?? 0;

    if (pullKind === 'rect') {
      // Prefer metadata, fallback to bbox
      if (meta?.center && Array.isArray(meta.center) && meta.center.length >= 2) {
        center = { x: meta.center[0], z: meta.center[1] };
      } else {
        center = { x: bboxCenter.x, z: bboxCenter.z };
      }

      width = meta?.width ?? startWidth;
      length = meta?.length ?? startLength;

    } else if (pullKind === 'circle') {
      if (meta?.center && Array.isArray(meta.center) && meta.center.length >= 2) {
        center = { x: meta.center[0], z: meta.center[1] };
      } else {
        center = { x: bboxCenter.x, z: bboxCenter.z };
      }

      const r = typeof meta?.radius === 'number' ? meta.radius : Math.max(startWidth, startLength) / 2;
      radius = r;
      width = r * 2;
      length = r * 2;

      if (pullDir !== 'depth') pullDir = 'radius';

      if (pullDir === 'radius') {
        const centerWorld = new THREE.Vector3(center.x, hit.point.y, center.z);
        const radialOut = hit.point.clone().sub(centerWorld).projectOnPlane(extrudeNormalWorld);
        const radialSign =
          radialOut.lengthSq() > 1e-10
            ? Math.sign(axisVector.clone().normalize().dot(radialOut.normalize())) || 1
            : 1;
        dragSign = radialSign;
      }

    } else if (pullKind === 'poly') {
      center = { x: bboxCenter.x, z: bboxCenter.z };
      width = startWidth;
      length = startLength;

      if (meta?.vertices && Array.isArray(meta.vertices)) {
        vertices = meta.vertices.map((p: any) =>
          Array.isArray(p) ? { x: p[0], z: p[1] } : { x: p.x || 0, z: p.z || p.y || 0 }
        );
      }
      // pullDir = 'depth';
    } else {
      center = { x: bboxCenter.x, z: bboxCenter.z };

      // Calculate start width/length from the SHAPE itself to be precise
      const shapeDims = existingShape ? this.getShapeDimensions(existingShape) : null;
      if (shapeDims) {
        width = shapeDims.width;
        length = shapeDims.length;
        // Adjust Center to be the center of the shape in world space
        const centerLoc = new THREE.Vector3(shapeDims.centerX, 0, shapeDims.centerY); // Shape is XY
        // But wait, the standard rotation is X -90. So Shape Y -> Local Z.
        centerLoc.set(shapeDims.centerX, 0, shapeDims.centerY);
        // We need to map this local point to world.
        // Problem: we don't know the exact local transform at this point (it's embedded in the mesh matrix)
        // Simple approximation: BBox center is safer for 'center', but dimensions MUST be from shape.
      } else {
        width = startWidth;
        length = startLength;
      }

      // Force Poly to use Shape Dimensions for consistency
      if (pullKind === 'poly' && shapeDims) {
        width = shapeDims.width;
        length = shapeDims.length;
      } else if (pullKind !== 'poly') {
        // fallback
        width = startWidth;
        length = startLength;
      }

      center = { x: bboxCenter.x, z: bboxCenter.z };
    }

    pullState = {
      center,
      width,
      length,
      radius,
      vertices,
      baseY: startBaseY,
      startMouseY: event.clientY,
      inputEl: input,
      pullDir,
      dragSign,
      startWidth: width,
      startLength: length,
      startRadius: radius,
      startDepth,
      startCenter: { ...center },
      startBaseY,
      bboxDimensions: { width: bboxWidth, length: bboxLength, height: bboxHeight },
      collapsedAxes: { x: widthCollapsed, y: heightCollapsed, z: lengthCollapsed }
    };

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

    const hiddenHelpers: ActiveExtrudeState["hiddenHelpers"] = [];
    selectedMesh.traverse((child) => {
      if (child === selectedMesh) return;
      const isHelper = (child.userData as any)?.isHelper === true || child.name === "__edgeWire";
      if (!isHelper) return;
      hiddenHelpers.push({ obj: child, visible: child.visible });
      child.visible = false;
    });

    const basePlaneWorld = new THREE.Plane();
    {
      const geom = selectedMesh.geometry as THREE.BufferGeometry | undefined;
      if (geom && !geom.boundingBox) geom.computeBoundingBox();
      const bbox = geom?.boundingBox ?? null;
      const anchorYLocal = bbox ? (startDepth >= 0 ? bbox.min.y : bbox.max.y) : 0;
      const anchorPointWorld = new THREE.Vector3(0, anchorYLocal, 0);
      selectedMesh.localToWorld(anchorPointWorld);
      basePlaneWorld.setFromNormalAndCoplanarPoint(extrudeNormalWorld.clone(), anchorPointWorld);
    }

    // Get or create shape for persistence
    const shape = this.getShapeFromMesh(selectedMesh) || (() => {
      // Fallback: create shape from current dimensions
      if (pullKind === 'rect') {
        const s = new THREE.Shape();
        const w = pullState?.width ?? startWidth;
        const l = pullState?.length ?? startLength;
        s.moveTo(-w / 2, -l / 2);
        s.lineTo(w / 2, -l / 2);
        s.lineTo(w / 2, l / 2);
        s.lineTo(-w / 2, l / 2);
        s.closePath();
        return s;
      } else if (pullKind === 'circle') {
        const s = new THREE.Shape();
        const r = pullState?.radius ?? startWidth / 2;
        s.absarc(0, 0, r, 0, Math.PI * 2, false);
        return s;
      }
      return null;
    })();

    if (!shape) {
      console.warn("[ExtrudeTool] Could not create shape for mesh.");
      return;
    }

    this.active = {
      mesh: selectedMesh,
      shape: shape.clone(),
      originalGeometry: selectedMesh.geometry,
      startDepth,
      lastDepth: startDepth,
      lastHollow: mode === "pull" ? startDepth < 0 : false,
      axisVector,
      extrudeNormalWorld: extrudeNormalWorld.clone(),
      basePlaneWorld,
      dragPlane,
      startPlanePoint: hit.point.clone(),
      faceCenter,
      pointerId: event.pointerId,
      previousControlsEnabled,
      hiddenHelpers,
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
      this.updateHover(event);
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
        // Delta is projection of drag onto Axis.
        // If Dragging along Axis, delta is positive.
        const deltaVec = new THREE.Vector3().subVectors(planeHit, this.active.startPlanePoint);
        delta = deltaVec.dot(this.active.axisVector);
      } else {
        // Fallback to 2D
        const dy = (state.startMouseY - event.clientY);
        delta = dy * 0.05;
      }

      const activeDir = state.pullDir;

      // --- Universal Shift Logic ---
      // For any "Side" pull (Width/Length/Radius), we want to expand that side by 'delta'
      // and shift the center so the OPPOSITE side remains fixed.
      // Shift = Axis * (Delta / 2).
      // Note: Axis is normalized Face Normal.

      // Map Axis back to local X/Z for Center shift.
      const invWorldRot = new THREE.Quaternion();
      this.active.mesh.getWorldQuaternion(invWorldRot);
      invWorldRot.invert();
      const localAxis = this.active.axisVector.clone().applyQuaternion(invWorldRot);

      if (activeDir === 'depth') {
        // Depth Logic (Y-axis generally)
        const startD = state.startDepth ?? this.active.startDepth;
        const startB = state.startBaseY ?? 0;

        // New Depth
        const nextDepth = startD + delta;

        // Base Shift logic for Bottom Face
        // If Axis is Down (-Y), we are pulling bottom.
        // BaseY should move by -Delta (since Delta is positive 'outwards' down).
        // localAxis.y is roughly -1 for bottom, +1 for top.
        // If dragging Top (+Y), delta>0. Base change = 0.
        // If dragging Bottom (-Y), delta>0. Base change = -delta.
        // Formula: BaseShift = (localAxis.y < -0.5) ? -delta : 0;

        let baseChange = 0;
        if (localAxis.y < -0.5) {
          baseChange = -delta;
        }

        const nextBaseY = startB + baseChange;

        // Update State
        state.baseY = nextBaseY;

        const nextHollow = nextDepth * this.active.axisVector.y < 0; // Simple check, might need refinement for bottom pull

        if (Math.abs(nextDepth - this.active.lastDepth) > 1e-4 || Math.abs(nextBaseY - (state.baseY ?? 0)) > 1e-4) {
          this.updatePullGeometry(this.active.mesh, nextDepth, this.active.pullKind!, state, nextHollow);
          this.active.lastDepth = nextDepth;
          this.active.lastHollow = nextHollow;
          state.inputEl.value = nextDepth.toFixed(3);
        }

      } else if (activeDir === 'width' && state.width != null && state.startWidth != null && state.center && state.startCenter) {

        const startW = state.startWidth;
        const currentW = Math.max(0.1, startW + delta); // One-sided expansion: simply add delta

        // Center Shift
        // Shift amount = delta / 2
        // Direction = localAxis (which component? X)
        // Actually, just project localAxis * (delta/2) to X/Z
        const shiftX = localAxis.x * (delta / 2);
        const shiftZ = localAxis.z * (delta / 2);

        state.width = currentW;

        state.center.x = state.startCenter.x + shiftX;
        state.center.z = state.startCenter.z + shiftZ;

        this.updatePullGeometry(this.active.mesh, this.active.lastDepth, this.active.pullKind!, state, this.active.lastHollow);
        state.inputEl.value = currentW.toFixed(3);

      } else if (activeDir === 'length' && state.length != null && state.startLength != null && state.center && state.startCenter) {

        const startL = state.startLength;
        const currentL = Math.max(0.1, startL + delta);

        const shiftX = localAxis.x * (delta / 2);
        const shiftZ = localAxis.z * (delta / 2);

        state.length = currentL;

        // Poly One-Sided Logic:
        // If Poly, we MUST shift center to keep opposite side fixed.
        // Delta is total expansion. Shift is half delta.
        // Direction depends on dragSign (which side was pulled).
        state.center.x = state.startCenter.x + shiftX;
        state.center.z = state.startCenter.z + shiftZ;

        this.updatePullGeometry(this.active.mesh, this.active.lastDepth, this.active.pullKind!, state, this.active.lastHollow);
        state.inputEl.value = currentL.toFixed(3);

      } else if (activeDir === 'radius' && state.radius != null && state.startRadius != null && state.center && state.startCenter) {

        // Radius Logic
        // Pulling a side of a cylinder.
        // Delta is expansion of diameter effectively?
        // See thought process: NewRadius = StartRadius + delta/2.
        // Center Shift = delta/2 * Axis.

        const startR = state.startRadius;
        const currentR = Math.max(0.01, startR + delta / 2); // Radius grows by half delta

        const shiftX = localAxis.x * (delta / 2);
        const shiftZ = localAxis.z * (delta / 2);

        state.radius = currentR;
        state.center.x = state.startCenter.x + shiftX;
        state.center.z = state.startCenter.z + shiftZ;

        this.updatePullGeometry(this.active.mesh, this.active.lastDepth, this.active.pullKind!, state, this.active.lastHollow);
        state.inputEl.value = currentR.toFixed(3);
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
      let committedShape = state.shape;
      if (state.mode === "pull" && state.pullKind && state.pullState) {
        if (state.pullKind === "rect" && state.pullState.width != null && state.pullState.length != null) {
          const s = new THREE.Shape();
          const w = state.pullState.width;
          const l = state.pullState.length;
          s.moveTo(-w / 2, -l / 2);
          s.lineTo(w / 2, -l / 2);
          s.lineTo(w / 2, l / 2);
          s.lineTo(-w / 2, l / 2);
          s.lineTo(-w / 2, -l / 2);
          committedShape = s;
        } else if (state.pullKind === "circle" && state.pullState.radius != null) {
          const s = new THREE.Shape();
          s.absarc(0, 0, state.pullState.radius, 0, Math.PI * 2, false);
          committedShape = s;
        } else if (state.pullKind === "poly" && state.pullState.width != null && state.pullState.length != null && state.pullState.startWidth && state.pullState.startLength) {
          // Persist the scaled poly shape!
          // We must transform the points of the original shape.
          const oldShape = state.shape;
          const scaleX = state.pullState.width / state.pullState.startWidth;
          const scaleY = state.pullState.length / state.pullState.startLength;

          if (Math.abs(scaleX - 1) > 1e-4 || Math.abs(scaleY - 1) > 1e-4) {
            const newPts = oldShape.getPoints().map(p => new THREE.Vector2(p.x * scaleX, p.y * scaleY));
            const newShape = new THREE.Shape(newPts);

            // Check holes? 
            if (oldShape.holes && oldShape.holes.length > 0) {
              newShape.holes = oldShape.holes.map(h => {
                const hPts = h.getPoints().map(p => new THREE.Vector2(p.x * scaleX, p.y * scaleY));
                return new THREE.Path(hPts);
              });
            }
            committedShape = newShape;
          }
        }
      }
      ud.extrudeShape = committedShape;
      ud.isExtruded = true;

      // Update surfaceMeta if we changed dimensions in Pull Mode
      if (state.mode === 'pull' && state.pullState && ud.surfaceMeta) {
        if (state.pullState.width != null) ud.surfaceMeta.width = state.pullState.width;
        if (state.pullState.length != null) ud.surfaceMeta.length = state.pullState.length;
        if (state.pullState.radius != null) ud.surfaceMeta.radius = state.pullState.radius;
        if (state.pullState.center) {
          ud.surfaceMeta.center = [state.pullState.center.x, state.pullState.center.z];
        }
        if (state.pullState.baseY != null) {
          ud.surfaceMeta.baseY = state.pullState.baseY;
        }
        if (state.pullState.bboxDimensions) {
          ud.surfaceMeta.bboxDimensions = state.pullState.bboxDimensions;
        }
        if (state.pullState.collapsedAxes) {
          ud.surfaceMeta.collapsedAxes = state.pullState.collapsedAxes;
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

    for (const entry of state.hiddenHelpers) {
      try {
        entry.obj.visible = entry.visible;
      } catch {
        // ignore
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
    const openGeom = this.stripCapAtAxis(solidLocal.clone(), "y", 0, 1e-3);

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
    eps = 1e-3
  ): THREE.BufferGeometry {
    const working = geometry.index ? geometry.toNonIndexed() : geometry;
    const pos = working.getAttribute("position") as THREE.BufferAttribute | undefined;
    if (!pos || pos.count < 3) {
      if (working !== geometry) working.dispose();
      return geometry;
    }

    const uv = working.getAttribute("uv") as THREE.BufferAttribute | undefined;

    const positions: number[] = [];
    const uvs: number[] = [];

    const vA = new THREE.Vector3();
    const vB = new THREE.Vector3();
    const vC = new THREE.Vector3();

    for (let i = 0; i < pos.count; i += 3) {
      let x0 = pos.getX(i); let y0 = pos.getY(i); let z0 = pos.getZ(i);
      let x1 = pos.getX(i + 1); let y1 = pos.getY(i + 1); let z1 = pos.getZ(i + 1);
      let x2 = pos.getX(i + 2); let y2 = pos.getY(i + 2); let z2 = pos.getZ(i + 2);

      // Snap to plane
      if (axis === 'x') {
        if (Math.abs(x0 - value) <= eps) x0 = value;
        if (Math.abs(x1 - value) <= eps) x1 = value;
        if (Math.abs(x2 - value) <= eps) x2 = value;
      } else if (axis === 'y') {
        if (Math.abs(y0 - value) <= eps) y0 = value;
        if (Math.abs(y1 - value) <= eps) y1 = value;
        if (Math.abs(y2 - value) <= eps) y2 = value;
      } else {
        if (Math.abs(z0 - value) <= eps) z0 = value;
        if (Math.abs(z1 - value) <= eps) z1 = value;
        if (Math.abs(z2 - value) <= eps) z2 = value;
      }

      const a0 = axis === 'x' ? x0 : (axis === 'y' ? y0 : z0);
      const a1 = axis === 'x' ? x1 : (axis === 'y' ? y1 : z1);
      const a2 = axis === 'x' ? x2 : (axis === 'y' ? y2 : z2);

      // Strict check after snap
      const isCap =
        Math.abs(a0 - value) < 1e-6 &&
        Math.abs(a1 - value) < 1e-6 &&
        Math.abs(a2 - value) < 1e-6;

      if (isCap) continue;

      // Degenerate check
      vA.set(x0, y0, z0);
      vB.set(x1, y1, z1);
      vC.set(x2, y2, z2);
      vB.sub(vA);
      vC.sub(vA);
      vB.cross(vC);
      if (vB.lengthSq() < 1e-12) continue;

      positions.push(x0, y0, z0, x1, y1, z1, x2, y2, z2);
      if (uv) {
        uvs.push(
          uv.getX(i), uv.getY(i),
          uv.getX(i + 1), uv.getY(i + 1),
          uv.getX(i + 2), uv.getY(i + 2)
        );
      }
    }

    if (working !== geometry) working.dispose();
    if (positions.length === 0) return geometry;

    const stripped = new THREE.BufferGeometry();
    stripped.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));

    if (uvs.length > 0) {
      stripped.setAttribute("uv", new THREE.Float32BufferAttribute(uvs, 2));
    }

    const merged = mergeVertices(stripped, 1e-3);
    merged.computeVertexNormals();
    merged.computeBoundingBox();
    merged.computeBoundingSphere();
    return merged;
  }

  private stripCapAtZ(geometry: THREE.BufferGeometry, z = 0, eps = 1e-3): THREE.BufferGeometry {
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
      const welded = mergeVertices(temp, 1e-3);
      temp.dispose();
      edges = new THREE.EdgesGeometry(welded, 45);
      welded.dispose();
    } else {
      edges = new THREE.EdgesGeometry(mesh.geometry, 45);
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
    } else if (kind === 'poly') {
      shape = this.active.shape.clone();
    }

    if (!shape) return;

    // Build a zero-thickness extrusion
    geometry = buildExtrusionGeometry(shape, depth, { hollow: false });

    // For Poly scaling, we must center and scale the geometry if Width/Length changed
    if (kind === 'poly' && state.width != null && state.length != null && state.startWidth && state.startLength) {
      // 1. Center geometry
      geometry.computeBoundingBox();
      // const center = geometry.boundingBox!.getCenter(new THREE.Vector3());
      // We only care about X/Y center (since shape is on XY before rotation)
      // wait, buildExtrusionGeometry makes it along Z. Shape is XY.
      // Actually buildExtrusionGeometry output: shape on XY, extruded along Z.
      // So width is X, Length is Y.

      const scaleX = state.width / state.startWidth;
      const scaleY = state.length / state.startLength;

      // We center on X/Y relative to the shape center?
      // Actually, simplest is: translate to -center, scale, translate back? 
      // But we want to scale around the CENTER of the bounding box of the shape.

      const centerX = (geometry.boundingBox!.min.x + geometry.boundingBox!.max.x) / 2;
      const centerY = (geometry.boundingBox!.min.y + geometry.boundingBox!.max.y) / 2;

      geometry.translate(-centerX, -centerY, 0);
      geometry.scale(scaleX, scaleY, 1);
      // We do NOT translate back, because 'state.center' handling below will position it 
      // at the correct World spot.
    }
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
    // KEY CHANGE: For Poly, we also centered it above during scaling, so we treat it same as Rect/Circle now.
    if ((kind === 'rect' || kind === 'circle' || kind === 'poly') && state.center) {
      // Start with the 2D center on a "flat" Y=0 plane (arbitrary, will be projected)
      const offset = new THREE.Vector3(state.center.x, 0, state.center.z);

      // Project onto the Base Plane (World Space) of the mesh
      this.active.basePlaneWorld.projectPoint(offset, offset);

      // Add Vertical Offset (baseY) along the Extrude Normal
      if (state.baseY) {
        offset.add(this.active.extrudeNormalWorld.clone().multiplyScalar(state.baseY));
      }

      // Convert World -> Local to get the geometry translation vector
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

  private updateHover(event: PointerEvent) {
    let hit: THREE.Intersection | null = null;
    let selectedMesh: THREE.Mesh | null = this.getSelectedExtrudableMesh();

    if (selectedMesh) {
      hit = this.raycastMesh(event, selectedMesh);
    } else {
      // Raycast all
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

      // Find first extrudable
      for (const h of hits) {
        const m = this.findExtrudableMesh(h.object);
        if (m) {
          selectedMesh = m;
          hit = h;
          break;
        }
      }
    }

    if (selectedMesh && hit) {
      this.options.onHover?.(selectedMesh, hit.faceIndex ?? null);
    } else {
      this.options.onHover?.(null, null);
    }
  }

  private getShapeDimensions(shape: THREE.Shape) {
    let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
    const pts = shape.getPoints();
    if (pts.length === 0) return { width: 0, length: 0, centerX: 0, centerY: 0 };
    for (const p of pts) {
      if (p.x < minX) minX = p.x;
      if (p.x > maxX) maxX = p.x;
      if (p.y < minY) minY = p.y;
      if (p.y > maxY) maxY = p.y;
    }
    return {
      width: maxX - minX,
      length: maxY - minY,
      centerX: (minX + maxX) / 2,
      centerY: (minY + maxY) / 2
    };
  }
}
