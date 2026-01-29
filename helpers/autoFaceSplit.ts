import * as THREE from "three";
import pc from "polygon-clipping";
import { LineSegmentsGeometry } from "three/addons/lines/LineSegmentsGeometry.js";
import { canonicalizePlaneKey, type SplitRegion } from "./pushPullCSG";
import type { FaceTriangle } from "../utils/faceRegion";
import { findSelectableRoot } from "./geometry";

type Ring2D = Array<[number, number]>; // [x,z] in aligned space
type Poly2 = Ring2D[]; // [outer, ...holes]
type MultiPoly2 = Poly2[];

const AUTO_SPLIT_SNAP_EPS = 1e-5;
const AUTO_SPLIT_PLANE_EPS = 1e-4;
const AUTO_SPLIT_MAX_CUTTER_TRIS = 50_000;
const AUTO_SPLIT_MAX_PIECES = 128;

function snap2(v: number, eps = AUTO_SPLIT_SNAP_EPS): number {
  if (!Number.isFinite(v)) return v;
  if (Math.abs(v) < eps) return 0;
  return Number(v.toFixed(5));
}

function stripClosedRing2D(ring: Array<[number, number]>): Array<[number, number]> {
  if (!ring || ring.length < 2) return ring;
  const [fx, fz] = ring[0];
  const [lx, lz] = ring[ring.length - 1];
  if (Math.abs(fx - lx) < 1e-6 && Math.abs(fz - lz) < 1e-6) return ring.slice(0, -1);
  return ring;
}

function ensureClosedRing2D(ring: Ring2D, eps = 1e-6): Ring2D {
  if (!ring || ring.length === 0) return [];
  const out = ring.map(([x, z]) => [snap2(x), snap2(z)] as [number, number]);
  if (out.length < 2) return out;
  const [fx, fz] = out[0];
  const [lx, lz] = out[out.length - 1];
  if (Math.abs(fx - lx) > eps || Math.abs(fz - lz) > eps) out.push([fx, fz]);
  return out;
}

function cleanRingForClip(ring: Ring2D, eps = 1e-6): Ring2D {
  const closed = ensureClosedRing2D(ring, eps);
  if (closed.length < 4) return closed;

  const out: Ring2D = [];
  for (let i = 0; i < closed.length; i++) {
    const p = closed[i];
    const last = out[out.length - 1];
    if (last && Math.abs(last[0] - p[0]) <= eps && Math.abs(last[1] - p[1]) <= eps) continue;
    out.push(p);
  }

  if (out.length >= 2) {
    const f = out[0];
    const l = out[out.length - 1];
    if (Math.abs(f[0] - l[0]) > eps || Math.abs(f[1] - l[1]) > eps) out.push([f[0], f[1]]);
  }

  return out;
}

function signedArea2D(ring: Ring2D): number {
  const pts = stripClosedRing2D(ring);
  if (pts.length < 3) return 0;
  let sum = 0;
  for (let i = 0; i < pts.length; i++) {
    const [x0, z0] = pts[i];
    const [x1, z1] = pts[(i + 1) % pts.length];
    sum += x0 * z1 - x1 * z0;
  }
  return sum / 2;
}

function polyAreaAbs(poly: Poly2): number {
  if (!poly || poly.length === 0) return 0;
  const outer = Math.abs(signedArea2D(poly[0]));
  let holes = 0;
  for (let i = 1; i < poly.length; i++) holes += Math.abs(signedArea2D(poly[i]));
  return Math.max(0, outer - holes);
}

function pointOnSegment2D(px: number, pz: number, ax: number, az: number, bx: number, bz: number, eps = 1e-6) {
  const abx = bx - ax;
  const abz = bz - az;
  const apx = px - ax;
  const apz = pz - az;
  const cross = apx * abz - apz * abx;
  if (Math.abs(cross) > eps) return false;
  const dot = apx * abx + apz * abz;
  if (dot < -eps) return false;
  const abLenSq = abx * abx + abz * abz;
  if (dot - abLenSq > eps) return false;
  return true;
}

function pointInRing2D(ring: Ring2D, x: number, z: number, eps = 1e-6): boolean {
  const pts = stripClosedRing2D(ring);
  if (pts.length < 3) return false;

  for (let i = 0; i < pts.length; i++) {
    const a = pts[i];
    const b = pts[(i + 1) % pts.length];
    if (pointOnSegment2D(x, z, a[0], a[1], b[0], b[1], eps)) return true;
  }

  let inside = false;
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
    const xi = pts[i][0],
      zi = pts[i][1];
    const xj = pts[j][0],
      zj = pts[j][1];
    const intersect = (zi > z) !== (zj > z) && x < ((xj - xi) * (z - zi)) / (zj - zi + Number.EPSILON) + xi;
    if (intersect) inside = !inside;
  }
  return inside;
}

