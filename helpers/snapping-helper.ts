import * as THREE from "three";

export type SnapKind = "none" | "endpoint" | "midpoint" | "onEdge";

export interface SnapResult {
  kind: SnapKind;
  point: THREE.Vector3;
  edge?: { a: THREE.Vector3; b: THREE.Vector3 };
  edges?: { a: THREE.Vector3; b: THREE.Vector3 }[];
  dist: number;
}

export type HitInfo = {
  point: THREE.Vector3;
  surfacePlane?: THREE.Plane;
  hitObject?: THREE.Object3D;
};

export class SnappingHelper {
  private scene: THREE.Scene;
  private getCamera: () => THREE.Camera;
  private container: HTMLElement;
  private raycaster: THREE.Raycaster;
  private snapThreshold: number;

  constructor(
    scene: THREE.Scene,
    camera: THREE.Camera | (() => THREE.Camera),
    container: HTMLElement,
    raycaster: THREE.Raycaster,
    snapThreshold: number = 0.3
  ) {
    this.scene = scene;
    this.getCamera = typeof camera === "function" ? camera : () => camera;
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
            const line = obj as THREE.Line;
            const geom = line.geometry;
            if (geom instanceof THREE.BufferGeometry) {
                const pos = geom.attributes.position;
                if (pos) {
                    const pts: THREE.Vector3[] = [];
                    for(let i=0; i<pos.count; i++) {
                        pts.push(
                          new THREE.Vector3(pos.getX(i), pos.getY(i), pos.getZ(i)).applyMatrix4(
                            line.matrixWorld
                          )
                        );
                    }
                    checkPoints(pts);
                }
            }
        }
    });

    return best;
  }

  public getBestSnapByScreen(
    mouseScreen: THREE.Vector2,
    currentPoints: THREE.Vector3[],
    snapPixels: number
  ): SnapResult | null {
    const camera = this.getCamera();
    const rect = this.container.getBoundingClientRect();
    let best: SnapResult | null = null;

    const edgeKeyEps = 1e-6;
    const quant = (n: number) => Math.round(n / edgeKeyEps);
    const keyOf = (v: THREE.Vector3) => `${quant(v.x)},${quant(v.y)},${quant(v.z)}`;
    const keyOfEdge = (edge: { a: THREE.Vector3; b: THREE.Vector3 }) => {
      const ka = keyOf(edge.a);
      const kb = keyOf(edge.b);
      return ka < kb ? `${ka}|${kb}` : `${kb}|${ka}`;
    };

    const addEdgeToBest = (edge?: { a: THREE.Vector3; b: THREE.Vector3 }) => {
      if (!best || !edge) return;
      const existing = best.edges ?? (best.edge ? [best.edge] : []);
      const keys = new Set(existing.map(keyOfEdge));
      const edgeKey = keyOfEdge(edge);
      if (keys.has(edgeKey)) return;

      const next = [...existing, { a: edge.a.clone(), b: edge.b.clone() }];
      best.edges = next;
      best.edge ??= next[0];
    };

    const considerPoint = (
      kind: SnapKind,
      pointWorld: THREE.Vector3,
      edge?: { a: THREE.Vector3; b: THREE.Vector3 }
    ) => {
      const pNdc = pointWorld.clone().project(camera);
      const x = (pNdc.x * 0.5 + 0.5) * rect.width;
      const y = (-pNdc.y * 0.5 + 0.5) * rect.height;
      const dist = Math.hypot(x - mouseScreen.x, y - mouseScreen.y);

      if (dist >= snapPixels) return;

      const samePoint = best && best.point.distanceTo(pointWorld) < 1e-6;
      const distImproved = !best || dist < best.dist - 0.25;
      const distTied = best && Math.abs(dist - best.dist) <= 0.25;

      if (distImproved) {
        best = {
          kind,
          point: pointWorld.clone(),
          dist,
          ...(edge
            ? { edge: { a: edge.a.clone(), b: edge.b.clone() }, edges: [{ a: edge.a.clone(), b: edge.b.clone() }] }
            : {}),
        };
        return;
      }

      if (best && distTied && best.kind === kind && samePoint) {
        addEdgeToBest(edge);
      }
    };

    const checkSegments = (pts: THREE.Vector3[], isLineSegments: boolean) => {
      const addSegment = (a: THREE.Vector3, b: THREE.Vector3) => {
        const edge = { a, b };
        considerPoint("endpoint", a, edge);
        considerPoint("endpoint", b, edge);
        considerPoint("midpoint", a.clone().add(b).multiplyScalar(0.5), edge);
      };

      if (pts.length < 2) return;
      if (isLineSegments) {
        for (let i = 0; i < pts.length - 1; i += 2) {
          addSegment(pts[i], pts[i + 1]);
        }
      } else {
        for (let i = 0; i < pts.length - 1; i++) {
          addSegment(pts[i], pts[i + 1]);
        }
      }
    };

    checkSegments(currentPoints, false);

    this.scene.traverse((obj) => {
      if ((obj as any).userData.isHelper) return;
      if (!(obj as any).isLine) return;

      const line = obj as THREE.Line;
      const geom = line.geometry;
      if (!(geom instanceof THREE.BufferGeometry)) return;

      const pos = geom.getAttribute("position") as THREE.BufferAttribute | undefined;
      if (!pos) return;

      const pts: THREE.Vector3[] = [];
      for (let i = 0; i < pos.count; i++) {
        pts.push(
          new THREE.Vector3(pos.getX(i), pos.getY(i), pos.getZ(i)).applyMatrix4(line.matrixWorld)
        );
      }

      checkSegments(pts, (line as any).isLineSegments === true);
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
    const camera = this.getCamera();
    const pScreen = pointOnAxis.clone().project(camera);
    const rect = this.container.getBoundingClientRect();
    const x = (pScreen.x * 0.5 + 0.5) * rect.width;
    const y = (-pScreen.y * 0.5 + 0.5) * rect.height;
    
    const distPixels = Math.hypot(x - mouseScreen.x, y - mouseScreen.y);

    return { point: pointOnAxis, distPixels };
  }
}
