import * as THREE from "three";
import type * as OBC from "@thatopen/components";

import { importDwgOrDxf } from "./dwg";
import { importGlbOrGltf, exportGlb } from "./glb";
import { IfcManager } from "./ifc";
import { importObj, exportObj } from "./obj";

export type ImportObjectStats = {
  meshCount: number;
  lineCount: number;
  pointsCount: number;
  vertexCount: number;
  triangleCount: number;
  bounds: { center: THREE.Vector3; size: THREE.Vector3 } | null;
};

export type ImportOutcome =
  | {
      ok: true;
      file: File;
      extension: string;
      root: THREE.Object3D;
      stats: ImportObjectStats;
      message: string;
    }
  | {
      ok: false;
      file?: File;
      extension?: string | null;
      message: string;
      error: Error;
    };

class ImportValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ImportValidationError";
  }
}

function toError(error: unknown): Error {
  if (error instanceof Error) return error;
  if (typeof error === "string") return new Error(error);
  try {
    return new Error(JSON.stringify(error));
  } catch {
    return new Error(String(error));
  }
}

export class FileController {
  private scene: THREE.Scene;
  private components?: OBC.Components;
  private ifc?: IfcManager;
  private ifcSetupPromise: Promise<void> | null = null;

  private importInput: HTMLInputElement | null = null;
  private pendingImportFiles: File[] = [];

  constructor(scene: THREE.Scene, components?: OBC.Components) {
    this.scene = scene;
    this.components = components;
  }

  public setupImport(inputElement: HTMLInputElement) {
    this.importInput = inputElement;
    inputElement.addEventListener("change", async (event) => {
      const input = event.target as HTMLInputElement;
      this.pendingImportFiles = input.files ? Array.from(input.files) : [];
    });
  }

  public hasPendingImport() {
    return this.pendingImportFiles.length > 0;
  }

  public getPendingImportLabel() {
    if (!this.hasPendingImport()) return null;
    if (this.pendingImportFiles.length === 1) return this.pendingImportFiles[0]!.name;
    return `${this.pendingImportFiles.length} files`;
  }

  public clearPendingImport() {
    this.pendingImportFiles = [];
    if (this.importInput) this.importInput.value = "";
  }

  public async importPending(): Promise<ImportOutcome> {
    if (!this.hasPendingImport()) {
      const message = "Tidak ada file yang dipilih. Pilih file dulu, lalu klik Import.";
      console.warn(message);
      return { ok: false, message, extension: null, error: new Error(message) };
    }

    const files = this.pendingImportFiles.slice();

    // If multiple files are selected, prefer the .obj (OBJ+MTL+textures scenario).
    const objFile = files.find((f) => f.name.toLowerCase().endsWith(".obj"));
    const file = objFile ?? files[0]!;

    const extension = file.name.split(".").pop()?.toLowerCase();
    console.log(`Importing ${extension ?? "unknown"}...`);

    try {
      let imported = false;
      let root: THREE.Object3D | null = null;
      let stats: ImportObjectStats | null = null;

      if (!extension) {
        throw new ImportValidationError(`Nama file tidak punya ekstensi: '${file.name}'`);
      }

      switch (extension) {
        case "ifc": {
          await this.ensureIfcReady();
          const model = await this.ifc!.loadFile(file, true);
          model.object.userData.selectable = true;
          model.object.userData.entityType = "ifc";
          model.object.userData.__fragmentsModel = model;
          root = model.object as unknown as THREE.Object3D;
          stats = this.getImportObjectStats(root);
          this.assertHasRenderableGeometry(stats, file);
          this.scene.add(model.object);
          imported = true;
          break;
        }
        case "glb":
        case "gltf": {
          const object = await importGlbOrGltf(file);
          object.userData.selectable = true;
          object.userData.entityType = "model";
          root = object;
          stats = this.getImportObjectStats(root);
          this.assertHasRenderableGeometry(stats, file);
          this.scene.add(object);
          imported = true;
          break;
        }
        case "obj": {
          const object = await importObj(file);
          object.userData.selectable = true;
          object.userData.entityType = "model";
          root = object;
          stats = this.getImportObjectStats(root);
          this.assertHasRenderableGeometry(stats, file);
          this.scene.add(object);
          imported = true;
          break;
        }
        case "dwg":
        case "dxf": {
          const object = await importDwgOrDxf(file);
          if (!object) throw new ImportValidationError("DWG/DXF loader tidak menghasilkan object.");
          object.userData.selectable = true;
          object.userData.entityType = "dxf";
          root = object;
          stats = this.getImportObjectStats(root);
          this.assertHasRenderableGeometry(stats, file);
          this.scene.add(object);
          imported = true;
          break;
        }
        default:
          throw new ImportValidationError(`Unsupported file format: ${extension}`);
      }

      if (imported) {
        this.clearPendingImport();
        const finalRoot = root ?? new THREE.Group();
        const finalStats = stats ?? this.getImportObjectStats(finalRoot);
        const message = `Import berhasil: ${file.name} (mesh: ${finalStats.meshCount}, tris: ${finalStats.triangleCount})`;
        console.info(message);
        return { ok: true, file, extension, root: finalRoot, stats: finalStats, message };
      }

      const message = `Import gagal: ${file.name}`;
      return { ok: false, file, extension, message, error: new Error(message) };
    } catch (error) {
      const err = toError(error);
      const message = `Import gagal: ${file.name}. ${err.message}`;
      console.error(message, err);
      return { ok: false, file, extension: extension ?? null, message, error: err };
    }
  }