function buildPolysFromRings(ringsIn: Ring2D[]): MultiPoly2 {
  const rings = (ringsIn || [])
    .map((r) => cleanRingForClip(r))
    .filter((r) => r.length >= 4);

  if (rings.length === 0) return [];

  const entries = rings
    .map((r, idx) => ({ idx, ring: r, area: Math.abs(signedArea2D(r)) }))
    .filter((e) => Number.isFinite(e.area) && e.area > 1e-12)
    .sort((a, b) => b.area - a.area);

  const parent: number[] = new Array(entries.length).fill(-1);
  const depth: number[] = new Array(entries.length).fill(0);

  const contains = (outer: Ring2D, inner: Ring2D) => {
    const p = stripClosedRing2D(inner)[0];
    if (!p) return false;
    return pointInRing2D(outer, p[0], p[1]);
  };

  for (let i = 0; i < entries.length; i++) {
    const ri = entries[i].ring;
    let best = -1;
    let bestArea = Infinity;
    for (let j = 0; j < i; j++) {
      const rj = entries[j].ring;
      if (!contains(rj, ri)) continue;
      const a = entries[j].area;
      if (a < bestArea) {
        bestArea = a;
        best = j;
      }
    }
    parent[i] = best;
  }

  for (let i = 0; i < entries.length; i++) {
    let d = 0;
    let p = parent[i];
    while (p !== -1) {
      d++;
      p = parent[p];
    }
    depth[i] = d;
  }

  const outerToHoles = new Map<number, number[]>();
  for (let i = 0; i < entries.length; i++) {
    if (depth[i] % 2 !== 1) continue;
    const p = parent[i];
    if (p === -1) continue;
    const list = outerToHoles.get(p) ?? [];
    list.push(i);
    outerToHoles.set(p, list);
  }

  const polys: MultiPoly2 = [];
  for (let i = 0; i < entries.length; i++) {
    if (depth[i] % 2 !== 0) continue;
    const outer = entries[i].ring;
    const holesIdx = outerToHoles.get(i) ?? [];
    const holes = holesIdx.map((hi) => entries[hi].ring);
    polys.push([outer, ...holes]);
  }

  return polys;
}

function mpToMultiPoly2(mp: any): MultiPoly2 {
  if (!mp || !Array.isArray(mp) || mp.length === 0) return [];
  const out: MultiPoly2 = [];
  for (const poly of mp as any[]) {
    if (!Array.isArray(poly) || poly.length === 0) continue;
    const rings: Ring2D[] = [];
    for (const ring of poly as any[]) {
      if (!Array.isArray(ring) || ring.length < 3) continue;
      const pts: Ring2D = [];
      for (const p of ring as any[]) {
        if (!Array.isArray(p) || p.length < 2) continue;
        const x = snap2(Number(p[0]));
        const z = snap2(Number(p[1]));
        if (!Number.isFinite(x) || !Number.isFinite(z)) continue;
        pts.push([x, z]);
      }
      const cleaned = cleanRingForClip(pts);
      if (cleaned.length >= 4) rings.push(cleaned);
    }
    if (rings.length > 0) out.push(rings as Poly2);
  }
  return out;
}

function buildBoundaryRingsFromFaceTrianglesAligned(
  triangles: FaceTriangle[],
  qAlign: THREE.Quaternion,
  eps = AUTO_SPLIT_SNAP_EPS
): Ring2D[] {
  if (!triangles || triangles.length === 0) return [];

  const idByKey = new Map<string, number>();
  const verts: Array<[number, number]> = [];
  const getId = (x: number, z: number) => {
    const kx = Math.round(x / eps);
    const kz = Math.round(z / eps);
    const key = `${kx},${kz}`;
    const existing = idByKey.get(key);
    if (existing !== undefined) return existing;
    const id = verts.length;
    idByKey.set(key, id);
    verts.push([snap2(x), snap2(z)]);
    return id;
  };

  const edgeCounts = new Map<string, number>();
  const addEdge = (a: number, b: number) => {
    const min = a < b ? a : b;
    const max = a < b ? b : a;
    const key = `${min},${max}`;
    edgeCounts.set(key, (edgeCounts.get(key) ?? 0) + 1);
  };

  const tmp = new THREE.Vector3();

  for (const tri of triangles) {
    tmp.copy(tri[0]).applyQuaternion(qAlign);
    const a = getId(tmp.x, tmp.z);
    tmp.copy(tri[1]).applyQuaternion(qAlign);
    const b = getId(tmp.x, tmp.z);
    tmp.copy(tri[2]).applyQuaternion(qAlign);
    const c = getId(tmp.x, tmp.z);
    addEdge(a, b);
    addEdge(b, c);
    addEdge(c, a);
  }

  const adjacency = new Map<number, number[]>();
  const boundaryEdges: Array<[number, number]> = [];
  for (const [key, count] of edgeCounts.entries()) {
    if (count !== 1) continue;
    const [aStr, bStr] = key.split(",");
    const a = Number(aStr);
    const b = Number(bStr);
    if (!Number.isFinite(a) || !Number.isFinite(b)) continue;
    boundaryEdges.push([a, b]);
    (adjacency.get(a) ?? adjacency.set(a, []).get(a)!).push(b);
    (adjacency.get(b) ?? adjacency.set(b, []).get(b)!).push(a);
  }

  const visitedEdge = new Set<string>();
  const edgeKey = (a: number, b: number) => (a < b ? `${a},${b}` : `${b},${a}`);

  const rings: Ring2D[] = [];
  const maxSteps = boundaryEdges.length * 4 + 64;

  for (const [a0, b0] of boundaryEdges) {
    const startKey = edgeKey(a0, b0);
    if (visitedEdge.has(startKey)) continue;

    const loopIds: number[] = [a0, b0];
    visitedEdge.add(startKey);

    let prev = a0;
    let cur = b0;

    for (let step = 0; step < maxSteps; step++) {
      if (cur === a0) break;
      const neigh = adjacency.get(cur) ?? [];
      if (neigh.length === 0) break;
      let next = neigh.find((n) => n !== prev && !visitedEdge.has(edgeKey(cur, n)));
      if (next === undefined) next = neigh.find((n) => n !== prev);
      if (next === undefined) break;

      visitedEdge.add(edgeKey(cur, next));
      loopIds.push(next);
      prev = cur;
      cur = next;
    }

    if (loopIds.length < 4) continue;
    if (loopIds[loopIds.length - 1] !== a0) loopIds.push(a0);

    const ring: Ring2D = [];
    for (const id of loopIds) {
      const v = verts[id];
      if (!v) continue;
      ring.push([v[0], v[1]]);
    }

    const cleaned = cleanRingForClip(ring);
    if (cleaned.length >= 4) rings.push(cleaned);
  }

  return rings;
}

