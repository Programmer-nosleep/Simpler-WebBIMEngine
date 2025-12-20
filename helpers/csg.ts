import * as THREE from "three";
import { ADDITION, Brush, Evaluator, SUBTRACTION } from "three-bvh-csg";

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

type HollowSolidsCacheEntry = {
  outer: THREE.BufferGeometry;
  void: THREE.BufferGeometry;
  depth: number;
  wallThickness: number;
  floorThickness: number;
  extraCut: number;
};

const hollowSolidsCache = new WeakMap<THREE.Mesh, HollowSolidsCacheEntry>();

export function disposeCachedHollowSolids(mesh: THREE.Mesh) {
  const entry = hollowSolidsCache.get(mesh);
  if (!entry) return;
  try {
    entry.outer.dispose();
  } catch { }
  try {
    entry.void.dispose();
  } catch { }
  hollowSolidsCache.delete(mesh);
}

function setCachedHollowSolids(mesh: THREE.Mesh, entry: HollowSolidsCacheEntry) {
  const prev = hollowSolidsCache.get(mesh);
  if (prev) {
    try {
      prev.outer.dispose();
    } catch { }
    try {
      prev.void.dispose();
    } catch { }
  }
  hollowSolidsCache.set(mesh, entry);
}

export type HollowExtrusionMeta = {
  mesh: THREE.Mesh;
  depth: number;
  wallThickness: number;
  floorThickness: number;
  extraCut: number;
  shape?: THREE.Shape;
  solids?: { outer: THREE.BufferGeometry; void: THREE.BufferGeometry };
};

export function getExtrusionShape(mesh: THREE.Mesh): THREE.Shape | null {
  const ud: any = mesh.userData || {};
  const fromUserData = ud.extrudeShape as unknown;
  if (fromUserData && typeof (fromUserData as any).getPoints === "function") {
    return fromUserData as THREE.Shape;
  }

  const params = (mesh.geometry as any)?.parameters as any;
  const shapes = params?.shapes as unknown;
  if (!shapes) return null;

  if (Array.isArray(shapes)) {
    const first = shapes[0] as any;
    if (first && typeof first.getPoints === "function") return first as THREE.Shape;
    return null;
  }

  if (typeof (shapes as any).getPoints === "function") return shapes as THREE.Shape;
  return null;
}

export function getHollowExtrusionMeta(
  mesh: THREE.Mesh,
  defaults: HollowExtrusionOptions = {}
): HollowExtrusionMeta | null {
  const ud: any = mesh.userData || {};
  if (ud.extrudeHollow !== true) return null;

  const cached = hollowSolidsCache.get(mesh);

  const depthRaw = Number(ud.extrudeDepth ?? (mesh.geometry as any)?.parameters?.options?.depth);
  const depth = Number.isFinite(depthRaw) ? depthRaw : cached?.depth ?? NaN;
  if (!Number.isFinite(depth) || Math.abs(depth) <= 1e-4) return null;
  if (depth < 0) return null;

  const wallThicknessRaw = Number(ud.extrudeWallThickness ?? defaults.wallThickness ?? 0.15);
  const wallThickness = Number.isFinite(wallThicknessRaw) ? wallThicknessRaw : cached?.wallThickness ?? 0.15;

  const floorThicknessRaw = Number(ud.extrudeFloorThickness ?? defaults.floorThickness ?? 0.1);
  const floorThickness = Number.isFinite(floorThicknessRaw) ? floorThicknessRaw : cached?.floorThickness ?? 0.1;

  const extraCutRaw = Number(ud.extrudeExtraCut ?? defaults.extraCut ?? 0.1);
  const extraCut = Number.isFinite(extraCutRaw) ? extraCutRaw : cached?.extraCut ?? 0.1;

  const shape = getExtrusionShape(mesh);
  if (shape) {
    return { mesh, shape, depth, wallThickness, floorThickness, extraCut };
  }

  if (!cached) return null;

  const epsilon = 1e-4;
  if (Math.abs(cached.depth - depth) > epsilon) return null;
  if (Math.abs(cached.wallThickness - wallThickness) > epsilon) return null;
  if (Math.abs(cached.floorThickness - floorThickness) > epsilon) return null;
  if (Math.abs(cached.extraCut - extraCut) > epsilon) return null;

  return {
    mesh,
    depth: cached.depth,
    wallThickness: cached.wallThickness,
    floorThickness: cached.floorThickness,
    extraCut: cached.extraCut,
    solids: { outer: cached.outer, void: cached.void },
  };
}

