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
import { SectionManager } from "../components/sections/SectionManager";

const isProjectionMode = (value: string): value is CameraProjectionMode =>
  value === "Perspective" || value === "Orthographic";
type NavigationModeOption = "Orbit" | "Plan";
const isNavigationMode = (value: string): value is NavigationModeOption =>
  value === "Orbit" || value === "Plan";

async function main() {
  const sidebar = setupLeftSidebar();
  const container = document.getElementById("threejs");
  if (!container) throw new Error("Container element #threejs tidak ditemukan");

  const cameraScene = await createCameraScene(container, {
    background: 0x000000,
    lookAt: { position: [0, 0, 5], target: [0, 0, 0] },
  });
  cameraScene.renderer.localClippingEnabled = true;
  setupNavigationInputBindings(cameraScene);
  let dockHandle: Awaited<ReturnType<typeof setupDock>> | null = null;
  const sectionManager = new SectionManager(cameraScene, sidebar, {
    onSectionActivated: () => {
      cameraScene.setProjection("Orthographic");
      cameraScene.setNavigationMode("Plan");
      if (dockHandle) {
        dockHandle.setActiveTool("section", { silent: true });
      }
      currentDockTool = "section";
      updateSelectionState("section");
    },
  });

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
  const selectionColor = new THREE.Color(0xcad6ff);
  const tempCameraPosition = new THREE.Vector3();
  const tempObjectPosition = new THREE.Vector3();
  const tempDirection = new THREE.Vector3();
  const selectionNormal = new THREE.Vector3();

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

  const computeFacingNormal = (object: THREE.Object3D) => {
    tempObjectPosition.set(0, 0, 0);
    object.getWorldPosition(tempObjectPosition);
    cameraScene.camera.three.getWorldPosition(tempCameraPosition);
    tempDirection.copy(tempCameraPosition).sub(tempObjectPosition);
    const absX = Math.abs(tempDirection.x);
    const absY = Math.abs(tempDirection.y);
    const absZ = Math.abs(tempDirection.z);

    if (absX >= absY && absX >= absZ) {
      selectionNormal.set(Math.sign(tempDirection.x) || 1, 0, 0);
    } else if (absY >= absX && absY >= absZ) {
      selectionNormal.set(0, Math.sign(tempDirection.y) || 1, 0);
    } else {
      selectionNormal.set(0, 0, Math.sign(tempDirection.z) || 1);
    }
    return selectionNormal;
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
      const first = selectedObjects.values().next().value as THREE.Object3D | undefined;
      if (first && faceSelection) {
        faceSelection.setSelectionByNormal(computeFacingNormal(first), true);
      }
    } else if (faceSelection) {
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
  sectionManager.setBoundsFromObjects(selectableObjects);

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
  const sectionNameInput = document.getElementById(
    "sectionName"
  ) as HTMLInputElement | null;
  const sectionHeightInput = document.getElementById(
    "sectionHeightInput"
  ) as HTMLInputElement | null;
  const sectionAddBtn = document.getElementById(
    "sectionAddBtn"
  ) as HTMLButtonElement | null;
  const sectionBoxToggle = document.getElementById(
    "sectionBoxToggle"
  ) as HTMLInputElement | null;

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
    navigationSelect.addEventListener("change", async () => {
      if (!isNavigationMode(navigationSelect.value)) return;
      const next = navigationSelect.value;
      if (next === "Plan") {
        await cameraScene.setProjection("Orthographic");
      }
      await cameraScene.setNavigationMode(next);
    });

    cameraScene.onNavigationModeChanged((mode) => {
      navigationSelect.value = mode;
    });
  }
  sectionHeightInput?.addEventListener("input", () => {
    const height = parseFloat(sectionHeightInput.value) || 0;
    sectionManager.setPreviewHeight(height);
  });

  sectionAddBtn?.addEventListener("click", () => {
    const label =
      sectionNameInput?.value.trim() || `Section ${sectionManager.getSectionCount() + 1}`;
    const height = parseFloat(sectionHeightInput?.value || "0");
    sectionManager.createSection(label, height);
  });

  sectionBoxToggle?.addEventListener("change", () => {
    sectionManager.setGizmoVisible(sectionBoxToggle.checked);
  });

  sidebar.onSectionAdd(() => {
    sectionAddBtn?.click();
  });

  if (sectionHeightInput) {
    sectionManager.setPreviewHeight(parseFloat(sectionHeightInput.value) || 0);
  }
  sectionManager.setGizmoVisible(sectionBoxToggle?.checked ?? true);

  let currentDockTool: DockToolId = "select";
  const updateSelectionState = (tool: DockToolId) => {
    if (tool === "select") {
      selectionMarquee.enable();
      sectionManager.handleToolActive(false);
      if (selectedObjects.size > 0 && faceSelection) {
        const first = selectedObjects.values().next().value as THREE.Object3D | undefined;
        if (first) faceSelection.setSelectionByNormal(computeFacingNormal(first), true);
      }
    } else if (tool === "section") {
      selectionMarquee.disable();
      faceSelection?.setSelectionByNormal(null);
      sectionManager.handleToolActive(true);
    } else {
      selectionMarquee.disable();
      faceSelection?.setSelectionByNormal(null);
      sectionManager.handleToolActive(false);
    }
  };

  dockHandle = await setupDock({
    initialTool: "select",
    onToolChange: (tool) => {
      currentDockTool = tool;
      if (tool === "hand" || tool === "section") {
        cameraScene.setNavigationMode("Plan");
      } else if (tool === "select") {
        cameraScene.setNavigationMode("Orbit");
      }
      updateSelectionState(tool);
    },
  });

  updateSelectionState("select");

  cameraScene.onNavigationModeChanged((mode) => {
    if (mode === "Plan" && currentDockTool === "select") {
      currentDockTool = "hand";
      dockHandle?.setActiveTool("hand", { silent: true });
      updateSelectionState("hand");
    } else if (mode !== "Plan" && currentDockTool === "hand") {
      currentDockTool = "select";
      dockHandle?.setActiveTool("select", { silent: true });
      updateSelectionState("select");
    }
  });
}
main();
