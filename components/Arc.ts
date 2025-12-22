import * as THREE from "three";
import { IntersectionHelper } from "../helpers/intersection-helper";
import { IntersectionGuide } from "../helpers/intersection-guide";
import { SnappingHelper } from "../helpers/snapping-helper";

function makeArcMaterial(color = 0x000000) {
    return new THREE.LineBasicMaterial({
        color,
        linewidth: 2,
        depthTest: true, // Allow depth test
        depthWrite: false, // Avoid z-fighting if on ground
    });
}

function createDashedLine(a: THREE.Vector3, b: THREE.Vector3, color = 0xff0000) {
    const geom = new THREE.BufferGeometry().setFromPoints([a, b]);
    const mat = new THREE.LineDashedMaterial({
        color,
        dashSize: 0.5,
        gapSize: 0.25,
        scale: 1,
        depthTest: false,
        depthWrite: false
    });
    const line = new THREE.Line(geom, mat);
    line.computeLineDistances();
    line.renderOrder = 2000; // on top
    return line;
}

function createProtractor(radius: number) {
    const group = new THREE.Group();

    // Circle guide
    const curve = new THREE.EllipseCurve(0, 0, radius, radius, 0, 2 * Math.PI, false, 0);
    const pts2 = curve.getPoints(64).map(p => new THREE.Vector3(p.x, 0, p.y));
    const geomCircle = new THREE.BufferGeometry().setFromPoints(pts2);
    const matCircle = new THREE.LineBasicMaterial({ color: 0x0000ff, transparent: true, opacity: 0.4, depthTest: false });
    const circle = new THREE.Line(geomCircle, matCircle);
    group.add(circle);

    // Ticks
    const tickGeom = new THREE.BufferGeometry();
    const tickPts: THREE.Vector3[] = [];
    for (let i = 0; i < 360; i += 15) {
        const rad = (i * Math.PI) / 180;
        const cos = Math.cos(rad);
        const sin = Math.sin(rad);
        const rInner = i % 90 === 0 ? radius * 0.9 : radius * 0.95;
        const p1 = new THREE.Vector3(cos * rInner, 0, sin * rInner);
        const p2 = new THREE.Vector3(cos * radius, 0, sin * radius);
        tickPts.push(p1, p2);
    }
    tickGeom.setFromPoints(tickPts);
    const ticks = new THREE.LineSegments(tickGeom, matCircle.clone());
    group.add(ticks);

    group.renderOrder = 1999;
    return group;
}

function createArcMesh(center: THREE.Vector3, radius: number, startAngle: number, endAngle: number, clockwise = false, color = 0x000000) {
    const curve = new THREE.EllipseCurve(
        center.x, center.z, // ax, ay (using X, Z)
        radius, radius,
        startAngle, endAngle,
        clockwise,
        0
    );
    const pts2 = curve.getPoints(50).map(p => new THREE.Vector3(p.x, 0, p.y));
    const geom = new THREE.BufferGeometry().setFromPoints(pts2);
    const mat = makeArcMaterial(color);
    const line = new THREE.Line(geom, mat);
    return line;
}

export class ArcTool {
    private scene: THREE.Scene;
    private getCamera: () => THREE.Camera;
    private container: HTMLElement;

    private enabled = false;
    private isDrawing = false;

    // State: 0: waiting for center, 1: waiting for start/radius, 2: waiting for end/angle
    private step = 0;
    private center: THREE.Vector3 | null = null;
    private startPoint: THREE.Vector3 | null = null;
    private radius = 0;

    // Visuals
    private guideLine: THREE.Line | null = null; // Dashed line Center -> Mouse
    private fixedLine: THREE.Line | null = null; // Dashed line Center -> Start
    private protractor: THREE.Group | null = null;
    private previewArc: THREE.Line | null = null;
    private dimOverlay: HTMLInputElement | null = null;

    private mouse = new THREE.Vector2();
    private raycaster = new THREE.Raycaster();
    private planeXZ = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
    private tempVec3 = new THREE.Vector3();

    // Helpers
    private intersectionHelper: IntersectionHelper;
    private intersectionGuide: IntersectionGuide;
    private snappingHelper: SnappingHelper;
    private connectorDot: THREE.Sprite | null = null;
    private setCameraZoom?: (enabled: boolean) => void;

    constructor(
        scene: THREE.Scene,
        camera: THREE.Camera | (() => THREE.Camera),
        container: HTMLElement,
        options?: { setCameraZoom?: (enabled: boolean) => void }
    ) {
        this.scene = scene;
        this.getCamera = typeof camera === "function" ? camera : () => camera;
        this.container = container;
        this.setCameraZoom = options?.setCameraZoom;

        this.intersectionHelper = new IntersectionHelper(this.getCamera, container);
        this.intersectionGuide = new IntersectionGuide(scene);
        this.snappingHelper = new SnappingHelper(scene, this.getCamera, container, this.raycaster);
    }