/**
 * Build footprint rings from a mesh's boundary by projecting its base outline onto the aligned plane.
 * This is used to detect floating meshes (like extruded shapes) that don't intersect the plane.
 */
function buildMeshFootprintRingsAligned(
  mesh: THREE.Mesh,
  qAlign: THREE.Quaternion
): Ring2D[] {
  const ud: any = mesh.userData || {};
  const sm: any = ud.surfaceMeta;

  mesh.updateWorldMatrix(true, false);
  const mAlign = new THREE.Matrix4().makeRotationFromQuaternion(qAlign);
  const m = new THREE.Matrix4().copy(mAlign).multiply(mesh.matrixWorld);

  const rings: Ring2D[] = [];

  // Try to extract footprint from surfaceMeta
  if (sm) {
    let pts2D: Array<[number, number]> | null = null;

    if (sm.kind === "rect" && Array.isArray(sm.center) && sm.center.length >= 2) {
      const cx = Number(sm.center[0]);
      const cz = Number(sm.center[1]);
      const w = Number(sm.width ?? 1);
      const l = Number(sm.length ?? 1);
      if (Number.isFinite(cx) && Number.isFinite(cz) && w > 0 && l > 0) {
        const hw = w / 2;
        const hl = l / 2;
        pts2D = [
          [cx - hw, cz - hl],
          [cx + hw, cz - hl],
          [cx + hw, cz + hl],
          [cx - hw, cz + hl],
        ];
      }
    } else if (sm.kind === "circle" && Array.isArray(sm.center) && sm.center.length >= 2) {
      const cx = Number(sm.center[0]);
      const cz = Number(sm.center[1]);
      const radius = Number(sm.radius ?? 1);
      const segments = Math.max(16, Math.min(64, Math.floor(sm.segments ?? 32)));
      if (Number.isFinite(cx) && Number.isFinite(cz) && radius > 0) {
        pts2D = [];
        for (let i = 0; i < segments; i++) {
          const t = (i / segments) * Math.PI * 2;
          pts2D.push([cx + Math.cos(t) * radius, cz + Math.sin(t) * radius]);
        }
      }
    } else if (sm.kind === "poly" && Array.isArray(sm.vertices)) {
      const verts = sm.vertices as number[][];
      if (verts.length >= 3) {
        pts2D = [];
        for (const v of verts) {
          if (Array.isArray(v) && v.length >= 2) {
            const x = Number(v[0]);
            const z = Number(v[1]);
            if (Number.isFinite(x) && Number.isFinite(z)) pts2D.push([x, z]);
          }
        }
        if (pts2D.length < 3) pts2D = null;
      }
    }

    if (pts2D && pts2D.length >= 3) {
      // Transform points from local surfaceMeta space to aligned space
      const tmp = new THREE.Vector3();
      const alignedPts: Ring2D = [];
      for (const [px, pz] of pts2D) {
        // SurfaceMeta is typically in local XZ plane at Y=0
        tmp.set(px, 0, pz).applyMatrix4(m);
        alignedPts.push([snap2(tmp.x), snap2(tmp.z)]);
      }
      const ring = cleanRingForClip(alignedPts);
      if (ring.length >= 4) rings.push(ring);
    }
  }

  // Fallback: use geometry bounding box XZ as footprint
  if (rings.length === 0) {
    const geometry = mesh.geometry as THREE.BufferGeometry | undefined;
    if (geometry) {
      if (!geometry.boundingBox) geometry.computeBoundingBox();
      const bb = geometry.boundingBox;
      if (bb) {
        const corners = [
          new THREE.Vector3(bb.min.x, bb.min.y, bb.min.z),
          new THREE.Vector3(bb.max.x, bb.min.y, bb.min.z),
          new THREE.Vector3(bb.max.x, bb.min.y, bb.max.z),
          new THREE.Vector3(bb.min.x, bb.min.y, bb.max.z),
        ];
        const alignedPts: Ring2D = [];
        for (const corner of corners) {
          corner.applyMatrix4(m);
          alignedPts.push([snap2(corner.x), snap2(corner.z)]);
        }
        const ring = cleanRingForClip(alignedPts);
        if (ring.length >= 4) rings.push(ring);
      }
    }
  }

  return rings;
}

