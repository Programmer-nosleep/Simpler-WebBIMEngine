import './style.css'
import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";

// initialize the scene
const scene = new THREE.Scene();

// add objects to the scene
const cubeGeometry = new THREE.BoxGeometry(1, 1, 1);
const faceBaseColor = 0xCCCCCC;
const faceHoverColor = 0xE6E6E6;
const faceMaterials = Array.from(
  { length: 6 },
  () => new THREE.MeshBasicMaterial({ color: faceBaseColor })
);
const cube = new THREE.Mesh(cubeGeometry, faceMaterials);
scene.add(cube);

cubeGeometry.computeBoundingBox();
const cubeBounds = cubeGeometry.boundingBox;
if (!cubeBounds) throw new Error("Cube bounding box tidak tersedia");
const cubeBox: THREE.Box3 = cubeBounds;
const cubeSize = new THREE.Vector3();
cubeBounds.getSize(cubeSize);
const cubeCenter = new THREE.Vector3();
cubeBounds.getCenter(cubeCenter);

const DOT_SPACING = 0.03;
const SURFACE_OFFSET = 0.001;

const selectedFaceOverlay = new THREE.Group();
selectedFaceOverlay.visible = false;
cube.add(selectedFaceOverlay);

const dotsMaterial = new THREE.PointsMaterial({
  color: 0x0000FF,
  size: 2,
  sizeAttenuation: false,
  depthWrite: false,
});
const dots = new THREE.Points(new THREE.BufferGeometry(), dotsMaterial);
dots.renderOrder = 2;
selectedFaceOverlay.add(dots);

const faceBorderMaterial = new THREE.LineBasicMaterial({
  color: 0x0000FF,
  depthWrite: false,
});
const faceBorder = new THREE.LineSegments(new THREE.BufferGeometry(), faceBorderMaterial);
faceBorder.visible = false;
faceBorder.renderOrder = 3;
selectedFaceOverlay.add(faceBorder);

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
  geometry.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
  return geometry;
}

