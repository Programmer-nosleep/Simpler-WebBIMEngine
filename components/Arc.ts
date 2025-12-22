import * as THREE from "three";
import { IntersectionHelper } from "../helpers/intersection-helper";
import { IntersectionGuide } from "../helpers/intersection-guide";
import { SnappingHelper } from "../helpers/snapping-helper";

// --- Reusable Materials ---
const ARC_MATERIAL = new THREE.LineBasicMaterial({
    color: 0x000000,
    linewidth: 2,
    depthTest: true,
    depthWrite: false,
});

const PREVIEW_MATERIAL = new THREE.LineBasicMaterial({
    color: 0x0000ff,
    linewidth: 2,
    depthTest: false,
    depthWrite: false,
});

const DASH_MATERIAL = new THREE.LineDashedMaterial({
    color: 0xff0000,
    dashSize: 0.5,
    gapSize: 0.25,
    scale: 1,
    depthTest: false,
    depthWrite: false,
});

const FIXED_DASH_MATERIAL = new THREE.LineDashedMaterial({
    color: 0x000000,
    dashSize: 0.5,
    gapSize: 0.25,
    scale: 1,
    depthTest: false,
    depthWrite: false,
});

const PROTRACTOR_MATERIAL = new THREE.LineBasicMaterial({
    color: 0x0000ff,
    transparent: true,
    opacity: 0.4,
    depthTest: false,
    depthWrite: false,
});

// --- Helper Functions ---

