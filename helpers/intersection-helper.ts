import * as THREE from "three";

export type IntersectionResult = {
  point: THREE.Vector3;
  axis1: "x" | "y" | "z";
  axis2: "x" | "y" | "z";
  origin1: THREE.Vector3;
  origin2: THREE.Vector3;
  point1: THREE.Vector3;
  point2: THREE.Vector3;
  dist: number;
};

export class IntersectionHelper {
  private getCamera: () => THREE.Camera;
  private container: HTMLElement;

  constructor(
    camera: THREE.Camera | (() => THREE.Camera),
    container: HTMLElement
  ) {
    this.getCamera = typeof camera === "function" ? camera : () => camera;
    this.container = container;
  }

  public getBestIntersection(
    lastPoint: THREE.Vector3,
    candidatePoints: THREE.Vector3[],
    mouseScreen: THREE.Vector2,
    snapDistPixels: number
  ): IntersectionResult | null {
    let best: IntersectionResult | null = null;
    
    // Gunakan endpoint dan tambahkan midpoint sebagai referensi intersection
    const targets: THREE.Vector3[] = [...candidatePoints];
    for (let i = 0; i < candidatePoints.length - 1; i++) {
      // Hitung midpoint antar titik untuk referensi tambahan
      targets.push(candidatePoints[i].clone().add(candidatePoints[i + 1]).multiplyScalar(0.5));
    }

    for (const candidate of targets) {
      // Lewati jika kandidat terlalu dekat dengan titik terakhir (origin)
      if (candidate.distanceTo(lastPoint) < 0.001) continue;

      const result = this.computeDualAxisIntersection(
        lastPoint,
        candidate,
        mouseScreen,
        snapDistPixels
      );
      if (result) {
        if (!best || result.dist < best.dist) {
          best = result;
        }
      }
    }
    return best;
  }

  private computeDualAxisIntersection(
    p1: THREE.Vector3,
    p2: THREE.Vector3,
    mouseScreen: THREE.Vector2,
    snapDist: number
  ): IntersectionResult | null {
    const axes = [
      { name: "x" as const, dir: new THREE.Vector3(1, 0, 0) },
      { name: "y" as const, dir: new THREE.Vector3(0, 1, 0) }, // Vertikal aktif
      { name: "z" as const, dir: new THREE.Vector3(0, 0, 1) },
    ];

    let bestLocal: IntersectionResult | null = null;

    for (const ax1 of axes) {
      for (const ax2 of axes) {
        // Skip jika sumbu paralel
        if (Math.abs(ax1.dir.dot(ax2.dir)) > 0.99) continue;

        // Matematika untuk mencari titik terdekat pada dua garis miring (skew lines)
        const w0 = new THREE.Vector3().subVectors(p1, p2);
        const a = 1;
        const b = ax1.dir.dot(ax2.dir);
        const c = 1;
        const d = ax1.dir.dot(w0);
        const e = ax2.dir.dot(w0);
        const denom = a * c - b * b;

        if (denom < 1e-6) continue;

        const sc = (b * e - c * d) / denom;
        const tc = (a * e - b * d) / denom;

        const intersect1 = p1.clone().addScaledVector(ax1.dir, sc);
        const intersect2 = p2.clone().addScaledVector(ax2.dir, tc);

        // Pastikan kedua garis benar-benar bertemu (jarak sangat dekat)
        if (intersect1.distanceTo(intersect2) > 0.1) continue;

        const candidate = intersect1.clone().add(intersect2).multiplyScalar(0.5);

        // Proyeksi ke layar untuk cek jarak mouse
        const camera = this.getCamera();
        const pScreen = candidate.clone().project(camera);
        
        // Pastikan titik intersection berada di depan kamera (mencegah ghosting/noise)
        if (pScreen.z < -1 || pScreen.z > 1) continue;

        const rect = this.container.getBoundingClientRect();
        const x = (pScreen.x * 0.5 + 0.5) * rect.width;
        const y = (-pScreen.y * 0.5 + 0.5) * rect.height;

        const dist = Math.hypot(x - mouseScreen.x, y - mouseScreen.y);

        if (dist < snapDist) {
          if (!bestLocal || dist < bestLocal.dist) {
            bestLocal = {
              point: candidate,
              axis1: ax1.name,
              origin1: p1,
              axis2: ax2.name,
              origin2: p2,
              dist,
              point1: intersect1,
              point2: intersect2,
            };
          }
        }
      }
    }
    return bestLocal;
  }
}
