import * as THREE from "three";

export type SnapKind = "none" | "endpoint" | "midpoint" | "onEdge";

export interface SnapResult {
  kind: SnapKind;
  point: THREE.Vector3;
  edge?: { a: THREE.Vector3; b: THREE.Vector3 };
  dist: number;
}

export type HitInfo = {
  point: THREE.Vector3;
  surfacePlane?: THREE.Plane;
  hitObject?: THREE.Object3D;
};

export class SnappingHelper {
  private scene: THREE.Scene;
  private camera: THREE.Camera;
  private container: HTMLElement;
  private raycaster: THREE.Raycaster;
  private snapThreshold: number;

  constructor(
    scene: THREE.Scene,
    camera: THREE.Camera,
    container: HTMLElement,
    raycaster: THREE.Raycaster,
    snapThreshold: number = 0.3
  ) {
    this.scene = scene;
    this.camera = camera;
    this.container = container;
    this.raycaster = raycaster;
    this.snapThreshold = snapThreshold;
  }

  public getBestSnap(hit: THREE.Vector3, currentPoints: THREE.Vector3[]): SnapResult | null {
    let best: SnapResult | null = null;
    const consider = (res: SnapResult) => {
        if (!best || res.dist < best.dist) best = res;
    };

    // Helper: Check points
    const checkPoints = (pts: THREE.Vector3[]) => {
      for (let i = 0; i < pts.length; i++) {
          const p = pts[i];
          const d = hit.distanceTo(p);
          if (d < this.snapThreshold) {
              consider({ kind: "endpoint", point: p, dist: d });
          }

          // Midpoint
          if (i < pts.length - 1) {
              const mid = new THREE.Vector3().addVectors(pts[i], pts[i+1]).multiplyScalar(0.5);
              const dMid = hit.distanceTo(mid);
              if (dMid < this.snapThreshold) {
                  consider({ kind: "midpoint", point: mid, dist: dMid });
              }
          }
      }
    };

    // 1. Check current drawing points
    checkPoints(currentPoints);

    // 2. Check scene lines (simplified)
    this.scene.traverse((obj) => {
        if ((obj as any).isLine && !(obj as any).userData.isHelper) {
            const geom = (obj as THREE.Line).geometry;
            if (geom instanceof THREE.BufferGeometry) {
                const pos = geom.attributes.position;
                if (pos) {
                    const pts: THREE.Vector3[] = [];
                    for(let i=0; i<pos.count; i++) {
                        pts.push(new THREE.Vector3(pos.getX(i), pos.getY(i), pos.getZ(i)));
                    }
                    checkPoints(pts);
                }
            }
        }
    });

    return best;
  }

  public getClosestPointOnAxis(origin: THREE.Vector3, axisDir: THREE.Vector3, mouseScreen: THREE.Vector2) {
    const ray = this.raycaster.ray;
    const dirNorm = axisDir.clone().normalize();
    
    const w0 = new THREE.Vector3().subVectors(ray.origin, origin);
    const a = ray.direction.dot(dirNorm);
    const b = ray.direction.dot(w0);
    const c = dirNorm.dot(w0);
    const d = 1 - a * a;

    let t = 0;
    if (d > 1e-6) {
        t = (c - a * b) / d;
    }
    const pointOnAxis = origin.clone().addScaledVector(dirNorm, t);
    
    // Project to screen to check pixel distance
    const pScreen = pointOnAxis.clone().project(this.camera);
    const rect = this.container.getBoundingClientRect();
    const x = (pScreen.x * 0.5 + 0.5) * rect.width;
    const y = (-pScreen.y * 0.5 + 0.5) * rect.height;
    
    const distPixels = Math.hypot(x - mouseScreen.x, y - mouseScreen.y);

    return { point: pointOnAxis, distPixels };
  }
}
