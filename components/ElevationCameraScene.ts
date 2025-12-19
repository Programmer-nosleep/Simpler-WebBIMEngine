/* c:\Users\Ahmad Zani Syechkar\Documents\project\website\jsts\Three.js\my-three3d\components\ElevationCameraScene.ts */
import * as THREE from "three";

type ViewOptions = {
	forceUp?: THREE.Vector3;
	lockTop?: boolean;
	lockAzimuth?: number;
};

export type ElevationDirection = "north" | "south" | "east" | "west";

export class ElevationCameraControls {
	private cameraScene: any;

	constructor(cameraScene: any) {
		this.cameraScene = cameraScene;
		this.initListeners();
	}

	private get camera() {
		return this.cameraScene.camera.three as THREE.Camera;
	}

	private get controls() {
		return this.cameraScene.camera.controls;
	}

	private get scene() {
		return this.cameraScene.scene as THREE.Scene;
	}

	public initListeners() {
		if (typeof window === "undefined") return;

		// Listen for custom events (matching the input code's protocol)
		window.addEventListener("qreasee:view", (e: any) => {
			const detail = e.detail || {};
			if (!detail.type) return;

			if (detail.type === "3d") {
				this.setPerspective();
			} else if (detail.type === "top") {
				this.setTopView();
			} else if (detail.type === "elevation") {
				this.setElevationView(detail.dir || "north");
			}
		});
	}

	public setPerspective() {
		this.cameraScene.setProjection("Perspective");
		this.cameraScene.setNavigationMode("Orbit");
		this.setViewKeepDistance(null);
		this.notifyViewMode("3d");
	}

	public setIsoView() {
		this.cameraScene.setProjection("Orthographic");
		this.cameraScene.setNavigationMode("Orbit");
		this.setViewKeepDistance(null);
		this.notifyViewMode("3d");
	}

	public setTopView() {
		this.cameraScene.setProjection("Orthographic");
		this.cameraScene.setNavigationMode("Plan");
		this.setViewKeepDistance(new THREE.Vector3(0, 1, 0), {
			lockTop: true,
			forceUp: new THREE.Vector3(0, 1, 0),
		});
		this.notifyViewMode("top");
	}

	public setElevationView(dir: ElevationDirection) {
		this.cameraScene.setProjection("Perspective");
		this.cameraScene.setNavigationMode("Orbit");

		const dirMap: Record<string, [number, number, number, number]> = {
			north: [0, 0, 1, 0],
			south: [0, 0, -1, Math.PI],
			east: [1, 0, 0, Math.PI / 2],
			west: [-1, 0, 0, -Math.PI / 2],
		};
		const d = dirMap[dir] || [0, 0, 1, 0];
		const vec = new THREE.Vector3(d[0], d[1], d[2]);

		this.setViewKeepDistance(vec, {
			forceUp: new THREE.Vector3(0, 1, 0),
		});
		this.notifyViewMode("elevation");
	}

	public fitScene(target?: THREE.Object3D, padding = 0.15) {
		const box = new THREE.Box3();

		const accumulateBox = (obj: THREE.Object3D) => {
			const b = new THREE.Box3().setFromObject(obj);
			if (this.isFiniteBox(b)) box.union(b);
		};

		if (target) {
			accumulateBox(target);
		} else {
			this.scene.traverse((child) => {
				if (
					(child as any).isGridHelper ||
					child.name === "snapIndicator" ||
					(child as any).userData?.isAxis ||
					(child as any).userData?.name === "skydome" ||
					(child as any).isCamera ||
					(child as any).isLight
				)
					return;

				if ((child as any).isMesh || (child as any).isLine || (child as any).isLineSegments) {
					accumulateBox(child);
				}
			});
		}

		if (box.isEmpty()) return;

		if (this.controls?.fitToBox) {
			this.controls.fitToBox(box, true, {
				paddingLeft: padding,
				paddingRight: padding,
				paddingBottom: padding,
				paddingTop: padding,
			});
		} else {
			// Fallback manual fit
			const size = new THREE.Vector3();
			const center = new THREE.Vector3();
			box.getSize(size);
			box.getCenter(center);

			const maxSize = Math.max(size.x, size.y, size.z);
			const fitHeightDistance = maxSize / (2 * Math.atan((Math.PI * (this.camera as any).fov) / 360));
			const fitWidthDistance = fitHeightDistance / (this.camera as any).aspect;
			const distance = Math.max(fitHeightDistance, fitWidthDistance) * (1 + padding * 2);

			const direction = this.camera.position.clone().sub(center).normalize().multiplyScalar(distance);

			this.camera.position.copy(center).add(direction);
			this.camera.lookAt(center);

			if (this.controls?.target) {
				this.controls.target.copy(center);
				this.controls.update();
			}
		}
	}

	private setViewKeepDistance(dir: THREE.Vector3 | null, options: ViewOptions = {}) {
		const center = new THREE.Vector3();
		if (this.controls?.getTarget) {
			this.controls.getTarget(center);
		} else if (this.controls?.target) {
			center.copy(this.controls.target);
		}

		const pos = new THREE.Vector3();
		if (this.controls?.getPosition) {
			this.controls.getPosition(pos);
		} else {
			pos.copy(this.camera.position);
		}

		let distance = pos.distanceTo(center);
		if (distance < 0.1) distance = 10;

		if (dir) {
			const d = dir.clone().normalize();
			const eye = center.clone().add(d.multiplyScalar(distance));

			if (options.forceUp && this.camera.up) {
				this.camera.up.copy(options.forceUp);
			}

			if (this.controls?.setLookAt) {
				this.controls.setLookAt(eye.x, eye.y, eye.z, center.x, center.y, center.z, true);
			} else {
				this.camera.position.copy(eye);
				this.camera.lookAt(center);
				if (this.controls?.target) {
					this.controls.target.copy(center);
					this.controls.update();
				}
			}
		} else {
			if (!options.forceUp) {
				this.camera.up.set(0, 1, 0);
			}
		}

		if (this.controls) {
			// Reset constraints
			this.controls.minPolarAngle = 0;
			this.controls.maxPolarAngle = Math.PI;
			this.controls.minAzimuthAngle = -Infinity;
			this.controls.maxAzimuthAngle = Infinity;
			this.controls.enableRotate = true;

			if (options.lockTop) {
				this.controls.minPolarAngle = 0;
				this.controls.maxPolarAngle = 0;
				this.controls.enableRotate = false;
			} else if (options.lockAzimuth !== undefined) {
				this.controls.minAzimuthAngle = options.lockAzimuth;
				this.controls.maxAzimuthAngle = options.lockAzimuth;
				this.controls.minPolarAngle = Math.PI / 2;
				this.controls.maxPolarAngle = Math.PI / 2;
				this.controls.enableRotate = false;
			}
		}
	}

	private notifyViewMode(type: "3d" | "top" | "elevation") {
		if (typeof window === "undefined") return;
		try {
			window.dispatchEvent(
				new CustomEvent("qreasee:viewModeInternal", { detail: { type } })
			);
		} catch { }
	}

	private isFiniteBox(box: THREE.Box3) {
		return (
			Number.isFinite(box.min.x) &&
			Number.isFinite(box.min.y) &&
			Number.isFinite(box.min.z) &&
			Number.isFinite(box.max.x) &&
			Number.isFinite(box.max.y) &&
			Number.isFinite(box.max.z)
		);
	}
}