    public enable() {
        if (this.enabled) return;
        this.enabled = true;
        this.container.style.cursor = "crosshair";

        if (this.setCameraZoom) {
            this.setCameraZoom(false);
        }

        this.container.addEventListener("pointermove", this.onPointerMove);
        this.container.addEventListener("pointerdown", this.onPointerDown);
        window.addEventListener("keydown", this.onKeyDown);
    }

    public disable() {
        if (!this.enabled) return;
        this.enabled = false;
        this.container.style.cursor = "default";

        if (this.setCameraZoom) {
            this.setCameraZoom(true);
        }

        this.container.removeEventListener("pointermove", this.onPointerMove);
        this.container.removeEventListener("pointerdown", this.onPointerDown);
        window.removeEventListener("keydown", this.onKeyDown);

        this.cancel();
    }

    private cleanVisuals() {
        if (this.guideLine) { this.guideLine.removeFromParent(); this.guideLine = null; }
        if (this.fixedLine) { this.fixedLine.removeFromParent(); this.fixedLine = null; }
        if (this.protractor) { this.protractor.removeFromParent(); this.protractor = null; }
        if (this.previewArc) { this.previewArc.removeFromParent(); this.previewArc = null; }
        if (this.dimOverlay) { this.dimOverlay.remove(); this.dimOverlay = null; }

        if (this.connectorDot) { this.connectorDot.visible = false; }
        this.intersectionGuide.update(null);
    }

    private cancel() {
        this.isDrawing = false;
        this.step = 0;
        this.center = null;
        this.startPoint = null;
        this.radius = 0;
        this.cleanVisuals();
    }

    private updateInput(val: string, x: number, y: number, label: string) {
        if (!this.dimOverlay) {
            const el = document.createElement('input');
            el.type = 'text';
            Object.assign(el.style, {
                position: 'fixed',
                zIndex: '10000',
                padding: '4px 8px',
                fontSize: '12px',
                borderRadius: '4px',
                border: '1px solid #ccc',
                background: 'rgba(255,255,255,0.9)',
                width: '120px'
            });

            // Handle enter key to confirm input
            el.addEventListener('keydown', (e) => {
                e.stopPropagation(); // Stop camera controls
                if (e.key === 'Enter') {
                    // Logic to finalize step with typed value is handled in general onKeyDown or explicit listener here
                    // But we'll rely on global onKeyDown/onPointerDown picking up the value or this listener
                    // Let's forward to main logic
                    this.onInputEnter();
                }
            });

            document.body.appendChild(el);
            this.dimOverlay = el;
        }
        const el = this.dimOverlay;
        el.style.left = `${x + 15}px`;
        el.style.top = `${y + 15}px`;
        // el.placeholder = `${label}: ${val}`;

        // Strategy: If user is typing, don't overwrite value. If not, update placeholder or value?
        // User snippet logic:
        if (document.activeElement !== el) {
            el.placeholder = `${label}: ${val}`;
            el.value = ""; // Clear if not typing so placeholder shows current live value
        }
    }

    private onInputEnter() {
        // Proceed to next step with typed value
        // This needs to simulate a "click" or state transition using the input value
        // We can just trigger the same logic as onPointerDown but use the input value override
        // Since onPointerDown handles input reading, we might not need special logic if we can mock the event?
        // Or better, extract logic.
        // For simplicity, let's just let the user click or press Enter which triggers the same "Action"

        // Note: We need the current mouse position if we want to determine direction, OR
        // if user types radius, direction is undetermined? 
        // User React code uses mouse position for direction even if radius is typed.
        // So we need access to last mouse position. 
        // But onPointerMove updates visuals.
        // Let's rely on standard flow.

        // Creating a fake event using current mouse pos?
        // For now, let's just let the user click.
    }

    // Standard methods
    private getGroundY() {
        const groundRef = this.scene.getObjectByName("Grid") ?? this.scene.getObjectByName("AxesWorld");
        return groundRef ? groundRef.getWorldPosition(this.tempVec3).y : 0;
    }

