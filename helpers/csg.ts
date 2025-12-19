import * as THREE from "three";
import { Brush, Evaluator, SUBTRACTION } from "three-bvh-csg";

export type HollowExtrusionOptions = {
  wallThickness?: number;
  floorThickness?: number;
  extraCut?: number;
};

export type BuildExtrusionOptions = HollowExtrusionOptions & {
  hollow?: boolean;
  minDepth?: number;
};

const DEFAULT_MIN_DEPTH = 1e-4;

const computeGeometryBox = (geometry: THREE.BufferGeometry) => {
  geometry.computeBoundingBox();
  const box = geometry.boundingBox;
  if (!box) return null;
  const size = new THREE.Vector3();
  const center = new THREE.Vector3();
  box.getSize(size);
  box.getCenter(center);
  return { box, size, center };
};

export function buildHollowExtrusionGeometry(
  shape: THREE.Shape,
  depth: number,
  options: HollowExtrusionOptions = {}
): THREE.BufferGeometry {
  const safeDepth = Math.max(DEFAULT_MIN_DEPTH, Math.abs(depth));
  const wallThickness = Math.max(DEFAULT_MIN_DEPTH, options.wallThickness ?? 0.15);
  const extraCut = Math.max(0, options.extraCut ?? 0.1);

  const requestedFloor = options.floorThickness ?? 0.1;
  const floorThickness = THREE.MathUtils.clamp(
    requestedFloor,
    DEFAULT_MIN_DEPTH,
    Math.max(DEFAULT_MIN_DEPTH, safeDepth)
  );

  const baseGeometry = new THREE.ExtrudeGeometry(shape, {
    depth: safeDepth,
    bevelEnabled: false,
  });

  const baseInfo = computeGeometryBox(baseGeometry);
  if (!baseInfo) return baseGeometry;

  // Center X/Y so scaling keeps void centered, but restore at the end.
  baseGeometry.translate(-baseInfo.center.x, -baseInfo.center.y, 0);

  const voidHeight = Math.max(DEFAULT_MIN_DEPTH, safeDepth - floorThickness + extraCut);
  const voidGeometry = new THREE.ExtrudeGeometry(shape, {
    depth: voidHeight,
    bevelEnabled: false,
  });
  voidGeometry.translate(-baseInfo.center.x, -baseInfo.center.y, 0);

  const safeScale = (span: number) => {
    if (!Number.isFinite(span) || span <= DEFAULT_MIN_DEPTH) return 0.85;
    const remaining = span - wallThickness * 2;
    if (remaining <= DEFAULT_MIN_DEPTH) return 0.85;
    return THREE.MathUtils.clamp(remaining / span, 0.05, 0.98);
  };

  const scaleX = safeScale(baseInfo.size.x);
  const scaleY = safeScale(baseInfo.size.y);
  voidGeometry.scale(scaleX, scaleY, 1);

  // Keep a floor at z=0..floorThickness, and cut beyond the top so the roof is open.
  voidGeometry.translate(0, 0, floorThickness);

  const baseBrush = new Brush(baseGeometry);
  const voidBrush = new Brush(voidGeometry);
  baseBrush.updateMatrixWorld();
  voidBrush.updateMatrixWorld();

  const evaluator = new Evaluator();
  evaluator.useGroups = false;
  const resultBrush = evaluator.evaluate(baseBrush, voidBrush, SUBTRACTION);

  const result = (resultBrush.geometry as THREE.BufferGeometry).clone();
  result.translate(baseInfo.center.x, baseInfo.center.y, 0);
  result.computeVertexNormals();
  result.computeBoundingBox();
  result.computeBoundingSphere();

  baseGeometry.dispose();
  voidGeometry.dispose();
  (resultBrush.geometry as THREE.BufferGeometry).dispose?.();

  return result;
}

export function buildExtrusionGeometry(
  shape: THREE.Shape,
  depthSigned: number,
  options: BuildExtrusionOptions = {}
): THREE.BufferGeometry {
  const minDepth = Math.max(DEFAULT_MIN_DEPTH, options.minDepth ?? DEFAULT_MIN_DEPTH);
  const depthAbs = Math.abs(depthSigned);

  // Treat "near zero" as a flat face again.
  if (!Number.isFinite(depthAbs) || depthAbs <= minDepth) {
    const geom = new THREE.ShapeGeometry(shape);
    geom.computeBoundingBox();
    geom.computeBoundingSphere();
    return geom;
  }

  const depth = Math.max(minDepth, depthAbs);

  let geometry: THREE.BufferGeometry;
  if (options.hollow && depthSigned >= 0) {
    geometry = buildHollowExtrusionGeometry(shape, depth, options);
  } else {
    geometry = new THREE.ExtrudeGeometry(shape, {
      depth,
      bevelEnabled: false,
    });
  }

  if (depthSigned < 0) {
    geometry.translate(0, 0, -depth);
  }

  geometry.computeVertexNormals();
  geometry.computeBoundingBox();
  geometry.computeBoundingSphere();
  return geometry;
}
