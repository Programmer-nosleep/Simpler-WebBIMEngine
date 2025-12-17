import * as THREE from "three";

export type AxisId = "x" | "y" | "z";

export class AxesGizmo {
  private gizmoRoot = new THREE.Group();
  private gizmoScene = new THREE.Scene();
  private gizmoCamera: THREE.OrthographicCamera;
  private gizmoRenderer!: THREE.WebGLRenderer;
  private gizmoClickTargets: THREE.Object3D[] = [];
  private raycaster = new THREE.Raycaster();
  private pointer = new THREE.Vector2();

  private readonly defaultPixelSize = 120;
  private readonly minPixelSize = 96;
  private readonly maxPixelSize = 144;
  private baseDistance = 20;
  private selectedAxis: { axis: AxisId; sign: number } | null = null;
  private bgGlobe!: THREE.Mesh;

  // Configuration for Blender-like look
  // User Request: Blue = Z (Up), Green = Y (Forward/Back)
  // We map Three.js World Axes (y=Up, z=Forward) to these colors/labels.
  private readonly colors = {
    x: 0xff3653, // Red
    y: 0x2c8fff, // Blue (Visual Z / World Up)
    z: 0x8bdc00, // Green (Visual Y / World Forward)
    gray: 0xdddddd,
    hover: 0xffffff,
  };

  private axisMeshes: Record<string, THREE.Mesh | THREE.Sprite> = {};
  private mainCamera: THREE.PerspectiveCamera | THREE.OrthographicCamera;
  private mainControls: any; // Using 'any' for OrbitControls compatibility
  private gizmoCanvas: HTMLCanvasElement;

  constructor(
    mainCamera: THREE.PerspectiveCamera | THREE.OrthographicCamera,
    mainControls: any,
    gizmoCanvas: HTMLCanvasElement,
  ) {
    this.mainCamera = mainCamera;
    this.mainControls = mainControls;
    this.gizmoCanvas = gizmoCanvas;
    const gizmoCamSize = 1.8;
    this.gizmoCamera = new THREE.OrthographicCamera(
      -gizmoCamSize, gizmoCamSize, gizmoCamSize, -gizmoCamSize, 0.1, 50
    );
    this.gizmoCamera.position.set(0, 0, 10);
    this.gizmoCamera.lookAt(0, 0, 0);

    this.initRenderer();
    this.buildGizmo();
    this.setupInteractions();
  }

  private initRenderer() {
    this.gizmoRenderer = new THREE.WebGLRenderer({
      canvas: this.gizmoCanvas,
      alpha: true,
      antialias: true,
    });
    this.updateSize();

    const onResize = () => this.updateSize();
    window.addEventListener("resize", onResize);
    // store cleanup handler on canvas for dispose
    (this.gizmoCanvas as any).__axesGizmoResize__ = onResize;
  }

