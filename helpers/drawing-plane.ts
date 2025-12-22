import * as THREE from "three";

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

export const WORLD_UP = new THREE.Vector3(0, 1, 0);
export const WORLD_FORWARD = new THREE.Vector3(0, 0, 1);
export const WORLD_RIGHT = new THREE.Vector3(1, 0, 0);

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
