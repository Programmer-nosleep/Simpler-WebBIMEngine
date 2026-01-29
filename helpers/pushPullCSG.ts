import * as THREE from "three";
import { mergeVertices } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import { stripCapAtPlane } from "./geometryOps";

// three-bvh-csg (API bisa beda versi; ini yang umum)
import { Brush, Evaluator, ADDITION, SUBTRACTION } from "three-bvh-csg";

type Ring2D = [number, number][];
type Poly2 = Ring2D[];

const SNAP_EPS = 1e-5;
const MIN_CSG_EPS = 1e-4;
const MAX_CSG_EPS = 5e-3;

const evaluator = new Evaluator();
const _invTargetWorld = new THREE.Matrix4();
const _tmpPosA = new THREE.Vector3();
const _tmpQuatA = new THREE.Quaternion();
const _tmpScaleA = new THREE.Vector3();
const _tmpPosB = new THREE.Vector3();
const _tmpQuatB = new THREE.Quaternion();
const _tmpScaleB = new THREE.Vector3();
const _tmpSize = new THREE.Vector3();

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
  // buang titik penutup supaya Shape nggak dobel
  if (Math.abs(f[0] - l[0]) < SNAP_EPS && Math.abs(f[1] - l[1]) < SNAP_EPS) {
    return closed.slice(0, closed.length - 1);
  }
  return closed;
}

