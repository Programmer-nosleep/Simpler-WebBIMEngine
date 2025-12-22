import * as THREE from "three";
import * as pc from "polygon-clipping";
import { ensureClosedRing } from "./polygon-clipper";

export type SurfacePlacementMode = "horizontal" | "vertical";

export type PlaneBasis = {
  plane: THREE.Plane;
  origin: THREE.Vector3;
  normal: THREE.Vector3;
  uAxis: THREE.Vector3; // local +X in world
  vAxis: THREE.Vector3; // local +Z in world (in-plane "up")
  quaternion: THREE.Quaternion;
};

const EPS = 1e-8;
const DEFAULT_SNAP_EPS = 1e-5;
const DEFAULT_POINT_EPS = 1e-6;
const DEFAULT_AREA_EPS = 1e-10;

export const WORLD_UP = new THREE.Vector3(0, 1, 0);
export const WORLD_FORWARD = new THREE.Vector3(0, 0, 1);
export const WORLD_RIGHT = new THREE.Vector3(1, 0, 0);

export type Ring2 = [number, number][];
export type Polygon2 = Ring2[];
export type MultiPolygon2 = Polygon2[];

export type Ring3 = THREE.Vector3[];
export type Polygon3 = Ring3[];
export type MultiPolygon3 = Polygon3[];

export type PolygonBooleanOp = "union" | "difference" | "intersection" | "xor";

export type PlanePolygonNormalizeOptions = {
  snapEpsilon?: number;
  pointEpsilon?: number;
  areaEpsilon?: number;
};

export function isFloorLikeNormal(normal: THREE.Vector3, threshold = 0.95) {
  const n = normal.clone().normalize();
  return Math.abs(n.dot(WORLD_UP)) >= threshold;
}

function projectNonDegenerateAxis(axis: THREE.Vector3, normal: THREE.Vector3) {
  const projected = axis.clone().projectOnPlane(normal);
  if (projected.lengthSq() < EPS) return null;
  return projected.normalize();
}

export function computePlaneBasis(
  normal: THREE.Vector3,
  origin: THREE.Vector3,
  options?: { preferredV?: THREE.Vector3 }
): PlaneBasis {
  const n = normal.clone().normalize();
  const o = origin.clone();

  let v =
    (options?.preferredV ? projectNonDegenerateAxis(options.preferredV, n) : null) ??
    projectNonDegenerateAxis(WORLD_UP, n) ??
    projectNonDegenerateAxis(WORLD_FORWARD, n) ??
    projectNonDegenerateAxis(WORLD_RIGHT, n);

  if (!v) {
    const helper = Math.abs(n.y) < 0.9 ? WORLD_UP : WORLD_RIGHT;
    v = helper.clone().projectOnPlane(n).normalize();
    if (v.lengthSq() < EPS) v = WORLD_FORWARD.clone();
  }

  const u = new THREE.Vector3().crossVectors(n, v).normalize();

  if (u.lengthSq() < EPS) {
    const helper = Math.abs(n.z) < 0.9 ? WORLD_FORWARD : WORLD_RIGHT;
    v = helper.clone().projectOnPlane(n).normalize();
    u.crossVectors(n, v).normalize();
  }

  const matrix = new THREE.Matrix4().makeBasis(u, n, v);
  const quaternion = new THREE.Quaternion().setFromRotationMatrix(matrix);

  return {
    plane: new THREE.Plane().setFromNormalAndCoplanarPoint(n, o),
    origin: o,
    normal: n,
    uAxis: u,
    vAxis: v,
    quaternion,
  };
}

export function worldToPlaneXZ(pointWorld: THREE.Vector3, basis: PlaneBasis): THREE.Vector2 {
  const offset = pointWorld.clone().sub(basis.origin);
  return new THREE.Vector2(offset.dot(basis.uAxis), offset.dot(basis.vAxis));
}

export function planeXZToWorld(x: number, z: number, basis: PlaneBasis): THREE.Vector3 {
  return basis.origin
    .clone()
    .addScaledVector(basis.uAxis, x)
    .addScaledVector(basis.vAxis, z);
}

