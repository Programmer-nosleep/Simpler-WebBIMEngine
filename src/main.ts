import './style.css'
import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { setupFaceSelection } from "../components/FaceSelection";

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

setupFaceSelection({
  cube,
  cubeGeometry,
  faceMaterials,
  faceBaseColor,
  faceHoverColor,
  canvas,
  camera,
  dotSpacing: 0.05,
  surfaceOffset: 0.001,
  dotColor: 0x0000FF,
  dotSize: 1.2,
  borderColor: 0x0000FF,
  borderLineWidth: 2,
});

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
