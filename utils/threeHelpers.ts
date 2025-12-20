import * as THREE from "three";
import { FontLoader } from "three/examples/jsm/loaders/FontLoader.js";
import { TextGeometry } from "three/examples/jsm/geometries/TextGeometry.js";

// --- Material Helpers ---
export function applyHighlight(
    obj: THREE.Object3D,
    originalMaterials: Map<THREE.Object3D, THREE.Material>,
    options?: { color?: number; opacity?: number; emissive?: number }
) {
    if (!originalMaterials.has(obj)) {
        originalMaterials.set(obj, (obj as any).material);
    }

    const origMaterial = (obj as any).material;
    const createFromOriginal = (material: THREE.Material) => {
        const clone = (material as any)?.clone?.() ?? material;
        if ((clone as any).color && options?.color !== undefined) {
            ((clone as any).color as THREE.Color).setHex(options.color);
        }
        if ((clone as any).emissive) {
            ((clone as any).emissive as THREE.Color).setHex(options?.emissive ?? 0x000000);
        }
        if ((clone as any).transparent !== undefined) (clone as any).transparent = false;
        if ((clone as any).opacity !== undefined) (clone as any).opacity = 1;
        (clone as any).needsUpdate = true;
        return clone;
    };

    const highlightMaterial = Array.isArray(origMaterial)
        ? origMaterial.map((mat: THREE.Material) => createFromOriginal(mat))
        : createFromOriginal(origMaterial as THREE.Material);

    (obj as any).material = highlightMaterial;
}

export function restoreMaterial(obj: THREE.Object3D, originalMaterials: Map<THREE.Object3D, THREE.Material>) {
    if (originalMaterials.has(obj)) {
        (obj as any).material = originalMaterials.get(obj)!;
        originalMaterials.delete(obj);
    }
}

// --- Scene Traverse ---
export function getAllObjects(root: THREE.Object3D): THREE.Object3D[] {
    const objects: THREE.Object3D[] = [];
    root.traverse((child: THREE.Object3D) => {
        if (child.type === "DirectionalLight") return;
        if ((child as THREE.Mesh).isMesh) {
            const mesh = child as THREE.Mesh;
            if (mesh.geometry?.attributes?.position) {
                const posAttr = mesh.geometry.attributes.position;
                if (!posAttr.itemSize || posAttr.itemSize !== 3) {
                    mesh.geometry.setAttribute(
                        "position",
                        new THREE.BufferAttribute(new Float32Array(posAttr.array), 3)
                    );
                }
            }
        }
        objects.push(child);
    });
    return objects;
}

// --- Edge Overlay Helpers ---
export function createEdgesOverlay(
    root: THREE.Object3D,
    options?: { color?: number; linewidth?: number; depthTest?: boolean; thresholdAngle?: number }
): THREE.Group {
    const color = options?.color ?? 0x00aaee;
    const linewidth = options?.linewidth ?? 1.5;
    const depthTest = options?.depthTest ?? true; // true => only visible-from-camera (occluded hidden)
    const thresholdAngle = options?.thresholdAngle ?? 40;
    const group = new THREE.Group();
    const material = new THREE.LineBasicMaterial({ color, linewidth, depthTest, transparent: true, opacity: 1 });
    const meshes: THREE.Mesh[] = [];
    // ensure matrices are up-to-date
    root.updateMatrixWorld(true);
    const rootWorld = root.matrixWorld.clone();
    const rootInv = rootWorld.clone().invert();
    root.traverse((child) => {
        const anyChild = child as any;
        if (anyChild.isMesh && anyChild.geometry) {
            meshes.push(anyChild as THREE.Mesh);
        }
    });
    for (const mesh of meshes) {
        mesh.updateMatrixWorld(true);
        const edgesGeo = new THREE.EdgesGeometry(mesh.geometry as THREE.BufferGeometry, thresholdAngle);
        const segs = new THREE.LineSegments(edgesGeo, material.clone());
        // local matrix relative to root so overlay follows when root moves
        const localMatrix = new THREE.Matrix4().copy(rootInv).multiply(mesh.matrixWorld);
        segs.matrixAutoUpdate = false;
        segs.matrix.copy(localMatrix);
        // mark overlay as non-selectable and locked so it doesn't interfere with selection/drag
        (segs as any).userData = { selectable: false, locked: true, isEdgesOverlay: true };
        group.add(segs);
    }
    (group as any).userData = { isEdgesOverlay: true, selectable: false, locked: true };
    return group;
}

export function disposeObjectDeep(obj: THREE.Object3D) {
    obj.traverse((child: any) => {
        if (child.geometry) child.geometry.dispose?.();
        if (child.material) {
            if (Array.isArray(child.material)) child.material.forEach((m: any) => m.dispose?.());
            else child.material.dispose?.();
        }
    });
}