function buildPlaneIntersectionRingsAligned(mesh: THREE.Mesh, qAlign: THREE.Quaternion, planeY: number): Ring2D[] {
  const geometry = mesh.geometry as THREE.BufferGeometry | undefined;
  const position = geometry?.getAttribute("position") as THREE.BufferAttribute | undefined;
  if (!geometry || !position) return [];

  const index = geometry.getIndex();
  const triCount = index ? index.count / 3 : position.count / 3;
  if (!Number.isFinite(triCount) || triCount <= 0) return [];
  if (triCount > AUTO_SPLIT_MAX_CUTTER_TRIS) return [];

  mesh.updateWorldMatrix(true, false);

  const mAlign = new THREE.Matrix4().makeRotationFromQuaternion(qAlign);
  const m = new THREE.Matrix4().copy(mAlign).multiply(mesh.matrixWorld);

  const v0 = new THREE.Vector3();
  const v1 = new THREE.Vector3();
  const v2 = new THREE.Vector3();

  const segments: Array<[[number, number], [number, number]]> = [];

  const getIdx = (t: number, c: 0 | 1 | 2) => (index ? index.getX(t * 3 + c) : t * 3 + c);

  const addSegment = (a: [number, number], b: [number, number]) => {
    const ax = snap2(a[0]);
    const az = snap2(a[1]);
    const bx = snap2(b[0]);
    const bz = snap2(b[1]);
    if (!Number.isFinite(ax) || !Number.isFinite(az) || !Number.isFinite(bx) || !Number.isFinite(bz)) return;
    if (Math.hypot(ax - bx, az - bz) < 1e-7) return;
    segments.push([
      [ax, az],
      [bx, bz],
    ]);
  };

  const intersectEdge = (a: THREE.Vector3, da: number, b: THREE.Vector3, db: number) => {
    const absA = Math.abs(da);
    const absB = Math.abs(db);
    if (absA <= AUTO_SPLIT_PLANE_EPS && absB <= AUTO_SPLIT_PLANE_EPS) return null;
    if (absA <= AUTO_SPLIT_PLANE_EPS) return [a.x, a.z] as [number, number];
    if (absB <= AUTO_SPLIT_PLANE_EPS) return [b.x, b.z] as [number, number];
    if (da * db > 0) return null;
    const t = da / (da - db);
    const x = a.x + (b.x - a.x) * t;
    const z = a.z + (b.z - a.z) * t;
    return [x, z] as [number, number];
  };

  for (let t = 0; t < triCount; t++) {
    const i0 = getIdx(t, 0);
    const i1 = getIdx(t, 1);
    const i2 = getIdx(t, 2);
    if (i0 >= position.count || i1 >= position.count || i2 >= position.count) continue;

    v0.fromBufferAttribute(position, i0).applyMatrix4(m);
    v1.fromBufferAttribute(position, i1).applyMatrix4(m);
    v2.fromBufferAttribute(position, i2).applyMatrix4(m);

    const d0 = v0.y - planeY;
    const d1 = v1.y - planeY;
    const d2 = v2.y - planeY;

    const maxD = Math.max(d0, d1, d2);
    const minD = Math.min(d0, d1, d2);
    if (minD > AUTO_SPLIT_PLANE_EPS || maxD < -AUTO_SPLIT_PLANE_EPS) continue;

    const ptsRaw = [intersectEdge(v0, d0, v1, d1), intersectEdge(v1, d1, v2, d2), intersectEdge(v2, d2, v0, d0)].filter(
      Boolean
    ) as Array<[number, number]>;

    if (ptsRaw.length < 2) continue;

    const unique = new Map<string, [number, number]>();
    for (const p of ptsRaw) {
      const kx = Math.round(p[0] / AUTO_SPLIT_SNAP_EPS);
      const kz = Math.round(p[1] / AUTO_SPLIT_SNAP_EPS);
      unique.set(`${kx},${kz}`, [snap2(p[0]), snap2(p[1])]);
    }
    const pts = Array.from(unique.values());
    if (pts.length !== 2) continue;
    addSegment(pts[0], pts[1]);
  }

  if (segments.length === 0) return [];

  const coordByKey = new Map<string, [number, number]>();
  const adjacency = new Map<string, string[]>();
  const keyFor = (p: [number, number]) => `${Math.round(p[0] / AUTO_SPLIT_SNAP_EPS)},${Math.round(p[1] / AUTO_SPLIT_SNAP_EPS)}`;
  const addAdj = (a: string, b: string) => {
    const list = adjacency.get(a) ?? [];
    list.push(b);
    adjacency.set(a, list);
  };

  for (const [a, b] of segments) {
    const ka = keyFor(a);
    const kb = keyFor(b);
    coordByKey.set(ka, a);
    coordByKey.set(kb, b);
    addAdj(ka, kb);
    addAdj(kb, ka);
  }

  const visitedEdge = new Set<string>();
  const edgeKey = (a: string, b: string) => (a < b ? `${a}|${b}` : `${b}|${a}`);

  const rings: Ring2D[] = [];
  const maxSteps = segments.length * 4 + 64;

  for (const [a, b] of segments) {
    const ka = keyFor(a);
    const kb = keyFor(b);
    const eKey = edgeKey(ka, kb);
    if (visitedEdge.has(eKey)) continue;

    const loopKeys: string[] = [ka, kb];
    visitedEdge.add(eKey);

    let prev = ka;
    let cur = kb;

    for (let step = 0; step < maxSteps; step++) {
      if (cur === ka) break;
      const neigh = adjacency.get(cur) ?? [];
      if (neigh.length === 0) break;
      let next = neigh.find((n) => n !== prev && !visitedEdge.has(edgeKey(cur, n)));
      if (next === undefined) next = neigh.find((n) => n !== prev);
      if (next === undefined) break;
      visitedEdge.add(edgeKey(cur, next));
      loopKeys.push(next);
      prev = cur;
      cur = next;
    }

    if (loopKeys.length < 4) continue;
    if (loopKeys[loopKeys.length - 1] !== ka) loopKeys.push(ka);

    const ring: Ring2D = [];
    for (const k of loopKeys) {
      const p = coordByKey.get(k);
      if (!p) continue;
      ring.push([p[0], p[1]]);
    }

    const cleaned = cleanRingForClip(ring);
    if (cleaned.length >= 4) rings.push(cleaned);
  }

  return rings;
}

