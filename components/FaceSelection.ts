import * as THREE from "three";
import { Line2 } from "three/addons/lines/Line2.js";
import { LineGeometry } from "three/addons/lines/LineGeometry.js";
import { LineMaterial } from "three/addons/lines/LineMaterial.js";

export type FaceSelectionOptions = {
  scene: THREE.Scene;
  cube: THREE.Mesh;
  cubeGeometry: THREE.BufferGeometry;
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
    cube,
    cubeGeometry,
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

  cubeGeometry.computeBoundingBox();
  const cubeBounds = cubeGeometry.boundingBox;
  if (!cubeBounds) throw new Error("Cube bounding box tidak tersedia");
  const cubeBox: THREE.Box3 = cubeBounds;
  const cubeSize = new THREE.Vector3();
  cubeBounds.getSize(cubeSize);
  const cubeCenter = new THREE.Vector3();
  cubeBounds.getCenter(cubeCenter);

  const selectedFaceOverlay = new THREE.Group();
  selectedFaceOverlay.visible = false;
  scene.add(selectedFaceOverlay);

  const dotsMaterial = new THREE.PointsMaterial({
    color: dotColor,
    size: dotSize,
    sizeAttenuation: false,
    depthWrite: false,
  });
  const dots = new THREE.Points(new THREE.BufferGeometry(), dotsMaterial);
  dots.renderOrder = 2;
  selectedFaceOverlay.add(dots);

  const faceBorderMaterial = new LineMaterial({
    color: borderColor,
    linewidth: borderLineWidth,
    depthWrite: false,
  });
  const faceBorder = new Line2(new LineGeometry(), faceBorderMaterial);
  faceBorder.visible = false;
  faceBorder.renderOrder = 3;
  selectedFaceOverlay.add(faceBorder);

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
        sign > 0 ? cubeBox.max.x : cubeBox.min.x,
        cubeCenter.y,
        cubeCenter.z
      );
      faceRotation.set(0, sign > 0 ? Math.PI / 2 : -Math.PI / 2, 0);
      faceWidth = cubeSize.z;
      faceHeight = cubeSize.y;
    } else if (absY >= absX && absY >= absZ) {
      axis = "y";
      const sign = normal.y >= 0 ? 1 : -1;
      faceNormal.set(0, sign, 0);
      faceCenter.set(
        cubeCenter.x,
        sign > 0 ? cubeBox.max.y : cubeBox.min.y,
        cubeCenter.z
      );
      faceRotation.set(sign > 0 ? -Math.PI / 2 : Math.PI / 2, 0, 0);
      faceWidth = cubeSize.x;
      faceHeight = cubeSize.z;
    } else {
      axis = "z";
      const sign = normal.z >= 0 ? 1 : -1;
      faceNormal.set(0, 0, sign);
      faceCenter.set(
        cubeCenter.x,
        cubeCenter.y,
        sign > 0 ? cubeBox.max.z : cubeBox.min.z
      );
      faceRotation.set(0, sign > 0 ? 0 : Math.PI, 0);
      faceWidth = cubeSize.x;
      faceHeight = cubeSize.y;
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
  let selectedObject: THREE.Object3D | null = null;
  let selectedFaceIndex: number | null = null;
  let selectedFaceNormal: THREE.Vector3 | null = null;
  let showSelectedBorder = false;
  let overlayAxis: string | null = null;

  function setPointerFromEvent(event: PointerEvent | MouseEvent) {
    const rect = canvas.getBoundingClientRect();
    pointer.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
    pointer.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;
  }

  function pickFace() {
    const candidates: THREE.Object3D[] = [cube];
    scene.traverse((obj) => {
      if (obj !== cube && obj.userData.selectable && (obj as any).isMesh) {
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
    if (object === cube) {
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
      setFaceColor(cube, index, faceBaseColor);
    }
    scene.traverse((obj) => {
      if (obj !== cube && obj.userData.selectable && (obj as any).isMesh) {
        setFaceColor(obj, 0, faceBaseColor);
      }
    });

    if (hoveredObject && hoveredFaceIndex !== null) {
      if (hoveredObject !== selectedObject) {
        setFaceColor(hoveredObject, hoveredFaceIndex, faceHoverColor);
      }
    }

    if (!selectedObject || !selectedFaceNormal) {
      selectedFaceOverlay.visible = false;
      overlayAxis = null;
      return;
    }

    selectedFaceOverlay.visible = true;

    if (selectedObject === cube) {
      if (selectedFaceOverlay.parent !== cube) cube.add(selectedFaceOverlay);
      const faceInfo = getFaceInfoFromNormal(selectedFaceNormal);
      selectedFaceOverlay.position
        .copy(faceInfo.center)
        .addScaledVector(faceInfo.normal, SURFACE_OFFSET);
      selectedFaceOverlay.rotation.copy(faceInfo.rotation);

      if (overlayAxis !== faceInfo.axis) {
        overlayAxis = faceInfo.axis;
        dots.geometry.dispose();
        dots.geometry = createDotsGeometry(faceInfo.width, faceInfo.height, DOT_SPACING);
        faceBorder.geometry.dispose();
        faceBorder.geometry = createBorderGeometry(faceInfo.width, faceInfo.height);
      }
    } else {
      const mesh = selectedObject as THREE.Mesh;
      if (selectedFaceOverlay.parent !== mesh) mesh.add(selectedFaceOverlay);

      if (!mesh.geometry.boundingBox) mesh.geometry.computeBoundingBox();
      const box = mesh.geometry.boundingBox!;
      const width = box.max.x - box.min.x;
      const height = box.max.y - box.min.y;
      const center = new THREE.Vector3();
      box.getCenter(center);

      selectedFaceOverlay.position.copy(center);
      selectedFaceOverlay.position.z += SURFACE_OFFSET;
      selectedFaceOverlay.rotation.set(0, 0, 0);

      const key = `mesh_${mesh.id}`;
      if (overlayAxis !== key) {
        overlayAxis = key;
        dots.geometry.dispose();
        dots.geometry = createDotsGeometry(width, height, DOT_SPACING);
        faceBorder.geometry.dispose();
        faceBorder.geometry = createBorderGeometry(width, height);
      }
    }

    faceBorder.visible = showSelectedBorder;
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

  const onClick = (event: MouseEvent) => {
    setPointerFromEvent(event);
    raycaster.setFromCamera(pointer, getActiveCamera());

    const hit = pickFace();
    hoveredObject = hit?.object ?? null;
    hoveredFaceIndex = hit?.materialIndex ?? null;
    selectedObject = hit?.object ?? null;
    selectedFaceIndex = hit?.materialIndex ?? null;
    selectedFaceNormal = hit?.normal ?? null;
    showSelectedBorder = false;
    updateSelectEffect();
  };

  const onDoubleClick = (event: MouseEvent) => {
    setPointerFromEvent(event);
    raycaster.setFromCamera(pointer, getActiveCamera());

    const hit = pickFace();
    if (!hit) return;
    hoveredObject = hit.object;
    hoveredFaceIndex = hit.materialIndex;
    selectedObject = hit.object;
    selectedFaceIndex = hit.materialIndex;
    selectedFaceNormal = hit.normal;
    showSelectedBorder = true;
    updateSelectEffect();
  };

  const onResize = () => {
    requestAnimationFrame(updateSelectEffect);
  };

  window.addEventListener("resize", onResize);
  canvas.addEventListener("pointermove", onPointerMove);
  canvas.addEventListener("pointerleave", onPointerLeave);
  canvas.addEventListener("click", onClick);
  canvas.addEventListener("dblclick", onDoubleClick);

  const setSelectionByNormal = (normal: THREE.Vector3 | null, border = true) => {
    selectedObject = normal ? cube : null;
    selectedFaceIndex = null;
    selectedFaceNormal = normal ? normal.clone() : null;
    showSelectedBorder = border && !!normal;
    hoveredObject = null;
    hoveredFaceIndex = null;
    updateSelectEffect();
  };

  updateSelectEffect();
  requestAnimationFrame(updateSelectEffect);

  return {
    updateSelectEffect,
    setSelectionByNormal,
    dispose() {
      window.removeEventListener("resize", onResize);
      canvas.removeEventListener("pointermove", onPointerMove);
      canvas.removeEventListener("pointerleave", onPointerLeave);
      canvas.removeEventListener("click", onClick);
      canvas.removeEventListener("dblclick", onDoubleClick);
      selectedFaceOverlay.removeFromParent();
      dots.geometry.dispose();
      faceBorder.geometry.dispose();
      dotsMaterial.dispose();
      faceBorderMaterial.dispose();
    },
  };
}