  public setupExport(buttonElement: HTMLElement, format: 'ifc' | 'glb' | 'obj') {
    buttonElement.addEventListener("click", async () => {
      await this.export(format);
    });
  }

  public async export(format: "ifc" | "glb" | "obj") {
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

  private getImportObjectStats(root: THREE.Object3D): ImportObjectStats {
    const stats: ImportObjectStats = {
      meshCount: 0,
      lineCount: 0,
      pointsCount: 0,
      vertexCount: 0,
      triangleCount: 0,
      bounds: null,
    };

    root.traverse((child: any) => {
      if (child?.isMesh) {
        stats.meshCount += 1;
        const geom = child.geometry as THREE.BufferGeometry | undefined;
        const pos = geom?.getAttribute?.("position") as THREE.BufferAttribute | undefined;
        const idx = geom?.getIndex?.() as THREE.BufferAttribute | null | undefined;
        if (pos) {
          stats.vertexCount += pos.count;
          if (idx) stats.triangleCount += Math.floor(idx.count / 3);
          else stats.triangleCount += Math.floor(pos.count / 3);
        }
        return;
      }
      if (child?.isLine || child?.isLineSegments) stats.lineCount += 1;
      if (child?.isPoints) stats.pointsCount += 1;
    });

    root.updateWorldMatrix(true, true);
    const box = new THREE.Box3().setFromObject(root);
    const isFiniteBox = (b: THREE.Box3) =>
      Number.isFinite(b.min.x) &&
      Number.isFinite(b.min.y) &&
      Number.isFinite(b.min.z) &&
      Number.isFinite(b.max.x) &&
      Number.isFinite(b.max.y) &&
      Number.isFinite(b.max.z);

    if (!box.isEmpty() && isFiniteBox(box)) {
      const center = new THREE.Vector3();
      const size = new THREE.Vector3();
      box.getCenter(center);
      box.getSize(size);
      stats.bounds = { center, size };
    }

    return stats;
  }

  private assertHasRenderableGeometry(stats: ImportObjectStats, file: File) {
    const renderableCount = stats.meshCount + stats.lineCount + stats.pointsCount;
    if (renderableCount <= 0 || !stats.bounds) {
      throw new ImportValidationError(
        `File '${file.name}' terbaca, tapi tidak ditemukan geometry (mesh/line/points). ` +
          `Ini biasanya terjadi jika file kosong / tidak punya mesh, atau untuk .gltf yang butuh file pendamping (.bin/texture).`
      );
    }
  }

  private downloadFile(blob: Blob, filename: string) {
    const link = document.createElement('a');
    link.href = URL.createObjectURL(blob);
    link.download = filename;
    link.click();
    URL.revokeObjectURL(link.href);
  }
}
