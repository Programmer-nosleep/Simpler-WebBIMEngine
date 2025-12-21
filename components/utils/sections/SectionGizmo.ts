import * as THREE from "three";

type GizmoLayout = {
  width: number;
  depth: number;
  basisX: THREE.Vector3;
  basisY: THREE.Vector3;
  basisZ: THREE.Vector3;
  position: THREE.Vector3;
};

export class SectionGizmo {
  private readonly group = new THREE.Group();
  private readonly fill: THREE.Mesh;
  private readonly outline: THREE.LineSegments;
  private readonly handles = new THREE.Group();
  private readonly handleSprites: THREE.Sprite[] = [];
  private bounds = new THREE.Box3(
    new THREE.Vector3(-2, 0, -2),
    new THREE.Vector3(2, 2, 2)
  );
  private readonly plane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);

  private static handleTexture: THREE.Texture | null = null;

  constructor(bounds?: THREE.Box3) {
    if (bounds) this.bounds.copy(bounds);
    const layout = this.computeLayout();

    const planeGeometry = new THREE.PlaneGeometry(layout.width, layout.depth);
    const planeMaterial = new THREE.MeshBasicMaterial({
      color: 0xff8b2f,
      opacity: 0.08,
      transparent: true,
      side: THREE.DoubleSide,
      depthWrite: false,
      depthTest: false,
    });
    this.fill = new THREE.Mesh(planeGeometry, planeMaterial);
    this.fill.rotation.x = -Math.PI / 2;
    this.group.add(this.fill);

    const outlineGeometry = new THREE.BufferGeometry();
    outlineGeometry.setAttribute(
      "position",
      new THREE.Float32BufferAttribute(this.getOutlinePositions(layout.width, layout.depth), 3)
    );
    const outlineMaterial = new THREE.LineDashedMaterial({
      color: 0xff8b2f,
      dashSize: Math.max(0.1, Math.min(layout.width, layout.depth) * 0.05),
      gapSize: Math.max(0.06, Math.min(layout.width, layout.depth) * 0.03),
      transparent: true,
      opacity: 0.9,
      depthWrite: false,
      depthTest: false,
    });
    this.outline = new THREE.LineSegments(outlineGeometry, outlineMaterial);
    this.outline.computeLineDistances();
    this.group.add(this.outline);

    this.handles.renderOrder = 3;
    this.group.add(this.handles);
    this.createHandles(layout.width, layout.depth);
    this.updateHandleLayout(layout.width, layout.depth);

    this.applyLayout(layout);

    // Ensure gizmo doesn't interfere with picking/selection.
    this.group.userData.isHelper = true;
    this.group.userData.selectable = false;
    this.group.traverse((child) => {
      child.userData.isHelper = true;
      child.userData.selectable = false;
      (child as any).raycast = () => { };
    });

    this.group.visible = false;
  }

  get object3d() {
    return this.group;
  }

  updateBounds(bounds: THREE.Box3) {
    this.bounds.copy(bounds);
    const layout = this.computeLayout();
    this.updateGeometry(layout.width, layout.depth);
    this.applyLayout(layout);
  }

  setPlane(plane: THREE.Plane) {
    this.plane.copy(plane).normalize();
    const layout = this.computeLayout();
    this.updateGeometry(layout.width, layout.depth);
    this.applyLayout(layout);
  }

  setVisible(state: boolean) {
    this.group.visible = state;
  }

  private updateGeometry(width: number, depth: number) {
    const safeWidth = Math.max(0.01, width);
    const safeDepth = Math.max(0.01, depth);

    (this.fill.geometry as THREE.BufferGeometry).dispose();
    this.fill.geometry = new THREE.PlaneGeometry(safeWidth, safeDepth);
    this.fill.rotation.x = -Math.PI / 2;

    (this.outline.geometry as THREE.BufferGeometry).dispose();
    const outlineGeometry = new THREE.BufferGeometry();
    outlineGeometry.setAttribute(
      "position",
      new THREE.Float32BufferAttribute(this.getOutlinePositions(safeWidth, safeDepth), 3)
    );
    this.outline.geometry = outlineGeometry;
    const material = this.outline.material as THREE.LineDashedMaterial;
    material.dashSize = Math.max(0.1, Math.min(safeWidth, safeDepth) * 0.05);
    material.gapSize = Math.max(0.06, Math.min(safeWidth, safeDepth) * 0.03);
    material.needsUpdate = true;
    this.outline.computeLineDistances();

    this.updateHandleLayout(safeWidth, safeDepth);
  }

  private getOutlinePositions(width: number, depth: number): number[] {
    const halfX = width / 2;
    const halfZ = depth / 2;
    const y = 0.001;

    const positions: number[] = [];
    const pushSeg = (ax: number, az: number, bx: number, bz: number) => {
      positions.push(ax, y, az, bx, y, bz);
    };

    pushSeg(-halfX, -halfZ, halfX, -halfZ);
    pushSeg(halfX, -halfZ, halfX, halfZ);
    pushSeg(halfX, halfZ, -halfX, halfZ);
    pushSeg(-halfX, halfZ, -halfX, -halfZ);

    return positions;
  }

  private createHandles(width: number, depth: number) {
    const texture = SectionGizmo.getHandleTexture();
    const material = new THREE.SpriteMaterial({
      map: texture,
      color: 0xff8b2f,
      transparent: true,
      depthWrite: false,
      depthTest: false,
    });

    for (let i = 0; i < 4; i++) {
      const sprite = new THREE.Sprite(material.clone());
      sprite.renderOrder = 4;
      sprite.userData.isHelper = true;
      sprite.userData.selectable = false;
      this.handles.add(sprite);
      this.handleSprites.push(sprite);
    }

    this.updateHandleLayout(width, depth);
  }

  private updateHandleLayout(width: number, depth: number) {
    if (this.handleSprites.length === 0) return;

    const halfX = width / 2;
    const halfZ = depth / 2;
    const y = 0.001;

    const handleSize = THREE.MathUtils.clamp(Math.min(width, depth) * 0.04, 0.12, 0.6);

    const corners: Array<[number, number]> = [
      [-halfX, -halfZ],
      [halfX, -halfZ],
      [halfX, halfZ],
      [-halfX, halfZ],
    ];

    for (let i = 0; i < this.handleSprites.length; i++) {
      const sprite = this.handleSprites[i];
      const [x, z] = corners[i];
      sprite.position.set(x, y, z);
      sprite.scale.set(handleSize, handleSize, 1);
    }
  }

  private static getHandleTexture() {
    if (SectionGizmo.handleTexture) return SectionGizmo.handleTexture;

    const size = 64;
    const canvas = document.createElement("canvas");
    canvas.width = size;
    canvas.height = size;
    const ctx = canvas.getContext("2d");
    if (!ctx) {
      const fallback = new THREE.Texture();
      SectionGizmo.handleTexture = fallback;
      return fallback;
    }

    ctx.clearRect(0, 0, size, size);
    ctx.beginPath();
    ctx.arc(size / 2, size / 2, size * 0.33, 0, Math.PI * 2);
    ctx.strokeStyle = "rgba(255,139,47,1)";
    ctx.lineWidth = size * 0.08;
    ctx.stroke();

    ctx.beginPath();
    ctx.arc(size / 2, size / 2, size * 0.12, 0, Math.PI * 2);
    ctx.fillStyle = "rgba(255,139,47,0.9)";
    ctx.fill();

    const texture = new THREE.CanvasTexture(canvas);
    texture.needsUpdate = true;
    SectionGizmo.handleTexture = texture;
    return texture;
  }

  private computeLayout(): GizmoLayout {
    const normalizedPlane = this.plane.clone().normalize();

    const size = this.bounds.getSize(new THREE.Vector3());
    const center = this.bounds.getCenter(new THREE.Vector3());

    const worldUp = new THREE.Vector3(0, 1, 0);
    const yAxis = normalizedPlane.normal.clone().normalize();
    const isHorizontal = Math.abs(yAxis.dot(worldUp)) > 0.75;

    let basisX: THREE.Vector3;
    let basisY: THREE.Vector3;
    let basisZ: THREE.Vector3;

    if (isHorizontal) {
      basisY = yAxis;

      const ref = Math.abs(basisY.dot(new THREE.Vector3(1, 0, 0))) > 0.9
        ? new THREE.Vector3(0, 0, 1)
        : new THREE.Vector3(1, 0, 0);

      basisX = ref
        .clone()
        .sub(basisY.clone().multiplyScalar(ref.dot(basisY)))
        .normalize();

      basisZ = basisX.clone().cross(basisY).normalize();
    } else {
      basisY = new THREE.Vector3(yAxis.x, 0, yAxis.z);
      if (basisY.lengthSq() < 1e-6) basisY.set(1, 0, 0);
      basisY.normalize();

      basisX = basisY.clone().cross(worldUp).normalize();
      basisZ = basisX.clone().cross(basisY).normalize();
    }

    const distance = normalizedPlane.distanceToPoint(center);
    const position = center
      .clone()
      .sub(normalizedPlane.normal.clone().multiplyScalar(distance));

    const width = isHorizontal ? size.x : Math.abs(basisX.x) * size.x + Math.abs(basisX.z) * size.z;
    const depth = isHorizontal ? size.z : size.y;

    return { width, depth, basisX, basisY, basisZ, position };
  }

  private applyLayout(layout: GizmoLayout) {
    const rotation = new THREE.Matrix4().makeBasis(layout.basisX, layout.basisY, layout.basisZ);
    this.group.quaternion.setFromRotationMatrix(rotation);
    this.group.position.copy(layout.position);
  }
}
