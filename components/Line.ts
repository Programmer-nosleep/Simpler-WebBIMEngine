// c:\Users\Ahmad Zani Syechkar\Documents\project\website\jsts\Three.js\my-three3d\src\components\Line.ts

import * as THREE from "three";
import { SnappingHelper } from "../helpers/snapping-helper";


export class LineTool {
  private scene: THREE.Scene;
  private camera: THREE.Camera;
  private container: HTMLElement;
  private onLineCreated: (mesh: THREE.Object3D) => void;

  private enabled = false;
  private points: THREE.Vector3[] = [];
  private raycaster = new THREE.Raycaster();
  private mouse = new THREE.Vector2();
  private plane = new THREE.Plane(new THREE.Vector3(0, 0, 1), 0); // XY Plane (Z=0)
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

  // Constants
  private readonly SNAP_THRESHOLD = 0.3;
  private readonly AXIS_SNAP_PIXELS = 15;

  constructor(
    scene: THREE.Scene,
    camera: THREE.Camera,
    container: HTMLElement,
    onLineCreated: (mesh: THREE.Object3D) => void
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
    this.container.style.cursor = "crosshair";

    this.container.addEventListener("pointermove", this.onPointerMove);
    this.container.addEventListener("pointerdown", this.onPointerDown);
    window.addEventListener("keydown", this.onKeyDown);
  }

  public disable() {
    if (!this.enabled) return;
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

    const hit = this.pickPoint(e);
    if (!hit) return;

    let target = hit.clone();
    let snappedAxis: "x" | "y" | "z" | null = null;

    // 1. Snap ke Geometri (Endpoint/Midpoint)
    const snapResult = this.snappingHelper.getBestSnap(hit, this.points);
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
        { name: "y" as const, dir: new THREE.Vector3(0, 1, 0) },
        // { name: "z" as const, dir: new THREE.Vector3(0, 0, 1) } // Uncomment jika ingin Z-axis snap
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

    let target: THREE.Vector3 | null = null;
    
    // Prioritaskan posisi dot connector yang sudah ter-snap
    if (this.connectorDot) {
        target = this.connectorDot.position.clone();
    } else {
        target = this.pickPoint(e);
    }

    if (!target) return;

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

  private pickPoint(e: PointerEvent): THREE.Vector3 | null {
    const rect = this.container.getBoundingClientRect();
    this.mouse.x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
    this.mouse.y = -((e.clientY - rect.top) / rect.height) * 2 + 1;

    this.raycaster.setFromCamera(this.mouse, this.camera);

    // 1. Raycast ke object scene (exclude helpers)
    const candidates: THREE.Object3D[] = [];
    this.scene.traverse((obj) => {
        if ((obj as any).isMesh || (obj as any).isLine) {
            if (obj.name === "SkyDome" || obj.name === "Grid" || (obj as any).userData.isHelper) return;
            candidates.push(obj);
        }
    });

    const hits = this.raycaster.intersectObjects(candidates, true);
    if (hits.length > 0) {
        return hits[0].point;
    }

    // 2. Raycast ke Plane Z=0 (XY Plane)
    if (this.raycaster.ray.intersectPlane(this.plane, this.tempVec3)) {
        return this.tempVec3.clone();
    }

    return null;
  }

  private finalizeLine() {
    if (this.points.length < 2) {
        this.disable(); // Cancel if not enough points
        return;
    }

    // Check for closed loop (min 3 unique points + 1 closing point = 4 points)
    const isClosed = this.points.length > 3 && this.points[0].distanceTo(this.points[this.points.length - 1]) < 1e-5;
    let object: THREE.Object3D;

    if (isClosed) {
        const shape = new THREE.Shape();
        shape.moveTo(this.points[0].x, this.points[0].y);
        for (let i = 1; i < this.points.length - 1; i++) {
            shape.lineTo(this.points[i].x, this.points[i].y);
        }
        shape.closePath();

        const geometry = new THREE.ShapeGeometry(shape);
        const material = new THREE.MeshBasicMaterial({ color: 0xcccccc, side: THREE.DoubleSide });
        const mesh = new THREE.Mesh(geometry, material);
        mesh.position.z = this.points[0].z;

        const edges = new THREE.EdgesGeometry(geometry);
        const line = new THREE.LineSegments(edges, new THREE.LineBasicMaterial({ color: 0x000000 }));
        mesh.add(line);
        object = mesh;
    } else {
        const geometry = new THREE.BufferGeometry().setFromPoints(this.points);
        const material = new THREE.LineBasicMaterial({ color: 0x000000 });
        object = new THREE.Line(geometry, material);
    }

    object.userData.selectable = true;
    this.scene.add(object);
    this.onLineCreated(object);

    // Reset state but keep tool active
    this.points = [];
    this.typedLength = "";
    this.cleanupVisuals();
    this.removeInputOverlay();
    this.hideAxisInfo();
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
        const mat = new THREE.LineBasicMaterial({ color: 0xff0000 });
        this.axisGuide = new THREE.Line(geom, mat);
        this.axisGuide.userData.isHelper = true;
        this.scene.add(this.axisGuide);
    }

    this.axisGuide.visible = true;
    const mat = this.axisGuide.material as THREE.LineBasicMaterial;
    mat.color.setHex(axis === 'x' ? 0xff0000 : axis === 'y' ? 0x00ff00 : 0x0000ff);

    const dir = axis === 'x' ? new THREE.Vector3(1,0,0) : axis === 'y' ? new THREE.Vector3(0,1,0) : new THREE.Vector3(0,0,1);
    const p1 = origin.clone().addScaledVector(dir, -1000);
    const p2 = origin.clone().addScaledVector(dir, 1000);
    this.axisGuide.geometry.setFromPoints([p1, p2]);
  }

  private updateAnchorSprite(pos: THREE.Vector3) {
      // Optional: Mark vertices
  }

  private updateHoverMarkers(edge?: {a: THREE.Vector3, b: THREE.Vector3}) {
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