export function computeVerticalPlaneNormal(camera: THREE.Camera): THREE.Vector3 {
  const viewDir = camera.getWorldDirection(new THREE.Vector3()).normalize();
  let n = viewDir.projectOnPlane(WORLD_UP);

  if (n.lengthSq() < EPS) {
    const q = new THREE.Quaternion();
    camera.getWorldQuaternion(q);
    const right = WORLD_RIGHT.clone().applyQuaternion(q);
    n = right.projectOnPlane(WORLD_UP);
  }

  if (n.lengthSq() < EPS) n = WORLD_FORWARD.clone();
  return n.normalize();
}

export function intersectRayToPlaneOrProject(
  ray: THREE.Ray,
  plane: THREE.Plane,
  camera: THREE.Camera,
  target: THREE.Vector3 = new THREE.Vector3()
): THREE.Vector3 {
  if (ray.intersectPlane(plane, target)) return target;

  const coplanar = new THREE.Vector3();
  plane.coplanarPoint(coplanar);

  const viewNormal = camera.getWorldDirection(new THREE.Vector3()).normalize();
  const viewPlane = new THREE.Plane().setFromNormalAndCoplanarPoint(viewNormal, coplanar);

  const temp = new THREE.Vector3();
  ray.intersectPlane(viewPlane, temp);
  plane.projectPoint(temp, target);
  return target;
}

export function computePlaneBasisFromPlane(
  plane: THREE.Plane,
  options?: { preferredV?: THREE.Vector3 }
): PlaneBasis {
  const origin = new THREE.Vector3();
  plane.coplanarPoint(origin);
  return computePlaneBasis(plane.normal, origin, options);
}

function snapNumber(value: number, eps: number) {
  if (!Number.isFinite(value)) return value;
  if (Math.abs(value) < eps) return 0;
  const digits = Math.max(0, Math.ceil(-Math.log10(eps)));
  return Number(value.toFixed(Math.min(10, digits)));
}

function samePoint2(a: [number, number], b: [number, number], eps: number) {
  return Math.abs(a[0] - b[0]) <= eps && Math.abs(a[1] - b[1]) <= eps;
}

function ringSignedArea2(ringClosed: Ring2) {
  const n = ringClosed.length;
  if (n < 4) return 0;
  let a = 0;
  for (let i = 0; i < n - 1; i++) {
    const [x0, y0] = ringClosed[i];
    const [x1, y1] = ringClosed[i + 1];
    a += x0 * y1 - x1 * y0;
  }
  return a * 0.5;
}

function stripClosingPoint(ring: Ring2, eps: number) {
  if (ring.length <= 2) return ring.slice();
  const first = ring[0];
  const last = ring[ring.length - 1];
  if (samePoint2(first, last, eps)) return ring.slice(0, -1);
  return ring.slice();
}

export function normalizeRing2(
  ring: Ring2,
  options: PlanePolygonNormalizeOptions = {}
): Ring2 | null {
  const snapEps = options.snapEpsilon ?? DEFAULT_SNAP_EPS;
  const pointEps = options.pointEpsilon ?? DEFAULT_POINT_EPS;
  const areaEps = options.areaEpsilon ?? DEFAULT_AREA_EPS;

  const openIn = stripClosingPoint(ring, pointEps);
  const snapped: Ring2 = openIn
    .map(([x, y]) => [snapNumber(x, snapEps), snapNumber(y, snapEps)] as [number, number]);

  // Use the project helper's ring closing + numeric cleanup.
  const closed = ensureClosedRing(snapped);

  // Remove consecutive duplicates (including duplicates introduced by closing).
  const cleanedOpen: Ring2 = [];
  for (let i = 0; i < closed.length - 1; i++) {
    const p = closed[i]!;
    const prev = cleanedOpen[cleanedOpen.length - 1];
    if (prev && samePoint2(prev, p, pointEps)) continue;
    cleanedOpen.push(p);
  }

  if (cleanedOpen.length < 3) return null;

  // Re-close.
  const result: Ring2 = [...cleanedOpen, cleanedOpen[0]!];

  const area = Math.abs(ringSignedArea2(result));
  if (!Number.isFinite(area) || area <= areaEps) return null;

  // Ensure the closing point isn't duplicated multiple times.
  while (result.length > 4 && samePoint2(result[0]!, result[result.length - 2]!, pointEps)) {
    result.splice(result.length - 2, 1);
  }

  return result;
}

