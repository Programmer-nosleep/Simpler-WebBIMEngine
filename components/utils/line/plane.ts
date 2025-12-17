import * as THREE from "three";

export function getMouseNDC(e: PointerEvent, dom: HTMLElement): THREE.Vector2 {
	const rect = dom.getBoundingClientRect();
	const x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
	const y = -((e.clientY - rect.top) / rect.height) * 2 + 1;
	return new THREE.Vector2(x, y);
}

export function raycastToZ0Plane(
	raycaster: THREE.Raycaster,
	camera: THREE.Camera,
	ndc: THREE.Vector2
): THREE.Vector3 | null {
	raycaster.setFromCamera(ndc, camera);
	const plane = new THREE.Plane(new THREE.Vector3(0, 0, 1), 0);
	const target = new THREE.Vector3();
	return raycaster.ray.intersectPlane(plane, target);
}