function buildBoundaryRingsFromMeshGeometryAligned(
  mesh: THREE.Mesh,
  qAlign: THREE.Quaternion,
  eps = AUTO_SPLIT_SNAP_EPS
): Ring2D[] {
  const geometry = mesh.geometry as THREE.BufferGeometry | undefined;
  const position = geometry?.getAttribute("position") as THREE.BufferAttribute | undefined;
  if (!geometry || !position) return [];

  const index = geometry.getIndex();
  const triCount = index ? index.count / 3 : position.count / 3;
  if (!Number.isFinite(triCount) || triCount <= 0) return [];
  if (triCount > AUTO_SPLIT_MAX_CUTTER_TRIS) return [];

  mesh.updateWorldMatrix(true, false);

  const mAlign = new THREE.Matrix4().makeRotationFromQuaternion(qAlign);
  const m = new THREE.Matrix4().copy(mAlign).multiply(mesh.matrixWorld);

  const idByKey = new Map<string, number>();
  const verts: Array<[number, number]> = [];
  const getId = (x: number, z: number) => {
    const kx = Math.round(x / eps);
    const kz = Math.round(z / eps);
    const key = `${kx},${kz}`;
    const existing = idByKey.get(key);
    if (existing !== undefined) return existing;
    const id = verts.length;
    idByKey.set(key, id);
    verts.push([snap2(x), snap2(z)]);
    return id;
  };

  const edgeCounts = new Map<string, number>();
  const addEdge = (a: number, b: number) => {
    const min = a < b ? a : b;
    const max = a < b ? b : a;
    const key = `${min},${max}`;
    edgeCounts.set(key, (edgeCounts.get(key) ?? 0) + 1);
  };

  const tmp = new THREE.Vector3();
  const getIdx = (t: number, c: 0 | 1 | 2) => (index ? index.getX(t * 3 + c) : t * 3 + c);

  for (let t = 0; t < triCount; t++) {
    const i0 = getIdx(t, 0);
    const i1 = getIdx(t, 1);
    const i2 = getIdx(t, 2);
    if (i0 >= position.count || i1 >= position.count || i2 >= position.count) continue;

    tmp.fromBufferAttribute(position, i0).applyMatrix4(m);
    const a = getId(tmp.x, tmp.z);
    tmp.fromBufferAttribute(position, i1).applyMatrix4(m);
    const b = getId(tmp.x, tmp.z);
    tmp.fromBufferAttribute(position, i2).applyMatrix4(m);
    const c = getId(tmp.x, tmp.z);
    addEdge(a, b);
    addEdge(b, c);
    addEdge(c, a);
  }

  const adjacency = new Map<number, number[]>();
  const boundaryEdges: Array<[number, number]> = [];
  for (const [key, count] of edgeCounts.entries()) {
    if (count !== 1) continue;
    const [aStr, bStr] = key.split(",");
    const a = Number(aStr);
    const b = Number(bStr);
    if (!Number.isFinite(a) || !Number.isFinite(b)) continue;
    boundaryEdges.push([a, b]);
    (adjacency.get(a) ?? adjacency.set(a, []).get(a)!).push(b);
    (adjacency.get(b) ?? adjacency.set(b, []).get(b)!).push(a);
  }

  const visitedEdge = new Set<string>();
  const edgeKey = (a: number, b: number) => (a < b ? `${a},${b}` : `${b},${a}`);

  const rings: Ring2D[] = [];
  const maxSteps = boundaryEdges.length * 4 + 64;

  for (const [a0, b0] of boundaryEdges) {
    const startKey = edgeKey(a0, b0);
    if (visitedEdge.has(startKey)) continue;

    const loopIds: number[] = [a0, b0];
    visitedEdge.add(startKey);

    let prev = a0;
    let cur = b0;

    for (let step = 0; step < maxSteps; step++) {
      if (cur === a0) break;
      const neigh = adjacency.get(cur) ?? [];
      if (neigh.length === 0) break;
      let next = neigh.find((n) => n !== prev && !visitedEdge.has(edgeKey(cur, n)));
      if (next === undefined) next = neigh.find((n) => n !== prev);
      if (next === undefined) break;

      visitedEdge.add(edgeKey(cur, next));
      loopIds.push(next);
      prev = cur;
      cur = next;
    }

    if (loopIds.length < 4) continue;
    if (loopIds[loopIds.length - 1] !== a0) loopIds.push(a0);

    const ring: Ring2D = [];
    for (const id of loopIds) {
      const v = verts[id];
      if (!v) continue;
      ring.push([v[0], v[1]]);
    }

    const cleaned = cleanRingForClip(ring);
    if (cleaned.length >= 4) rings.push(cleaned);
  }

  return rings;
}

