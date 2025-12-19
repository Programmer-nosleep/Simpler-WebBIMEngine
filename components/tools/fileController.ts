import * as THREE from "three";
import type * as OBC from "@thatopen/components";

import { importDwgOrDxf } from "./dwg";
import { importGlbOrGltf, exportGlb } from "./glb";
import { IfcManager } from "./ifc";
import { importObj, exportObj } from "./obj";

export class FileController {
  private scene: THREE.Scene;
  private components?: OBC.Components;
  private ifc?: IfcManager;
  private ifcSetupPromise: Promise<void> | null = null;

  constructor(scene: THREE.Scene, components?: OBC.Components) {
    this.scene = scene;
    this.components = components;
  }

  public setupImport(inputElement: HTMLInputElement) {
    inputElement.addEventListener("change", async (event) => {
      const input = event.target as HTMLInputElement;
      const file = input.files?.[0];
      if (!file) return;

      const extension = file.name.split('.').pop()?.toLowerCase();
      console.log(`Importing ${extension ?? "unknown"}...`);

      try {
        switch (extension) {
          case "ifc": {
            await this.ensureIfcReady();
            const model = await this.ifc!.loadFile(file, true);
            model.object.userData.selectable = true;
            model.object.userData.entityType = "ifc";
            model.object.userData.__fragmentsModel = model;
            this.scene.add(model.object);
            break;
          }
          case "glb":
          case "gltf": {
            const object = await importGlbOrGltf(file);
            object.userData.selectable = true;
            object.userData.entityType = "model";
            this.scene.add(object);
            break;
          }
          case "obj": {
            const object = await importObj(file);
            object.userData.selectable = true;
            object.userData.entityType = "model";
            this.scene.add(object);
            break;
          }
          case "dwg":
          case "dxf": {
            await importDwgOrDxf(file);
            break;
          }
          default:
            console.error(`Unsupported file format: ${extension}`);
        }
      } catch (error) {
        console.error("Error loading file:", error);
      } finally {
        input.value = "";
      }
    });
  }

  public setupExport(buttonElement: HTMLElement, format: 'ifc' | 'glb' | 'obj') {
    buttonElement.addEventListener("click", async () => {
      console.log(`Exporting ${format}...`);
      switch (format) {
        case "glb": {
          const blob = await exportGlb(this.scene);
          this.downloadFile(blob, "scene.glb");
          break;
        }
        case "obj": {
          const blob = exportObj(this.scene);
          this.downloadFile(blob, "scene.obj");
          break;
        }
        case "ifc": {
          console.warn("IFC export is not supported directly from the scene graph.");
          break;
        }
      }
    });
  }

  private async ensureIfcReady() {
    if (!this.ifc) {
      if (!this.components) {
        throw new Error("IFC import requires OBC.Components. Pass it to FileController constructor.");
      }
      this.ifc = new IfcManager(this.components);
    }

    if (!this.ifcSetupPromise) {
      this.ifcSetupPromise = this.ifc.setup();
    }

    await this.ifcSetupPromise;
  }

  private downloadFile(blob: Blob, filename: string) {
    const link = document.createElement('a');
    link.href = URL.createObjectURL(blob);
    link.download = filename;
    link.click();
    URL.revokeObjectURL(link.href);
  }
}
