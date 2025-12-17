import './style.css'
import * as THREE from "three";
import { setupFaceSelection } from "../components/FaceSelection";
import { AxesGizmo } from "../components/Gizmo";
import { type CameraProjectionMode, createCameraScene } from "../components/CameraScene";
import { setupGrid } from "../components/Grid";
import { setupLeftSidebar } from "../components/ui/LeftSidebar";
import { setupDock, type DockToolId } from "../components/ui/Dock";
import { setupNavigationInputBindings } from "../helpers/navigationInputs";
import { createSelectionMarquee, type SelectionRect } from "../components/tools/SelectionMarquee";

const isProjectionMode = (value: string): value is CameraProjectionMode =>
  value === "Perspective" || value === "Orthographic";
type NavigationModeOption = "Orbit" | "Plan";
const isNavigationMode = (value: string): value is NavigationModeOption =>
  value === "Orbit" || value === "Plan";

async function main() {
  setupLeftSidebar();
  const container = document.getElementById("threejs");
  if (!container) throw new Error("Container element #threejs tidak ditemukan");

  const cameraScene = await createCameraScene(container, {
    background: 0x000000,
    lookAt: { position: [0, 0, 5], target: [0, 0, 0] },
  });
  setupNavigationInputBindings(cameraScene);

  cameraScene.canvas.classList.add("three-main-canvas");
  const scene = cameraScene.scene;

  const gizmoCanvas = document.createElement("canvas");
  gizmoCanvas.classList.add("axes-gizmo");
  gizmoCanvas.setAttribute("aria-label", "camera axes gizmo");
  container.appendChild(gizmoCanvas);

  const axesGizmo = new AxesGizmo(
    cameraScene.camera.three,
    cameraScene.camera.controls,
    gizmoCanvas
  );

  const updateGizmoCamera = () => {
    axesGizmo.setCamera(cameraScene.camera.three);
  };
  const renderGizmo = () => axesGizmo.update();
  const worldRenderer = cameraScene.world.renderer;
  if (!worldRenderer) {
    throw new Error("Renderer tidak tersedia untuk cameraScene");
  }
  worldRenderer.onAfterUpdate.add(renderGizmo);
  updateGizmoCamera();

  const selectableObjects: THREE.Object3D[] = [];
  const selectedObjects = new Set<THREE.Object3D>();
  const selectionColor = new THREE.Color(0x4f8cff);

  const setObjectSelection = (object: THREE.Object3D, selected: boolean) => {
    object.traverse((child) => {
      const mesh = child as THREE.Mesh;
      if (!(mesh as any).isMesh) return;
      const materials = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
      materials.forEach((material) => {
        const mat = material as THREE.Material & { color?: THREE.Color };
        if (!mat || !(mat as any).color) return;
        const meshMaterial = mat as THREE.MeshBasicMaterial;
        if (selected) {
          if (meshMaterial.userData.__originalColor === undefined) {
            meshMaterial.userData.__originalColor = meshMaterial.color.getHex();
          }
          meshMaterial.color.copy(selectionColor);
        } else if (meshMaterial.userData.__originalColor !== undefined) {
          meshMaterial.color.setHex(meshMaterial.userData.__originalColor);
          delete meshMaterial.userData.__originalColor;
        }
      });
    });
  };

  const selectObjectsInRect = (rect: SelectionRect) => {
    const camera = cameraScene.camera.three;
    const box = new THREE.Box3();
    const corners = [
      new THREE.Vector3(),
      new THREE.Vector3(),
      new THREE.Vector3(),
      new THREE.Vector3(),
      new THREE.Vector3(),
      new THREE.Vector3(),
      new THREE.Vector3(),
      new THREE.Vector3(),
    ];

    const projectToScreen = (vec: THREE.Vector3) => {
      const projected = vec.clone().project(camera);
      return {
        x: (projected.x + 1) / 2,
        y: (-projected.y + 1) / 2,
      };
    };

    const selected: THREE.Object3D[] = [];

    selectableObjects.forEach((object) => {
      box.setFromObject(object);
      if (box.isEmpty()) return;
      corners[0].set(box.min.x, box.min.y, box.min.z);
      corners[1].set(box.min.x, box.min.y, box.max.z);
      corners[2].set(box.min.x, box.max.y, box.min.z);
      corners[3].set(box.min.x, box.max.y, box.max.z);
      corners[4].set(box.max.x, box.min.y, box.min.z);
      corners[5].set(box.max.x, box.min.y, box.max.z);
      corners[6].set(box.max.x, box.max.y, box.min.z);
      corners[7].set(box.max.x, box.max.y, box.max.z);

      const inside = corners.some((corner) => {
        const screen = projectToScreen(corner);
        return (
          screen.x >= rect.left &&
          screen.x <= rect.right &&
          screen.y >= rect.top &&
          screen.y <= rect.bottom
        );
      });

      if (inside) {
        selected.push(object);
      }
    });

    return selected;
  };

  const updateSelections = (rect: SelectionRect) => {
    const newlySelected = selectObjectsInRect(rect);
    const previous = Array.from(selectedObjects);
    previous.forEach((obj) => {
      if (!newlySelected.includes(obj)) {
        setObjectSelection(obj, false);
        selectedObjects.delete(obj);
      }
    });

    newlySelected.forEach((obj) => {
      if (!selectedObjects.has(obj)) {
        setObjectSelection(obj, true);
        selectedObjects.add(obj);
      }
    });

    if (selectedObjects.size > 0) {
      faceSelection.setSelectionByNormal(new THREE.Vector3(0, 0, 1), true);
    } else {
      faceSelection.setSelectionByNormal(null);
    }
  };

  let faceSelection: ReturnType<typeof setupFaceSelection>;

  const selectionMarquee = createSelectionMarquee(container, {
    onSelection: (rect) => {
      updateSelections(rect);
    },
  });

  setupGrid(cameraScene, { yOffset: -0.5 });

  const cubeGeometry = new THREE.BoxGeometry(1, 1, 1);
  const faceBaseColor = 0xcccccc;
  const faceHoverColor = 0xe6e6e6;
  const faceMaterials = Array.from(
    { length: 6 },
    () => new THREE.MeshBasicMaterial({ color: faceBaseColor })
  );
  const cube = new THREE.Mesh(cubeGeometry, faceMaterials);
  scene.add(cube);
  selectableObjects.push(cube);

  const edge = new THREE.EdgesGeometry(cubeGeometry);
  const outlineMaterial = new THREE.LineBasicMaterial({ color: 0x000000 });
  const outline = new THREE.LineSegments(edge, outlineMaterial);
  outline.scale.setScalar(1.0);
  cube.add(outline);

  faceSelection = setupFaceSelection({
    cube,
    cubeGeometry,
    faceMaterials,
    faceBaseColor,
    faceHoverColor,
    canvas: cameraScene.canvas,
    camera: cameraScene.camera.three,
    getCamera: () => cameraScene.camera.three,
    dotSpacing: 0.05,
    surfaceOffset: 0.001,
    dotColor: 0x0000ff,
    dotSize: 1.2,
    borderColor: 0x0000ff,
    borderLineWidth: 2,
  });

  const projectionSelect = document.getElementById(
    "projectionMode"
  ) as HTMLSelectElement | null;
  const projectionToggle = document.getElementById(
    "projectionToggle"
  ) as HTMLButtonElement | null;
  const navigationSelect = document.getElementById(
    "navigationMode"
  ) as HTMLSelectElement | null;

  if (projectionSelect) {
    projectionSelect.value = cameraScene.getProjection();
    projectionSelect.addEventListener("change", async () => {
      if (!isProjectionMode(projectionSelect.value)) return;
      await cameraScene.setProjection(projectionSelect.value);
    });
  }

  if (projectionToggle) {
    projectionToggle.addEventListener("click", async () => {
      await cameraScene.toggleProjection();
    });
  }

  cameraScene.onProjectionChanged((projection) => {
    if (projectionSelect) {
      projectionSelect.value = projection;
    }
    updateGizmoCamera();
  });

  if (navigationSelect) {
    const updateNavigationSelect = (mode: string) => {
      if (isNavigationMode(mode)) {
        navigationSelect.value = mode;
      }
    };

    navigationSelect.addEventListener("change", () => {
      if (!isNavigationMode(navigationSelect.value)) return;
      cameraScene.setNavigationMode(navigationSelect.value);
    });

    cameraScene.onNavigationModeChanged((mode) => {
      updateNavigationSelect(mode);
    });
  }

  let currentDockTool: DockToolId = "select";
  const updateSelectionState = (tool: DockToolId) => {
    if (tool === "select") {
      selectionMarquee.enable();
      if (selectedObjects.size > 0) {
        faceSelection.setSelectionByNormal(new THREE.Vector3(0, 0, 1), true);
      }
    } else {
      selectionMarquee.disable();
      faceSelection.setSelectionByNormal(null);
    }
  };

  const dock = await setupDock({
    initialTool: "select",
    onToolChange: (tool) => {
      currentDockTool = tool;
      if (tool === "hand") {
        cameraScene.setNavigationMode("Plan");
      } else if (tool === "select") {
        cameraScene.setNavigationMode("Orbit");
      }
      updateSelectionState(tool);
    },
  });

  updateSelectionState("select");

  cameraScene.onNavigationModeChanged((mode) => {
    if (mode === "Plan" && currentDockTool !== "hand") {
      currentDockTool = "hand";
      dock.setActiveTool("hand", { silent: true });
      updateSelectionState("hand");
    } else if (mode !== "Plan" && currentDockTool === "hand") {
      currentDockTool = "select";
      dock.setActiveTool("select", { silent: true });
      updateSelectionState("select");
    }
  });
}
main();