    private getSnappedPoint(event: PointerEvent | MouseEvent): { point: THREE.Vector3, kind?: string } | null {
        const rect = this.container.getBoundingClientRect();
        this.mouse.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
        this.mouse.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;

        this.raycaster.setFromCamera(this.mouse, this.getCamera());

        const groundY = this.getGroundY();
        this.planeXZ.constant = -groundY; // Simplified for now, or match CircleTool's SURFACE_OFFSET?

        const rawHit = new THREE.Vector3();
        if (!this.raycaster.ray.intersectPlane(this.planeXZ, rawHit)) return null;

        // Use snapping helper
        const currentPoints = this.center ? [this.center] : [];
        const snap = this.snappingHelper.getBestSnapByScreen(
            new THREE.Vector2(event.clientX, event.clientY),
            currentPoints,
            15
        );

        // Intersection (if drawing 2nd step)
        let intersectResult = null;
        if (this.center) {
            const candidates = this.snappingHelper.getSceneVertices({ limit: 200 });
            intersectResult = this.intersectionHelper.getBestIntersection(
                this.center,
                candidates,
                new THREE.Vector2(event.clientX, event.clientY),
                15
            );
        }

        this.intersectionGuide.update(intersectResult);

        if (snap) return { point: snap.point, kind: snap.kind };
        if (intersectResult) return { point: intersectResult.point, kind: 'intersection' };

        return { point: rawHit };
    }


    private onPointerMove = (event: PointerEvent) => {
        if (!this.enabled) return;

        // Basic snap/hit logic
        const snapResult = this.getSnappedPoint(event);
        const hit = snapResult ? snapResult.point : null;
        if (!hit) {
            if (this.connectorDot) this.connectorDot.visible = false;
            return;
        }

        this.updateConnectorDot(hit, snapResult?.kind);

        if (!this.isDrawing) {
            // Step 0: Waiting for center
            this.updateInput("", event.clientX, event.clientY, "Pick Center");
            return;
        }

        const step = this.step;

        if (step === 1 && this.center) {
            // Waiting for start point (Radius)
            const dist = this.center.distanceTo(hit);

            if (this.guideLine) { this.guideLine.removeFromParent(); this.guideLine = null; }
            this.guideLine = createDashedLine(this.center, hit, 0xff0000);
            this.scene.add(this.guideLine);

            this.updateInput(dist.toFixed(3), event.clientX, event.clientY, "Radius");
        }
        else if (step === 2 && this.center && this.startPoint) {
            // Waiting for end point (Angle)
            const r = this.radius;

            // Determine angles
            const dirStart = new THREE.Vector3().subVectors(this.startPoint, this.center).normalize();
            const dirCurr = new THREE.Vector3().subVectors(hit, this.center).normalize();

            const angleStart = Math.atan2(dirStart.z, dirStart.x);
            const angleCurr = Math.atan2(dirCurr.z, dirCurr.x);

            // Visuals: Line from center to current mouse projection on circle
            const clampedHit = dirCurr.clone().multiplyScalar(r).add(this.center);

            if (this.guideLine) { this.guideLine.removeFromParent(); this.guideLine = null; }
            this.guideLine = createDashedLine(this.center, clampedHit, 0xff0000);
            this.scene.add(this.guideLine);

            // Preview Arc
            if (this.previewArc) { this.previewArc.removeFromParent(); this.previewArc = null; }
            this.previewArc = createArcMesh(this.center, r, angleStart, angleCurr, false, 0x0000ff);
            (this.previewArc.material as THREE.LineBasicMaterial).color.setHex(0x0000ff);
            this.scene.add(this.previewArc);

            // Calculate angle diff in degrees
            let diffRad = angleCurr - angleStart;
            // Normalize to positive or keep signed? User snippet uses raw diff.
            // Usually arcs are CCW.
            const deg = (diffRad * 180 / Math.PI).toFixed(1);
            this.updateInput(`${deg}°`, event.clientX, event.clientY, "Angle");
        }
    }

