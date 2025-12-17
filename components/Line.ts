// lineTool.ts
import * as THREE from "three";
import { getMouseNDC, raycastToZ0Plane } from "./utils/line/plane";
import { SnapManager, type Segment, type SnapHit } from "./utils/line/snap";
import { SnapIndicator, DashedLinePreview } from "./utils/line/ui";

export class LineTool {
  private scene: THREE.Scene;
  private camera: THREE.Camera;
  private dom: HTMLElement;
  private snap: SnapManager;
  private onMeshCreated?: (mesh: THREE.Mesh) => void;

  private raycaster = new THREE.Raycaster();
  private ndc = new THREE.Vector2();

  private polyline: THREE.Vector3[] = [];
  private segments: Segment[] = [];

  private currentFrom: THREE.Vector3 | null = null;
  private currentSnap: SnapHit | null = null;

  private preview: DashedLinePreview;
  private snapUI: SnapIndicator;

  private committedLines: THREE.Line[] = [];

  constructor(
    scene: THREE.Scene,
    camera: THREE.Camera,
    dom: HTMLElement,
    snap: SnapManager,
    onMeshCreated?: (mesh: THREE.Mesh) => void
  ) {
    this.scene = scene;
    this.camera = camera;
    this.dom = dom;
    this.snap = snap;
    this.onMeshCreated = onMeshCreated;

    this.preview = new DashedLinePreview(this.scene);
    this.snapUI = new SnapIndicator(this.scene);
  }

  enable() {
    this.dom.addEventListener("pointermove", this.onMove);
    this.dom.addEventListener("pointerdown", this.onDown);
  }
  disable() {
    this.dom.removeEventListener("pointermove", this.onMove);
    this.dom.removeEventListener("pointerdown", this.onDown);
    this.preview.hide();
    this.snapUI.hide();
  }

  private onMove = (e: PointerEvent) => {
    this.ndc.copy(getMouseNDC(e, this.dom));
    const hit = raycastToZ0Plane(this.raycaster, this.camera, this.ndc);
    if (!hit) return;
    hit.z = 0;

    const snapHit = this.snap.findBestSnap(hit, this.raycaster, this.camera, this.ndc);
    this.currentSnap = snapHit;

    const p = (snapHit ? snapHit.point : hit).clone();
    p.z = 0;

    if (snapHit) this.snapUI.show(snapHit.type, snapHit.point);
    else this.snapUI.hide();

    if (this.currentFrom) this.preview.set(this.currentFrom, p);
    else this.preview.hide();
  };

  private onDown = (e: PointerEvent) => {
    if (e.button !== 0) return;

    this.ndc.copy(getMouseNDC(e, this.dom));
    const hit = raycastToZ0Plane(this.raycaster, this.camera, this.ndc);
    if (!hit) return;

    const p = (this.currentSnap ? this.currentSnap.point : hit).clone();
    p.z = 0;

    if (!this.currentFrom) {
      this.currentFrom = p;
      this.polyline = [p.clone()];
      return;
    }

    const first = this.polyline[0];
    const closeThreshold = this.snap.snapThreshold;

    if (p.distanceTo(first) <= closeThreshold && this.polyline.length >= 3) {
      this.polyline.push(first.clone());
      this.commitSegment(this.currentFrom, first);
      this.finishAsMesh();
      this.reset();
      return;
    }

    this.commitSegment(this.currentFrom, p);
    this.polyline.push(p.clone());
    this.currentFrom = p;
  };

  private commitSegment(a: THREE.Vector3, b: THREE.Vector3) {
    const geo = new THREE.BufferGeometry().setFromPoints([a.clone(), b.clone()]);
    const mat = new THREE.LineBasicMaterial({ color: 0x111111 });
    const line = new THREE.Line(geo, mat);
    this.scene.add(line);
    this.committedLines.push(line);

    this.segments.push({ a: a.clone(), b: b.clone() });
    this.snap.setSegments(this.segments);
  }

  private finishAsMesh() {
    const pts2 = this.polyline.slice(0, -1).map(v => new THREE.Vector2(v.x, v.y));
    const shape = new THREE.Shape(pts2);

    const geom = new THREE.ShapeGeometry(shape);
    const mat = new THREE.MeshStandardMaterial({ color: 0x9ca3af, side: THREE.DoubleSide });

    const mesh = new THREE.Mesh(geom, mat);
    mesh.position.z = 0;
    this.scene.add(mesh);
    this.onMeshCreated?.(mesh);
  }

  private reset() {
    this.currentFrom = null;
    this.currentSnap = null;
    this.preview.hide();
    this.snapUI.hide();
    this.polyline = [];
  }
}
