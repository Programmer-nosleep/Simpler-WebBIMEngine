import * as THREE from "three";

export type FaceTriangle = [THREE.Vector3, THREE.Vector3, THREE.Vector3];

export type FaceRegion = {
  triangles: FaceTriangle[];
};

type FaceRegionOptions = {
  normalThreshold?: number;
  positionEpsilon?: number;
  maxTriangles?: number;
};

const DEFAULT_NORMAL_THRESHOLD = 0.999;
const DEFAULT_POSITION_EPSILON = 1e-5;
const DEFAULT_MAX_TRIANGLES = 10_000;

function computeTriangleNormal(
  position: THREE.BufferAttribute,
  i0: number,
  i1: number,
  i2: number
) {
  const a = new THREE.Vector3(position.getX(i0), position.getY(i0), position.getZ(i0));
  const b = new THREE.Vector3(position.getX(i1), position.getY(i1), position.getZ(i1));
  const c = new THREE.Vector3(position.getX(i2), position.getY(i2), position.getZ(i2));

  const normal = new THREE.Vector3()
    .subVectors(b, a)
    .cross(new THREE.Vector3().subVectors(c, a));
  if (normal.lengthSq() < 1e-12) return null;
  return normal.normalize();
}

export function getCoplanarFaceRegionLocalToRoot(
  intersection: THREE.Intersection,
  root: THREE.Object3D,
  options: FaceRegionOptions = {}
): FaceRegion | null {
  if (typeof intersection.faceIndex !== "number") return null;
  if (!(intersection.object as any)?.isMesh) return null;

  const mesh = intersection.object as THREE.Mesh;
  const geometry = mesh.geometry as THREE.BufferGeometry | undefined;
  if (!geometry) return null;

  const position = geometry.getAttribute("position") as THREE.BufferAttribute | undefined;
  if (!position) return null;

  const index = geometry.getIndex();
  const triCount = index ? index.count / 3 : position.count / 3;
  if (!Number.isFinite(triCount) || triCount <= 0) return null;

  const seedTri = intersection.faceIndex;
  if (seedTri < 0 || seedTri >= triCount) return null;

  const getTriVertIndex = (tri: number, corner: 0 | 1 | 2) =>
    index ? index.getX(tri * 3 + corner) : tri * 3 + corner;

  const seedNormal = computeTriangleNormal(
    position,
    getTriVertIndex(seedTri, 0),
    getTriVertIndex(seedTri, 1),
    getTriVertIndex(seedTri, 2)
  );
  if (!seedNormal) return null;

  const normalThreshold = options.normalThreshold ?? DEFAULT_NORMAL_THRESHOLD;
  const maxTriangles = options.maxTriangles ?? DEFAULT_MAX_TRIANGLES;

  let vertexIds: Int32Array | null = null;
  if (!index) {
    const eps = options.positionEpsilon ?? DEFAULT_POSITION_EPSILON;
    const ids = new Int32Array(position.count);
    const map = new Map<string, number>();
    let nextId = 0;
    for (let i = 0; i < position.count; i++) {
      const key = `${Math.round(position.getX(i) / eps)},${Math.round(
        position.getY(i) / eps
      )},${Math.round(position.getZ(i) / eps)}`;
      let id = map.get(key);
      if (id === undefined) {
        id = nextId++;
        map.set(key, id);
      }
      ids[i] = id;
    }
    vertexIds = ids;
  }

  const getVertexId = (vertexIndex: number) =>
    index ? vertexIndex : (vertexIds ? vertexIds[vertexIndex] : vertexIndex);

  const edgeMap = new Map<string, number[]>();
  const addEdge = (a: number, b: number, tri: number) => {
    const min = a < b ? a : b;
    const max = a < b ? b : a;
    const key = `${min},${max}`;
    const list = edgeMap.get(key);
    if (list) list.push(tri);
    else edgeMap.set(key, [tri]);
  };

  for (let tri = 0; tri < triCount; tri++) {
    const v0 = getVertexId(getTriVertIndex(tri, 0));
    const v1 = getVertexId(getTriVertIndex(tri, 1));
    const v2 = getVertexId(getTriVertIndex(tri, 2));
    addEdge(v0, v1, tri);
    addEdge(v1, v2, tri);
    addEdge(v2, v0, tri);
  }

  const visited = new Uint8Array(triCount);
  const stack: number[] = [seedTri];
  visited[seedTri] = 1;

  const regionTris: number[] = [];
  while (stack.length > 0) {
    const tri = stack.pop()!;
    regionTris.push(tri);
    if (regionTris.length >= maxTriangles) break;

    const a = getVertexId(getTriVertIndex(tri, 0));
    const b = getVertexId(getTriVertIndex(tri, 1));
    const c = getVertexId(getTriVertIndex(tri, 2));
    const edges: [number, number][] = [
      [a, b],
      [b, c],
      [c, a],
    ];

    for (const [e0, e1] of edges) {
      const min = e0 < e1 ? e0 : e1;
      const max = e0 < e1 ? e1 : e0;
      const key = `${min},${max}`;
      const neighbors = edgeMap.get(key);
      if (!neighbors) continue;

      for (const neighbor of neighbors) {
        if (neighbor === tri) continue;
        if (visited[neighbor]) continue;

        const normal = computeTriangleNormal(
          position,
          getTriVertIndex(neighbor, 0),
          getTriVertIndex(neighbor, 1),
          getTriVertIndex(neighbor, 2)
        );
        if (!normal) continue;

        if (Math.abs(normal.dot(seedNormal)) < normalThreshold) continue;

        visited[neighbor] = 1;
        stack.push(neighbor);
      }
    }
  }

  root.updateWorldMatrix(true, true);
  mesh.updateWorldMatrix(true, false);
  const invRoot = new THREE.Matrix4().copy(root.matrixWorld).invert();

  const triangles: FaceTriangle[] = [];
  for (const tri of regionTris) {
    const i0 = getTriVertIndex(tri, 0);
    const i1 = getTriVertIndex(tri, 1);
    const i2 = getTriVertIndex(tri, 2);

    const v0 = new THREE.Vector3(position.getX(i0), position.getY(i0), position.getZ(i0))
      .applyMatrix4(mesh.matrixWorld)
      .applyMatrix4(invRoot);
    const v1 = new THREE.Vector3(position.getX(i1), position.getY(i1), position.getZ(i1))
      .applyMatrix4(mesh.matrixWorld)
      .applyMatrix4(invRoot);
    const v2 = new THREE.Vector3(position.getX(i2), position.getY(i2), position.getZ(i2))
      .applyMatrix4(mesh.matrixWorld)
      .applyMatrix4(invRoot);

    const triNormal = computeTriangleNormal(position, i0, i1, i2);
    if (triNormal && triNormal.dot(seedNormal) < 0) {
      triangles.push([v0, v2, v1]);
    } else {
      triangles.push([v0, v1, v2]);
    }
  }

  if (triangles.length === 0) return null;
  return { triangles };
}