// --- Corner Connectors ---
export function createCornerConnectors(
    target: THREE.Object3D,
    options?: { size?: number; color?: number }
): THREE.Group {
    const size = options?.size ?? 0.06;
    const color = options?.color ?? 0x00aaff;
    const group = new THREE.Group();
    // ensure matrices current then compute world->local for target
    target.updateMatrixWorld(true);
    const inv = target.matrixWorld.clone().invert();
    const box = new THREE.Box3().setFromObject(target);
    const worldCorners: THREE.Vector3[] = [
        new THREE.Vector3(box.min.x, box.min.y, box.min.z),
        new THREE.Vector3(box.min.x, box.min.y, box.max.z),
        new THREE.Vector3(box.min.x, box.max.y, box.min.z),
        new THREE.Vector3(box.min.x, box.max.y, box.max.z),
        new THREE.Vector3(box.max.x, box.min.y, box.min.z),
        new THREE.Vector3(box.max.x, box.min.y, box.max.z),
        new THREE.Vector3(box.max.x, box.max.y, box.min.z),
        new THREE.Vector3(box.max.x, box.max.y, box.max.z),
    ];
    const sphereGeo = new THREE.SphereGeometry(size, 12, 12);
    for (let i = 0; i < worldCorners.length; i++) {
        const localCorner = worldCorners[i].clone().applyMatrix4(inv);
        const mat = new THREE.MeshBasicMaterial({ color });
        const dot = new THREE.Mesh(sphereGeo, mat);
        dot.position.copy(localCorner);
        (dot as any).userData = { isHandle: true, isConnector: true, connectorIndex: i };
        group.add(dot);
    }
    (group as any).userData = { isConnectorsGroup: true, selectable: false, locked: true };
    return group;
}

// --- Ruler Helpers ---
export function removeRuler(scene: THREE.Scene, rulerRef: { current: THREE.Group | null }) {
    if (rulerRef.current) {
        scene.remove(rulerRef.current);
        rulerRef.current.traverse((child) => {
            if ((child as any).geometry) (child as any).geometry.dispose();
            if ((child as any).material) (child as any).material.dispose();
        });
        rulerRef.current = null;
    }
}

export function addRulerToObject(object: THREE.Object3D, scene: THREE.Scene, rulerRef: { current: THREE.Group | null }, camera: THREE.Camera) {
    removeRuler(scene, rulerRef);

    const box = new THREE.Box3().setFromObject(object);
    const size = new THREE.Vector3();
    box.getSize(size);

    const group = new THREE.Group();
    const fontLoader = new FontLoader();

    function createRulerLineAndText(
        start: THREE.Vector3,
        end: THREE.Vector3,
        textPosition: THREE.Vector3,
        text: string,
        color: number,
        camera: THREE.Camera
    ) {
        const lineMaterial = new THREE.LineBasicMaterial({ color, linewidth: 3 });
        const lineGeometry = new THREE.BufferGeometry().setFromPoints([start, end]);
        const line = new THREE.Line(lineGeometry, lineMaterial);
        group.add(line);

        fontLoader.load("/fonts/helvetiker_regular.typeface.json", (font) => {
            const textGeo = new TextGeometry(text, {
                font,
                size: 0.5,    // lebih besar biar jelas
                depth: 0,     // tipis, bukan 3D tebel
            });
            const textMat = new THREE.MeshBasicMaterial({ color, side: THREE.DoubleSide });
            const textMesh = new THREE.Mesh(textGeo, textMat);

            textMesh.position.copy(textPosition);
            textMesh.position.y += 0.2;

            // bikin text selalu ngadep kamera
            textMesh.quaternion.copy(camera.quaternion);

            group.add(textMesh);
        });
    }

    // Ruler X (merah)
    createRulerLineAndText(
        new THREE.Vector3(box.min.x, box.min.y, box.min.z),
        new THREE.Vector3(box.max.x, box.min.y, box.min.z),
        new THREE.Vector3((box.min.x + box.max.x) / 2, box.min.y, box.min.z),
        `${size.x.toFixed(2)}m`,
        0xff0000,
        camera
    );

    // Ruler Y (hijau)
    createRulerLineAndText(
        new THREE.Vector3(box.min.x, box.min.y, box.min.z),
        new THREE.Vector3(box.min.x, box.max.y, box.min.z),
        new THREE.Vector3(box.min.x, (box.min.y + box.max.y) / 2, box.min.z),
        `${size.y.toFixed(2)}m`,
        0x00ff00, camera
    );

    // Ruler Z (biru)
    createRulerLineAndText(
        new THREE.Vector3(box.min.x, box.min.y, box.min.z),
        new THREE.Vector3(box.min.x, box.min.y, box.max.z),
        new THREE.Vector3(box.min.x, box.min.y, (box.min.z + box.max.z) / 2),
        `${size.z.toFixed(2)}m`,
        0x0000ff, camera
    );

    rulerRef.current = group;
    scene.add(group);
}