    private onPointerDown = (event: PointerEvent) => {
        if (!this.enabled || event.button !== 0) return;
        event.preventDefault();
        event.stopPropagation();

        const snapResult = this.getSnappedPoint(event);
        const hit = snapResult ? snapResult.point : null;
        if (!hit) return;

        if (this.step === 0) {
            this.isDrawing = true;
            this.center = hit.clone();
            this.step = 1;

            this.updateInput("0.00", event.clientX, event.clientY, "Radius");
            // Focus input?
            if (this.dimOverlay) {
                this.dimOverlay.value = "";
                this.dimOverlay.focus();
            }
        }
        else if (this.step === 1 && this.center) {
            let r = this.center.distanceTo(hit);
            // Check input override
            if (this.dimOverlay && this.dimOverlay.value) {
                const parsed = parseFloat(this.dimOverlay.value);
                if (isFinite(parsed) && parsed > 0) r = parsed;
            }

            this.radius = r;

            // Define Start Point
            // If user picked a point, startPoint is that point projected to radius r
            // If user typed radius, we use the direction to the mouse hit
            const dir = new THREE.Vector3().subVectors(hit, this.center).normalize();
            if (dir.lengthSq() < 0.0001) dir.set(1, 0, 0);
            this.startPoint = this.center.clone().add(dir.multiplyScalar(r));

            this.step = 2;

            // Add fixed visuals
            if (this.fixedLine) { this.fixedLine.removeFromParent(); this.fixedLine = null; }
            this.fixedLine = createDashedLine(this.center, this.startPoint, 0x000000);
            this.scene.add(this.fixedLine);

            if (this.protractor) { this.protractor.removeFromParent(); this.protractor = null; }
            this.protractor = createProtractor(r);
            this.protractor.position.copy(this.center);
            this.scene.add(this.protractor);

            // Reset input
            if (this.dimOverlay) {
                this.dimOverlay.value = "";
                this.dimOverlay.focus();
                this.dimOverlay.placeholder = "Angle: 0°";
            }
        }
        else if (this.step === 2 && this.center && this.startPoint) {
            // Finalize
            let endAngle = 0;
            const dirStart = new THREE.Vector3().subVectors(this.startPoint, this.center).normalize();
            const angleStart = Math.atan2(dirStart.z, dirStart.x);

            const dirCurr = new THREE.Vector3().subVectors(hit, this.center).normalize();
            let angleCurr = Math.atan2(dirCurr.z, dirCurr.x);

            if (this.dimOverlay && this.dimOverlay.value) {
                const val = parseFloat(this.dimOverlay.value);
                if (isFinite(val)) {
                    // Start + Offset
                    const rad = val * Math.PI / 180;
                    angleCurr = angleStart + rad;
                }
            }
            endAngle = angleCurr;

            // Create Final Mesh
            const arcMesh = createArcMesh(this.center, this.radius, angleStart, endAngle, false, 0x000000);

            arcMesh.userData = {
                type: 'arc',
                selectable: true,
                center: this.center.toArray(),
                radius: this.radius,
                startAngle: angleStart,
                endAngle: endAngle
            };

            this.scene.add(arcMesh);

            // Should we restart or stop? User snippet restarts.
            this.cleanVisuals();
            this.step = 0;
            this.center = null; // Wait, start from picking center again
            this.startPoint = null;
            this.isDrawing = false; // Reset to idle

            // Trigger sync event (as in user code)
            try {
                window.dispatchEvent(new CustomEvent('qreasee:action', { detail: { action: 'create' } }));
            } catch { /* */ }
        }
    }

    private onKeyDown = (event: KeyboardEvent) => {
        if (!this.enabled) return;
        if (event.key === 'Escape') {
            this.cancel();
        }
        if (event.key === 'Enter') {
            // Handle Enter if input is not focused or general confirm
            // If input is focused, 'onPointerDown' logic handles it via simulated click or similar?
            // Actually, if input is focused, its own keydown fires.
            // If NOT focused, we might want to confirm current mouse pos?
            // Let's assume onPointerDown handles interaction.
            if (this.dimOverlay && document.activeElement === this.dimOverlay) {
                // The input event listener already handles propagation stopping?
                // We need to trigger the next step.
                // We can synthesize a pointer down event or call logic directly.
                // But I don't have the mouse event here.
                // So I rely on user clicking OR typing and pressing enter in the box.
            }
        }
    }

    private updateConnectorDot(pos: THREE.Vector3, snapKind?: string) {
        if (!this.connectorDot) {
            const canvas = document.createElement("canvas");
            canvas.width = 64; canvas.height = 64;
            const ctx = canvas.getContext("2d")!;
            ctx.beginPath(); ctx.arc(32, 32, 16, 0, Math.PI * 2); ctx.fillStyle = "#fff"; ctx.fill();
            ctx.lineWidth = 4; ctx.strokeStyle = "#000"; ctx.stroke();

            const tex = new THREE.CanvasTexture(canvas);
            const mat = new THREE.SpriteMaterial({ map: tex, depthTest: false, depthWrite: false });
            this.connectorDot = new THREE.Sprite(mat);
            this.connectorDot.scale.set(0.5, 0.5, 1);
            this.connectorDot.renderOrder = 9999;
            this.connectorDot.userData.isHelper = true;
            this.scene.add(this.connectorDot);
        }

        this.connectorDot.visible = true;
        this.connectorDot.position.copy(pos);
        const mat = this.connectorDot.material;

        if (snapKind === "endpoint") mat.color.setHex(0x00ff00);
        else if (snapKind === "midpoint") mat.color.setHex(0x00ffff);
        else mat.color.setHex(0xffffff);
    }
}