export function computeAutoSplitRegionsForFace(
  root: THREE.Object3D,
  target: THREE.Mesh,
  faceTriangles: FaceTriangle[],
  faceNormalWorld: THREE.Vector3,
  hitPointWorld: THREE.Vector3
): SplitRegion[] | null {
  try {
    const ud: any = target.userData || {};
    if (ud?.isHelper) return null;

    const geo = target.geometry as THREE.BufferGeometry | undefined;
    const pos = geo?.getAttribute("position") as THREE.BufferAttribute | undefined;
    if (!geo || !pos || pos.count < 3) return null;
    if (!Array.isArray(faceTriangles) || faceTriangles.length === 0) return null;

    const excludeRoot = findSelectableRoot(target) ?? target;
    const excludedMeshIds = new Set<number>();
    excludeRoot.traverse((obj) => {
      if ((obj as any)?.isMesh) excludedMeshIds.add(obj.id);
    });

    const plane = canonicalizePlaneKey(faceNormalWorld, hitPointWorld);
    const canonicalNormalWorld = plane.normal.clone().normalize();
    const qAlign = new THREE.Quaternion().setFromUnitVectors(canonicalNormalWorld, new THREE.Vector3(0, 1, 0));
    const planeY = hitPointWorld.clone().applyQuaternion(qAlign).y;

    const faceRings = buildBoundaryRingsFromFaceTrianglesAligned(faceTriangles, qAlign);
    const facePolys = buildPolysFromRings(faceRings);
    if (facePolys.length === 0) return null;

    // Face bounds in aligned XZ.
    let minX = Infinity,
      minZ = Infinity,
      maxX = -Infinity,
      maxZ = -Infinity;
    for (const poly of facePolys) {
      for (const ring of poly) {
        for (const [x, z] of ring) {
          minX = Math.min(minX, x);
          minZ = Math.min(minZ, z);
          maxX = Math.max(maxX, x);
          maxZ = Math.max(maxZ, z);
        }
      }
    }
    if (!Number.isFinite(minX) || !Number.isFinite(minZ) || !Number.isFinite(maxX) || !Number.isFinite(maxZ)) return null;

    const span = Math.max(maxX - minX, maxZ - minZ);
    const areaEps = Math.max(1e-6, span * span * 1e-12);

    const cutters: MultiPoly2 = [];
    const bbWorld = new THREE.Box3();
    const c = new THREE.Vector3();
    const corners = Array.from({ length: 8 }, () => new THREE.Vector3());

    root.traverse((obj) => {
      if (!(obj as any).isMesh) return;
      const m = obj as THREE.Mesh;
      if (excludedMeshIds.has(m.id)) return;
      if (!m.visible) return;
      const mud: any = m.userData || {};
      if (mud.isHelper || mud.isExtrudeHover === true) return;
      if (mud.selectable === false) return;
      if (m.name === "SkyDome" || m.name === "Grid" || m.name === "AxesWorld") return;

      // Quick reject via aligned world AABB.
      bbWorld.setFromObject(m);
      const min = bbWorld.min;
      const max = bbWorld.max;
      corners[0].set(min.x, min.y, min.z);
      corners[1].set(min.x, min.y, max.z);
      corners[2].set(min.x, max.y, min.z);
      corners[3].set(min.x, max.y, max.z);
      corners[4].set(max.x, min.y, min.z);
      corners[5].set(max.x, min.y, max.z);
      corners[6].set(max.x, max.y, min.z);
      corners[7].set(max.x, max.y, max.z);

      let aMinX = Infinity,
        aMinY = Infinity,
        aMinZ = Infinity,
        aMaxX = -Infinity,
        aMaxY = -Infinity,
        aMaxZ = -Infinity;
      for (let i = 0; i < 8; i++) {
        c.copy(corners[i]).applyQuaternion(qAlign);
        aMinX = Math.min(aMinX, c.x);
        aMinY = Math.min(aMinY, c.y);
        aMinZ = Math.min(aMinZ, c.z);
        aMaxX = Math.max(aMaxX, c.x);
        aMaxY = Math.max(aMaxY, c.y);
        aMaxZ = Math.max(aMaxZ, c.z);
      }

      // Quick reject XZ bounds
      const margin = span * 0.01 + 1e-3;
      if (aMaxX < minX - margin || aMinX > maxX + margin || aMaxZ < minZ - margin || aMinZ > maxZ + margin) return;

      // Check if mesh intersects the plane (original logic)
      const intersectsPlane = !(planeY < aMinY - AUTO_SPLIT_PLANE_EPS || planeY > aMaxY + AUTO_SPLIT_PLANE_EPS);

      // Check if mesh is floating above the face (for footprint projection)
      const isFloatingAbove = aMinY > planeY + AUTO_SPLIT_PLANE_EPS;

      let foundCutters = false;

      // Special-case: coplanar planar surfaces (including decals) won't produce plane-intersection segments.
      // Use their boundary outline as a cutter so sub-face regions are detected for circle/poly/etc.
      const isSurfaceLike = mud.isDecal === true || mud.type === "surface" || mud.entityType === "face";
      if (isSurfaceLike) {
        const yMid = (aMinY + aMaxY) / 2;
        const thickness = aMaxY - aMinY;
        const maxCoplanarGap = Math.max(5e-4, Math.min(0.02, span * 0.02 + 1e-3));
        const maxPlanarThickness = Math.max(AUTO_SPLIT_PLANE_EPS * 4, maxCoplanarGap);

        if (Math.abs(yMid - planeY) <= maxCoplanarGap && thickness <= maxPlanarThickness) {
          const rings = buildBoundaryRingsFromMeshGeometryAligned(m, qAlign);
          if (rings.length > 0) {
            const polys = buildPolysFromRings(rings);
            for (const p of polys) {
              if (polyAreaAbs(p) > areaEps) {
                cutters.push(p);
                foundCutters = true;
              }
            }
          }
        }
      }

      // Try plane intersection first (for meshes that span across the plane)
      if (!foundCutters && intersectsPlane) {
        const rings = buildPlaneIntersectionRingsAligned(m, qAlign, planeY);
        if (rings.length > 0) {
          const polys = buildPolysFromRings(rings);
          for (const p of polys) {
            if (polyAreaAbs(p) > areaEps) {
              cutters.push(p);
              foundCutters = true;
            }
          }
        }
      }

      // For floating meshes, try footprint projection
      if (!foundCutters && isFloatingAbove) {
        const footprintRings = buildMeshFootprintRingsAligned(m, qAlign);
        if (footprintRings.length > 0) {
          const polys = buildPolysFromRings(footprintRings);
          for (const p of polys) {
            if (polyAreaAbs(p) > areaEps) {
              cutters.push(p);
            }
          }
        }
      }
    });

    if (cutters.length === 0) return null;

    let pieces: MultiPoly2 = [...facePolys];
    let didSplit = false;

    for (const cutter of cutters) {
      const nextPieces: MultiPoly2 = [];
      for (const piece of pieces) {
        const interMP = pc.intersection([piece] as any, [cutter] as any) as any;
        const diffMP = pc.difference([piece] as any, [cutter] as any) as any;

        const inter = mpToMultiPoly2(interMP).filter((p) => polyAreaAbs(p) > areaEps);
        const diff = mpToMultiPoly2(diffMP).filter((p) => polyAreaAbs(p) > areaEps);

        if (inter.length > 0) didSplit = true;
        if (diff.length > 0) didSplit = true;

        nextPieces.push(...diff, ...inter);
        if (nextPieces.length > AUTO_SPLIT_MAX_PIECES) return null;
      }
      pieces = nextPieces.length > 0 ? nextPieces : pieces;
      if (pieces.length > AUTO_SPLIT_MAX_PIECES) return null;
    }

    if (!didSplit || pieces.length <= 1) return null;

    const basis = { q: [qAlign.x, qAlign.y, qAlign.z, qAlign.w] as [number, number, number, number], y: planeY };

    const regions: SplitRegion[] = pieces.map((poly, idx) => {
      const ring = ensureClosedRing2D(poly[0]);
      const holes = poly
        .slice(1)
        .map((h) => ensureClosedRing2D(h))
        .filter((h) => h.length >= 4);

      let rMinX = Infinity,
        rMinZ = Infinity,
        rMaxX = -Infinity,
        rMaxZ = -Infinity;
      for (const [x, z] of ring) {
        rMinX = Math.min(rMinX, x);
        rMinZ = Math.min(rMinZ, z);
        rMaxX = Math.max(rMaxX, x);
        rMaxZ = Math.max(rMaxZ, z);
      }
      const cx = snap2((rMinX + rMaxX) / 2);
      const cz = snap2((rMinZ + rMaxZ) / 2);

      return {
        id: `${plane.key}:${idx}`,
        polygon: [ring, ...holes],
        ring,
        holes,
        center: [cx, cz],
        basis,
      };
    });

    return regions;
  } catch {
    return null;
  }
}

