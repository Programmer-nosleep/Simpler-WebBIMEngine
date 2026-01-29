import * as THREE from "three";
import { mergeVertices } from "three/examples/jsm/utils/BufferGeometryUtils.js";

export function stripCapAtPlane(
  geometry: THREE.BufferGeometry,
  plane: THREE.Plane,
  eps = 1e-3,
  mergeTol = 1e-4,
): THREE.BufferGeometry {
  const working = geometry.index ? geometry.toNonIndexed() : geometry;
  const pos = working.getAttribute("position") as THREE.BufferAttribute | undefined;
  if (!pos || pos.count < 3) {
    if (working !== geometry) working.dispose();
    return geometry;
  }

  const uv = working.getAttribute("uv") as THREE.BufferAttribute | undefined;

  const positions: number[] = [];
  const uvs: number[] = [];

  const v0 = new THREE.Vector3();
  const v1 = new THREE.Vector3();
  const v2 = new THREE.Vector3();
  const e1 = new THREE.Vector3();
  const e2 = new THREE.Vector3();

  for (let i = 0; i < pos.count; i += 3) {
    v0.set(pos.getX(i), pos.getY(i), pos.getZ(i));
    v1.set(pos.getX(i + 1), pos.getY(i + 1), pos.getZ(i + 1));
    v2.set(pos.getX(i + 2), pos.getY(i + 2), pos.getZ(i + 2));

    const isCoplanar =
      Math.abs(plane.distanceToPoint(v0)) <= eps &&
      Math.abs(plane.distanceToPoint(v1)) <= eps &&
      Math.abs(plane.distanceToPoint(v2)) <= eps;
    if (isCoplanar) continue;

    // skip degenerate tris
    e1.subVectors(v1, v0);
    e2.subVectors(v2, v0);
    const area2 = e1.cross(e2).lengthSq();
    if (area2 < 1e-12) continue;

    positions.push(v0.x, v0.y, v0.z, v1.x, v1.y, v1.z, v2.x, v2.y, v2.z);

    if (uv) {
      uvs.push(
        uv.getX(i),
        uv.getY(i),
        uv.getX(i + 1),
        uv.getY(i + 1),
        uv.getX(i + 2),
        uv.getY(i + 2),
      );
    }
  }

  if (working !== geometry) working.dispose();
  if (positions.length === 0) return geometry;

  const stripped = new THREE.BufferGeometry();
  stripped.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
  if (uvs.length > 0) stripped.setAttribute("uv", new THREE.Float32BufferAttribute(uvs, 2));

  let welded = mergeVertices(stripped, mergeTol);
  if (welded !== stripped) stripped.dispose();
  welded.computeVertexNormals();
  welded.computeBoundingBox();
  welded.computeBoundingSphere();
  return welded;
}

