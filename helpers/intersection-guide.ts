import * as THREE from "three";
import { type IntersectionResult } from "./intersection-helper";

export class IntersectionGuide {
  private scene: THREE.Scene;
  private line1: THREE.Line<THREE.BufferGeometry, THREE.LineDashedMaterial>;
  private line2: THREE.Line<THREE.BufferGeometry, THREE.LineDashedMaterial>;

  constructor(scene: THREE.Scene) {
    this.scene = scene;

    // Inisialisasi Line 1
    this.line1 = this.createDashedLine();
    this.scene.add(this.line1);

    // Inisialisasi Line 2
    this.line2 = this.createDashedLine();
    this.scene.add(this.line2);
  }

  private createDashedLine() {
    const geometry = new THREE.BufferGeometry();
    // Set posisi awal dummy
    geometry.setAttribute(
      "position",
      new THREE.Float32BufferAttribute([0, 0, 0, 0, 0, 0], 3)
    );

    const material = new THREE.LineDashedMaterial({
      color: 0xffffff, // Warna default, nanti diupdate
      dashSize: 0.2,   // Panjang garis
      gapSize: 0.1,    // Jarak antar garis
      depthTest: false, // Agar selalu terlihat di atas objek lain (opsional)
      transparent: true,
      opacity: 0.8,
    });

    const line = new THREE.Line(geometry, material);
    line.frustumCulled = false; // Mencegah flickering saat update cepat
    line.renderOrder = 999; // Render di urutan akhir (di atas)
    line.visible = false;
    line.userData.isHelper = true;
    line.userData.selectable = false;

    return line;
  }

  public update(result: IntersectionResult | null) {
    if (!result) {
      this.line1.visible = false;
      this.line2.visible = false;
      return;
    }

    this.line1.visible = true;
    this.line2.visible = true;

    // Update Garis 1: origin1 -> point1
    this.updateLine(this.line1, result.origin1, result.point1, result.axis1);

    // Update Garis 2: origin2 -> point2
    this.updateLine(this.line2, result.origin2, result.point2, result.axis2);
  }

  private updateLine(
    line: THREE.Line<THREE.BufferGeometry, THREE.LineDashedMaterial>,
    start: THREE.Vector3,
    end: THREE.Vector3,
    axisName: string
  ) {
    const positions = [start.x, start.y, start.z, end.x, end.y, end.z];
    line.geometry.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
    
    // Update warna berdasarkan sumbu
    const color = axisName === "x" ? 0xff0000 : axisName === "y" ? 0x00ff00 : 0x0000ff;
    line.material.color.setHex(color);

    // PENTING: Wajib dipanggil agar dash terlihat
    line.computeLineDistances();
    line.geometry.attributes.position.needsUpdate = true;
  }

  public dispose() {
    this.scene.remove(this.line1);
    this.scene.remove(this.line2);
    this.line1.geometry.dispose();
    this.line2.geometry.dispose();
    this.line1.material.dispose();
    this.line2.material.dispose();
  }
}
