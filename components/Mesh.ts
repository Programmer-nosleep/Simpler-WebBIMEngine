import * as THREE from "three";
import * as OBC from "@thatopen/components";
import * as FRAGS from "@thatopen/fragments";
import * as WEBIFC from "web-ifc";

import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { OBJLoader } from "three/examples/jsm/loaders/OBJLoader.js";

const workerUrl = "/worker.mjs";

export class MeshLoader extends OBC.Component implements OBC.Disposable {
    enabled = true;
    readonly onDisposed = new OBC.Event();

    private _loaderGLTF = new GLTFLoader();
    private _loaderOBJ = new OBJLoader();
    private _ifcLoader: OBC.IfcLoader;

    constructor(components: OBC.Components) {
        super(components);
        this._ifcLoader = components.get(OBC.IfcLoader);
    }

    async setup() {
        const fragments = this.components.get(OBC.FragmentsManager);
        if (!fragments.initialized) {
            fragments.init(workerUrl);
        }

        await this._ifcLoader.setup({
            autoSetWasm: false,
            wasm: {
                path: "/wasm/",
                absolute: true,
                logLevel: WEBIFC.LogLevel.LOG_LEVEL_OFF,
            },
            webIfc: {
                ...this._ifcLoader.settings.webIfc,
                COORDINATE_TO_ORIGIN: true,
            },
        });
    }

    async load(file: File, options?: { position?: THREE.Vector3 }) {
        const extension = file.name.split('.').pop()?.toLowerCase();

        if (extension === 'gltf' || extension === 'glb') {
            return this.loadGLTF(file, options);
        } else if (extension === 'obj') {
            return this.loadOBJ(file, options);
        } else if (extension === 'ifc') {
            return this.loadIFC(file, options);
        } else {
            console.warn(`Unsupported file format: ${extension}`);
            return null;
        }
    }

    private async loadGLTF(file: File, options?: { position?: THREE.Vector3 }) {
        const url = URL.createObjectURL(file);
        try {
            const gltf = await this._loaderGLTF.loadAsync(url);
            const scene = gltf.scene;
            this.setupMesh(scene, options);
            return scene;
        } finally {
            URL.revokeObjectURL(url);
        }
    }

    private async loadOBJ(file: File, options?: { position?: THREE.Vector3 }) {
        const url = URL.createObjectURL(file);
        try {
            const group = await this._loaderOBJ.loadAsync(url);
            this.setupMesh(group, options);
            return group;
        } finally {
            URL.revokeObjectURL(url);
        }
    }

    private async loadIFC(file: File, Options?: { position?: THREE.Vector3 }) {
        const buffer = await file.arrayBuffer();
        const data = new Uint8Array(buffer);

        // Ensure setup is done (idempotent usually or check initialized)
        // Ideally setup() is called at app start, but lazy init here:
        if (!this._ifcLoader.settings.webIfc.COORDINATE_TO_ORIGIN) {
            await this.setup();
        }

        const model = await this._ifcLoader.load(data, true, file.name);
        // Position handling for fragments is distinct, ignoring options.position for now 
        // as fragments are world-aligned usually.

        // Setup metadata usage
        model.object.userData.selectable = true;
        model.object.userData.entityType = "ifc";

        const world = this.getWorld();
        if (world) {
            world.scene.three.add(model.object);
        }

        return model;
    }

    private setupMesh(object: THREE.Object3D, options?: { position?: THREE.Vector3 }) {
        if (options?.position) {
            object.position.copy(options.position);
        }

        object.traverse((child) => {
            if ((child as any).isMesh) {
                child.castShadow = true;
                child.receiveShadow = true;
                child.userData.selectable = true;
                child.userData.type = "imported_mesh";
            }
        });

        const world = this.getWorld();
        if (world) {
            world.scene.three.add(object);
        }
    }

    private getWorld() {
        const worlds = this.components.get(OBC.Worlds);
        // Get the first available world
        for (const [_id, world] of worlds.list) {
            if (world.scene && world.scene.three) {
                return world;
            }
        }
        return null;
    }

    dispose() {
        this.enabled = false;
        this.onDisposed.trigger();
    }
}
