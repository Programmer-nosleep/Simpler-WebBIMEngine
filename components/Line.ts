// c:\Users\Ahmad Zani Syechkar\Documents\project\website\jsts\Three.js\my-three3d\src\components\Line.ts

import * as THREE from "three";
import { SnappingHelper, type SnapKind, type SnapResult } from "../helpers/snapping-helper";
// (patched)

type PickInfo = {
  point: THREE.Vector3;
  surfacePlane?: THREE.Plane;
};

export class LineTool {
  private scene: THREE.Scene;
  private getCamera: () => THREE.Camera;
  private container: HTMLElement;
  private onLineCreated?: (mesh: THREE.Object3D) => void;

  private enabled = false;
  private points: THREE.Vector3[] = [];
  private raycaster = new THREE.Raycaster();
  private mouse = new THREE.Vector2();
  private groundPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0); // XZ (Y=ground)
  private plane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0); // Active drawing plane
  private planeLocked = false;
  private snappingHelper: SnappingHelper;

  // Visual Helpers
  private previewLine: THREE.Line | null = null;
  private connectorDot: THREE.Sprite | null = null;
  private axisGuide: THREE.Line | null = null;
  private snapGuides: THREE.Group | null = null;
  private snapGuideLines: THREE.Line[] = [];
  private edgeGuide: THREE.Line | null = null;
  private anchorSprite: THREE.Sprite | null = null;
  private hoverMarkers: THREE.Group | null = null;
  private axisInfoEl: HTMLDivElement | null = null;
  private inputEl: HTMLInputElement | null = null;

  // State
  private typedLength = "";
  private edgeLockDirs: THREE.Vector3[] = [];
  private tempVec3 = new THREE.Vector3();
  private tempVec3b = new THREE.Vector3();
  private createdFaceHashes = new Set<string>();

  // Constants
  private readonly SNAP_THRESHOLD = 0.3;
  private readonly AXIS_SNAP_PIXELS = 15;
  private readonly SURFACE_OFFSET = 0.001;

  constructor(
    scene: THREE.Scene,
    camera: THREE.Camera | (() => THREE.Camera),
    container: HTMLElement,
    onLineCreated?: (mesh: THREE.Object3D) => void
  ) {
    this.scene = scene;
    this.getCamera = typeof camera === "function" ? camera : () => camera;
    this.container = container;
    this.onLineCreated = onLineCreated;
    this.snappingHelper = new SnappingHelper(
      this.scene,
      this.getCamera,
      this.container,
      this.raycaster,
      this.SNAP_THRESHOLD
    );
  }

  public enable() {
    if (this.enabled) return;
    this.enabled = true;
    this.points = [];
    this.typedLength = "";
    this.edgeLockDirs = [];
    this.resetDrawingPlane();
    this.container.style.cursor = "crosshair";

    this.container.addEventListener("pointermove", this.onPointerMove);
    this.container.addEventListener("pointerdown", this.onPointerDown);
    window.addEventListener("keydown", this.onKeyDown);
  }

  public disable() {
    if (!this.enabled) return;

    // When exiting the tool (e.g. via Escape/tool switch), don't discard the
    // already drawn points. Commit them as a line/mesh if possible.
    if (this.points.length > 0) {
      this.finalizeLine();
    }

    this.enabled = false;
    this.container.style.cursor = "default";

    this.container.removeEventListener("pointermove", this.onPointerMove);
    this.container.removeEventListener("pointerdown", this.onPointerDown);
    window.removeEventListener("keydown", this.onKeyDown);

    this.cleanupVisuals();
    this.removeInputOverlay();
    this.hideAxisInfo();
  }

  private cleanupVisuals() {
    const removeObj = (obj: THREE.Object3D | null) => {
      if (obj) {
        obj.traverse((child) => {
          const anyChild = child as any;
          if (anyChild.geometry) anyChild.geometry.dispose();
          if (anyChild.material) {
            if (Array.isArray(anyChild.material)) {
              anyChild.material.forEach((m: any) => m.dispose());
            } else {
              anyChild.material.dispose();
            }
          }
        });
        this.scene.remove(obj);
      }
    };

    removeObj(this.previewLine);
    removeObj(this.connectorDot);
    removeObj(this.axisGuide);
    removeObj(this.snapGuides);
    removeObj(this.edgeGuide);
    removeObj(this.anchorSprite);
    removeObj(this.hoverMarkers);

    this.previewLine = null;
    this.connectorDot = null;
    this.axisGuide = null;
    this.snapGuides = null;
    this.snapGuideLines = [];
    this.edgeGuide = null;
    this.anchorSprite = null;
    this.hoverMarkers = null;
  }

  // --- Event Handlers ---

  private onPointerMove = (e: PointerEvent) => {
    if (!this.enabled) return;
    
    // Skip jika sedang navigasi (Shift/Middle click)
    if (e.shiftKey && (e.buttons & 1) === 1) return;
    if ((e.buttons & 4) === 4) return;

    const pick = this.pickPoint(e);
    if (!pick) return;

    let target = pick.point.clone();
    let snappedAxis: "x" | "y" | "z" | null = null;
    let snappedEdgeDir: THREE.Vector3 | null = null;

    // 1. Snap ke Geometri (Endpoint/Midpoint)
    const rect = this.container.getBoundingClientRect();
    const mouseScreen = new THREE.Vector2(
      e.clientX - rect.left,
      e.clientY - rect.top
    );
    const snapResult = this.snappingHelper.getBestSnapByScreen(
      mouseScreen,
      this.points,
      this.AXIS_SNAP_PIXELS
    );
    if (snapResult) {
      target.copy(snapResult.point);
    }

    // 2. Axis Locking (Inference)
    if (!snapResult && this.points.length > 0) {
      const last = this.points[this.points.length - 1];

      const axes = [
        { name: "x" as const, dir: new THREE.Vector3(1, 0, 0) },
        { name: "z" as const, dir: new THREE.Vector3(0, 0, 1) },
        { name: "y" as const, dir: new THREE.Vector3(0, 1, 0) },
      ];

      let bestDist = this.AXIS_SNAP_PIXELS;
      let bestPoint: THREE.Vector3 | null = null;

      for (const ax of axes) {
        const info = this.snappingHelper.getClosestPointOnAxis(last, ax.dir, mouseScreen);
        if (info.distPixels < bestDist) {
          bestDist = info.distPixels;
          bestPoint = info.point;
          snappedAxis = ax.name;
          snappedEdgeDir = null;
        }
      }

      for (const dir of this.edgeLockDirs) {
        const info = this.snappingHelper.getClosestPointOnAxis(last, dir, mouseScreen);
        if (info.distPixels < bestDist) {
          bestDist = info.distPixels;
          bestPoint = info.point;
          snappedAxis = null;
          snappedEdgeDir = dir;
        }
      }

      if (bestPoint) {
        target.copy(bestPoint);
      }
    }

    // Update Visuals
    this.updateConnectorDot(target, snapResult?.kind);
    this.updateSnapGuides(snapResult);
    this.updateAxisGuide(snappedAxis, this.points[this.points.length - 1]);
    this.updateEdgeGuide(snappedEdgeDir, this.points[this.points.length - 1]);
    this.updatePreviewLine(target);
    this.updateHoverMarkers(snapResult?.edge);
    
    if (this.points.length > 0) {
        const lockLabel = snappedAxis ?? (snappedEdgeDir ? "edge" : null);
        this.updateAxisInfo(this.points[this.points.length - 1], target, lockLabel);
    }
  };

  private onPointerDown = (e: PointerEvent) => {
    if (!this.enabled || e.button !== 0) return;
    // Cegah event bubbling agar tidak trigger orbit controls selection
    // e.stopPropagation(); 

    const pick = this.pickPoint(e);
    if (!pick) return;

    if (this.points.length === 0) {
      if (pick.surfacePlane) {
        this.plane.copy(pick.surfacePlane);
        this.planeLocked = true;
      } else {
        this.resetDrawingPlane();
      }
    }

    const rect = this.container.getBoundingClientRect();
    const mouseScreen = new THREE.Vector2(
      e.clientX - rect.left,
      e.clientY - rect.top
    );
    const clickSnap = this.snappingHelper.getBestSnapByScreen(
      mouseScreen,
      this.points,
      this.AXIS_SNAP_PIXELS
    );

    // Prioritaskan posisi dot connector yang sudah ter-snap/axis-locked
    let target = this.connectorDot ? this.connectorDot.position.clone() : pick.point.clone();

    // Close loop check
    if (this.points.length >= 2) {
        if (target.distanceTo(this.points[0]) < this.SNAP_THRESHOLD) {
            this.points.push(this.points[0].clone());
            this.finalizeLine();
            return;
        }
    }

    // Handle Typed Length
    if (this.points.length > 0 && this.typedLength) {
        const len = parseFloat(this.typedLength);
        if (isFinite(len) && len > 0) {
            const last = this.points[this.points.length - 1];
            const dir = new THREE.Vector3().subVectors(target, last).normalize();
            target = last.clone().addScaledVector(dir, len);
            this.typedLength = "";
            this.removeInputOverlay();
         }
     }

    const nextEdgeLockDirs = this.getEdgeLockDirsFromSnap(clickSnap, target);

    this.points.push(target);
    this.edgeLockDirs = nextEdgeLockDirs;
    // Keep the active plane passing through the latest point (SketchUp-like).
    this.plane.constant = -this.plane.normal.dot(target);
    this.updateAnchorSprite(target);

    if (this.points.length === 1) {
        this.showInputOverlay(e.clientX, e.clientY);
    }
  };

  private onKeyDown = (e: KeyboardEvent) => {
    if (!this.enabled) return;

    if (e.key === "Enter") {
        if (this.points.length > 1) this.finalizeLine();
    } else if (e.key === "Backspace") {
        this.typedLength = this.typedLength.slice(0, -1);
        this.updateInputDisplay();
    } else if (/^[0-9.]$/.test(e.key)) {
        this.typedLength += e.key;
        this.updateInputDisplay();
        // Jika input box belum muncul (misal user mengetik tanpa klik pertama), munculkan di tengah atau dekat mouse
        if (!this.inputEl && this.points.length > 0) {
             // Fallback position logic could go here
        }
    }
  };

  // --- Logic Helpers ---
  private resetDrawingPlane() {
    this.syncGroundPlane();
    const camera = this.getCamera();
    if ((camera as any).isOrthographicCamera) {
      // For orthographic views (front/side/top), use a view-aligned plane so
      // ray/plane intersection stays stable and follows the cursor.
      const viewNormal = camera.getWorldDirection(this.tempVec3b).normalize();
      const groundY = -this.groundPlane.constant;
      this.tempVec3.set(0, groundY, 0);
      this.plane.setFromNormalAndCoplanarPoint(viewNormal, this.tempVec3);
    } else {
      this.plane.copy(this.groundPlane);
    }
    this.planeLocked = false;
  }

  private syncGroundPlane() {
    const groundRef =
      this.scene.getObjectByName("Grid") ?? this.scene.getObjectByName("AxesWorld");
    const groundY = groundRef ? groundRef.getWorldPosition(this.tempVec3).y : 0;
    this.groundPlane.normal.set(0, 1, 0);
    this.groundPlane.constant = -groundY;
  }

  private getMaxPickDistance() {
    const far = (this.getCamera() as any).far;
    return typeof far === "number" && isFinite(far) ? far : 1e6;
  }

  private getSurfacePlane(intersection: THREE.Intersection): THREE.Plane | undefined {
    const face = intersection.face;
    if (!face) return undefined;

    const normal = face.normal.clone();
    normal.transformDirection(intersection.object.matrixWorld).normalize();
    return new THREE.Plane().setFromNormalAndCoplanarPoint(normal, intersection.point);
  }

  private pickPoint(e: PointerEvent): PickInfo | null {
    // If projection changes while the tool is active, keep the default plane
    // in sync (only before the first click).
    if (!this.planeLocked && this.points.length === 0) {
      this.resetDrawingPlane();
    }

    const rect = this.container.getBoundingClientRect();
    this.mouse.x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
    this.mouse.y = -((e.clientY - rect.top) / rect.height) * 2 + 1;

    const camera = this.getCamera();
    this.raycaster.setFromCamera(this.mouse, camera);
    const maxDist = this.getMaxPickDistance();

    const meshCandidates: THREE.Object3D[] = [];
    const lineCandidates: THREE.Object3D[] = [];
    this.scene.traverse((obj) => {
      if (obj.name === "SkyDome" || obj.name === "Grid" || (obj as any).userData.isHelper) return;
      if ((obj as any).isMesh) meshCandidates.push(obj);
      else if ((obj as any).isLine) lineCandidates.push(obj);
    });

    const meshHit = this.raycaster.intersectObjects(meshCandidates, true)[0];
    const lineHit = this.raycaster.intersectObjects(lineCandidates, true)[0];
    const surfaceHit: THREE.Intersection | null =
      (meshHit && meshHit.distance <= maxDist ? meshHit : null) ??
      (lineHit && lineHit.distance <= maxDist ? lineHit : null);

    let planePoint: THREE.Vector3 | null = null;
    if (this.raycaster.ray.intersectPlane(this.plane, this.tempVec3)) {
      const dist = this.raycaster.ray.origin.distanceTo(this.tempVec3);
      if (dist <= maxDist) planePoint = this.tempVec3.clone();
    }

    let viewPoint: THREE.Vector3 | null = null;
    const viewRef =
      this.points.length > 0 ? this.points[this.points.length - 1] : surfaceHit?.point ?? null;

    if (viewRef) {
      const viewNormal = camera.getWorldDirection(this.tempVec3b).normalize();
      const viewPlane = new THREE.Plane().setFromNormalAndCoplanarPoint(viewNormal, viewRef);
      if (this.raycaster.ray.intersectPlane(viewPlane, this.tempVec3)) {
        const dist = this.raycaster.ray.origin.distanceTo(this.tempVec3);
        if (dist <= maxDist) viewPoint = this.tempVec3.clone();
      }
    }

    const starting = this.points.length === 0 && !this.planeLocked;
    let chosenPoint: THREE.Vector3 | null = null;
    let surfacePlane: THREE.Plane | undefined;

    if (starting) {
      if (surfaceHit) {
        chosenPoint = surfaceHit.point.clone();
        if (surfaceHit === meshHit) surfacePlane = this.getSurfacePlane(surfaceHit);
      } else {
        chosenPoint = planePoint ?? viewPoint;
      }
    } else {
      chosenPoint = planePoint ?? (surfaceHit ? surfaceHit.point.clone() : null) ?? viewPoint;
    }

    if (!chosenPoint) return null;
    return { point: chosenPoint, surfacePlane };
  }

  private createFaceFromLoop(loop: THREE.Vector3[]): THREE.Mesh | null {
    const points = loop.slice();
    if (points.length < 3) return null;

    const closeEps = 1e-5;
    if (points[0].distanceTo(points[points.length - 1]) < closeEps) points.pop();

    const cleaned: THREE.Vector3[] = [];
    for (const p of points) {
      const prev = cleaned[cleaned.length - 1];
      if (prev && prev.distanceTo(p) < closeEps) continue;
      cleaned.push(p.clone());
    }
    if (cleaned.length < 3) return null;

    const origin = cleaned[0];
    let normal: THREE.Vector3 | null = null;
    for (let i = 1; i < cleaned.length - 1 && !normal; i++) {
      const v1 = cleaned[i].clone().sub(origin);
      for (let j = i + 1; j < cleaned.length && !normal; j++) {
        const v2 = cleaned[j].clone().sub(origin);
        const n = v1.clone().cross(v2);
        if (n.lengthSq() > 1e-10) normal = n.normalize();
      }
    }
    if (!normal) return null;

    const plane = new THREE.Plane().setFromNormalAndCoplanarPoint(normal, origin);
    const planarEps = 1e-3;
    if (!cleaned.every((p) => Math.abs(plane.distanceToPoint(p)) < planarEps)) return null;

    const helperAxis =
      Math.abs(normal.y) < 0.9 ? new THREE.Vector3(0, 1, 0) : new THREE.Vector3(1, 0, 0);
    const u = new THREE.Vector3().crossVectors(helperAxis, normal).normalize();
    const v = new THREE.Vector3().crossVectors(normal, u).normalize();

    const shape = new THREE.Shape();
    const p0 = cleaned[0].clone().sub(origin);
    shape.moveTo(p0.dot(u), p0.dot(v));
    for (let i = 1; i < cleaned.length; i++) {
      const p = cleaned[i].clone().sub(origin);
      shape.lineTo(p.dot(u), p.dot(v));
    }
    shape.closePath();

    const geometry = new THREE.ShapeGeometry(shape);
    const material = new THREE.MeshBasicMaterial({
      color: 0xcccccc,
      side: THREE.DoubleSide,
      polygonOffset: true,
      polygonOffsetFactor: 1,
      polygonOffsetUnits: 1,
    });

    const mesh = new THREE.Mesh(geometry, material);
    const basis = new THREE.Matrix4().makeBasis(u, v, normal).setPosition(origin);
    mesh.applyMatrix4(basis);
    mesh.position.addScaledVector(normal, this.SURFACE_OFFSET);

    const edges = new THREE.EdgesGeometry(geometry);
    const outline = new THREE.LineSegments(
      edges,
      new THREE.LineBasicMaterial({ color: 0x000000, depthWrite: false })
    );
    outline.userData.selectable = false;
    outline.renderOrder = 1;
    outline.position.z += this.SURFACE_OFFSET;
    mesh.add(outline);

    return mesh;
  }

  private tryAutoCreateFaces() {
    type Edge = { a: number; b: number };
    type PlaneInfo = { normal: THREE.Vector3; origin: THREE.Vector3 };

    // Include:
    // - user-drawn lines (selectable === true)
    // - outlines of faces created by this tool (LineSegments child of a selectable face mesh)
    const isFaceOutline = (obj: THREE.Object3D) => {
      let current: THREE.Object3D | null = obj.parent;
      while (current && current !== this.scene) {
        if (current.userData?.selectable === true && current.userData?.entityType === "face") return true;
        current = current.parent;
      }
      return false;
    };

    const lineSources: THREE.Line[] = [];
    this.scene.traverse((obj) => {
      if ((obj as any).userData?.isHelper) return;
      if (obj.name === "SkyDome" || obj.name === "Grid" || obj.name === "AxesWorld") return;
      if (!(obj as any).isLine) return;

      if (obj.userData?.selectable === true) {
        lineSources.push(obj as THREE.Line);
        return;
      }

      if (isFaceOutline(obj)) {
        lineSources.push(obj as THREE.Line);
      }
    });

    if (lineSources.length === 0) return;

    // Re-sync createdFaceHashes with the scene to allow re-creation of deleted faces
    this.createdFaceHashes.clear();
    this.scene.traverse((obj) => {
      if (obj.userData?.entityType === "face" && obj.userData?.loopHash) {
        this.createdFaceHashes.add(obj.userData.loopHash);
      }
    });

    const keyEps = 1e-3;
    const quant = (n: number) => Math.round(n / keyEps);
    const keyOf = (v: THREE.Vector3) => `${quant(v.x)},${quant(v.y)},${quant(v.z)}`;

    const vertices: THREE.Vector3[] = [];
    const keys: string[] = [];
    const keyToIndex = new Map<string, number>();
    const adjacency: number[][] = [];
    const edges: Edge[] = [];
    const edgeSet = new Set<string>();

    const getIndex = (p: THREE.Vector3) => {
      const k = keyOf(p);
      const existing = keyToIndex.get(k);
      if (existing !== undefined) return existing;
      const index = vertices.length;
      keyToIndex.set(k, index);
      vertices.push(p.clone());
      keys.push(k);
      adjacency[index] = [];
      return index;
    };

    const addEdge = (a: number, b: number) => {
      if (a === b) return;
      const min = Math.min(a, b);
      const max = Math.max(a, b);
      const edgeKey = `${min}|${max}`;
      if (edgeSet.has(edgeKey)) return;
      edgeSet.add(edgeKey);
      edges.push({ a: min, b: max });
      adjacency[a].push(b);
      adjacency[b].push(a);
    };

    const addSegmentsFromLine = (line: THREE.Line) => {
      const geom = line.geometry;
      if (!(geom instanceof THREE.BufferGeometry)) return;
      const pos = geom.getAttribute("position") as THREE.BufferAttribute | undefined;
      if (!pos) return;

      const pts: THREE.Vector3[] = [];
      for (let i = 0; i < pos.count; i++) {
        pts.push(new THREE.Vector3(pos.getX(i), pos.getY(i), pos.getZ(i)).applyMatrix4(line.matrixWorld));
      }

      const isLineSegments = (line as any).isLineSegments === true;
      if (isLineSegments) {
        for (let i = 0; i < pts.length - 1; i += 2) {
          addEdge(getIndex(pts[i]), getIndex(pts[i + 1]));
        }
      } else {
        for (let i = 0; i < pts.length - 1; i++) {
          addEdge(getIndex(pts[i]), getIndex(pts[i + 1]));
        }
      }
    };

    for (const line of lineSources) addSegmentsFromLine(line);
    if (edges.length === 0) return;

    // Candidate planes from pairs of incident edges (allows planar faces even when the whole graph is non-planar).
    const canonicalizeNormal = (n: THREE.Vector3) => {
      const ax = Math.abs(n.x);
      const ay = Math.abs(n.y);
      const az = Math.abs(n.z);

      if (ay >= ax && ay >= az) {
        if (n.y < 0) n.multiplyScalar(-1);
      } else if (ax >= ay && ax >= az) {
        if (n.x < 0) n.multiplyScalar(-1);
      } else {
        if (n.z < 0) n.multiplyScalar(-1);
      }
      return n;
    };

    const normalEps = 1e-3;
    const planeConstEps = 1e-3;
    const qn = (v: number) => Math.round(v / normalEps);
    const qc = (v: number) => Math.round(v / planeConstEps);

    const planeCandidates = new Map<string, PlaneInfo>();
    for (let i = 0; i < vertices.length; i++) {
      const neigh = adjacency[i];
      if (!neigh || neigh.length < 2) continue;
      const origin = vertices[i];

      for (let a = 0; a < neigh.length - 1; a++) {
        for (let b = a + 1; b < neigh.length; b++) {
          const d1 = vertices[neigh[a]].clone().sub(origin);
          const d2 = vertices[neigh[b]].clone().sub(origin);
          const n = d1.cross(d2);
          if (n.lengthSq() < 1e-10) continue;
          n.normalize();
          canonicalizeNormal(n);

          const c = n.dot(origin);
          const key = `${qn(n.x)},${qn(n.y)},${qn(n.z)}|${qc(c)}`;
          if (!planeCandidates.has(key)) {
            planeCandidates.set(key, { normal: n.clone(), origin: origin.clone() });
          }
        }
      }
    }

    if (planeCandidates.size === 0) return;

    const planeDistEps = 1e-3;
    const areaEps = 1e-7;
    const maxWalkSteps = 10000;

    const signedArea2D = (loop: number[], coords: Map<number, { x: number; y: number }>) => {
      let sum = 0;
      for (let i = 0; i < loop.length; i++) {
        const a = coords.get(loop[i]);
        const b = coords.get(loop[(i + 1) % loop.length]);
        if (!a || !b) continue;
        sum += a.x * b.y - a.y * b.x;
      }
      return sum * 0.5;
    };

    for (const { normal, origin } of planeCandidates.values()) {
      const plane = new THREE.Plane().setFromNormalAndCoplanarPoint(normal, origin);

      const helperAxis =
        Math.abs(normal.y) < 0.9 ? new THREE.Vector3(0, 1, 0) : new THREE.Vector3(1, 0, 0);
      const u = new THREE.Vector3().crossVectors(helperAxis, normal).normalize();
      const v = new THREE.Vector3().crossVectors(normal, u).normalize();

      const coords = new Map<number, { x: number; y: number }>();
      for (let i = 0; i < vertices.length; i++) {
        if (Math.abs(plane.distanceToPoint(vertices[i])) >= planeDistEps) continue;
        const rel = vertices[i].clone().sub(origin);
        coords.set(i, { x: rel.dot(u), y: rel.dot(v) });
      }

      if (coords.size < 3) continue;

      const planeAdj = new Map<number, number[]>();
      for (const e of edges) {
        if (!coords.has(e.a) || !coords.has(e.b)) continue;
        (planeAdj.get(e.a) ?? planeAdj.set(e.a, []).get(e.a)!).push(e.b);
        (planeAdj.get(e.b) ?? planeAdj.set(e.b, []).get(e.b)!).push(e.a);
      }

      if (planeAdj.size < 3) continue;

      const neighborOrder = new Map<number, number[]>();
      const neighborIndex = new Map<string, number>();

      for (const [from, neighs] of planeAdj) {
        const fromCoord = coords.get(from);
        if (!fromCoord) continue;

        const uniqueNeighs = Array.from(new Set(neighs));
        uniqueNeighs.sort((a, b) => {
          const aCoord = coords.get(a);
          const bCoord = coords.get(b);
          if (!aCoord || !bCoord) return 0;
          const aAng = Math.atan2(aCoord.y - fromCoord.y, aCoord.x - fromCoord.x);
          const bAng = Math.atan2(bCoord.y - fromCoord.y, bCoord.x - fromCoord.x);
          return aAng - bAng;
        });

        neighborOrder.set(from, uniqueNeighs);
        uniqueNeighs.forEach((to, idx) => neighborIndex.set(`${from}|${to}`, idx));
      }

      const visitedDir = new Set<string>();
      for (const [startFrom, starts] of neighborOrder) {
        for (const startTo of starts) {
          const startKey = `${startFrom}->${startTo}`;
          if (visitedDir.has(startKey)) continue;

          const loop: number[] = [];
          let from = startFrom;
          let to = startTo;
          let steps = 0;

          while (steps++ < maxWalkSteps) {
            visitedDir.add(`${from}->${to}`);
            loop.push(from);

            const toNeigh = neighborOrder.get(to);
            if (!toNeigh || toNeigh.length === 0) {
              loop.length = 0;
              break;
            }

            const idx = neighborIndex.get(`${to}|${from}`);
            if (idx === undefined) {
              loop.length = 0;
              break;
            }

            const next = toNeigh[(idx + 1) % toNeigh.length];
            from = to;
            to = next;

            if (from === startFrom && to === startTo) break;
          }

          if (loop.length < 3) continue;
          if (!(from === startFrom && to === startTo)) continue;

          const area = signedArea2D(loop, coords);
          if (Math.abs(area) <= areaEps) continue; // ignore outer / degenerate

          const hash = loop.map((idx) => keys[idx]).sort().join("|");
          if (this.createdFaceHashes.has(hash)) continue;

          const loopPoints = loop.map((idx) => vertices[idx]);
          const mesh = this.createFaceFromLoop(loopPoints);
          if (!mesh) continue;

          mesh.userData.selectable = true;
          mesh.userData.loopHash = hash;
          mesh.userData.entityType = "face";
          this.scene.add(mesh);
          this.createdFaceHashes.add(hash);
        }
      }
    }
  }

  private finalizeLine() {
    if (this.points.length < 2) {
      this.points = [];
      this.typedLength = "";
      this.edgeLockDirs = [];
      this.cleanupVisuals();
      this.removeInputOverlay();
      this.hideAxisInfo();
      this.resetDrawingPlane();
      return;
    }

    const isClosed =
      this.points.length > 3 &&
      this.points[0].distanceTo(this.points[this.points.length - 1]) < 1e-5;
    let object: THREE.Object3D;

    if (isClosed) {
      const mesh = this.createFaceFromLoop(this.points);
      if (mesh) {
        object = mesh;
      } else {
        const geometry = new THREE.BufferGeometry().setFromPoints(this.points);
        const material = new THREE.LineBasicMaterial({ color: 0x000000 });
        object = new THREE.Line(geometry, material);
      }
    } else {
      const geometry = new THREE.BufferGeometry().setFromPoints(this.points);
      const material = new THREE.LineBasicMaterial({ color: 0x000000 });
      object = new THREE.Line(geometry, material);
    }

    if ((object as any).isMesh) {
      const closeEps = 1e-5;
      const pts = this.points.slice();
      if (pts[0].distanceTo(pts[pts.length - 1]) < closeEps) pts.pop();

      const cleaned: THREE.Vector3[] = [];
      for (const p of pts) {
        const prev = cleaned[cleaned.length - 1];
        if (prev && prev.distanceTo(p) < closeEps) continue;
        cleaned.push(p.clone());
      }

      const keyEps = 1e-3;
      const quant = (n: number) => Math.round(n / keyEps);
      const keyOf = (v: THREE.Vector3) => `${quant(v.x)},${quant(v.y)},${quant(v.z)}`;
      const loopHash = cleaned.map(keyOf).sort().join("|");

      if (loopHash) {
        object.userData.loopHash = loopHash;
        this.createdFaceHashes.add(loopHash);
      }
    }

    if ((object as THREE.Line).isLine) {
      const planarEps = 1e-3;
      const isPlanarToActivePlane = this.points.every(
        (p) => Math.abs(this.plane.distanceToPoint(p)) < planarEps
      );
      if (isPlanarToActivePlane) {
        object.position.addScaledVector(this.plane.normal, this.SURFACE_OFFSET);
      }
    }

    object.userData.selectable = true;
    object.userData.entityType = (object as any).isMesh ? "face" : "line";
    this.scene.add(object);
    try {
      this.onLineCreated?.(object);
    } catch (error) {
      console.error("LineTool onLineCreated callback failed:", error);
    }

    if ((object as any).isLine) {
      this.tryAutoCreateFaces();
    }

    this.points = [];
    this.typedLength = "";
    this.edgeLockDirs = [];
    this.cleanupVisuals();
    this.removeInputOverlay();
    this.hideAxisInfo();
    this.resetDrawingPlane();
  }

  // --- Visual Updaters ---

  private updateConnectorDot(pos: THREE.Vector3, snapKind?: SnapKind) {
    if (!this.connectorDot) {
        const canvas = document.createElement("canvas");
        canvas.width = 64; canvas.height = 64;
        const ctx = canvas.getContext("2d")!;
        ctx.beginPath(); ctx.arc(32, 32, 16, 0, Math.PI*2); ctx.fillStyle = "#fff"; ctx.fill();
        ctx.lineWidth = 4; ctx.strokeStyle = "#000"; ctx.stroke();
        
        const tex = new THREE.CanvasTexture(canvas);
        const mat = new THREE.SpriteMaterial({ map: tex, depthTest: false, depthWrite: false });
        this.connectorDot = new THREE.Sprite(mat);
        this.connectorDot.scale.set(0.5, 0.5, 1);
        this.connectorDot.renderOrder = 999;
        this.connectorDot.userData.isHelper = true;
        this.scene.add(this.connectorDot);
    }
    this.connectorDot.position.copy(pos);
    
    const mat = this.connectorDot.material;
    if (snapKind === "endpoint") mat.color.setHex(0x00ff00);
    else if (snapKind === "midpoint") mat.color.setHex(0x00ffff);
    else mat.color.setHex(0xffffff);
  }

  private updatePreviewLine(currentPos: THREE.Vector3) {
    if (this.points.length === 0) return;
    
    const pts = [...this.points, currentPos];
    const geometry = new THREE.BufferGeometry().setFromPoints(pts);
    
    if (!this.previewLine) {
        const material = new THREE.LineBasicMaterial({ color: 0x000000 });
        this.previewLine = new THREE.Line(geometry, material);
        this.previewLine.userData.isHelper = true;
        this.scene.add(this.previewLine);
    } else {
        this.previewLine.geometry.dispose();
        this.previewLine.geometry = geometry;
    }
  }

  private updateAxisGuide(axis: "x" | "y" | "z" | null, origin?: THREE.Vector3) {
    if (!axis || !origin) {
        if (this.axisGuide) this.axisGuide.visible = false;
        return;
    }

    if (!this.axisGuide) {
        const geom = new THREE.BufferGeometry();
        const mat = new THREE.LineDashedMaterial({
            color: 0xff0000,
            dashSize: 0.5,
            gapSize: 0.3,
            depthTest: false,
            depthWrite: false,
        });
        this.axisGuide = new THREE.Line(geom, mat);
        this.axisGuide.computeLineDistances(); // Required for LineDashedMaterial
        this.axisGuide.userData.isHelper = true;
        this.scene.add(this.axisGuide);
    }

    this.axisGuide.visible = true;
    const mat = this.axisGuide.material as THREE.LineDashedMaterial;
    mat.color.setHex(axis === 'x' ? 0xff0000 : axis === 'y' ? 0x00ff00 : 0x0000ff);

    const dir = axis === 'x' ? new THREE.Vector3(1,0,0) : axis === 'y' ? new THREE.Vector3(0,1,0) : new THREE.Vector3(0,0,1);
    const p1 = origin.clone().addScaledVector(dir, -1000);
    const p2 = origin.clone().addScaledVector(dir, 1000);
    this.axisGuide.geometry.setFromPoints([p1, p2]);
    this.axisGuide.computeLineDistances();
  }

  private getEdgeLockDirsFromSnap(snap: SnapResult | null, target: THREE.Vector3) {
    if (!snap) return [];
    if (snap.kind !== "endpoint" && snap.kind !== "midpoint") return [];
    if (snap.point.distanceTo(target) > this.SNAP_THRESHOLD) return [];

    const edges = snap.edges ?? (snap.edge ? [snap.edge] : []);
    if (edges.length === 0) return [];

    const planeNormal = this.plane.normal;
    const dirs: THREE.Vector3[] = [];
    const unfiltered: THREE.Vector3[] = [];
    const dirEps = 0.999;

    for (const edge of edges) {
      const dir = edge.b.clone().sub(edge.a);
      if (dir.lengthSq() < 1e-12) continue;
      dir.normalize();

      if (!unfiltered.some((d) => Math.abs(d.dot(dir)) > dirEps)) unfiltered.push(dir);

      // Prefer directions that lie on the current drawing plane.
      if (Math.abs(dir.dot(planeNormal)) > 0.15) continue;
      if (!dirs.some((d) => Math.abs(d.dot(dir)) > dirEps)) dirs.push(dir);
    }

    return dirs.length > 0 ? dirs : unfiltered;
  }

  private updateSnapGuides(snap: SnapResult | null) {
    const shouldShow =
      !!snap &&
      (snap.kind === "endpoint" || snap.kind === "midpoint") &&
      (snap.edges?.length || snap.edge);

    if (!shouldShow) {
      if (this.snapGuides) this.snapGuides.visible = false;
      return;
    }

    const dirs = this.getEdgeLockDirsFromSnap(snap, snap.point);
    if (dirs.length === 0) {
      if (this.snapGuides) this.snapGuides.visible = false;
      return;
    }

    if (!this.snapGuides) {
      this.snapGuides = new THREE.Group();
      this.snapGuides.userData.isHelper = true;
      this.scene.add(this.snapGuides);
    }

    const length = 1000;
    const ensureLine = (index: number) => {
      if (this.snapGuideLines[index]) return this.snapGuideLines[index];

      const geom = new THREE.BufferGeometry();
      const mat = new THREE.LineDashedMaterial({
        color: 0xff00ff,
        dashSize: 0.5,
        gapSize: 0.3,
        depthTest: false,
        depthWrite: false,
      });
      const line = new THREE.Line(geom, mat);
      line.userData.isHelper = true;
      line.renderOrder = 998;
      this.snapGuides!.add(line);
      this.snapGuideLines[index] = line;
      return line;
    };

    for (let i = 0; i < dirs.length; i++) {
      const dir = dirs[i];
      const line = ensureLine(i);
      const p1 = snap.point.clone().addScaledVector(dir, -length);
      const p2 = snap.point.clone().addScaledVector(dir, length);
      line.geometry.setFromPoints([p1, p2]);
      line.computeLineDistances();
      line.visible = true;
    }

    for (let i = dirs.length; i < this.snapGuideLines.length; i++) {
      this.snapGuideLines[i].visible = false;
    }

    this.snapGuides.visible = true;
  }

  private updateEdgeGuide(dir: THREE.Vector3 | null, origin?: THREE.Vector3) {
    if (!dir || !origin) {
      if (this.edgeGuide) this.edgeGuide.visible = false;
      return;
    }

    if (!this.edgeGuide) {
      const geom = new THREE.BufferGeometry();
      const mat = new THREE.LineDashedMaterial({
        color: 0xff00ff,
        dashSize: 0.5,
        gapSize: 0.3,
        depthTest: false,
        depthWrite: false,
      });
      this.edgeGuide = new THREE.Line(geom, mat);
      this.edgeGuide.userData.isHelper = true;
      this.edgeGuide.renderOrder = 998;
      this.scene.add(this.edgeGuide);
    }

    const length = 1000;
    const p1 = origin.clone().addScaledVector(dir, -length);
    const p2 = origin.clone().addScaledVector(dir, length);
    this.edgeGuide.geometry.setFromPoints([p1, p2]);
    this.edgeGuide.computeLineDistances();
    this.edgeGuide.visible = true;
  }

  private updateAnchorSprite(pos: THREE.Vector3) {
      void pos;
      // Optional: Mark vertices
  }

  private updateHoverMarkers(edge?: {a: THREE.Vector3, b: THREE.Vector3}) {
      void edge;
      // Optional: Highlight edge being snapped to
  }

  // --- UI Overlays ---

  private showInputOverlay(x: number, y: number) {
    if (!this.inputEl) {
        this.inputEl = document.createElement("input");
        this.inputEl.type = "text";
        this.inputEl.placeholder = "Length...";
        this.inputEl.className = "control-panel"; // Reuse style
        Object.assign(this.inputEl.style, {
            position: "fixed",
            zIndex: "10000",
            width: "100px",
            padding: "4px 8px",
            fontSize: "12px",
            pointerEvents: "none", // Let user type but not click? Or focus it?
            // Actually for SketchUp style, you just type. We display what is typed.
            background: "rgba(255, 255, 255, 0.9)",
            color: "black",
            border: "1px solid #ccc",
            borderRadius: "4px"
        });
        document.body.appendChild(this.inputEl);
    }
    this.inputEl.style.left = `${x + 15}px`;
    this.inputEl.style.top = `${y + 15}px`;
    this.updateInputDisplay();
  }

  private updateInputDisplay() {
      if (this.inputEl) {
          this.inputEl.value = this.typedLength;
          this.inputEl.style.display = this.points.length > 0 ? "block" : "none";
      }
  }

  private removeInputOverlay() {
      if (this.inputEl) {
          this.inputEl.remove();
          this.inputEl = null;
      }
  }

  private updateAxisInfo(last: THREE.Vector3, curr: THREE.Vector3, axis: string | null) {
      if (!this.axisInfoEl) {
          this.axisInfoEl = document.createElement("div");
          Object.assign(this.axisInfoEl.style, {
              position: "fixed",
              zIndex: "9999",
              padding: "4px 8px",
              fontSize: "11px",
              borderRadius: "4px",
              background: "rgba(0,0,0,0.7)",
              color: "#fff",
              pointerEvents: "none",
              whiteSpace: "pre",
          });
          document.body.appendChild(this.axisInfoEl);
      }
      
      const dist = last.distanceTo(curr);
      const axisLabel = axis ? `Axis: ${axis.toUpperCase()}` : "Free";
      this.axisInfoEl.innerText = `Len: ${dist.toFixed(2)}m\n${axisLabel}`;
      
      // Position near mouse
      const rect = this.container.getBoundingClientRect();
      const pScreen = curr.clone().project(this.getCamera());
      const x = (pScreen.x * 0.5 + 0.5) * rect.width + rect.left;
      const y = (-pScreen.y * 0.5 + 0.5) * rect.height + rect.top;
      
      this.axisInfoEl.style.left = `${x + 20}px`;
      this.axisInfoEl.style.top = `${y + 20}px`;
      this.axisInfoEl.style.display = "block";
  }

  private hideAxisInfo() {
      if (this.axisInfoEl) this.axisInfoEl.style.display = "none";
  }
}
