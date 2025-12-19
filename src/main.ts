import './style.css'
import * as THREE from "three";

import { SkyDomeHelper, SkyDomeUI } from '../helpers/skydome';
import { setupFaceSelection } from "../components/FaceSelection";
import { AxesGizmo } from "../components/Gizmo";
import { type CameraProjectionMode, createCameraScene } from "../components/CameraScene";
import { setupGrid } from "../components/Grid";
import { AxesWorld } from "../utils/axesWorld";
import { setupLeftSidebar } from "../components/ui/LeftSidebar";
import { setupDock, type DockToolId } from "../components/ui/Dock";
import { setupNavigationInputBindings } from "../helpers/navigationInputs";
import { createSelectionMarquee, type SelectionRect } from "../components/tools/SelectionMarquee";
import { LineTool } from "../components/Line";
import { MoveTool } from "../components/Move";
import { ElevationCameraControls } from "../components/ElevationCameraScene";
import { FileController } from "../components/tools/fileController";

type NavigationModeOption = "Orbit" | "Plan";

const isProjectionMode = (value: string): value is CameraProjectionMode =>
	value === "Perspective" || value === "Orthographic";
const isNavigationMode = (value: string): value is NavigationModeOption =>
	value === "Orbit" || value === "Plan";

const init = async () => {
	let elevationControls: ElevationCameraControls;

	setupLeftSidebar(undefined, {
		onDefault: () => elevationControls?.setPerspective(),
		onElevation: (dir) => elevationControls?.setElevationView(dir),
	});
	const container = document.getElementById("threejs");
	if (!container) throw new Error("Container element #threejs tidak ditemukan");

	// 1. Setup Camera Scene
	const cameraScene = await createCameraScene(container, {
		background: 0x000000,
		lookAt: { position: [0, 0, 5], target: [0, 0, 0] },
	});
	setupNavigationInputBindings(cameraScene);
	cameraScene.canvas.classList.add("three-main-canvas");

	// Konfigurasi Mouse Controls (Opsional: Sesuaikan jika ingin gaya Revit/BIM)
	// Default Three.js: LEFT=Orbit, MIDDLE=Dolly, RIGHT=Pan
	if (cameraScene.camera.controls) {
		// cameraScene.camera.controls.mouseButtons.left = THREE.MOUSE.ROTATE;
		// cameraScene.camera.controls.mouseButtons.middle = THREE.MOUSE.DOLLY;
		// cameraScene.camera.controls.mouseButtons.right = THREE.MOUSE.PAN;
	}

	// 2. Setup Gizmo
	setupGizmo(container, cameraScene);

	// 3. Setup Environment (Grid, SkyDome)
	setupEnvironment(cameraScene);

	// 4. Setup Test Objects (Cube)
	const testObjectData = createTestCube(cameraScene.scene);

	// 5. Setup Face Selection
	const faceSelection = setupFaceSelection({
		scene: cameraScene.scene,
		faceObject: testObjectData.cube,
		objectGeometry: testObjectData.cubeGeometry,
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
	const getCamera = () => cameraScene.camera.three;
	const lineTool = new LineTool(
		cameraScene.scene,
		getCamera,
		container
	);
	const moveTool = new MoveTool(
		cameraScene.scene,
		getCamera,
		container
	);

	// 8. Setup UI Bindings
	setupUIBindings(cameraScene);

	// 9. Setup Dock & Tool State Management
	await setupDockSystem(cameraScene, lineTool, moveTool, selectionSystem, faceSelection);

	// 10. Setup Elevation & Camera Controls
	elevationControls = new ElevationCameraControls(cameraScene);
	(window as any).qreaseeCamera = {
		perspective: () => elevationControls.setPerspective(),
		orthographicIso: () => elevationControls.setIsoView(),
		orthographicTop: () => elevationControls.setTopView(),
		fitScene: () => elevationControls.fitScene(),
		setElevation: (dir: string) => elevationControls.setElevationView(dir as any),
	};

	// 11. Setup Importer
	try {
		const importer = document.getElementById("importer") as HTMLInputElement | null;
		if (!importer) throw new Error("Importer element #importer tidak ditemukan");

		const fileController = new FileController(cameraScene.scene, cameraScene.components);
		fileController.setupImport(importer);
	} catch (error) {
		console.warn("File importer gagal diinisialisasi:", error);
	}
};

// --- Helper Functions ---

const setupGizmo = (container: HTMLElement, cameraScene: any) => {
	const gizmoCanvas = document.createElement("canvas");
	gizmoCanvas.classList.add("axes-gizmo");
	gizmoCanvas.setAttribute("aria-label", "camera axes gizmo");
	// Pastikan gizmo tidak menutupi seluruh layar (blocking events)
	gizmoCanvas.style.position = "absolute";
	gizmoCanvas.style.top = "10px";
	gizmoCanvas.style.right = "10px";
	gizmoCanvas.style.zIndex = "100";
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
	// Non-aktifkan raycasting pada GridHelper agar tidak mengganggu Orbit
	cameraScene.scene.traverse((child: any) => {
		if (child.isGridHelper) child.raycast = () => {};
	});

	// Axes World Setup
	const axesWorld = new AxesWorld();
	axesWorld.position.y = -0.5;
	// Non-aktifkan raycasting pada AxesWorld agar tidak mengganggu Orbit/Line tool
	axesWorld.traverse((child) => {
		child.raycast = () => {};
	});
	cameraScene.scene.add(axesWorld);

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

	const syncFaceSelection = (primaryObject?: THREE.Object3D, primaryNormal?: THREE.Vector3) => {
		if (selectedObjects.size > 0) {
			const items = Array.from(selectedObjects).map((obj) => {
				if (obj === primaryObject && primaryNormal) {
					return { object: obj, normal: primaryNormal };
				}
				return { object: obj };
			});
			faceSelection.setSelectedObjects(items);
		} else {
			faceSelection.setSelectedObjects([]);
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

	const selectSingleObject = (object: THREE.Object3D, normal?: THREE.Vector3) => {
		Array.from(selectedObjects).forEach((obj) => {
			if (obj === object) return;
			setObjectSelection(obj, false);
			selectedObjects.delete(obj);
		});
		if (!selectedObjects.has(object)) {
			setObjectSelection(object, true);
			selectedObjects.add(object);
		}
		syncFaceSelection(object, normal);
	};

	const toggleObjectSelection = (object: THREE.Object3D, normal?: THREE.Vector3) => {
		if (selectedObjects.has(object)) {
			setObjectSelection(object, false);
			selectedObjects.delete(object);
			syncFaceSelection();
		} else {
			setObjectSelection(object, true);
			selectedObjects.add(object);
			syncFaceSelection(object, normal);
		}
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
		const hit = hits[0];
		const root = hit ? findSelectableRoot(hit.object) : null;

		if (!root) {
			if (!event.shiftKey) clearSelection();
			return;
		}

		if (event.shiftKey) toggleObjectSelection(root, hit.face?.normal);
		else selectSingleObject(root, hit.face?.normal);
	};

	cameraScene.canvas.addEventListener("pointerup", onCanvasPointerUp);

	const selectionSystem = {
		selectedObjects,
		selectionMarquee,
		syncFaceSelection,
		currentTool: "select" as DockToolId,
		clearSelection,
		selectAll: () => {
			const roots = getSelectableRoots();
			selectedObjects.forEach((obj) => setObjectSelection(obj, false));
			selectedObjects.clear();
			roots.forEach((obj) => {
				setObjectSelection(obj, true);
				selectedObjects.add(obj);
			});
			syncFaceSelection();
		},
		deleteSelected: async () => {
			const toDelete = Array.from(selectedObjects);
			toDelete.forEach((obj) => setObjectSelection(obj, false));
			selectedObjects.clear();
			syncFaceSelection();

			const disposeMaterial = (material: THREE.Material) => {
				const anyMaterial = material as any;
				Object.values(anyMaterial).forEach((value) => {
					if (value && typeof value === "object" && (value as any).isTexture) {
						try {
							(value as THREE.Texture).dispose();
						} catch { }
					}
				});
				try {
					material.dispose();
				} catch { }
			};

			const disposeObject3D = (object: THREE.Object3D) => {
				object.traverse((child: any) => {
					if (child.geometry?.dispose) {
						try {
							child.geometry.dispose();
						} catch { }
					}

					const mat = child.material as THREE.Material | THREE.Material[] | undefined;
					if (!mat) return;
					if (Array.isArray(mat)) mat.forEach(disposeMaterial);
					else disposeMaterial(mat);
				});
			};

			for (const obj of toDelete) {
				const fragmentsModel = (obj.userData as any)?.__fragmentsModel as
					| { dispose?: () => Promise<void> | void }
					| undefined;
				if (fragmentsModel?.dispose) {
					try {
						await fragmentsModel.dispose();
					} catch { }
				}

				obj.removeFromParent();
				disposeObject3D(obj);
			}
		},
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
			selectionSystem.syncFaceSelection();
		} else if (tool === "line") {
			lineTool.enable();
		} else if (tool === "move") {
			moveTool.enable();
		}
	};

	const dock = await setupDock({
		initialTool: "select",
		onToolChange: (tool) => {
			updateSelectionState(tool);

			const controls = cameraScene.camera.controls;
			if (tool === "hand") {
				// Mode Hand: Pan dengan Left Click, tetap di Orbit (Perspective) agar bisa rotate via Right Click
				cameraScene.setNavigationMode("Orbit");
				if (controls) {
					controls.mouseButtons.left = THREE.MOUSE.PAN;
					controls.mouseButtons.right = THREE.MOUSE.ROTATE;
				}
			} else if (tool === "select") {
				cameraScene.setNavigationMode("Orbit");
				if (controls) {
					controls.mouseButtons.left = THREE.MOUSE.ROTATE;
					controls.mouseButtons.right = THREE.MOUSE.PAN;
				}
			} else if (tool === "line") {
				// cameraScene.setNavigationMode("Plan");
			} else if (tool === "move") {
				cameraScene.setNavigationMode("Orbit");
				if (controls) {
					controls.mouseButtons.left = THREE.MOUSE.ROTATE;
					controls.mouseButtons.right = THREE.MOUSE.PAN;
				}
			}
		},
	});

	cameraScene.setNavigationMode("Orbit");
	updateSelectionState("select");

	cameraScene.onNavigationModeChanged((mode: string) => {
		if (mode === "Plan" && selectionSystem.currentTool !== "hand") {
			dock.setActiveTool("hand", { silent: true });
			updateSelectionState("hand");
		}
	});

	window.addEventListener("keydown", (event) => {
		const activeElement = document.activeElement as HTMLElement | null;
		const isTyping =
			!!activeElement &&
			(activeElement.tagName === "INPUT" ||
				activeElement.tagName === "TEXTAREA" ||
				activeElement.tagName === "SELECT" ||
				activeElement.isContentEditable);

		if (selectionSystem.currentTool === "select" && !isTyping) {
			const key = event.key.toLowerCase();
			if ((event.ctrlKey || event.metaKey) && key === "a") {
				event.preventDefault();
				selectionSystem.selectAll();
				return;
			}

			if (event.key === "Backspace" || event.key === "Delete") {
				event.preventDefault();
				void selectionSystem.deleteSelected();
				return;
			}
		}

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
