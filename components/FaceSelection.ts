import * as THREE from "three";
import { Line2 } from "three/addons/lines/Line2.js";
import { LineGeometry } from "three/addons/lines/LineGeometry.js";
import { LineMaterial } from "three/addons/lines/LineMaterial.js";

export type FaceSelectionOptions = {
  scene: THREE.Scene;
  faceObject: THREE.Mesh;
  objectGeometry: THREE.BufferGeometry;
  faceMaterials: THREE.MeshBasicMaterial[];
  faceBaseColor: number;
  faceHoverColor: number;
  canvas: HTMLCanvasElement;
  camera: THREE.Camera;
  getCamera?: () => THREE.Camera;
  dotSpacing?: number;
  surfaceOffset?: number;
  dotColor?: number;
  dotSize?: number;
  borderColor?: number;
  borderLineWidth?: number;
};

export function setupFaceSelection(options: FaceSelectionOptions) {
  const {
    scene,
    faceObject,
    objectGeometry,
    faceMaterials,
    faceBaseColor,
    faceHoverColor,
    canvas,
    camera,
  } = options;

  const getActiveCamera = options.getCamera ?? (() => camera);

  const DOT_SPACING = options.dotSpacing ?? 0.03;
  const SURFACE_OFFSET = options.surfaceOffset ?? 0.001;
  const dotColor = options.dotColor ?? 0x0000ff;
  const dotSize = options.dotSize ?? 2;
  const borderColor = options.borderColor ?? 0x0000ff;
  const borderLineWidth = options.borderLineWidth ?? 4;

  objectGeometry.computeBoundingBox();
  const objectBounds = objectGeometry.boundingBox;
  if (!objectBounds) throw new Error("Object bounding box tidak tersedia");
  const objectBox: THREE.Box3 = objectBounds;
  const objectSize = new THREE.Vector3();
  objectBounds.getSize(objectSize);
  const objectCenter = new THREE.Vector3();
  objectBounds.getCenter(objectCenter);

  const dotsMaterial = new THREE.PointsMaterial({
    color: dotColor,
    size: dotSize,
    sizeAttenuation: false,
    depthWrite: false,
  });
  const faceBorderMaterial = new LineMaterial({
    color: borderColor,
    linewidth: borderLineWidth,
    depthWrite: false,
  });

  function updateBorderResolution() {
    if (canvas.width <= 0 || canvas.height <= 0) return;
    faceBorderMaterial.resolution.set(canvas.width, canvas.height);
  }

  function createDotsGeometry(width: number, height: number, spacing: number) {
    const halfWidth = width / 2;
    const halfHeight = height / 2;
    const positions: number[] = [];

    const xStart = -halfWidth + spacing / 2;
    const xEnd = halfWidth - spacing / 2;
    const yStart = -halfHeight + spacing / 2;
    const yEnd = halfHeight - spacing / 2;

    for (let x = xStart; x <= xEnd; x += spacing) {
      for (let y = yStart; y <= yEnd; y += spacing) {
        positions.push(x, y, 0);
      }
    }

    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute(
      "position",
      new THREE.Float32BufferAttribute(positions, 3)
    );
    return geometry;
  }

  function createBorderGeometry(width: number, height: number) {
    const halfWidth = width / 2;
    const halfHeight = height / 2;
    const positions = [
      -halfWidth, -halfHeight, 0,
      halfWidth, -halfHeight, 0,
      halfWidth, halfHeight, 0,
      -halfWidth, halfHeight, 0,
      -halfWidth, -halfHeight, 0,
    ];

    const geometry = new LineGeometry();
    geometry.setPositions(positions);
    return geometry;
  }

  const _v0 = new THREE.Vector3();
  const _v1 = new THREE.Vector3();
  const _v2 = new THREE.Vector3();

  function isPointInTriangle(p: THREE.Vector3, a: THREE.Vector3, b: THREE.Vector3, c: THREE.Vector3) {
    _v0.subVectors(c, a);
    _v1.subVectors(b, a);
    _v2.subVectors(p, a);

    const dot00 = _v0.dot(_v0);
    const dot01 = _v0.dot(_v1);
    const dot02 = _v0.dot(_v2);
    const dot11 = _v1.dot(_v1);
    const dot12 = _v1.dot(_v2);

    const denom = dot00 * dot11 - dot01 * dot01;
    if (denom === 0) return false;
    const invDenom = 1 / denom;
    const u = (dot11 * dot02 - dot01 * dot12) * invDenom;
    const v = (dot00 * dot12 - dot01 * dot02) * invDenom;

    return (u >= 0) && (v >= 0) && (u + v < 1);
  }

  function createDotsGeometryFromMesh(mesh: THREE.Mesh, spacing: number) {
    const geometry = mesh.geometry;
    if (!geometry.boundingBox) geometry.computeBoundingBox();
    const box = geometry.boundingBox!;

    const positions: number[] = [];
    const posAttr = geometry.getAttribute("position");
    const indexAttr = geometry.getIndex();

    const vA = new THREE.Vector3();
    const vB = new THREE.Vector3();
    const vC = new THREE.Vector3();
    const p = new THREE.Vector3();

    for (let x = box.min.x; x <= box.max.x; x += spacing) {
      for (let y = box.min.y; y <= box.max.y; y += spacing) {
        p.set(x, y, 0);
        let inside = false;

        if (indexAttr) {
          for (let i = 0; i < indexAttr.count; i += 3) {
            vA.fromBufferAttribute(posAttr, indexAttr.getX(i));
            vB.fromBufferAttribute(posAttr, indexAttr.getX(i + 1));
            vC.fromBufferAttribute(posAttr, indexAttr.getX(i + 2));
            if (isPointInTriangle(p, vA, vB, vC)) {
              inside = true;
              break;
            }
          }
        } else {
          for (let i = 0; i < posAttr.count; i += 3) {
            vA.fromBufferAttribute(posAttr, i);
            vB.fromBufferAttribute(posAttr, i + 1);
            vC.fromBufferAttribute(posAttr, i + 2);
            if (isPointInTriangle(p, vA, vB, vC)) {
              inside = true;
              break;
            }
          }
        }

        if (inside) positions.push(x, y, 0);
      }
    }

    const geometryDots = new THREE.BufferGeometry();
    geometryDots.setAttribute(
      "position",
      new THREE.Float32BufferAttribute(positions, 3)
    );
    return geometryDots;
  }

  function createBorderGeometryFromMesh(mesh: THREE.Mesh) {
    const geometry = mesh.geometry;
    const edges = new THREE.EdgesGeometry(geometry);
    const lineGeo = new LineGeometry();
    lineGeo.setPositions(edges.attributes.position.array as Float32Array);
    edges.dispose();
    return lineGeo;
  }

  function getFaceInfoFromNormal(normal: THREE.Vector3) {
    const absX = Math.abs(normal.x);
    const absY = Math.abs(normal.y);
    const absZ = Math.abs(normal.z);

    const faceCenter = new THREE.Vector3();
    const faceRotation = new THREE.Euler();
    const faceNormal = new THREE.Vector3();
    let faceWidth = 0;
    let faceHeight = 0;
    let axis: "x" | "y" | "z" = "z";

    if (absX >= absY && absX >= absZ) {
      axis = "x";
      const sign = normal.x >= 0 ? 1 : -1;
      faceNormal.set(sign, 0, 0);
      faceCenter.set(
        sign > 0 ? objectBox.max.x : objectBox.min.x,
        objectCenter.y,
        objectCenter.z
      );
      faceRotation.set(0, sign > 0 ? Math.PI / 2 : -Math.PI / 2, 0);
      faceWidth = objectSize.z;
      faceHeight = objectSize.y;
    } else if (absY >= absX && absY >= absZ) {
      axis = "y";
      const sign = normal.y >= 0 ? 1 : -1;
      faceNormal.set(0, sign, 0);
      faceCenter.set(
        objectCenter.x,
        sign > 0 ? objectBox.max.y : objectBox.min.y,
        objectCenter.z
      );
      faceRotation.set(sign > 0 ? -Math.PI / 2 : Math.PI / 2, 0, 0);
      faceWidth = objectSize.x;
      faceHeight = objectSize.z;
    } else {
      axis = "z";
      const sign = normal.z >= 0 ? 1 : -1;
      faceNormal.set(0, 0, sign);
      faceCenter.set(
        objectCenter.x,
        objectCenter.y,
        sign > 0 ? objectBox.max.z : objectBox.min.z
      );
      faceRotation.set(0, sign > 0 ? 0 : Math.PI, 0);
      faceWidth = objectSize.x;
      faceHeight = objectSize.y;
    }

    return {
      axis,
      center: faceCenter,
      rotation: faceRotation,
      normal: faceNormal,
      width: faceWidth,
      height: faceHeight,
    };
  }

  const raycaster = new THREE.Raycaster();
  const pointer = new THREE.Vector2();
  let hoveredObject: THREE.Object3D | null = null;
  let hoveredFaceIndex: number | null = null;
  
  // State untuk multi-selection
  let currentSelection: { object: THREE.Object3D; normal?: THREE.Vector3 }[] = [];
  const activeOverlays = new Map<number, { group: THREE.Group; dots: THREE.Points; border: Line2 }>();

  let showSelectedBorder = false;

  function setPointerFromEvent(event: PointerEvent | MouseEvent) {
    const rect = canvas.getBoundingClientRect();
    pointer.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
    pointer.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;
  }

  function pickFace() {
    const candidates: THREE.Object3D[] = [faceObject];

    scene.traverse((obj) => {
      if (obj !== faceObject && obj.userData.selectable && (obj as any).isMesh) {
        candidates.push(obj);
      }
    });

    const intersection = raycaster.intersectObjects(candidates, false)[0];
    const materialIndex = intersection?.face?.materialIndex;
    const normal = intersection?.face?.normal;

    if (typeof materialIndex !== "number" || !normal) return null;
    return { object: intersection.object, materialIndex, normal: normal.clone() };
  }

  function setFaceColor(object: THREE.Object3D, index: number, color: number) {
    if (object === faceObject) {
      const material = faceMaterials[index];
      if (!material) return;
      material.color.set(color);
    } else if ((object as THREE.Mesh).isMesh) {
      const mesh = object as THREE.Mesh;
      if (mesh.material instanceof THREE.MeshBasicMaterial) {
        mesh.material.color.set(color);
      }
    }
  }

  function updateSelectEffect() {
    updateBorderResolution();

    for (let index = 0; index < faceMaterials.length; index++) {
      setFaceColor(faceObject, index, faceBaseColor);
    }
    scene.traverse((obj) => {
      if (obj !== faceObject && obj.userData.selectable && (obj as any).isMesh) {
        setFaceColor(obj, 0, faceBaseColor);
      }
    });

    // Highlight Hovered (hanya jika tidak sedang diseleksi)
    if (hoveredObject && hoveredFaceIndex !== null) {
      const isSelected = currentSelection.some((item) => item.object === hoveredObject);
      if (!isSelected) {
        setFaceColor(hoveredObject, hoveredFaceIndex, faceHoverColor);
      }
    }

    // Manage Overlays
    const newOverlayIds = new Set<number>();

    currentSelection.forEach((item) => {
      const obj = item.object;
      newOverlayIds.add(obj.id);

      let overlay = activeOverlays.get(obj.id);

      if (!overlay) {
        // Create new overlay
        const group = new THREE.Group();
        group.renderOrder = 2;
        
        const dots = new THREE.Points(new THREE.BufferGeometry(), dotsMaterial);
        dots.renderOrder = 2;
        group.add(dots);

        const border = new Line2(new LineGeometry(), faceBorderMaterial);
        border.renderOrder = 3;
        group.add(border);

        if ((obj as THREE.Mesh).isMesh) {
          obj.add(group);
        } else {
          scene.add(group);
        }

        overlay = { group, dots, border };
        activeOverlays.set(obj.id, overlay);

        // Generate Geometry
        updateOverlayGeometry(obj, overlay, item.normal);
      }

      // Update visibility
      overlay.group.visible = true;
      overlay.border.visible = showSelectedBorder;
    });

    // Cleanup old overlays
    for (const [id, overlay] of activeOverlays) {
      if (!newOverlayIds.has(id)) {
        overlay.group.removeFromParent();
        overlay.dots.geometry.dispose();
        overlay.border.geometry.dispose();
        activeOverlays.delete(id);
      }
    }
  }

  function updateOverlayGeometry(
    obj: THREE.Object3D,
    overlay: { dots: THREE.Points; border: Line2; group: THREE.Group },
    normal?: THREE.Vector3
  ) {
    if (obj === faceObject) {
      if (normal) {
        const faceInfo = getFaceInfoFromNormal(normal);
        
        overlay.group.position
          .copy(faceInfo.center)
          .addScaledVector(faceInfo.normal, SURFACE_OFFSET);
        overlay.group.rotation.copy(faceInfo.rotation);

        overlay.dots.geometry.dispose();
        overlay.dots.geometry = createDotsGeometry(faceInfo.width, faceInfo.height, DOT_SPACING);
        
        overlay.border.geometry.dispose();
        overlay.border.geometry = createBorderGeometry(faceInfo.width, faceInfo.height);
      } else {
        // All faces logic for Object
        overlay.group.position.set(0, 0, 0);
        overlay.group.rotation.set(0, 0, 0);

        const allDotsPositions: number[] = [];
        const normals = [
          new THREE.Vector3(1, 0, 0), new THREE.Vector3(-1, 0, 0),
          new THREE.Vector3(0, 1, 0), new THREE.Vector3(0, -1, 0),
          new THREE.Vector3(0, 0, 1), new THREE.Vector3(0, 0, -1)
        ];

        const v = new THREE.Vector3();
        normals.forEach(n => {
          const info = getFaceInfoFromNormal(n);
          const dotsGeo = createDotsGeometry(info.width, info.height, DOT_SPACING);
          const posAttr = dotsGeo.getAttribute('position');
          const offset = n.clone().multiplyScalar(SURFACE_OFFSET);
          
          for (let i = 0; i < posAttr.count; i++) {
            v.fromBufferAttribute(posAttr, i);
            v.applyEuler(info.rotation);
            v.add(info.center);
            v.add(offset);
            allDotsPositions.push(v.x, v.y, v.z);
          }
          dotsGeo.dispose();
        });

        const mergedDotsGeo = new THREE.BufferGeometry();
        mergedDotsGeo.setAttribute('position', new THREE.Float32BufferAttribute(allDotsPositions, 3));
        overlay.dots.geometry.dispose();
        overlay.dots.geometry = mergedDotsGeo;

        const edges = new THREE.EdgesGeometry(objectGeometry);
        const lineGeo = new LineGeometry();
        lineGeo.setPositions(edges.attributes.position.array as Float32Array);
        overlay.border.geometry.dispose();
        overlay.border.geometry = lineGeo;
      }
    } else {
      const mesh = obj as THREE.Mesh;
      overlay.group.position.set(0, 0, SURFACE_OFFSET);
      overlay.group.rotation.set(0, 0, 0);
      overlay.group.scale.set(1, 1, 1);

      overlay.dots.geometry.dispose();
      overlay.dots.geometry = createDotsGeometryFromMesh(mesh, DOT_SPACING);

      overlay.border.geometry.dispose();
      overlay.border.geometry = createBorderGeometryFromMesh(mesh);
    }
  }

  const onPointerMove = (event: PointerEvent) => {
    setPointerFromEvent(event);
    raycaster.setFromCamera(pointer, getActiveCamera());

    const hit = pickFace();
    hoveredObject = hit?.object ?? null;
    hoveredFaceIndex = hit?.materialIndex ?? null;
    canvas.style.cursor = hoveredObject ? "pointer" : "";
    updateSelectEffect();
  };

  const onPointerLeave = () => {
    hoveredObject = null;
    hoveredFaceIndex = null;
    canvas.style.cursor = "";
    updateSelectEffect();
  };

  const onResize = () => {
    requestAnimationFrame(updateSelectEffect);
  };

  window.addEventListener("resize", onResize);
  canvas.addEventListener("pointermove", onPointerMove);
  canvas.addEventListener("pointerleave", onPointerLeave);

  const setSelectionByNormal = (normal: THREE.Vector3 | null, border = true) => {
    if (normal) {
      currentSelection = [{ object: faceObject, normal: normal.clone() }];
    } else {
      currentSelection = [];
    }
    showSelectedBorder = border && !!normal;
    hoveredObject = null;
    hoveredFaceIndex = null;
    updateSelectEffect();
  };

  const setSelectedObjects = (items: { object: THREE.Object3D; normal?: THREE.Vector3 }[]) => {
    currentSelection = items.map(item => ({
      object: item.object,
      normal: item.normal ? item.normal.clone() : undefined
    }));
    showSelectedBorder = true; // Default show border for object selection
    updateSelectEffect();
  };

  updateSelectEffect();
  requestAnimationFrame(updateSelectEffect);

  return {
    updateSelectEffect,
    setSelectionByNormal,
    setSelectedObjects,
    dispose() {
      window.removeEventListener("resize", onResize);
      canvas.removeEventListener("pointermove", onPointerMove);
      canvas.removeEventListener("pointerleave", onPointerLeave);
      
      activeOverlays.forEach(overlay => {
        overlay.group.removeFromParent();
        overlay.dots.geometry.dispose();
        overlay.border.geometry.dispose();
      });
      activeOverlays.clear();
      dotsMaterial.dispose();
      faceBorderMaterial.dispose();
    },
  };
}