function createUnitProtractor(): THREE.Group {
    const group = new THREE.Group();

    // Circle guide (Radius 1)
    const curve = new THREE.EllipseCurve(0, 0, 1, 1, 0, 2 * Math.PI, false, 0);
    const pts = curve.getPoints(64).map((p) => new THREE.Vector3(p.x, 0, p.y));
    const geomCircle = new THREE.BufferGeometry().setFromPoints(pts);
    const circle = new THREE.Line(geomCircle, PROTRACTOR_MATERIAL);
    group.add(circle);

    // Ticks
    const tickPts: THREE.Vector3[] = [];
    for (let i = 0; i < 360; i += 15) {
        const rad = (i * Math.PI) / 180;
        const cos = Math.cos(rad);
        const sin = Math.sin(rad);
        // Inner radius for ticks: 0.9 for major (90s), 0.95 for others
        const rInner = i % 90 === 0 ? 0.9 : 0.95;
        const p1 = new THREE.Vector3(cos * rInner, 0, sin * rInner);
        const p2 = new THREE.Vector3(cos, 0, sin);
        tickPts.push(p1, p2);
    }
    const tickGeom = new THREE.BufferGeometry().setFromPoints(tickPts);
    const ticks = new THREE.LineSegments(tickGeom, PROTRACTOR_MATERIAL);
    group.add(ticks);

    return group;
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

    // Visuals (Persistent)
    private guideLine: THREE.Line;
    private fixedLine: THREE.Line;
    private previewArc: THREE.Line;
    private protractor: THREE.Group; // Scalable unit protractor

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

        // Initialize Visuals (Hidden by default)
        this.guideLine = new THREE.Line(new THREE.BufferGeometry(), DASH_MATERIAL);
        this.guideLine.visible = false;
        this.guideLine.renderOrder = 2000;
        this.scene.add(this.guideLine);

        this.fixedLine = new THREE.Line(new THREE.BufferGeometry(), FIXED_DASH_MATERIAL);
        this.fixedLine.visible = false;
        this.scene.add(this.fixedLine);

        this.previewArc = new THREE.Line(new THREE.BufferGeometry(), PREVIEW_MATERIAL);
        this.previewArc.visible = false;
        this.scene.add(this.previewArc);

        this.protractor = createUnitProtractor();
        this.protractor.visible = false;
        this.protractor.renderOrder = 1999;
        this.scene.add(this.protractor);
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

    private updateVisuals(hit: THREE.Vector3) {
        if (this.step === 1 && this.center) {
            // Updating Radius: Draw DASHLINE from Center to Hit
            this.setLineGeometry(this.guideLine, this.center, hit);
            this.guideLine.visible = true;
            this.guideLine.computeLineDistances();

            this.fixedLine.visible = false;
            this.protractor.visible = false;
            this.previewArc.visible = false;

        } else if (this.step === 2 && this.center && this.startPoint) {
            // Updating Angle: 
            // 1. Fixed Line: Center -> StartPoint
            this.setLineGeometry(this.fixedLine, this.center, this.startPoint);
            this.fixedLine.visible = true;
            this.fixedLine.computeLineDistances();

            // 2. Guide Line: Center -> Current Hit (projected to radius)
            const dirCurr = new THREE.Vector3().subVectors(hit, this.center).normalize();
            const clampedHit = dirCurr.clone().multiplyScalar(this.radius).add(this.center);

            this.setLineGeometry(this.guideLine, this.center, clampedHit);
            this.guideLine.visible = true;
            this.guideLine.computeLineDistances();

            // 3. Protractor: At Center, Scaled by Radius
            this.protractor.position.copy(this.center);
            this.protractor.scale.setScalar(this.radius);
            this.protractor.visible = true;

            // 4. Preview Arc
            const dirStart = new THREE.Vector3().subVectors(this.startPoint, this.center).normalize();
            const angleStart = Math.atan2(dirStart.z, dirStart.x);
            const angleCurr = Math.atan2(dirCurr.z, dirCurr.x);

            this.setArcGeometry(this.previewArc, this.radius, angleStart, angleCurr);
            this.previewArc.position.copy(this.center);
            this.previewArc.visible = true;
        } else {
            this.hideVisuals();
        }
    }

    private hideVisuals() {
        this.guideLine.visible = false;
        this.fixedLine.visible = false;
        this.protractor.visible = false;
        this.previewArc.visible = false;
    }

    private setLineGeometry(line: THREE.Line, p1: THREE.Vector3, p2: THREE.Vector3) {
        const positions = new Float32Array([p1.x, p1.y, p1.z, p2.x, p2.y, p2.z]);
        line.geometry.setAttribute("position", new THREE.BufferAttribute(positions, 3));
        line.geometry.setDrawRange(0, 2);
        line.geometry.computeBoundingSphere();
    }

    private setArcGeometry(line: THREE.Line, radius: number, startAngle: number, endAngle: number, clockwise = false) {
        const curve = new THREE.EllipseCurve(
            0, 0, // ax, ay relative to its own position
            radius, radius,
            startAngle, endAngle,
            clockwise,
            0
        );
        const points = curve.getPoints(50);
        const positions = new Float32Array(points.length * 3);
        for (let i = 0; i < points.length; i++) {
            positions[i * 3] = points[i].x;
            positions[i * 3 + 1] = 0;
            positions[i * 3 + 2] = points[i].y;
        }
        line.geometry.dispose(); // Better to reuse attribute if size matches, but dispose is safer for varying size
        line.geometry = new THREE.BufferGeometry();
        line.geometry.setAttribute("position", new THREE.BufferAttribute(positions, 3));
    }

    private cancel() {
        this.isDrawing = false;
        this.step = 0;
        this.center = null;
        this.startPoint = null;
        this.radius = 0;
        this.hideVisuals();
        if (this.dimOverlay) {
            this.dimOverlay.remove();
            this.dimOverlay = null;
        }
        if (this.connectorDot) this.connectorDot.visible = false;
        this.intersectionGuide.update(null);
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

            el.addEventListener('keydown', (e) => {
                e.stopPropagation();
                if (e.key === 'Enter') {
                    this.onPointerDown({
                        button: 0,
                        preventDefault: () => { },
                        stopPropagation: () => { },
                        clientX: x, // Use last known pos logic? Or just rely on value?
                        clientY: y // This might be stale if mouse moved. 
                    } as any);
                }
            });

            document.body.appendChild(el);
            this.dimOverlay = el;
        }
        const el = this.dimOverlay;
        el.style.left = `${x + 15}px`;
        el.style.top = `${y + 15}px`;

        if (document.activeElement !== el) {
            el.placeholder = `${label}: ${val}`;
            el.value = "";
        }
    }

    private getGroundY() {
        const groundRef = this.scene.getObjectByName("Grid") ?? this.scene.getObjectByName("AxesWorld");
        return groundRef ? groundRef.getWorldPosition(this.tempVec3).y : 0;
    }

    private getSnappedPoint(event: PointerEvent | MouseEvent): { point: THREE.Vector3, kind?: string } | null {
        const rect = this.container.getBoundingClientRect();
        // Handle fallback if mock event doesn't have clientX/Y properly (e.g. from input enter)
        if (!event.clientX) return null;

        this.mouse.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
        this.mouse.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;

        this.raycaster.setFromCamera(this.mouse, this.getCamera());

        const groundY = this.getGroundY();
        this.planeXZ.constant = -groundY;

        const rawHit = new THREE.Vector3();
        if (!this.raycaster.ray.intersectPlane(this.planeXZ, rawHit)) return null;

        const currentPoints = this.center ? [this.center] : [];
        const snap = this.snappingHelper.getBestSnapByScreen(
            new THREE.Vector2(event.clientX, event.clientY),
            currentPoints,
            15
        );

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

        const snapResult = this.getSnappedPoint(event);
        const hit = snapResult ? snapResult.point : null;
        if (!hit) {
            if (this.connectorDot) this.connectorDot.visible = false;
            return;
        }

        this.updateConnectorDot(hit, snapResult?.kind);

        if (!this.isDrawing) {
            this.updateInput("", event.clientX, event.clientY, "Pick Center");
            return;
        }

        this.updateVisuals(hit);

        if (this.step === 1 && this.center) {
            const dist = this.center.distanceTo(hit);
            this.updateInput(dist.toFixed(3), event.clientX, event.clientY, "Radius");
        } else if (this.step === 2 && this.center && this.startPoint) {
            const dirStart = new THREE.Vector3().subVectors(this.startPoint, this.center).normalize();
            const dirCurr = new THREE.Vector3().subVectors(hit, this.center).normalize();
            const angleStart = Math.atan2(dirStart.z, dirStart.x);
            const angleCurr = Math.atan2(dirCurr.z, dirCurr.x);
            const diffRad = angleCurr - angleStart;
            const deg = (diffRad * 180 / Math.PI).toFixed(1);
            this.updateInput(`${deg}°`, event.clientX, event.clientY, "Angle");
        }
    };

    private onPointerDown = (event: PointerEvent) => {
        if (!this.enabled && event.button !== 0 && !this.dimOverlay?.value) return;
        // If triggered from Input enter, event might be mock.

        // Reuse getSnappedPoint logic?
        // For step 1 and 2, if input has value, we override.

        let hit: THREE.Vector3 | null = null;

        // If legitimate pointer event
        if (event.clientX) {
            const res = this.getSnappedPoint(event);
            hit = res ? res.point : null;
        } else {
            // Fallback if triggered without mouse pos?
            // Actually input enter listener passes x/y causing getSnappedPoint to work or be approx.
            // But if we only rely on input value, hit point matters less for some steps.
            // Let's assume we have a hit from last move or current event.
            // If event is mock, ensure clientX is present.
        }

        if (!hit && !this.dimOverlay?.value) return;

        if (this.step === 0 && hit) {
            this.isDrawing = true;
            this.center = hit.clone();
            this.step = 1;
            this.updateInput("0.00", event.clientX, event.clientY, "Radius");
            if (this.dimOverlay) {
                this.dimOverlay.value = "";
                this.dimOverlay.focus();
            }
        } else if (this.step === 1 && this.center && hit) {
            let r = this.center.distanceTo(hit);
            if (this.dimOverlay && this.dimOverlay.value) {
                const val = parseFloat(this.dimOverlay.value);
                if (Number.isFinite(val) && val > 0) r = val;
            }
            this.radius = r;

            // Define Start Point
            const dir = new THREE.Vector3().subVectors(hit, this.center).normalize();
            if (dir.lengthSq() < 0.0001) dir.set(1, 0, 0);
            this.startPoint = this.center.clone().add(dir.multiplyScalar(r));

            this.step = 2;

            // Update visuals immediately to switch mode
            this.updateVisuals(hit);

            if (this.dimOverlay) {
                this.dimOverlay.value = "";
                this.dimOverlay.focus();
                this.dimOverlay.placeholder = "Angle: 0°";
            }

        } else if (this.step === 2 && this.center && this.startPoint && hit) {
            const dirStart = new THREE.Vector3().subVectors(this.startPoint, this.center).normalize();
            const angleStart = Math.atan2(dirStart.z, dirStart.x);

            const dirCurr = new THREE.Vector3().subVectors(hit, this.center).normalize();
            let angleCurr = Math.atan2(dirCurr.z, dirCurr.x);

            if (this.dimOverlay && this.dimOverlay.value) {
                const val = parseFloat(this.dimOverlay.value);
                if (Number.isFinite(val)) {
                    const rad = val * Math.PI / 180;
                    angleCurr = angleStart + rad;
                }
            }

            const endAngle = angleCurr;

            // Finalize: Create Mesh
            // Re-use logic to create final mesh (not the preview one)
            const points = new THREE.EllipseCurve(
                this.center.x, this.center.z,
                this.radius, this.radius,
                angleStart, endAngle,
                false, 0
            ).getPoints(50).map(p => new THREE.Vector3(p.x, 0, p.y));

            const geometry = new THREE.BufferGeometry().setFromPoints(points);
            const arcMesh = new THREE.Line(geometry, ARC_MATERIAL.clone()); // Clone material for independence? Or Reuse? 
            // Reuse material is mostly fine for Lines unless we change color per object.
            // Let's allow color override if needed later, but shared material is efficient.
            // However user might want to select it -> highlight color. So cloning might be safer for selection system.

            arcMesh.userData = {
                type: 'arc',
                selectable: true,
                center: this.center.toArray(),
                radius: this.radius,
                startAngle: angleStart,
                endAngle: endAngle
            };

            this.scene.add(arcMesh);

            // Finish
            this.cancel();

            // Try to dispatch event
            try {
                window.dispatchEvent(new CustomEvent('qreasee:action', { detail: { action: 'create' } }));
            } catch { }
        }
    };

    private onKeyDown = (event: KeyboardEvent) => {
        if (!this.enabled) return;
        if (event.key === 'Escape') this.cancel();
    };

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
