import * as THREE from "three";

type Ring2D = [number, number][];
type Poly2 = Ring2D[];

const SNAP_EPS = 1e-5;

const snap = (v: number, eps = SNAP_EPS): number => {
  if (!Number.isFinite(v)) return v;
  if (Math.abs(v) < eps) return 0;
  return Number(v.toFixed(5));
};

function ensureClosedRing(ring: Ring2D): Ring2D {
  if (!ring || ring.length === 0) return [];
  const out = ring.map(([x, z]) => [snap(x), snap(z)] as [number, number]);
  const f = out[0];
  const l = out[out.length - 1];
  if (Math.abs(f[0] - l[0]) > SNAP_EPS || Math.abs(f[1] - l[1]) > SNAP_EPS) {
    out.push([f[0], f[1]]);
  }
  return out;
}

function cleanRingForGeometry(ring: Ring2D): Ring2D {
  const closed = ensureClosedRing(ring);
  if (closed.length < 2) return closed;
  const f = closed[0];
  const l = closed[closed.length - 1];
  if (Math.abs(f[0] - l[0]) < SNAP_EPS && Math.abs(f[1] - l[1]) < SNAP_EPS) {
    return closed.slice(0, closed.length - 1);
  }
  return closed;
}

function pointOnSegment2D(
  px: number,
  pz: number,
  ax: number,
  az: number,
  bx: number,
  bz: number,
  eps = 1e-6,
) {
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

function pointInRing2D(ring: Ring2D, x: number, z: number) {
  const pts = cleanRingForGeometry(ring);
  if (pts.length < 3) return false;

  for (let i = 0; i < pts.length; i++) {
    const a = pts[i];
    const b = pts[(i + 1) % pts.length];
    if (pointOnSegment2D(x, z, a[0], a[1], b[0], b[1], 1e-6)) return true;
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

function pointInPoly2(poly: Poly2, x: number, z: number) {
  if (!poly.length || !poly[0]) return false;
  if (!pointInRing2D(poly[0], x, z)) return false;
  for (let i = 1; i < poly.length; i++) {
    if (pointInRing2D(poly[i], x, z)) return false;
  }
  return true;
}

function ringSignedArea2D(ring: Ring2D): number {
  const pts = cleanRingForGeometry(ring);
  if (pts.length < 3) return 0;
  let sum = 0;
  for (let i = 0; i < pts.length; i++) {
    const [x0, z0] = pts[i];
    const [x1, z1] = pts[(i + 1) % pts.length];
    sum += x0 * z1 - x1 * z0;
  }
  return sum / 2;
}

function polyAreaAbs2D(poly: Poly2): number {
  if (!poly || poly.length === 0) return 0;
  const outer = Math.abs(ringSignedArea2D(poly[0]));
  let holes = 0;
  for (let i = 1; i < poly.length; i++) holes += Math.abs(ringSignedArea2D(poly[i]));
  return Math.max(0, outer - holes);
}

export function canonicalizePlaneKey(normalWorld: THREE.Vector3, pointWorld: THREE.Vector3) {
  const n = normalWorld.clone().normalize();
  if (n.lengthSq() < 1e-12) n.set(0, 1, 0);

  let d = -n.dot(pointWorld);
  const ax = Math.abs(n.x),
    ay = Math.abs(n.y),
    az = Math.abs(n.z);
  if (ax >= ay && ax >= az) {
    if (n.x < 0) {
      n.negate();
      d = -d;
    }
  } else if (ay >= az) {
    if (n.y < 0) {
      n.negate();
      d = -d;
    }
  } else {
    if (n.z < 0) {
      n.negate();
      d = -d;
    }
  }

  const digits = 4;
  const key = `${n.x.toFixed(digits)},${n.y.toFixed(digits)},${n.z.toFixed(digits)}|${d.toFixed(digits)}`;
  return { normal: n, key };
}

export type SplitRegion = {
  id: string;
  polygon: Poly2;
  ring: Ring2D;
  holes: Ring2D[];
  center: [number, number];
  basis: { q: [number, number, number, number]; y: number };
  isPicked?: boolean;
};

export function pickRegionFromPlaneRegions(regions: SplitRegion[], pickPointWorld: THREE.Vector3): SplitRegion | null {
  if (!regions || regions.length === 0) return null;

  const qAlign = new THREE.Quaternion(...regions[0].basis.q);
  const pAligned = pickPointWorld.clone().applyQuaternion(qAlign);

  let best: SplitRegion | null = null;
  let bestArea = Infinity;
  for (const r of regions) {
    if (!r?.polygon) continue;
    if (!pointInPoly2(r.polygon, pAligned.x, pAligned.z)) continue;
    const area = polyAreaAbs2D(r.polygon);
    if (!best || area < bestArea) {
      best = r;
      bestArea = area;
    }
  }
  if (best) return best;

  let bestDist2 = Infinity;
  for (const r of regions) {
    const c = r?.center;
    if (!c || c.length !== 2) continue;
    const dx = pAligned.x - c[0];
    const dz = pAligned.z - c[1];
    const d2 = dx * dx + dz * dz;
    if (d2 < bestDist2) {
      bestDist2 = d2;
      best = r;
    }
  }
  return best;
}