// point-in-poly yang kamu sudah punya (aku tulis ulang versi ring+holes)
function pointOnSegment2D(
  px: number, pz: number,
  ax: number, az: number,
  bx: number, bz: number,
  eps = 1e-6
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

  // boundary-inclusive
  for (let i = 0; i < pts.length; i++) {
    const a = pts[i];
    const b = pts[(i + 1) % pts.length];
    if (pointOnSegment2D(x, z, a[0], a[1], b[0], b[1], 1e-6)) return true;
  }

  let inside = false;
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
    const xi = pts[i][0], zi = pts[i][1];
    const xj = pts[j][0], zj = pts[j][1];
    const intersect =
      (zi > z) !== (zj > z) &&
      x < ((xj - xi) * (z - zi)) / (zj - zi + Number.EPSILON) + xi;
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

/**
 * Samain cara kamu bikin "plane key" waktu split.
 * (Aku bikin versi ringkas: normal + d + rounding)
 */
export function canonicalizePlaneKey(normalWorld: THREE.Vector3, pointWorld: THREE.Vector3) {
  const n = normalWorld.clone().normalize();
  if (n.lengthSq() < 1e-12) n.set(0, 1, 0);

  let d = -n.dot(pointWorld);
  // bikin normal “canonical” (arah stabil)
  const ax = Math.abs(n.x), ay = Math.abs(n.y), az = Math.abs(n.z);
  if (ax >= ay && ax >= az) {
    if (n.x < 0) { n.negate(); d = -d; }
  } else if (ay >= az) {
    if (n.y < 0) { n.negate(); d = -d; }
  } else {
    if (n.z < 0) { n.negate(); d = -d; }
  }

  const digits = 4;
  const key = `${n.x.toFixed(digits)},${n.y.toFixed(digits)},${n.z.toFixed(digits)}|${d.toFixed(digits)}`;
  return { normal: n, key };
}

function polyToCenteredShape(poly: Poly2, cx: number, cz: number) {
  const outer = cleanRingForGeometry(poly[0]).map(([x, z]) => new THREE.Vector2(x - cx, -(z - cz)));
  const shape = new THREE.Shape(outer);

  for (let i = 1; i < poly.length; i++) {
    const hole = cleanRingForGeometry(poly[i]).map(([x, z]) => new THREE.Vector2(x - cx, -(z - cz)));
    if (hole.length >= 3) shape.holes.push(new THREE.Path(hole));
  }
  return shape;
}

/**
 * Struktur region yang kamu simpan di __splitRegionsByPlane
 */
export type SplitRegion = {
  id: string;
  polygon: Poly2;                 // polygon di ALIGNED SPACE (plane jadi horizontal)
  ring: Ring2D;
  holes: Ring2D[];
  center: [number, number];       // [cx, cz] di aligned space
  basis: { q: [number, number, number, number]; y: number }; // world->aligned, dan planeY (aligned)
  isPicked?: boolean;
};

function getCsgEpsFromRegion(region: SplitRegion, pullAligned: number) {
  let minX = Infinity;
  let minZ = Infinity;
  let maxX = -Infinity;
  let maxZ = -Infinity;

  const scanRing = (ring: Ring2D | undefined) => {
    if (!Array.isArray(ring)) return;
    for (const p of ring) {
      const x = Number(p?.[0]);
      const z = Number(p?.[1]);
      if (!Number.isFinite(x) || !Number.isFinite(z)) continue;
      minX = Math.min(minX, x);
      minZ = Math.min(minZ, z);
      maxX = Math.max(maxX, x);
      maxZ = Math.max(maxZ, z);
    }
  };

  scanRing(region.ring);
  if (Array.isArray(region.holes)) {
    for (const h of region.holes) scanRing(h);
  }

  const spanX = Number.isFinite(minX) && Number.isFinite(maxX) ? maxX - minX : 0;
  const spanZ = Number.isFinite(minZ) && Number.isFinite(maxZ) ? maxZ - minZ : 0;
  const span = Math.max(spanX, spanZ, Math.abs(pullAligned), 1e-3);
  const eps = Math.max(MIN_CSG_EPS, span * 1e-4);
  return Math.min(MAX_CSG_EPS, eps);
}

function getWeldToleranceForGeometry(geometry: THREE.BufferGeometry) {
  if (!geometry.boundingBox) geometry.computeBoundingBox();
  const bb = geometry.boundingBox;
  if (!bb) return 1e-4;

  bb.getSize(_tmpSize);
  const maxDim = Math.max(_tmpSize.x, _tmpSize.y, _tmpSize.z);
  const maxAbs = Math.max(
    Math.abs(bb.min.x),
    Math.abs(bb.min.y),
    Math.abs(bb.min.z),
    Math.abs(bb.max.x),
    Math.abs(bb.max.y),
    Math.abs(bb.max.z),
  );

  const tolBySize = maxDim * 1e-5;
  const tolByMagnitude = maxAbs * 2e-7;
  const tol = Math.max(1e-4, tolBySize, tolByMagnitude);
  return Math.min(MAX_CSG_EPS, tol);
}

/**
 * Cari region yang mengandung pickPointWorld.
 * Pick point diubah ke aligned space pakai basis.q (world->aligned).
 */
export function pickRegionFromPlaneRegions(regions: SplitRegion[], pickPointWorld: THREE.Vector3): SplitRegion | null {
  if (!regions || regions.length === 0) return null;

  const qAlign = new THREE.Quaternion(...regions[0].basis.q);
  const pAligned = pickPointWorld.clone().applyQuaternion(qAlign);

  // Prefer the most specific (smallest-area) region that contains the point.
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

  // Fallback: choose nearest region center (avoids "jumping" to regions[0] when we're on a boundary).
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

/**
 * Bikin cutter volume dari region polygon (aligned), lalu rotate balik ke world.
 *
 * pullSigned:
 *   >0 = pull keluar (UNION)
 *   <0 = push masuk (SUBTRACT)
 *
 * hitNormalWorld:
 *   normal face hasil raycast (arah “keluar” dari solid)
 */
export function buildCutterFromRegion(
  region: SplitRegion,
  pullSigned: number,
  hitNormalWorld: THREE.Vector3
): THREE.Mesh {
  const qAlign = new THREE.Quaternion(...region.basis.q); // world->aligned
  const qBack = qAlign.clone().invert();                 // aligned->world

  // normal canonical (world) berdasarkan basis
  const canonicalNormalWorld = new THREE.Vector3(0, 1, 0).applyQuaternion(qBack).normalize();

  // kalau basis normal kebalik dibanding hit normal, balik arah pull
  const sign = Math.sign(canonicalNormalWorld.dot(hitNormalWorld.clone().normalize())) || 1;
  const pullAligned = pullSigned * sign;
  const csgEps = getCsgEpsFromRegion(region, pullAligned);

  const [cx, cz] = region.center;
  const planeY = region.basis.y;

  // cutter harus “nembus” solid → kasih eps di bawah/atas
  const y0 = Math.min(planeY, planeY + pullAligned) - csgEps;
  const y1 = Math.max(planeY, planeY + pullAligned) + csgEps;
  const depth = Math.max(csgEps * 2, y1 - y0);

  const shape = polyToCenteredShape(region.polygon, cx, cz);

  // ExtrudeGeometry default extrude di +Z → rotateX(-90°) biar extrude di +Y (aligned)
  let geom: THREE.BufferGeometry = new THREE.ExtrudeGeometry(shape, { depth, bevelEnabled: false });
  geom.rotateX(-Math.PI / 2);

  // Pastikan base di y=0, lalu nanti kita taruh di y0
  geom.computeBoundingBox();
  const bb = geom.boundingBox!;
  geom.translate(0, -bb.min.y, 0);

  // optional: weld vertex biar boolean lebih stabil
  const welded = mergeVertices(geom, Math.max(1e-5, csgEps * 0.5));
  geom.dispose();
  geom = welded;

  geom.computeVertexNormals();
  geom.computeBoundingBox();
  geom.computeBoundingSphere();

  const cutter = new THREE.Mesh(
    geom,
    // material cutter bebas; bisa invisible kalau nggak mau kelihatan
    new THREE.MeshStandardMaterial({ color: 0xff00ff, transparent: true, opacity: 0.25 })
  );

  // pos cutter di aligned coords
  cutter.position.set(cx, y0, cz);

  // rotate balik ke world
  cutter.position.applyQuaternion(qBack);
  cutter.quaternion.copy(qBack);
  cutter.updateMatrixWorld(true);

  return cutter;
}

/**
 * Compute push/pull CSG result geometry in TARGET LOCAL SPACE.
 *
 * Note: three-bvh-csg emits positions in WORLD SPACE (it applies matrixWorld),
 * so we must transform the result back into the target mesh's local space to
 * avoid "double transforms" (object shifting / warped results).
 */
export function computePushPullCSGGeometryLocal(
  targetSolid: THREE.Mesh,
  cutter: THREE.Mesh,
  pullSigned: number,
  sourceGeometry?: THREE.BufferGeometry,
) {
  targetSolid.updateMatrixWorld(true);
  cutter.updateMatrixWorld(true);

  const op = pullSigned < 0 ? SUBTRACTION : ADDITION;

  const baseGeometry = sourceGeometry ?? (targetSolid.geometry as THREE.BufferGeometry | undefined);
  if (!baseGeometry) return null;

  const a = new Brush(baseGeometry, targetSolid.material as any);
  targetSolid.matrixWorld.decompose(_tmpPosA, _tmpQuatA, _tmpScaleA);
  a.position.copy(_tmpPosA);
  a.quaternion.copy(_tmpQuatA);
  a.scale.copy(_tmpScaleA);
  a.updateMatrixWorld(true);

  const b = new Brush(cutter.geometry, cutter.material as any);
  cutter.matrixWorld.decompose(_tmpPosB, _tmpQuatB, _tmpScaleB);
  b.position.copy(_tmpPosB);
  b.quaternion.copy(_tmpQuatB);
  b.scale.copy(_tmpScaleB);
  b.updateMatrixWorld(true);

  const result = evaluator.evaluate(a, b, op);
  const worldGeom = result.geometry as THREE.BufferGeometry | undefined;
  if (!worldGeom) return null;

  _invTargetWorld.copy(targetSolid.matrixWorld).invert();
  worldGeom.applyMatrix4(_invTargetWorld);

  // Recompute normals after boolean + transform.
  worldGeom.deleteAttribute("normal");

  const merged = mergeVertices(worldGeom, getWeldToleranceForGeometry(worldGeom));
  if (merged !== worldGeom) worldGeom.dispose();

  merged.computeVertexNormals();
  merged.computeBoundingBox();
  merged.computeBoundingSphere();

  return merged;
}

/**
 * Apply CSG ke targetSolid.
 * pullSigned menentukan union/subtract.
 */
export function applyPushPullCSG(
  targetSolid: THREE.Mesh,
  cutter: THREE.Mesh,
  pullSigned: number,
  sourceGeometry?: THREE.BufferGeometry,
  opPlaneWorld?: THREE.Plane,
) {
  const merged = computePushPullCSGGeometryLocal(targetSolid, cutter, pullSigned, sourceGeometry);
  let applied: THREE.BufferGeometry | null = null;

  if (merged) {
    let next = merged;

    if (opPlaneWorld && pullSigned < 0) {
      try {
        targetSolid.updateWorldMatrix(true, true);
        const inv = new THREE.Matrix4().copy(targetSolid.matrixWorld).invert();
        const planeLocal = opPlaneWorld.clone().applyMatrix4(inv);

        const stripped = stripCapAtPlane(next, planeLocal, 1e-3);
        if (stripped !== next) {
          next.dispose();
          next = stripped;
        }
      } catch {
        // ignore
      }
    }

    // replace geometry (avoid disposing the caller-provided base geometry)
    const prev = targetSolid.geometry as THREE.BufferGeometry | undefined;
    targetSolid.geometry = next;
    targetSolid.geometry.computeBoundingBox();
    targetSolid.geometry.computeBoundingSphere();
    if (prev && prev !== next && prev !== sourceGeometry) {
      try { prev.dispose(); } catch { }
    }
    applied = next;
  }

  // cleanup cutter
  cutter.geometry.dispose();
  const mats = Array.isArray(cutter.material) ? cutter.material : [cutter.material];
  mats.forEach((m) => (m as THREE.Material).dispose());

  return applied;
}

/**
 * High-level: push/pull satu solid berdasarkan region yang displit sebelumnya.
 *
 * - solid.userData.__splitRegionsByPlane[planeKey] harus ada (dari splitSurfaceByLineCutter kamu)
 * - pickPointWorld + hitNormalWorld didapat dari raycast
 * - pullSigned = jarak pull (meter/unit) (+ keluar, - masuk)
 */
export function pushPullSolidFromStoredRegions(
  solid: THREE.Mesh,
  pickPointWorld: THREE.Vector3,
  hitNormalWorld: THREE.Vector3,
  pullSigned: number
) {
  const ud: any = solid.userData || {};
  const byPlane: Record<string, SplitRegion[]> | undefined = ud.__splitRegionsByPlane;
  const legacyRegions: SplitRegion[] | null = Array.isArray(ud.__splitRegions) ? (ud.__splitRegions as SplitRegion[]) : null;

  if (!byPlane && !legacyRegions) return false;

  const plane = canonicalizePlaneKey(hitNormalWorld, pickPointWorld);
  const regions = byPlane?.[plane.key] && byPlane[plane.key].length > 0 ? byPlane[plane.key] : legacyRegions;
  if (!regions || regions.length === 0) return false;

  const region = pickRegionFromPlaneRegions(regions, pickPointWorld);
  if (!region) return false;

  const cutter = buildCutterFromRegion(region, pullSigned, hitNormalWorld);
  const applied = applyPushPullCSG(solid, cutter, pullSigned);

  solid.userData = ud;
  return !!applied;
}
