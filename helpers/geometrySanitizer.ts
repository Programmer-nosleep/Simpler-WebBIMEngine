import * as THREE from "three";

export function sanitizeIndexedGeometryInPlace(
  geometry: THREE.BufferGeometry,
  options: { positionEpsilon?: number } = {},
): void {
  const pos = geometry.getAttribute("position") as THREE.BufferAttribute | undefined;
  if (!pos) return;

  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i);
    const y = pos.getY(i);
    const z = pos.getZ(i);
    if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(z)) {
      pos.setXYZ(i, 0, 0, 0);
    }
  }
  pos.needsUpdate = true;

  const index = geometry.getIndex();
  if (!index) return;

  const eps = Math.max(1e-12, options.positionEpsilon ?? 1e-5);
  const areaEpsSq = eps * eps;

  const a = new THREE.Vector3();
  const b = new THREE.Vector3();
  const c = new THREE.Vector3();
  const ab = new THREE.Vector3();
  const ac = new THREE.Vector3();

  const next: number[] = [];
  for (let t = 0; t < index.count; t += 3) {
    const i0 = index.getX(t);
    const i1 = index.getX(t + 1);
    const i2 = index.getX(t + 2);
    if (i0 === i1 || i1 === i2 || i2 === i0) continue;

    a.set(pos.getX(i0), pos.getY(i0), pos.getZ(i0));
    b.set(pos.getX(i1), pos.getY(i1), pos.getZ(i1));
    c.set(pos.getX(i2), pos.getY(i2), pos.getZ(i2));

    ab.subVectors(b, a);
    ac.subVectors(c, a);
    const area2Sq = ab.cross(ac).lengthSq();
    if (area2Sq <= areaEpsSq) continue;

    next.push(i0, i1, i2);
  }

  geometry.setIndex(next);
}

export function flattenCoplanarNormalsInPlace(
  geometry: THREE.BufferGeometry,
  _options: { positionEpsilon?: number; maxAngleDeg?: number } = {},
): void {
  // Conservative no-op: recompute normals after any index cleanup.
  // This keeps behavior predictable while still improving results after CSG.
  geometry.computeVertexNormals();
}