function buildHollowExtrusionSolids(
  shape: THREE.Shape,
  depth: number,
  options: HollowExtrusionOptions = {}
) {
  const safeDepth = Math.max(DEFAULT_MIN_DEPTH, Math.abs(depth));
  const wallThickness = Math.max(DEFAULT_MIN_DEPTH, options.wallThickness ?? 0.15);
  const extraCut = Math.max(0, options.extraCut ?? 0.1);

  const requestedFloor = options.floorThickness ?? 0.1;
  const floorThickness = THREE.MathUtils.clamp(
    requestedFloor,
    DEFAULT_MIN_DEPTH,
    Math.max(DEFAULT_MIN_DEPTH, safeDepth)
  );

  const outer = new THREE.ExtrudeGeometry(shape, {
    depth: safeDepth,
    bevelEnabled: false,
  });

  const outerInfo = computeGeometryBox(outer);
  if (!outerInfo) {
    return { outer, inner: null as THREE.BufferGeometry | null, floorThickness, safeDepth };
  }

  const voidHeight = Math.max(DEFAULT_MIN_DEPTH, safeDepth - floorThickness + extraCut);
  const inner = new THREE.ExtrudeGeometry(shape, {
    depth: voidHeight,
    bevelEnabled: false,
  });

  // Center X/Y so scaling keeps void centered.
  outer.translate(-outerInfo.center.x, -outerInfo.center.y, 0);
  inner.translate(-outerInfo.center.x, -outerInfo.center.y, 0);

  const safeScale = (span: number) => {
    if (!Number.isFinite(span) || span <= DEFAULT_MIN_DEPTH) return 0.85;
    const remaining = span - wallThickness * 2;
    if (remaining <= DEFAULT_MIN_DEPTH) return 0.85;
    return THREE.MathUtils.clamp(remaining / span, 0.05, 0.98);
  };

  const scaleX = safeScale(outerInfo.size.x);
  const scaleY = safeScale(outerInfo.size.y);
  inner.scale(scaleX, scaleY, 1);

  // Keep a floor at z=0..floorThickness, and cut beyond the top so the roof is open.
  inner.translate(0, 0, floorThickness);

  // Restore translation so solids are in the original shape coordinate space.
  outer.translate(outerInfo.center.x, outerInfo.center.y, 0);
  inner.translate(outerInfo.center.x, outerInfo.center.y, 0);

  outer.computeBoundingBox();
  outer.computeBoundingSphere();
  inner.computeBoundingBox();
  inner.computeBoundingSphere();

  return { outer, inner, floorThickness, safeDepth };
}