export function normalizePolygon2(poly: Polygon2, options: PlanePolygonNormalizeOptions = {}) {
  const rings = poly
    .map((r) => normalizeRing2(r, options))
    .filter((r): r is Ring2 => !!r);
  if (rings.length === 0) return [];

  rings.sort((a, b) => Math.abs(ringSignedArea2(b)) - Math.abs(ringSignedArea2(a)));
  return rings;
}

export function normalizeMultiPolygon2(
  multi: MultiPolygon2,
  options: PlanePolygonNormalizeOptions = {}
): MultiPolygon2 {
  return multi
    .map((poly) => normalizePolygon2(poly, options))
    .filter((poly) => poly.length > 0);
}

export function projectRingToPlane2D(
  ringWorld: THREE.Vector3[],
  basis: PlaneBasis,
  options: PlanePolygonNormalizeOptions = {}
): Ring2 | null {
  const snapEps = options.snapEpsilon ?? DEFAULT_SNAP_EPS;
  const ring2: Ring2 = ringWorld.map((p) => {
    const v = worldToPlaneXZ(p, basis);
    return [snapNumber(v.x, snapEps), snapNumber(v.y, snapEps)] as [number, number];
  });
  return normalizeRing2(ring2, options);
}

export function projectPolygonToPlane2D(
  polygonWorld: Polygon3,
  basis: PlaneBasis,
  options: PlanePolygonNormalizeOptions = {}
): Polygon2 {
  return polygonWorld
    .map((ring) => projectRingToPlane2D(ring, basis, options))
    .filter((ring): ring is Ring2 => !!ring);
}

export function projectMultiPolygonToPlane2D(
  multiWorld: MultiPolygon3,
  basis: PlaneBasis,
  options: PlanePolygonNormalizeOptions = {}
): MultiPolygon2 {
  return multiWorld.map((poly) => projectPolygonToPlane2D(poly, basis, options));
}

export function planeRing2DToWorld(ring: Ring2, basis: PlaneBasis): THREE.Vector3[] {
  return ring.map(([x, y]) => planeXZToWorld(x, y, basis));
}

export function planeMultiPolygon2DToWorld(multi: MultiPolygon2, basis: PlaneBasis): MultiPolygon3 {
  return multi.map((poly) => poly.map((ring) => planeRing2DToWorld(ring, basis)));
}

export function booleanMultiPolygon2D(
  op: PolygonBooleanOp,
  subject: MultiPolygon2,
  clips: MultiPolygon2[] = [],
  options: PlanePolygonNormalizeOptions = {}
): MultiPolygon2 {
  const subj = normalizeMultiPolygon2(subject, options);
  const others = clips.map((c) => normalizeMultiPolygon2(c, options)).filter((c) => c.length > 0);

  let result: unknown;
  switch (op) {
    case "union":
      result = others.length > 0 ? pc.union(subj as any, ...(others as any)) : (subj as any);
      break;
    case "difference":
      result =
        others.length > 0 ? pc.difference(subj as any, ...(others as any)) : (subj as any);
      break;
    case "intersection":
      result =
        others.length > 0 ? pc.intersection(subj as any, ...(others as any)) : (subj as any);
      break;
    case "xor":
      result = others.length > 0 ? pc.xor(subj as any, ...(others as any)) : (subj as any);
      break;
    default:
      result = subj as any;
  }

  return normalizeMultiPolygon2(((result as any) ?? []) as MultiPolygon2, options);
}

