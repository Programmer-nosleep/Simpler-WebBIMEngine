import * as THREE from "three";
import { OBJExporter } from "three/examples/jsm/exporters/OBJExporter.js";
import { OBJLoader } from "three/examples/jsm/loaders/OBJLoader.js";

export async function importObj(file: File): Promise<THREE.Object3D> {
  const text = await file.text();
  const loader = new OBJLoader();
  const object = loader.parse(text);
  object.name ||= file.name;
  return object;
}

export function exportObj(object: THREE.Object3D): Blob {
  const exporter = new OBJExporter();
  const result = exporter.parse(object);
  return new Blob([result], { type: "text/plain" });
}
