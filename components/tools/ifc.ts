import * as THREE from "three";
import * as OBC from "@thatopen/components";
import * as WEBIFC from "web-ifc";

import fragmentsWorkerUrl from "@thatopen/fragments/dist/Worker/worker.mjs?url";

export class IfcManager {
  components: OBC.Components;
  loader: OBC.IfcLoader;

  constructor(components: OBC.Components) {
    this.components = components;
    this.loader = components.get(OBC.IfcLoader);
  }

  async setup() {
    const fragments = this.components.get(OBC.FragmentsManager);
    if (!fragments.initialized) {
      fragments.init(fragmentsWorkerUrl);
    }

    await this.loader.setup({
      autoSetWasm: false,
      wasm: {
        path: "/wasm/",
        absolute: true,
        logLevel: WEBIFC.LogLevel.LOG_LEVEL_OFF,
      },
      webIfc: {
        ...this.loader.settings.webIfc,
        COORDINATE_TO_ORIGIN: true,
      },
    });
  }

  async load(data: Uint8Array, name = "model.ifc", coordinate = true) {
    return this.loader.load(data, coordinate, name);
  }

  async loadFile(file: File, coordinate = true) {
    const data = await file.arrayBuffer();
    const buffer = new Uint8Array(data);
    return this.load(buffer, file.name, coordinate);
  }

  /**
   * Menghubungkan loader dengan elemen input HTML
   * @param elementId ID dari elemen input type="file" di HTML
   * @param scene Scene Three.js tempat model akan ditambahkan
   */
  setupImporter(elementId: string = "importer", scene: THREE.Scene) {
    const input = document.getElementById(elementId) as HTMLInputElement;
    
    if (!input) {
      console.warn(`Importer element with ID '${elementId}' not found.`);
      return;
    }

    input.addEventListener("change", async (event) => {
      const target = event.target as HTMLInputElement;
      if (!target.files || target.files.length === 0) return;

      const file = target.files[0];
      const ext = file.name.split(".").pop()?.toLowerCase();
      if (ext !== "ifc") {
        console.warn(`File '${file.name}' bukan IFC (.ifc).`);
        input.value = "";
        return;
      }

      const data = await file.arrayBuffer();
      const buffer = new Uint8Array(data);
      
      try {
        const model = await this.load(buffer, file.name, true);
        model.object.userData.selectable = true;
        model.object.userData.entityType = "ifc";
        model.object.userData.__fragmentsModel = model;
        scene.add(model.object);
      } catch (error) {
        console.error("Gagal memuat file IFC:", error);
      }
      
      // Reset value agar file yang sama bisa di-load ulang jika perlu
      input.value = "";
    });
  }
}