export function computeFaceRegionsForFaceTriangles(
  faceTriangles: FaceTriangle[],
  faceNormalWorld: THREE.Vector3,
  hitPointWorld: THREE.Vector3
): SplitRegion[] | null {
  try {
    if (!Array.isArray(faceTriangles) || faceTriangles.length === 0) return null;

    const plane = canonicalizePlaneKey(faceNormalWorld, hitPointWorld);
    const canonicalNormalWorld = plane.normal.clone().normalize();
    const qAlign = new THREE.Quaternion().setFromUnitVectors(canonicalNormalWorld, new THREE.Vector3(0, 1, 0));
    const planeY = hitPointWorld.clone().applyQuaternion(qAlign).y;

    const faceRings = buildBoundaryRingsFromFaceTrianglesAligned(faceTriangles, qAlign);
    const facePolys = buildPolysFromRings(faceRings);
    if (facePolys.length === 0) return null;

    // Face bounds in aligned XZ (for numeric eps filtering).
    let minX = Infinity,
      minZ = Infinity,
      maxX = -Infinity,
      maxZ = -Infinity;
    for (const poly of facePolys) {
      for (const ring of poly) {
        for (const [x, z] of ring) {
          minX = Math.min(minX, x);
          minZ = Math.min(minZ, z);
          maxX = Math.max(maxX, x);
          maxZ = Math.max(maxZ, z);
        }
      }
    }
    if (!Number.isFinite(minX) || !Number.isFinite(minZ) || !Number.isFinite(maxX) || !Number.isFinite(maxZ)) return null;

    const span = Math.max(maxX - minX, maxZ - minZ);
    const areaEps = Math.max(1e-6, span * span * 1e-12);

    const basis = { q: [qAlign.x, qAlign.y, qAlign.z, qAlign.w] as [number, number, number, number], y: planeY };

    const regions: SplitRegion[] = [];
    for (const poly of facePolys) {
      if (polyAreaAbs(poly) <= areaEps) continue;

      const ring = ensureClosedRing2D(poly[0]);
      const holes = poly
        .slice(1)
        .map((h) => ensureClosedRing2D(h))
        .filter((h) => h.length >= 4);

      let rMinX = Infinity,
        rMinZ = Infinity,
        rMaxX = -Infinity,
        rMaxZ = -Infinity;
      for (const [x, z] of ring) {
        rMinX = Math.min(rMinX, x);
        rMinZ = Math.min(rMinZ, z);
        rMaxX = Math.max(rMaxX, x);
        rMaxZ = Math.max(rMaxZ, z);
      }
      const cx = snap2((rMinX + rMaxX) / 2);
      const cz = snap2((rMinZ + rMaxZ) / 2);

      regions.push({
        id: `${plane.key}:base:${regions.length}`,
        polygon: [ring, ...holes],
        ring,
        holes,
        center: [cx, cz],
        basis,
      });
    }

    return regions.length > 0 ? regions : null;
  } catch {
    return null;
  }
}

