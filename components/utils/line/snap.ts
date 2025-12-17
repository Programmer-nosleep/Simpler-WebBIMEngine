import * as THREE from "three";

export type SnapType = "endpoint" | "midpoint";

export interface SnapHit {
	point: THREE.Vector3;
	type: SnapType;
}

export interface Segment {
	a: THREE.Vector3;
	b: THREE.Vector3;
}

export class SnapManager {
	public snapThreshold = 0.3;
	private segments: Segment[] = [];

	setSegments(segs: Segment[]) {
		this.segments = segs;
	}

	findBestSnap(
		currentPoint: THREE.Vector3,
		_raycaster: THREE.Raycaster,
		_camera: THREE.Camera,
		_ndc: THREE.Vector2
	): SnapHit | null {
		let bestDist = this.snapThreshold;
		let bestSnap: SnapHit | null = null;

		for (const seg of this.segments) {
			// Endpoint A
			const da = currentPoint.distanceTo(seg.a);
			if (da < bestDist) {
				bestDist = da;
				bestSnap = { point: seg.a, type: "endpoint" };
			}
			// Endpoint B
			const db = currentPoint.distanceTo(seg.b);
			if (db < bestDist) {
				bestDist = db;
				bestSnap = { point: seg.b, type: "endpoint" };
			}
			// Midpoint
			const mid = seg.a.clone().add(seg.b).multiplyScalar(0.5);
			const dm = currentPoint.distanceTo(mid);
			if (dm < bestDist) {
				bestDist = dm;
				bestSnap = { point: mid, type: "midpoint" };
			}
		}

		return bestSnap;
	}
}