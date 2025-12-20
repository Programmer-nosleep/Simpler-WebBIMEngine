import * as THREE from "three";

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
  private heightWorld = 0;

  private static handleTexture: THREE.Texture | null = null;

  constructor(bounds?: THREE.Box3) {
    if (bounds) this.bounds.copy(bounds);
    const size = this.bounds.getSize(new THREE.Vector3());
    const center = this.bounds.getCenter(new THREE.Vector3());

    const planeGeometry = new THREE.PlaneGeometry(size.x, size.z);
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
      new THREE.Float32BufferAttribute(this.getOutlinePositions(size), 3)
    );
    const outlineMaterial = new THREE.LineDashedMaterial({
      color: 0xff8b2f,
      dashSize: Math.max(0.1, Math.min(size.x, size.z) * 0.05),
      gapSize: Math.max(0.06, Math.min(size.x, size.z) * 0.03),
      transparent: true,
      opacity: 0.9,
      depthWrite: false,
      depthTest: false,
    });
    this.outline = new THREE.LineSegments(outlineGeometry, outlineMaterial);
    this.outline.computeLineDistances();
    this.group.add(this.outline);

    this.group.position.set(center.x, this.heightWorld, center.z);

    this.handles.renderOrder = 3;
    this.group.add(this.handles);
    this.createHandles(size);
    this.updateHandleLayout(size);

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
    const size = this.bounds.getSize(new THREE.Vector3());
    (this.fill.geometry as THREE.BufferGeometry).dispose();
    this.fill.geometry = new THREE.PlaneGeometry(size.x, size.z);
    this.fill.rotation.x = -Math.PI / 2;

    (this.outline.geometry as THREE.BufferGeometry).dispose();
    const outlineGeometry = new THREE.BufferGeometry();
    outlineGeometry.setAttribute(
      "position",
      new THREE.Float32BufferAttribute(this.getOutlinePositions(size), 3)
    );
    this.outline.geometry = outlineGeometry;
    const material = this.outline.material as THREE.LineDashedMaterial;
    material.dashSize = Math.max(0.1, Math.min(size.x, size.z) * 0.05);
    material.gapSize = Math.max(0.06, Math.min(size.x, size.z) * 0.03);
    material.needsUpdate = true;
    this.outline.computeLineDistances();

    this.updateHandleLayout(size);

    const center = this.bounds.getCenter(new THREE.Vector3());
    this.group.position.set(center.x, this.heightWorld, center.z);
  }

  setHeight(height: number) {
    this.heightWorld = height;
    const center = this.bounds.getCenter(new THREE.Vector3());
    this.group.position.set(center.x, this.heightWorld, center.z);
  }

  setVisible(state: boolean) {
    this.group.visible = state;
  }

  private getOutlinePositions(size: THREE.Vector3): number[] {
    const halfX = size.x / 2;
    const halfZ = size.z / 2;
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

  private createHandles(size: THREE.Vector3) {
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

    this.updateHandleLayout(size);
  }

  private updateHandleLayout(size: THREE.Vector3) {
    if (this.handleSprites.length === 0) return;

    const halfX = size.x / 2;
    const halfZ = size.z / 2;
    const y = 0.001;

    const handleSize = THREE.MathUtils.clamp(Math.min(size.x, size.z) * 0.04, 0.12, 0.6);

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
}
