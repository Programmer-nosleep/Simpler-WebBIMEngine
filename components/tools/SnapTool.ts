export class SnapTool {
    private _parallelSnap = true;
    private _perpendicularSnap = true;

    constructor() {
        // Default values
    }

    public setParallelSnap(enabled: boolean) {
        this._parallelSnap = enabled;
        console.log(`Parallel Snap set to: ${enabled}`);
        // Future: notify listeners or update global config
    }

    public setPerpendicularSnap(enabled: boolean) {
        this._perpendicularSnap = enabled;
        console.log(`Perpendicular Snap set to: ${enabled}`);
    }

    public get parallelSnap() {
        return this._parallelSnap;
    }

    public get perpendicularSnap() {
        return this._perpendicularSnap;
    }
}
