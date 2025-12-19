import * as THREE from "three";
import { GLTFExporter } from "three/examples/jsm/exporters/GLTFExporter.js";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";

export async function importGlbOrGltf(file: File): Promise<THREE.Object3D> {
  const loader = new GLTFLoader();
  const ext = file.name.split(".").pop()?.toLowerCase();

  const gltf = await new Promise<{ scene: THREE.Object3D }>((resolve, reject) => {
    const onLoad = (result: any) => resolve(result);
    const onError = (error: unknown) => reject(error);

    if (ext === "gltf") {
      file
        .text()
        .then((text) => loader.parse(text, "", onLoad, onError))
        .catch(onError);
      return;
    }

    file
      .arrayBuffer()
      .then((buffer) => loader.parse(buffer, "", onLoad, onError))
      .catch(onError);
  });

  gltf.scene.name ||= file.name;
  return gltf.scene;
}

export async function exportGlb(object: THREE.Object3D): Promise<Blob> {
  const exporter = new GLTFExporter();

  const arrayBuffer = await new Promise<ArrayBuffer>((resolve, reject) => {
    exporter.parse(
      object,
      (result) => {
        if (result instanceof ArrayBuffer) resolve(result);
        else reject(new Error("GLTFExporter returned non-binary result."));
      },
      (error) => reject(error instanceof Error ? error : new Error(String(error))),
      { binary: true }
    );
  });

  return new Blob([arrayBuffer], { type: "model/gltf-binary" });
}
