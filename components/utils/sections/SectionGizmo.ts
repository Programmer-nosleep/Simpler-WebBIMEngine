import * as THREE from "three";

export class SectionGizmo {
  private readonly group = new THREE.Group();
  private readonly fill: THREE.Mesh;
  private readonly outline: THREE.LineSegments;
  private bounds = new THREE.Box3(
    new THREE.Vector3(-2, 0, -2),
    new THREE.Vector3(2, 2, 2)
  );

  constructor(bounds?: THREE.Box3) {
    if (bounds) this.bounds.copy(bounds);
    const size = this.bounds.getSize(new THREE.Vector3());

    const planeGeometry = new THREE.PlaneGeometry(size.x, size.z);
    const planeMaterial = new THREE.MeshBasicMaterial({
      color: 0x2f5eff,
      opacity: 0.2,
      transparent: true,
      side: THREE.DoubleSide,
      depthWrite: false,
    });
    this.fill = new THREE.Mesh(planeGeometry, planeMaterial);
    this.fill.rotation.x = -Math.PI / 2;
    this.group.add(this.fill);

    const outlineGeometry = new THREE.EdgesGeometry(
      new THREE.BoxGeometry(size.x, 0.02, size.z)
    );
    const outlineMaterial = new THREE.LineBasicMaterial({
      color: 0x2f5eff,
      linewidth: 2,
      transparent: true,
      opacity: 0.9,
    });
    this.outline = new THREE.LineSegments(outlineGeometry, outlineMaterial);
    this.group.add(this.outline);

    this.group.position.set(
      this.bounds.getCenter(new THREE.Vector3()).x,
      this.bounds.min.y,
      this.bounds.getCenter(new THREE.Vector3()).z
    );
    this.fill.position.y = 0;
    this.outline.position.y = 0;
    this.group.visible = false;
  }

  get object3d() {
    return this.group;
  }

  updateBounds(bounds: THREE.Box3) {
    this.bounds.copy(bounds);
    const size = this.bounds.getSize(new THREE.Vector3());
    (this.fill.geometry as THREE.PlaneGeometry).dispose();
    this.fill.geometry = new THREE.PlaneGeometry(size.x, size.z);
    (this.outline.geometry as THREE.EdgesGeometry).dispose();
    this.outline.geometry = new THREE.EdgesGeometry(
      new THREE.BoxGeometry(size.x, 0.02, size.z)
    );
    const center = this.bounds.getCenter(new THREE.Vector3());
    this.group.position.set(center.x, this.bounds.min.y, center.z);
  }

  setHeight(height: number) {
    this.fill.position.y = height;
    this.outline.position.y = height;
  }

  setVisible(state: boolean) {
    this.group.visible = state;
  }
}