function buildShapeFromAlignedPoly(poly: Array<Array<[number, number]>>, center: [number, number]): THREE.Shape | null {
  if (!Array.isArray(poly) || poly.length === 0) return null;
  const [cx, cz] = center;

  const outer = stripClosedRing2D(poly[0] as Array<[number, number]>).map(([x, z]) => new THREE.Vector2(x - cx, -(z - cz)));
  if (outer.length < 3) return null;
  const shape = new THREE.Shape(outer);

  for (let i = 1; i < poly.length; i++) {
    const holePts = stripClosedRing2D(poly[i] as Array<[number, number]>).map(([x, z]) => new THREE.Vector2(x - cx, -(z - cz)));
    if (holePts.length < 3) continue;
    shape.holes.push(new THREE.Path(holePts));
  }
  return shape;
}

export function buildWorldTrianglesFromSplitRegion(region: any, hitNormalWorld: THREE.Vector3): FaceTriangle[] | null {
  const basis = region?.basis;
  const poly = region?.polygon as Array<Array<[number, number]>> | undefined;
  const center = region?.center as [number, number] | undefined;

  if (!basis || !Array.isArray(basis.q) || basis.q.length !== 4 || !Number.isFinite(basis.y)) return null;
  if (!center || !Array.isArray(center) || center.length !== 2) return null;
  if (!poly || !Array.isArray(poly) || poly.length === 0) return null;

  const shape = buildShapeFromAlignedPoly(poly, center);
  if (!shape) return null;

  const geom2d = new THREE.ShapeGeometry(shape);
  const geom = geom2d.index ? geom2d.toNonIndexed() : geom2d;
  if (geom !== geom2d) geom2d.dispose();

  const pos = geom.getAttribute("position") as THREE.BufferAttribute | undefined;
  if (!pos || pos.count < 3) {
    geom.dispose();
    return null;
  }

  const qAlign = new THREE.Quaternion(basis.q[0], basis.q[1], basis.q[2], basis.q[3]); // world->aligned
  const qBack = qAlign.clone().invert(); // aligned->world
  const canonicalNormalWorld = new THREE.Vector3(0, 1, 0).applyQuaternion(qBack).normalize();
  const shouldFlip = canonicalNormalWorld.dot(hitNormalWorld.clone().normalize()) < 0;

  const [cx, cz] = center;
  const y = basis.y;

  const tris: FaceTriangle[] = [];
  const a = new THREE.Vector3();
  const b = new THREE.Vector3();
  const c = new THREE.Vector3();

  for (let i = 0; i < pos.count; i += 3) {
    const ax = pos.getX(i);
    const ay = pos.getY(i);
    const bx = pos.getX(i + 1);
    const by = pos.getY(i + 1);
    const cx2 = pos.getX(i + 2);
    const cy2 = pos.getY(i + 2);

    // ShapeGeometry is in XY plane; map back to aligned XZ, at aligned Y=planeY.
    a.set(ax + cx, y, -ay + cz).applyQuaternion(qBack);
    b.set(bx + cx, y, -by + cz).applyQuaternion(qBack);
    c.set(cx2 + cx, y, -cy2 + cz).applyQuaternion(qBack);

    if (shouldFlip) tris.push([a.clone(), c.clone(), b.clone()]);
    else tris.push([a.clone(), b.clone(), c.clone()]);
  }

  geom.dispose();
  return tris;
}

export function buildSplitRegionsBorderGeometry(regions: any[], hitNormalWorld: THREE.Vector3, offset: number) {
  const basis = regions?.[0]?.basis;
  if (!basis || !Array.isArray(basis.q) || basis.q.length !== 4 || !Number.isFinite(basis.y)) {
    const empty = new LineSegmentsGeometry();
    empty.setPositions([]);
    return empty;
  }

  const qAlign = new THREE.Quaternion(basis.q[0], basis.q[1], basis.q[2], basis.q[3]);
  const qBack = qAlign.clone().invert();

  const normal = hitNormalWorld.clone().normalize();
  const offsetVec = normal.multiplyScalar(offset);

  const positions: number[] = [];
  const a = new THREE.Vector3();
  const b = new THREE.Vector3();

  const pushRing = (ring: Array<[number, number]>) => {
    const pts = Array.isArray(ring) ? ring : [];
    if (pts.length < 2) return;
    for (let i = 0; i < pts.length - 1; i++) {
      const [x0, z0] = pts[i];
      const [x1, z1] = pts[i + 1];
      if (!Number.isFinite(x0) || !Number.isFinite(z0) || !Number.isFinite(x1) || !Number.isFinite(z1)) continue;

      a.set(x0, basis.y, z0).applyQuaternion(qBack).add(offsetVec);
      b.set(x1, basis.y, z1).applyQuaternion(qBack).add(offsetVec);
      positions.push(a.x, a.y, a.z, b.x, b.y, b.z);
    }
    // Close ring if needed
    const [fx, fz] = pts[0];
    const [lx, lz] = pts[pts.length - 1];
    if (Math.abs(fx - lx) > 1e-6 || Math.abs(fz - lz) > 1e-6) {
      a.set(lx, basis.y, lz).applyQuaternion(qBack).add(offsetVec);
      b.set(fx, basis.y, fz).applyQuaternion(qBack).add(offsetVec);
      positions.push(a.x, a.y, a.z, b.x, b.y, b.z);
    }
  };

  for (const r of regions as any[]) {
    const ring = (r as any)?.ring as Array<[number, number]> | undefined;
    const holes = (r as any)?.holes as Array<Array<[number, number]>> | undefined;
    if (Array.isArray(ring) && ring.length >= 2) pushRing(ring);
    if (Array.isArray(holes)) {
      for (const h of holes) {
        if (Array.isArray(h) && h.length >= 2) pushRing(h);
      }
    }
  }

  const geo = new LineSegmentsGeometry();
  geo.setPositions(positions);
  return geo;
}