function createBorderGeometry(width: number, height: number) {
  const halfWidth = width / 2;
  const halfHeight = height / 2;
  const positions = [
    -halfWidth, -halfHeight, 0, halfWidth, -halfHeight, 0,
    halfWidth, -halfHeight, 0, halfWidth, halfHeight, 0,
    halfWidth, halfHeight, 0, -halfWidth, halfHeight, 0,
    -halfWidth, halfHeight, 0, -halfWidth, -halfHeight, 0,
  ];

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
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

//
const edge = new THREE.EdgesGeometry(cubeGeometry);
const outlineMaterial = new THREE.LineBasicMaterial({ color: 0x000000 });
const outline = new THREE.LineSegments(edge, outlineMaterial);
outline.scale.setScalar(1.0);
// outline.visible = false;
cube.add(outline);

// initialize the camera perspective
const camera = new THREE.PerspectiveCamera(
  75, 
  window.innerWidth / window.innerHeight, 
  0.1,
  30
);

// initialize thre camera orthograph
// const aspectRatio = window.innerWidth / window.innerHeight;
// const camera = new THREE.OrthographicCamera(
//   -1 * aspectRatio, 
//   1 * aspectRatio, 
//   1 * aspectRatio, 
//   -1 * aspectRatio, 
//   0.1, 
//   200
// );

camera.position.z = 5;

const canvas = document.querySelector("#threejs") as HTMLCanvasElement;
if (!canvas) throw new Error("Canvas element #threejs tidak ditemukan");

const renderer = new THREE.WebGLRenderer({
  canvas: canvas,
});

// instantiate the controls
const controls = new OrbitControls(camera, renderer.domElement);

// const loop = () => {
//   console.log("loop")
//   loop()
// }
// loop()

controls.enableDamping = true;
// controls.autoRotate = true;
// controls.autoRotateSpeed = 10.0;

const raycaster = new THREE.Raycaster();
const pointer = new THREE.Vector2();
let hoveredFace: number | null = null;
let selectedFace: number | null = null;
let selectedFaceNormal: THREE.Vector3 | null = null;
let showSelectedBorder = false;
let overlayAxis: "x" | "y" | "z" | null = null;

// 
function setPointerFromEvent(event: PointerEvent | MouseEvent) {
  const rect = canvas.getBoundingClientRect();
  pointer.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
  pointer.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;
}

function pickFace() {
  const intersection = raycaster.intersectObject(cube, false)[0];
  const materialIndex = intersection?.face?.materialIndex;
  const normal = intersection?.face?.normal;

  if (typeof materialIndex !== "number" || !normal) return null;
  return { materialIndex, normal: normal.clone() };
}

function setFaceColor(index: number, color: number) {
  const material = faceMaterials[index];
  if (!material) return;
  material.color.set(color);
}

// 
function updateSelectEffect() {
  for (let index = 0; index < faceMaterials.length; index++) {
    setFaceColor(index, faceBaseColor);
  }

  if (hoveredFace !== null && hoveredFace !== selectedFace) {
    setFaceColor(hoveredFace, faceHoverColor);
  }

  if (!selectedFaceNormal) {
    selectedFaceOverlay.visible = false;
    overlayAxis = null;
    return;
  }

  const faceInfo = getFaceInfoFromNormal(selectedFaceNormal);
  selectedFaceOverlay.visible = true;
  selectedFaceOverlay.position.copy(faceInfo.center).addScaledVector(faceInfo.normal, SURFACE_OFFSET);
  selectedFaceOverlay.rotation.copy(faceInfo.rotation);

  if (overlayAxis !== faceInfo.axis) {
    overlayAxis = faceInfo.axis;
    dots.geometry.dispose();
    dots.geometry = createDotsGeometry(faceInfo.width, faceInfo.height, DOT_SPACING);
    faceBorder.geometry.dispose();
    faceBorder.geometry = createBorderGeometry(faceInfo.width, faceInfo.height);
  }

  faceBorder.visible = showSelectedBorder;
}

function resize() {
  const width = window.innerWidth;
  const height = window.innerHeight;
  const aspect = width / height;

  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));

  if (camera instanceof THREE.PerspectiveCamera) {
    camera.aspect = aspect;
    camera.updateProjectionMatrix();
  }

  if (camera instanceof THREE.OrthographicCamera) { 
      camera.left = -1 * aspect;
      camera.right = 1 * aspect;
      camera.top = 1 * aspect;
      camera.bottom = -1 * aspect;
      camera.updateProjectionMatrix();
  }

  renderer.setSize(width, height);
}

window.addEventListener("resize", resize);
resize();

function tick() {
  controls.update();
  renderer.render(scene, camera);
  requestAnimationFrame(tick);
}
tick();

canvas.addEventListener("pointermove", (event) => {
  setPointerFromEvent(event);
  raycaster.setFromCamera(pointer, camera);

  hoveredFace = pickFace()?.materialIndex ?? null;
  canvas.style.cursor = hoveredFace !== null ? "pointer" : "";
  updateSelectEffect();
});

canvas.addEventListener("pointerleave", () => {
  hoveredFace = null;
  canvas.style.cursor = "";
  updateSelectEffect();
});

canvas.addEventListener("click", (event) => {
  setPointerFromEvent(event);
  raycaster.setFromCamera(pointer, camera);

  const hit = pickFace();
  hoveredFace = hit?.materialIndex ?? null;
  selectedFace = hit?.materialIndex ?? null;
  selectedFaceNormal = hit?.normal ?? null;
  showSelectedBorder = false;
  updateSelectEffect();
});

canvas.addEventListener("dblclick", (event) => {
  setPointerFromEvent(event);
  raycaster.setFromCamera(pointer, camera);

  const hit = pickFace();
  if (!hit) return;
  hoveredFace = hit.materialIndex;
  selectedFace = hit.materialIndex;
  selectedFaceNormal = hit.normal;
  showSelectedBorder = true;
  updateSelectEffect();
});

updateSelectEffect();
