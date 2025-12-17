// ui.ts
import * as THREE from "three";
import type { SnapType } from "./snap";

function makeCircleSprite(color: string, size = 64) {
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = size;

  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Canvas 2D context not available");

  ctx.clearRect(0, 0, size, size);
  ctx.beginPath();
  ctx.arc(size / 2, size / 2, size * 0.28, 0, Math.PI * 2);
  ctx.fillStyle = color;
  ctx.fill();

  ctx.lineWidth = size * 0.06;
  ctx.strokeStyle = "white";
  ctx.stroke();

  const tex = new THREE.CanvasTexture(canvas);
  const mat = new THREE.SpriteMaterial({ map: tex, transparent: true, depthTest: false });

  const spr = new THREE.Sprite(mat);
  spr.renderOrder = 9999;
  spr.scale.set(0.18, 0.18, 1);
  return spr;
}

export class SnapIndicator {
  private endpointSprite = makeCircleSprite("#4ade80"); // hijau
  private midpointSprite = makeCircleSprite("#60a5fa"); // biru
	private edgepointSprite = makeCircleSprite(""); // merah
	private facepointSprite = makeCircleSprite(""); // ungu
  private current: THREE.Sprite | null = null;

  constructor(scene: THREE.Scene) {
    scene.add(this.endpointSprite, this.midpointSprite);
    this.endpointSprite.visible = false;
    this.midpointSprite.visible = false;
  }

  show(type: SnapType, position: THREE.Vector3) {
    this.endpointSprite.visible = false;
    this.midpointSprite.visible = false;

    if (type === "endpoint") this.current = this.endpointSprite;
    else if (type === "midpoint") this.current = this.midpointSprite;
    else {
      this.current = null;
      return;
    }

    this.current.visible = true;
    this.current.position.copy(position);
    this.current.position.z = 0;
  }

  hide() {
    this.endpointSprite.visible = false;
    this.midpointSprite.visible = false;
    this.current = null;
  }
}

export class DashedLinePreview {
  public line: THREE.Line;
  private geo: THREE.BufferGeometry;

  constructor(scene: THREE.Scene) {
    this.geo = new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(), new THREE.Vector3()]);

    const mat = new THREE.LineDashedMaterial({
      color: 0x111111,
      dashSize: 0.12,
      gapSize: 0.08,
    });

    this.line = new THREE.Line(this.geo, mat);
    this.line.visible = false;
    this.line.frustumCulled = false;

    scene.add(this.line);
  }

  set(a: THREE.Vector3, b: THREE.Vector3) {
    const p0 = a.clone(); p0.z = 0;
    const p1 = b.clone(); p1.z = 0;

    this.geo.setFromPoints([p0, p1]);
    this.line.computeLineDistances();
    this.line.visible = true;
  }

  hide() {
    this.line.visible = false;
  }
}