export function mergeHollowExtrusionsToTargetLocal(
  target: THREE.Mesh,
  metas: HollowExtrusionMeta[]
): THREE.BufferGeometry | null {
  if (metas.length === 0) return null;

  target.updateWorldMatrix(true, true);
  const invTarget = new THREE.Matrix4().copy(target.matrixWorld).invert();

  const evaluator = new Evaluator();
  evaluator.useGroups = false;
  evaluator.consolidateMaterials = false;

  const outerBrushes: Brush[] = [];
  const voidBrushes: Brush[] = [];

  for (const meta of metas) {
    meta.mesh.updateWorldMatrix(true, true);

    let localOuter: THREE.BufferGeometry | null = null;
    let localVoid: THREE.BufferGeometry | null = null;

    if (meta.solids) {
      localOuter = meta.solids.outer;
      localVoid = meta.solids.void;
    } else if (meta.shape) {
      const solids = buildHollowExtrusionSolids(meta.shape, meta.depth, {
        wallThickness: meta.wallThickness,
        floorThickness: meta.floorThickness,
        extraCut: meta.extraCut,
      });
      if (!solids.inner) return null;
      localOuter = solids.outer as THREE.BufferGeometry;
      localVoid = solids.inner as THREE.BufferGeometry;

      setCachedHollowSolids(meta.mesh, {
        outer: localOuter,
        void: localVoid,
        depth: meta.depth,
        wallThickness: meta.wallThickness,
        floorThickness: meta.floorThickness,
        extraCut: meta.extraCut,
      });
    } else {
      return null;
    }

    if (!localOuter || !localVoid) return null;

    const outerGeom = localOuter.clone();
    const voidGeom = localVoid.clone();

    outerGeom.applyMatrix4(meta.mesh.matrixWorld).applyMatrix4(invTarget);
    voidGeom.applyMatrix4(meta.mesh.matrixWorld).applyMatrix4(invTarget);

    const outerBrush = new Brush(outerGeom);
    outerBrush.updateMatrixWorld(true);
    outerBrushes.push(outerBrush);

    const voidBrush = new Brush(voidGeom);
    voidBrush.updateMatrixWorld(true);
    voidBrushes.push(voidBrush);
  }

  if (outerBrushes.length === 0 || voidBrushes.length === 0) return null;

  const disposeBrush = (brush: Brush) => {
    try {
      (brush.geometry as THREE.BufferGeometry).dispose();
    } catch { }
    try {
      brush.disposeCacheData?.();
    } catch { }
  };

  let outerAcc = outerBrushes[0];
  for (let i = 1; i < outerBrushes.length; i++) {
    const next = outerBrushes[i];
    const merged = evaluator.evaluate(outerAcc, next, ADDITION);
    if (outerAcc !== outerBrushes[0]) disposeBrush(outerAcc);
    disposeBrush(next);
    outerAcc = merged;
  }

  let voidAcc = voidBrushes[0];
  for (let i = 1; i < voidBrushes.length; i++) {
    const next = voidBrushes[i];
    const merged = evaluator.evaluate(voidAcc, next, ADDITION);
    if (voidAcc !== voidBrushes[0]) disposeBrush(voidAcc);
    disposeBrush(next);
    voidAcc = merged;
  }

  const resultBrush = evaluator.evaluate(outerAcc, voidAcc, SUBTRACTION);

  const result = (resultBrush.geometry as THREE.BufferGeometry).clone();
  result.computeVertexNormals();
  result.computeBoundingBox();
  result.computeBoundingSphere();

  try {
    const outerForCache = (outerAcc.geometry as THREE.BufferGeometry).clone();
    outerForCache.computeBoundingBox();
    outerForCache.computeBoundingSphere();

    const voidForCache = (voidAcc.geometry as THREE.BufferGeometry).clone();
    voidForCache.computeBoundingBox();
    voidForCache.computeBoundingSphere();

    const ref = metas[0];
    setCachedHollowSolids(target, {
      outer: outerForCache,
      void: voidForCache,
      depth: ref.depth,
      wallThickness: ref.wallThickness,
      floorThickness: ref.floorThickness,
      extraCut: ref.extraCut,
    });
  } catch {
    // ignore cache failures
  }

  disposeBrush(resultBrush);
  if (outerAcc !== outerBrushes[0]) disposeBrush(outerAcc);
  if (voidAcc !== voidBrushes[0]) disposeBrush(voidAcc);
  if (outerBrushes.length > 0) disposeBrush(outerBrushes[0]);
  if (voidBrushes.length > 0) disposeBrush(voidBrushes[0]);

  return result;
}

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