export function booleanMultiPolygonOnPlane(
  op: PolygonBooleanOp,
  basis: PlaneBasis,
  subjectWorld: MultiPolygon3,
  clipsWorld: MultiPolygon3[] = [],
  options: PlanePolygonNormalizeOptions = {}
) {
  const subject2 = projectMultiPolygonToPlane2D(subjectWorld, basis, options);
  const clips2 = clipsWorld.map((c) => projectMultiPolygonToPlane2D(c, basis, options));
  const result2 = booleanMultiPolygon2D(op, subject2, clips2, options);
  return { basis, result2D: result2, result3D: planeMultiPolygon2DToWorld(result2, basis) };
}

function signedArea2(pts: THREE.Vector2[]) {
  const n = pts.length;
  if (n < 3) return 0;
  let a = 0;
  for (let p = n - 1, q = 0; q < n; p = q++) {
    a += pts[p]!.x * pts[q]!.y - pts[q]!.x * pts[p]!.y;
  }
  return a * 0.5;
}

function ensureWinding(pts: THREE.Vector2[], clockwise: boolean) {
  const isClockwise = signedArea2(pts) < 0;
  if (isClockwise !== clockwise) pts.reverse();
  return pts;
}

function ringToVector2(ring: Ring2, pointEps: number) {
  const open = stripClosingPoint(ring, pointEps);
  return open.map(([x, y]) => new THREE.Vector2(x, -y));
}

export function multiPolygon2DToShapes(
  multi: MultiPolygon2,
  options: PlanePolygonNormalizeOptions = {}
): THREE.Shape[] {
  const pointEps = options.pointEpsilon ?? DEFAULT_POINT_EPS;
  const normalized = normalizeMultiPolygon2(multi, options);
  const shapes: THREE.Shape[] = [];

  for (const poly of normalized) {
    const [outer, ...holes] = poly;
    if (!outer || outer.length < 4) continue;

    const outerPts = ensureWinding(ringToVector2(outer, pointEps), false);
    if (outerPts.length < 3) continue;

    const shape = new THREE.Shape();
    shape.moveTo(outerPts[0]!.x, outerPts[0]!.y);
    for (let i = 1; i < outerPts.length; i++) shape.lineTo(outerPts[i]!.x, outerPts[i]!.y);
    shape.closePath();

    for (const hole of holes) {
      if (!hole || hole.length < 4) continue;
      const holePts = ensureWinding(ringToVector2(hole, pointEps), true);
      if (holePts.length < 3) continue;

      const path = new THREE.Path();
      path.moveTo(holePts[0]!.x, holePts[0]!.y);
      for (let i = 1; i < holePts.length; i++) path.lineTo(holePts[i]!.x, holePts[i]!.y);
      path.closePath();
      shape.holes.push(path);
    }

    shapes.push(shape);
  }

  return shapes;
}

export function buildPlaneGeometriesFromMultiPolygon2D(
  multi: MultiPolygon2,
  options: PlanePolygonNormalizeOptions = {}
): THREE.BufferGeometry[] {
  const shapes = multiPolygon2DToShapes(multi, options);
  const geometries: THREE.BufferGeometry[] = [];

  for (const shape of shapes) {
    const geom = new THREE.ShapeGeometry(shape);
    geom.rotateX(-Math.PI / 2);
    geom.computeBoundingBox();
    geom.computeBoundingSphere();
    geometries.push(geom);
  }

  return geometries;
}

export function buildPlaneMeshesFromMultiPolygon2D(
  multi: MultiPolygon2,
  basis: PlaneBasis,
  material: THREE.Material | THREE.Material[],
  options?: { userData?: Record<string, unknown>; renderOrder?: number }
): THREE.Mesh[] {
  const geoms = buildPlaneGeometriesFromMultiPolygon2D(multi);
  const meshes: THREE.Mesh[] = [];

  for (const g of geoms) {
    const mesh = new THREE.Mesh(g, material);
    mesh.position.copy(basis.origin);
    mesh.quaternion.copy(basis.quaternion);
    mesh.userData = { ...(options?.userData ?? {}) };
    if (typeof options?.renderOrder === "number") mesh.renderOrder = options.renderOrder;
    meshes.push(mesh);
  }

  return meshes;
}