  private updateSize() {
    const rect = this.gizmoCanvas.getBoundingClientRect();
    const measured = Math.max(rect.width, rect.height, this.defaultPixelSize);
    const clamped = Math.min(this.maxPixelSize, Math.max(this.minPixelSize, measured));
    const width = clamped;
    const height = clamped;

    // Force a stable CSS size so the gizmo doesn't grow when the layout changes
    this.gizmoCanvas.style.width = `${width}px`;
    this.gizmoCanvas.style.height = `${height}px`;

    this.gizmoRenderer.setSize(width, height, false);
    this.gizmoRenderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));

    // Fix aspect ratio to prevent "gepeng" (squashed) look
    const aspect = width / height;
    const frustumSize = 2.2; // Adjusted for better fit

    if (aspect >= 1) {
      this.gizmoCamera.left = -frustumSize * aspect;
      this.gizmoCamera.right = frustumSize * aspect;
      this.gizmoCamera.top = frustumSize;
      this.gizmoCamera.bottom = -frustumSize;
    } else {
      this.gizmoCamera.left = -frustumSize;
      this.gizmoCamera.right = frustumSize;
      this.gizmoCamera.top = frustumSize / aspect;
      this.gizmoCamera.bottom = -frustumSize / aspect;
    }
    this.gizmoCamera.updateProjectionMatrix();
  }

  private buildGizmo() {
    this.gizmoScene.clear();
    this.gizmoRoot = new THREE.Group();
    this.gizmoScene.add(this.gizmoRoot);
    this.gizmoClickTargets = [];

    // Background area (White circle, opacity controlled by hover)
    const bgGeo = new THREE.SphereGeometry(1.6, 32, 32);
    const bgMat = new THREE.MeshBasicMaterial({
      color: 0xffffff,
      transparent: true,
      opacity: 0.0, // Default invisible
      depthTest: false,
      side: THREE.BackSide
    });
    this.bgGlobe = new THREE.Mesh(bgGeo, bgMat);
    this.gizmoRoot.add(this.bgGlobe);

    // Create Axes
    // MAPPING:
    // World X (1,0,0) -> Red, Label "X"
    // World Y (0,1,0) -> Blue, Label "Z" (User Request: Blue is Z)
    // World Z (0,0,1) -> Green, Label "Y" (User Request: Green is Y)

    this.buildAxis("x", new THREE.Vector3(1, 0, 0), this.colors.x, "X");
    this.buildAxis("y", new THREE.Vector3(0, 1, 0), this.colors.y, "Z");
    this.buildAxis("z", new THREE.Vector3(0, 0, 1), this.colors.z, "Y");

    // Center point
    const centerGeo = new THREE.SphereGeometry(0.2, 32, 32);
    const centerMat = new THREE.MeshBasicMaterial({ color: 0xdddddd });
    const centerMesh = new THREE.Mesh(centerGeo, centerMat);
    this.gizmoRoot.add(centerMesh);
  }

  private buildAxis(axis: AxisId, dir: THREE.Vector3, colorHex: number, labelStr: string) {
    const length = 1.4;
    const radius = 0.35;
    const lineRadius = 0.05;

    const dirNorm = dir.clone().normalize();
    const posPos = dirNorm.clone().multiplyScalar(length);
    const negPos = dirNorm.clone().multiplyScalar(-length);

    // 1. Connecting Line (Positive)
    const lineMesh = new THREE.Mesh(
      new THREE.CylinderGeometry(lineRadius, lineRadius, length, 8).translate(0, length / 2, 0).rotateX(Math.PI / 2),
      new THREE.MeshBasicMaterial({ color: colorHex })
    );
    lineMesh.lookAt(dirNorm);
    this.gizmoRoot.add(lineMesh);

    // 2. Positive Axis Button (The "Bubble")
    const tipGeo = new THREE.SphereGeometry(radius, 32, 32);
    const tipMat = new THREE.MeshBasicMaterial({ color: colorHex });
    const tipMesh = new THREE.Mesh(tipGeo, tipMat);
    tipMesh.position.copy(posPos);
    (tipMesh as any).userData = { axis, sign: 1 };
    this.gizmoClickTargets.push(tipMesh);
    this.gizmoRoot.add(tipMesh);
    this.axisMeshes[`${axis}_pos`] = tipMesh;

    // 3. Label (X, Y, Z)
    const labelMap = this.createLabelTexture(labelStr, "#000000");
    const labelMat = new THREE.SpriteMaterial({ map: labelMap, depthTest: false });
    const labelSprite = new THREE.Sprite(labelMat);
    labelSprite.scale.set(0.5, 0.5, 0.5);
    labelSprite.position.copy(posPos);
    this.gizmoRoot.add(labelSprite);

    // 4. Negative Axis (Smaller circle)
    const negLineMesh = new THREE.Mesh(
      new THREE.CylinderGeometry(lineRadius, lineRadius, length, 8).translate(0, length / 2, 0).rotateX(Math.PI / 2),
      new THREE.MeshBasicMaterial({ color: colorHex })
    );
    negLineMesh.lookAt(dirNorm.clone().negate());
    this.gizmoRoot.add(negLineMesh);

    const negTipGeo = new THREE.SphereGeometry(radius * 0.7, 32, 32);
    const negTipMat = new THREE.MeshBasicMaterial({ color: colorHex });
    const negTipMesh = new THREE.Mesh(negTipGeo, negTipMat);
    negTipMesh.position.copy(negPos);
    (negTipMesh as any).userData = { axis, sign: -1 };
    this.gizmoClickTargets.push(negTipMesh);
    this.gizmoRoot.add(negTipMesh);
    this.axisMeshes[`${axis}_neg`] = negTipMesh;
  }

  private createLabelTexture(text: string, color: string) {
    const size = 128;
    const canvas = document.createElement("canvas");
    canvas.width = size;
    canvas.height = size;
    const ctx = canvas.getContext("2d")!;

    ctx.font = "bold 90px Arial, sans-serif";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillStyle = color;
    ctx.fillText(text, size / 2, size / 2 + 8);

    const tex = new THREE.CanvasTexture(canvas);
    tex.colorSpace = THREE.SRGBColorSpace;
    return tex;
  }

  private setupInteractions() {
    this.gizmoCanvas.addEventListener("pointerdown", this.onGizmoClick);
    this.gizmoCanvas.addEventListener("pointermove", this.onPointerMove);
    this.gizmoCanvas.addEventListener("pointerleave", this.onPointerLeave);

    // Hover effect for background
    this.gizmoCanvas.addEventListener("mouseenter", this.onMouseEnter);
    this.gizmoCanvas.addEventListener("mouseleave", this.onMouseLeave);
  }

  private onMouseEnter = () => {
    (this.bgGlobe.material as THREE.MeshBasicMaterial).opacity = 0.2;
  };

  private onMouseLeave = () => {
    (this.bgGlobe.material as THREE.MeshBasicMaterial).opacity = 0.0;
    this.onPointerLeave(); // Also clear highlights
  };

  private onPointerMove = (event: PointerEvent) => {
    const rect = this.gizmoCanvas.getBoundingClientRect();
    const x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
    const y = -((event.clientY - rect.top) / rect.height) * 2 + 1;

    this.pointer.set(x, y);
    this.raycaster.setFromCamera(this.pointer, this.gizmoCamera);

    const intersects = this.raycaster.intersectObjects(this.gizmoClickTargets);

    // Reset all highlights
    Object.values(this.axisMeshes).forEach(mesh => {
      const mat = (mesh as THREE.Mesh).material as THREE.MeshBasicMaterial;
      mat.color.setHex(this.getAxisColor((mesh as any).userData.axis));
    });

    if (intersects.length > 0) {
      this.gizmoCanvas.style.cursor = "pointer";
      const object = intersects[0].object as THREE.Mesh;
      const data = (object as any).userData;

      // Highlight: Brighten
      (object.material as THREE.MeshBasicMaterial).color.offsetHSL(0, 0, 0.2);

      this.selectedAxis = { axis: data.axis, sign: data.sign };
    } else {
      this.gizmoCanvas.style.cursor = "default";
      this.selectedAxis = null;
    }
  };

  private getAxisColor(axis: AxisId): number {
    if (axis === 'x') return this.colors.x;
    if (axis === 'y') return this.colors.y;
    if (axis === 'z') return this.colors.z;
    return 0xffffff;
  }

  private onPointerLeave = () => {
    this.gizmoCanvas.style.cursor = "default";
    Object.values(this.axisMeshes).forEach(mesh => {
      const mat = (mesh as THREE.Mesh).material as THREE.MeshBasicMaterial;
      mat.color.setHex(this.getAxisColor((mesh as any).userData.axis));
    });
  }

  private onGizmoClick = () => {
    if (this.selectedAxis) {
      this.snapToAxis(this.selectedAxis.axis, this.selectedAxis.sign);
    }
  };

  private snapToAxis(axis: AxisId, sign: number) {
    const dist = this.baseDistance;
    const target = new THREE.Vector3(0, 0, 0);

    // Use controls target if available
    if (this.mainControls?.target) {
      target.copy(this.mainControls.target);
    }

    const newPos = new THREE.Vector3();
    const newUp = new THREE.Vector3(0, 1, 0);

    if (axis === "x") {
      // Right / Left view
      newPos.set(sign * dist, 0, 0);
      newUp.set(0, 1, 0);
    } else if (axis === "y") {
      // Top / Bottom view (use Z as screen-up, invert when looking from below)
      newPos.set(0, sign * dist, 0);
      newUp.set(0, 0, sign > 0 ? -1 : 1);
    } else if (axis === "z") {
      // Front / Back view
      newPos.set(0, 0, sign * dist);
      newUp.set(0, 1, 0);
    }

    newPos.add(target);

    // Prefer controls.setLookAt for smooth sync
    let handledByControls = false;
    try {
      if (this.mainControls?.setLookAt) {
        this.mainControls.setLookAt(
          newPos.x, newPos.y, newPos.z,
          target.x, target.y, target.z,
          true
        );
        handledByControls = true;
      }
    } catch {
      handledByControls = false;
    }

    if (!handledByControls) {
      this.mainCamera.position.copy(newPos);
      this.mainCamera.up.copy(newUp);
      this.mainCamera.lookAt(target);
      this.mainControls?.update?.();
    }

    // If orthographic, ensure zoom is sane so we don't clip/black out
    const camAny = this.mainCamera as any;
    if (camAny.isOrthographicCamera) {
      const cam = camAny as THREE.OrthographicCamera;
      if (!Number.isFinite(cam.zoom) || cam.zoom < 0.01) cam.zoom = 1;
      cam.updateProjectionMatrix();
    }
  }

  public setCamera(camera: THREE.PerspectiveCamera | THREE.OrthographicCamera) {
    this.mainCamera = camera;
  }

  public update = () => {
    this.gizmoRoot.quaternion.copy(this.mainCamera.quaternion).invert();
    this.gizmoRenderer.render(this.gizmoScene, this.gizmoCamera);
  };

  public dispose() {
    this.gizmoCanvas.removeEventListener("pointerdown", this.onGizmoClick);
    this.gizmoCanvas.removeEventListener("pointermove", this.onPointerMove);
    this.gizmoCanvas.removeEventListener("pointerleave", this.onPointerLeave);
    this.gizmoCanvas.removeEventListener("mouseenter", this.onMouseEnter);
    this.gizmoCanvas.removeEventListener("mouseleave", this.onMouseLeave);

    const cleanup = (this.gizmoCanvas as any).__axesGizmoResize__ as (() => void) | undefined;
    if (cleanup) {
      window.removeEventListener("resize", cleanup);
      delete (this.gizmoCanvas as any).__axesGizmoResize__;
    }
    this.gizmoRenderer.dispose();
  }
}
