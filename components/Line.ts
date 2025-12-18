// c:\Users\Ahmad Zani Syechkar\Documents\project\website\jsts\Three.js\my-three3d\src\components\Line.ts

import * as THREE from "three";
import { SnappingHelper, type SnapKind } from "../helpers/snapping-helper";

type PickInfo = {
  point: THREE.Vector3;
  surfacePlane?: THREE.Plane;
};

export class LineTool {
  private scene: THREE.Scene;
  private camera: THREE.Camera;
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
  private anchorSprite: THREE.Sprite | null = null;
  private hoverMarkers: THREE.Group | null = null;
  private axisInfoEl: HTMLDivElement | null = null;
  private inputEl: HTMLInputElement | null = null;

  // State
  private typedLength = "";
  private tempVec3 = new THREE.Vector3();
  private tempVec3b = new THREE.Vector3();
  private createdFaceHashes = new Set<string>();

  // Constants
  private readonly SNAP_THRESHOLD = 0.3;
  private readonly AXIS_SNAP_PIXELS = 15;
  private readonly SURFACE_OFFSET = 0.001;

  constructor(
    scene: THREE.Scene,
    camera: THREE.Camera,
    container: HTMLElement,
    onLineCreated?: (mesh: THREE.Object3D) => void
  ) {
    this.scene = scene;
    this.camera = camera;
    this.container = container;
    this.onLineCreated = onLineCreated;
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
    this.points = [];
    this.typedLength = "";
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
        this.scene.remove(obj);
        if ((obj as any).geometry) (obj as any).geometry.dispose();
        if ((obj as any).material) {
            if (Array.isArray((obj as any).material)) {
                (obj as any).material.forEach((m: any) => m.dispose());
            } else {
                (obj as any).material.dispose();
            }
        }
      }
    };

    removeObj(this.previewLine);
    removeObj(this.connectorDot);
    removeObj(this.axisGuide);
    removeObj(this.anchorSprite);
    removeObj(this.hoverMarkers);

    this.previewLine = null;
    this.connectorDot = null;
    this.axisGuide = null;
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

    // 1. Snap ke Geometri (Endpoint/Midpoint)
    const snapResult = this.snappingHelper.getBestSnap(pick.point, this.points);
    if (snapResult) {
      target.copy(snapResult.point);
    }

    // 2. Axis Locking (Inference)
    if (!snapResult && this.points.length > 0) {
      const last = this.points[this.points.length - 1];
      const rect = this.container.getBoundingClientRect();
      const mouseScreen = new THREE.Vector2(
        e.clientX - rect.left,
        e.clientY - rect.top
      );

      const axes = [
        { name: "x" as const, dir: new THREE.Vector3(1, 0, 0) },
        { name: "z" as const, dir: new THREE.Vector3(0, 0, 1) },
        { name: "y" as const, dir: new THREE.Vector3(0, 1, 0) },
      ];

      let bestDist = this.AXIS_SNAP_PIXELS;
      let bestAxisPoint: THREE.Vector3 | null = null;

      for (const ax of axes) {
        const info = this.snappingHelper.getClosestPointOnAxis(last, ax.dir, mouseScreen);
        if (info.distPixels < bestDist) {
          bestDist = info.distPixels;
          bestAxisPoint = info.point;
          snappedAxis = ax.name;
        }
      }

      if (bestAxisPoint && snappedAxis) {
        target.copy(bestAxisPoint);
      }
    }

    // Update Visuals
    this.updateConnectorDot(target, snapResult?.kind);
    this.updateAxisGuide(snappedAxis, this.points[this.points.length - 1]);
    this.updatePreviewLine(target);
    this.updateHoverMarkers(snapResult?.edge);
    
    if (this.points.length > 0) {
        this.updateAxisInfo(this.points[this.points.length - 1], target, snappedAxis);
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

    this.points.push(target);
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
    this.plane.copy(this.groundPlane);
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
    const far = (this.camera as any).far;
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
    const rect = this.container.getBoundingClientRect();
    this.mouse.x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
    this.mouse.y = -((e.clientY - rect.top) / rect.height) * 2 + 1;

    this.raycaster.setFromCamera(this.mouse, this.camera);
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
      const viewNormal = this.camera.getWorldDirection(this.tempVec3b).normalize();
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
      polygonOffsetFactor: -1,
      polygonOffsetUnits: -1,
    });

    const mesh = new THREE.Mesh(geometry, material);
    const basis = new THREE.Matrix4().makeBasis(u, v, normal).setPosition(origin);
    mesh.applyMatrix4(basis);
    mesh.position.addScaledVector(normal, this.SURFACE_OFFSET);

    const edges = new THREE.EdgesGeometry(geometry);
    const outline = new THREE.LineSegments(edges, new THREE.LineBasicMaterial({ color: 0x000000 }));
    outline.userData.selectable = false;
    mesh.add(outline);

    return mesh;
  }

  private tryAutoCreateFaces() {
    const lines: THREE.Line[] = [];
    this.scene.traverse((obj) => {
      if (!(obj as any).isLine || (obj as any).userData?.isHelper) return;
      if (obj.userData.selectable !== true) return;
      lines.push(obj as THREE.Line);
    });

    if (lines.length === 0) return;

    const keyEps = 1e-4;
    const quant = (n: number) => Math.round(n / keyEps);
    const keyOf = (v: THREE.Vector3) => `${quant(v.x)},${quant(v.y)},${quant(v.z)}`;

    const vertices: THREE.Vector3[] = [];
    const keys: string[] = [];
    const keyToIndex = new Map<string, number>();
    const adjacency: number[][] = [];
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
      adjacency[a].push(b);
      adjacency[b].push(a);
    };

    for (const line of lines) {
      const geom = line.geometry;
      if (!(geom instanceof THREE.BufferGeometry)) continue;
      const pos = geom.getAttribute("position") as THREE.BufferAttribute | undefined;
      if (!pos) continue;

      const pts: THREE.Vector3[] = [];
      for (let i = 0; i < pos.count; i++) {
        pts.push(new THREE.Vector3(pos.getX(i), pos.getY(i), pos.getZ(i)));
      }
      for (const p of pts) p.applyMatrix4(line.matrixWorld);

      for (let i = 0; i < pts.length - 1; i++) {
        addEdge(getIndex(pts[i]), getIndex(pts[i + 1]));
      }
    }

    const visited = new Set<number>();
    for (let i = 0; i < vertices.length; i++) {
      if (visited.has(i)) continue;

      const component: number[] = [];
      const queue: number[] = [i];
      visited.add(i);

      while (queue.length) {
        const v = queue.pop()!;
        component.push(v);
        for (const n of adjacency[v]) {
          if (visited.has(n)) continue;
          visited.add(n);
          queue.push(n);
        }
      }

      if (component.length < 3) continue;
      if (!component.every((v) => adjacency[v].length === 2)) continue;

      const hash = component.map((v) => keys[v]).sort().join("|");
      if (this.createdFaceHashes.has(hash)) continue;

      const start = component[0];
      const order: number[] = [start];
      let prev = start;
      let curr = adjacency[start][0];

      while (true) {
        if (curr === start) break;
        order.push(curr);

        const neigh = adjacency[curr];
        if (neigh.length !== 2) break;
        const next = neigh[0] === prev ? neigh[1] : neigh[0];

        prev = curr;
        curr = next;

        if (order.length > component.length + 1) break;
      }

      if (order.length !== component.length) continue;

      const loopPoints = order.map((idx) => vertices[idx]);
      const mesh = this.createFaceFromLoop(loopPoints);
      if (!mesh) continue;

      mesh.userData.selectable = true;
      mesh.userData.loopHash = hash;
      mesh.userData.entityType = "face";
      this.scene.add(mesh);
      this.createdFaceHashes.add(hash);
    }
  }

  private finalizeLine() {
    if (this.points.length < 2) {
      this.points = [];
      this.typedLength = "";
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

    if ((object as any).isLine) {
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
      const pScreen = curr.clone().project(this.camera);
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
