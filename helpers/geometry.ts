import * as THREE from "three";
import { mergeVertices } from "three/examples/jsm/utils/BufferGeometryUtils.js";

export function createWeldedEdgesGeometry(
  geometry: THREE.BufferGeometry,
  thresholdAngle = 25,
  mergeTol = 1e-4,
): THREE.EdgesGeometry {
  const pos = geometry.getAttribute("position") as THREE.BufferAttribute | undefined;
  if (!pos) return new THREE.EdgesGeometry(geometry, thresholdAngle);

  const temp = new THREE.BufferGeometry();
  temp.setAttribute("position", pos);
  if (geometry.index) temp.setIndex(geometry.index);

  const welded = mergeVertices(temp, mergeTol);
  temp.dispose();

  const edges = new THREE.EdgesGeometry(welded, thresholdAngle);
  welded.dispose();
  return edges;
}

export function findSelectableRoot(obj: THREE.Object3D | null): THREE.Object3D | null {
  const start = obj;
  let current: THREE.Object3D | null = obj;
  while (current) {
    const ud: any = (current as any).userData || {};
    if (ud?.isHelper) return null;
    if (ud?.selectable === true) return current;
    current = current.parent;
  }

  // Fallback: allow direct mesh selection unless explicitly disabled.
  if (start) {
    const ud: any = (start as any).userData || {};
    if (!ud?.isHelper && ud?.selectable !== false && (start as any).isMesh) return start;
  }

  return null;
}
