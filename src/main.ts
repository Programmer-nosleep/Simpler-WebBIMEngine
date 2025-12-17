import './style.css'
import * as THREE from "three";
import { SkyDomeHelper, SkyDomeUI } from '../helpers/skydome';
import { setupFaceSelection } from "../components/FaceSelection";
import { AxesGizmo } from "../components/Gizmo";
import { type CameraProjectionMode, createCameraScene } from "../components/CameraScene";
import { setupGrid } from "../components/Grid";
import { setupLeftSidebar } from "../components/ui/LeftSidebar";
import { setupDock, type DockToolId } from "../components/ui/Dock";
import { setupNavigationInputBindings } from "../helpers/navigationInputs";
import { createSelectionMarquee, type SelectionRect } from "../components/tools/SelectionMarquee";
import { LineTool } from "../components/Line";
import { SnapManager } from "../components/utils/line/snap";
import { MoveTool } from "../components/Move";

type NavigationModeOption = "Orbit" | "Plan";

const isProjectionMode = (value: string): value is CameraProjectionMode =>
	value === "Perspective" || value === "Orthographic";
const isNavigationMode = (value: string): value is NavigationModeOption =>
	value === "Orbit" || value === "Plan";

const init = async () => {
	setupLeftSidebar();
	const container = document.getElementById("threejs");
	if (!container) throw new Error("Container element #threejs tidak ditemukan");

	// 1. Setup Camera Scene
	const cameraScene = await createCameraScene(container, {
		background: 0x000000,
		lookAt: { position: [0, 0, 5], target: [0, 0, 0] },
	});
	setupNavigationInputBindings(cameraScene);
	cameraScene.canvas.classList.add("three-main-canvas");

	// 2. Setup Gizmo
	setupGizmo(container, cameraScene);

	// 3. Setup Environment (Grid, SkyDome)
	setupEnvironment(cameraScene);

	// 4. Setup Test Objects (Cube)
	const testObjectData = createTestCube(cameraScene.scene);

	// 5. Setup Face Selection
	const faceSelection = setupFaceSelection({
		cube: testObjectData.cube,
		cubeGeometry: testObjectData.cubeGeometry,
		faceMaterials: testObjectData.faceMaterials,
		faceBaseColor: testObjectData.faceBaseColor,
		faceHoverColor: testObjectData.faceHoverColor,
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

	// 6. Setup Selection System
	const selectionSystem = setupSelectionSystem(container, cameraScene, faceSelection);

	// 7. Setup Tools (Line, Snap)
	const snapManager = new SnapManager();
	const lineTool = new LineTool(
		cameraScene.scene,
		cameraScene.camera.three,
		container,
		snapManager
	);
	const moveTool = new MoveTool(
		cameraScene.scene,
		cameraScene.camera.three,
		container
	);

	// 8. Setup UI Bindings
	setupUIBindings(cameraScene);

	// 9. Setup Dock & Tool State Management
	await setupDockSystem(cameraScene, lineTool, moveTool, selectionSystem, faceSelection);
};

// --- Helper Functions ---

const setupGizmo = (container: HTMLElement, cameraScene: any) => {
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
	if (worldRenderer) {
		worldRenderer.onAfterUpdate.add(renderGizmo);
	}

	cameraScene.onProjectionChanged(() => updateGizmoCamera());
	updateGizmoCamera();
};

const setupEnvironment = (cameraScene: any) => {
	setupGrid(cameraScene, { yOffset: -0.5 });

	// SkyDome Setup
	const skyHelper = new SkyDomeHelper(cameraScene.scene);
	new SkyDomeUI(skyHelper);
};

const createTestCube = (scene: THREE.Scene) => {
	const cubeGeometry = new THREE.BoxGeometry(1, 1, 1);
	const faceBaseColor = 0xcccccc;
	const faceHoverColor = 0xe6e6e6;
	const faceMaterials = Array.from(
		{ length: 6 },
		() => new THREE.MeshBasicMaterial({ color: faceBaseColor })
	);
	const cube = new THREE.Mesh(cubeGeometry, faceMaterials);
	cube.userData.selectable = true;
	scene.add(cube);

	const edge = new THREE.EdgesGeometry(cubeGeometry);
	const outlineMaterial = new THREE.LineBasicMaterial({ color: 0x000000 });
	const outline = new THREE.LineSegments(edge, outlineMaterial);
	outline.userData.selectable = false;
	outline.scale.setScalar(1.0);
	cube.add(outline);

	return { cube, cubeGeometry, faceMaterials, faceBaseColor, faceHoverColor };
};

const setupSelectionSystem = (
	container: HTMLElement,
	cameraScene: any,
	faceSelection: any
) => {
	const scene = cameraScene.scene;
	const selectedObjects = new Set<THREE.Object3D>();
	const selectionColor = new THREE.Color(0x4f8cff);

	const isSelectableRoot = (object: THREE.Object3D) =>
		(object.userData as { selectable?: boolean } | undefined)?.selectable === true;

	const getSelectableRoots = () => {
		const roots: THREE.Object3D[] = [];
		scene.traverse((obj: any) => {
			if (isSelectableRoot(obj)) roots.push(obj);
		});
		return roots;
	};

	const syncFaceSelection = () => {
		if (selectedObjects.size > 0) {
			faceSelection.setSelectionByNormal(new THREE.Vector3(0, 0, 1), true);
		} else {
			faceSelection.setSelectionByNormal(null);
		}
	};

	const setObjectSelection = (object: THREE.Object3D, selected: boolean) => {
		object.traverse((child) => {
			if ((child.userData as { selectable?: boolean } | undefined)?.selectable === false) return;
			if (!(child as any).isMesh && !(child as any).isLine && !(child as any).isLineSegments) return;

			const materialValue = (child as any).material as THREE.Material | THREE.Material[] | undefined;
			if (!materialValue) return;
			const materials = Array.isArray(materialValue) ? materialValue : [materialValue];

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
		const corners = Array(8).fill(null).map(() => new THREE.Vector3());

		const projectToScreen = (vec: THREE.Vector3) => {
			const projected = vec.clone().project(camera);
			return { x: (projected.x + 1) / 2, y: (-projected.y + 1) / 2 };
		};

		const selected: THREE.Object3D[] = [];
		getSelectableRoots().forEach((object) => {
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
					screen.x >= rect.left && screen.x <= rect.right &&
					screen.y >= rect.top && screen.y <= rect.bottom
				);
			});

			if (inside) selected.push(object);
		});
		return selected;
	};

	const updateSelections = (rect: SelectionRect, selectionOptions?: { additive?: boolean }) => {
		const newlySelected = selectObjectsInRect(rect);
		if (!selectionOptions?.additive) {
			Array.from(selectedObjects).forEach((obj) => {
				if (!newlySelected.includes(obj)) {
					setObjectSelection(obj, false);
					selectedObjects.delete(obj);
				}
			});
		}
		newlySelected.forEach((obj) => {
			if (!selectedObjects.has(obj)) {
				setObjectSelection(obj, true);
				selectedObjects.add(obj);
			}
		});
		syncFaceSelection();
	};

	const selectionMarquee = createSelectionMarquee(container, {
		onSelection: (rect, event) => {
			updateSelections(rect, { additive: event.shiftKey });
		},
	});

	const selectionRaycaster = new THREE.Raycaster();
	const selectionPointer = new THREE.Vector2();

	const findSelectableRoot = (obj: THREE.Object3D) => {
		let current: THREE.Object3D | null = obj;
		while (current && current !== scene) {
			if (isSelectableRoot(current)) return current;
			current = current.parent;
		}
		return null;
	};

	const clearSelection = () => {
		selectedObjects.forEach((obj) => setObjectSelection(obj, false));
		selectedObjects.clear();
		syncFaceSelection();
	};

	const selectSingleObject = (object: THREE.Object3D) => {
		Array.from(selectedObjects).forEach((obj) => {
			if (obj === object) return;
			setObjectSelection(obj, false);
			selectedObjects.delete(obj);
		});
		if (!selectedObjects.has(object)) {
			setObjectSelection(object, true);
			selectedObjects.add(object);
		}
		syncFaceSelection();
	};

	const toggleObjectSelection = (object: THREE.Object3D) => {
		if (selectedObjects.has(object)) {
			setObjectSelection(object, false);
			selectedObjects.delete(object);
		} else {
			setObjectSelection(object, true);
			selectedObjects.add(object);
		}
		syncFaceSelection();
	};

	const onCanvasPointerUp = (event: PointerEvent) => {
		if (selectionSystem.currentTool !== "select") return;

		if (event.button !== 0) return;
		if (selectionMarquee.isDragging()) return;

		const rect = cameraScene.canvas.getBoundingClientRect();
		selectionPointer.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
		selectionPointer.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;

		selectionRaycaster.setFromCamera(selectionPointer, cameraScene.camera.three);
		const hits = selectionRaycaster.intersectObjects(getSelectableRoots(), true);
		const root = hits[0] ? findSelectableRoot(hits[0].object) : null;

		if (!root) {
			if (!event.shiftKey) clearSelection();
			return;
		}

		if (event.shiftKey) toggleObjectSelection(root);
		else selectSingleObject(root);
	};

	cameraScene.canvas.addEventListener("pointerup", onCanvasPointerUp);

	const selectionSystem = {
		selectedObjects,
		selectionMarquee,
		syncFaceSelection,
		currentTool: "select" as DockToolId,
		clearSelection,
	};
	return selectionSystem;
};

const setupUIBindings = (cameraScene: any) => {
	const projectionSelect = document.getElementById("projectionMode") as HTMLSelectElement | null;
	const projectionToggle = document.getElementById("projectionToggle") as HTMLButtonElement | null;
	const navigationSelect = document.getElementById("navigationMode") as HTMLSelectElement | null;

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

	cameraScene.onProjectionChanged((projection: string) => {
		if (projectionSelect) projectionSelect.value = projection;
	});

	if (navigationSelect) {
		const updateNavigationSelect = (mode: string) => {
			if (isNavigationMode(mode)) navigationSelect.value = mode;
		};
		navigationSelect.addEventListener("change", () => {
			if (!isNavigationMode(navigationSelect.value)) return;
			cameraScene.setNavigationMode(navigationSelect.value);
		});
		cameraScene.onNavigationModeChanged((mode: string) => updateNavigationSelect(mode));
	}
};

const setupDockSystem = async (
	cameraScene: any,
	lineTool: LineTool,
	moveTool: MoveTool,
	selectionSystem: any,
	faceSelection: any
) => {
	const updateSelectionState = (tool: DockToolId) => {
		selectionSystem.currentTool = tool;

		// Reset all tools first
		lineTool.disable();
		moveTool.disable();
		selectionSystem.selectionMarquee.disable();
		faceSelection.setSelectionByNormal(null);

		if (tool === "select") {
			selectionSystem.selectionMarquee.enable();
			if (selectionSystem.selectedObjects.size > 0) {
				faceSelection.setSelectionByNormal(new THREE.Vector3(0, 0, 1), true);
			}
		} else if (tool === "line") {
			lineTool.enable();
		} else if (tool === "move") {
			moveTool.enable();
		}
	};

	const dock = await setupDock({
		initialTool: "select",
		onToolChange: (tool) => {
			if (tool === "hand") {
				cameraScene.setNavigationMode("Plan");
			} else if (tool === "select") {
				cameraScene.setNavigationMode("Orbit");
			} else if (tool === "line") {
				// cameraScene.setNavigationMode("Plan");
			} else if (tool === "move") {
				cameraScene.setNavigationMode("Orbit");
			}
			updateSelectionState(tool);
		},
	});

	updateSelectionState("select");

	cameraScene.onNavigationModeChanged((mode: string) => {
		if (mode === "Plan" && selectionSystem.currentTool !== "hand") {
			dock.setActiveTool("hand", { silent: true });
			updateSelectionState("hand");
		} else if (mode !== "Plan" && selectionSystem.currentTool === "hand") {
			dock.setActiveTool("select", { silent: true });
			updateSelectionState("select");
		}
	});

	window.addEventListener("keydown", (event) => {
		if (event.key === "Escape") {
			if (selectionSystem.currentTool !== "select") {
				dock.setActiveTool("select");
			} else {
				selectionSystem.clearSelection();
			}
		}
	});
};

init();
