import * as THREE from "three";

export class AxesWorld extends THREE.Group {
    constructor(length: number = 1000) {
        super();
        this.name = "AxesWorld";

        // X Axis (Red)
        this.createAxis(new THREE.Vector3(1, 0, 0), 0xff0000, length, "x");
        // Y Axis (Green)
        this.createAxis(new THREE.Vector3(0, 1, 0), 0x00ff00, length, "y");
        // Z Axis (Blue)
        this.createAxis(new THREE.Vector3(0, 0, 1), 0x0000ff, length, "z");
    }

    private createAxis(
        dir: THREE.Vector3,
        color: number,
        length: number,
        axisName: "x" | "y" | "z"
    ) {
        const origin = new THREE.Vector3(0, 0, 0);

        // --- Positive Axis (Solid) ---
        const positiveGeometry = new THREE.BufferGeometry().setFromPoints([
            origin,
            origin.clone().add(dir.clone().multiplyScalar(length)),
        ]);

        // Use polygonOffset to prevent z-fighting with the ground grid
        const positiveMaterial = new THREE.LineBasicMaterial({
            color,
            polygonOffset: true,
            polygonOffsetFactor: -2.0,
            polygonOffsetUnits: -2.0,
            depthTest: true,
        });

        const positiveLine = new THREE.Line(positiveGeometry, positiveMaterial);
        positiveLine.name = `axis-${axisName}-positive`;
        positiveLine.renderOrder = 1;

        positiveLine.userData = {
            locked: true,
            selectable: false,
            isAxis: true,
            axis: axisName,
            // Mark as helper so interactive tools (lines, snap, etc.)
            // do not use the main axis line as a snap target.
            isHelper: true,
        };

        this.add(positiveLine);

        // --- Negative Axis (Dashed) ---
        const negativeGeometry = new THREE.BufferGeometry().setFromPoints([
            origin,
            origin.clone().add(dir.clone().multiplyScalar(-length)),
        ]);

        // Increased dash/gap size for better visibility at distance (SketchUp style)
        const negativeMaterial = new THREE.LineDashedMaterial({
            color,
            dashSize: 0.5,
            gapSize: 0.3,
            polygonOffset: true,
            polygonOffsetFactor: -2.0,
            polygonOffsetUnits: -2.0,
            depthTest: true,
        });

        const negativeLine = new THREE.Line(negativeGeometry, negativeMaterial);
        negativeLine.name = `axis-${axisName}-negative`;
        negativeLine.computeLineDistances(); // Required for LineDashedMaterial
        negativeLine.renderOrder = 1;

        negativeLine.userData = {
            locked: true,
            selectable: false,
            isAxis: true,
            axis: axisName,
            isHelper: true,
        };

        this.add(negativeLine);
    }
}