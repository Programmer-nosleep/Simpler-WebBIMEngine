import * as THREE from "three";

/**
 * Data structure representing a detected face on a mesh surface
 */
export interface FaceData {
    /** The mesh object containing the face */
    object: THREE.Object3D;

    /** Face information (normal vector) */
    face: { normal: THREE.Vector3 };

    /** Index of the face in the geometry */
    faceIndex: number;

    /** Hit point in world coordinates */
    point: THREE.Vector3;

    /** Face normal in world coordinates */
    normal: THREE.Vector3;

    /** Distance from ray origin to hit point */
    distance: number;

    /** Local coordinate system for the face */
    localBasis: {
        /** Origin point on the face (typically the hit point) */
        origin: THREE.Vector3;
        /** Local X axis (tangent to face) */
        xAxis: THREE.Vector3;
        /** Local Y axis (face normal) */
        yAxis: THREE.Vector3;
        /** Local Z axis (perpendicular to both X and Y) */
        zAxis: THREE.Vector3;
    };
}

/**
 * Detects which mesh face the cursor is hovering over
 * @param raycaster - Three.js raycaster from cursor position
 * @param scene - Scene to raycast against
 * @param options - Configuration options
 * @returns FaceData if a face is detected, null otherwise
 */
export function detectFaceUnderCursor(
    raycaster: THREE.Raycaster,
    scene: THREE.Scene,
    options?: {
        excludeHelpers?: boolean;
        excludeGround?: boolean;
        maxDistance?: number;
    }
): FaceData | null {
    const excludeHelpers = options?.excludeHelpers ?? true;
    const excludeGround = options?.excludeGround ?? false;
    const maxDistance = options?.maxDistance ?? Infinity;

    // Get all mesh objects in scene
    const meshes: THREE.Object3D[] = [];
    scene.traverse((obj) => {
        if (!(obj as any).isMesh) return;
        if (excludeHelpers && obj.userData?.isHelper) return;
        if (obj.userData?.selectable === false) return;
        if (excludeGround && (obj.name === "Grid" || obj.name === "AxesWorld")) return;
        meshes.push(obj);
    });

    // Perform raycasting
    const intersects = raycaster.intersectObjects(meshes, true);

    // Find first valid intersection
    for (const intersection of intersects) {
        if (intersection.distance > maxDistance) continue;
        if (!intersection.face) continue;

        const worldNormal = intersection.face.normal.clone()
            .transformDirection(intersection.object.matrixWorld)
            .normalize();

        const localBasis = getFaceLocalCoordinateSystem(
            worldNormal,
            intersection.point
        );

        return {
            object: intersection.object,
            face: { normal: intersection.face.normal.clone() },
            faceIndex: intersection.faceIndex ?? -1,
            point: intersection.point.clone(),
            normal: worldNormal,
            distance: intersection.distance,
            localBasis,
        };
    }

    return null;
}

/**
 * Creates a local coordinate system for a face
 * @param faceNormal - Normal vector of the face (in world coordinates)
 * @param origin - Origin point for the coordinate system (typically on the face)
 * @returns Local basis with X, Y, Z axes
 */
export function getFaceLocalCoordinateSystem(
    faceNormal: THREE.Vector3,
    origin: THREE.Vector3
): FaceData["localBasis"] {
    const yAxis = faceNormal.clone().normalize();

    // Find a good tangent vector (xAxis)
    // Try to align with world X or Z axis, whichever is more perpendicular to normal
    const worldX = new THREE.Vector3(1, 0, 0);
    const worldZ = new THREE.Vector3(0, 0, 1);

    const dotX = Math.abs(yAxis.dot(worldX));
    const dotZ = Math.abs(yAxis.dot(worldZ));

    // Use the axis that's more perpendicular to the normal
    const referenceAxis = dotX < dotZ ? worldX : worldZ;

    // Calculate tangent (xAxis) perpendicular to normal
    const xAxis = new THREE.Vector3()
        .crossVectors(yAxis, referenceAxis)
        .normalize();

    // If cross product is zero (parallel vectors), try another reference
    if (xAxis.lengthSq() < 0.001) {
        const alternateRef = dotX < dotZ ? worldZ : worldX;
        xAxis.crossVectors(yAxis, alternateRef).normalize();
    }

    // Calculate zAxis perpendicular to both
    const zAxis = new THREE.Vector3()
        .crossVectors(xAxis, yAxis)
        .normalize();

    return {
        origin: origin.clone(),
        xAxis,
        yAxis,
        zAxis,
    };
}

/**
 * Projects a 3D world point onto a face's 2D local plane
 * @param worldPoint - Point in world coordinates
 * @param localBasis - Local coordinate system of the face
 * @returns 2D coordinates in face's local space (x, z)
 */
export function projectPointToFacePlane(
    worldPoint: THREE.Vector3,
    localBasis: FaceData["localBasis"]
): THREE.Vector2 {
    // Vector from origin to point
    const offset = worldPoint.clone().sub(localBasis.origin);

    // Project onto local X and Z axes
    const x = offset.dot(localBasis.xAxis);
    const z = offset.dot(localBasis.zAxis);

    return new THREE.Vector2(x, z);
}

/**
 * Converts a 2D local point back to 3D world coordinates
 * @param localX - X coordinate in face's local space
 * @param localZ - Z coordinate in face's local space
 * @param localBasis - Local coordinate system of the face
 * @returns 3D point in world coordinates
 */
export function localToWorldPoint(
    localX: number,
    localZ: number,
    localBasis: FaceData["localBasis"]
): THREE.Vector3 {
    const worldPoint = localBasis.origin.clone();

    // Add scaled local axes
    worldPoint.addScaledVector(localBasis.xAxis, localX);
    worldPoint.addScaledVector(localBasis.zAxis, localZ);

    return worldPoint;
}

/**
 * Creates a transformation matrix from local face coordinates to world coordinates
 * @param localBasis - Local coordinate system of the face
 * @returns 4x4 transformation matrix
 */
export function createLocalToWorldMatrix(
    localBasis: FaceData["localBasis"]
): THREE.Matrix4 {
    const matrix = new THREE.Matrix4();

    // Set rotation (basis vectors as columns)
    matrix.makeBasis(localBasis.xAxis, localBasis.yAxis, localBasis.zAxis);

    // Set translation (origin)
    matrix.setPosition(localBasis.origin);

    return matrix;
}
