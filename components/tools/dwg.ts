import * as THREE from "three";
import { FontLoader } from "three/examples/jsm/loaders/FontLoader.js";
import { DXFLoader } from "three-dxf-loader";

import helvetikerRegularUrl from "three/examples/fonts/helvetiker_regular.typeface.json?url";

let fontPromise: Promise<unknown> | null = null;

const getDefaultFont = async () => {
  if (fontPromise) return fontPromise;

  const loader = new FontLoader();
  fontPromise = new Promise((resolve, reject) => {
    loader.load(
      helvetikerRegularUrl,
      (font) => resolve(font),
      undefined,
      (error) => reject(error)
    );
  });
  return fontPromise;
};

const importDxf = async (file: File): Promise<THREE.Object3D> => {
  const loader = new DXFLoader();
  loader.setEnableLayer(true);
  loader.setConsumeUnits(true);
  loader.setDefaultColor(0x000000);

  try {
    const font = await getDefaultFont();
    loader.setFont(font);
  } catch {
    // Best-effort: DXF text may not render without a font, but geometry should still load.
  }

  const url = URL.createObjectURL(file);
  try {
    const data = await new Promise<any>((resolve, reject) => {
      loader.load(
        url,
        (result) => resolve(result),
        undefined,
        (error) => reject(error)
      );
    });

    const entity = data?.entity as THREE.Object3D | undefined;
    if (!entity) throw new Error("DXFLoader returned no entity.");
    entity.name ||= file.name;
    return entity;
  } finally {
    URL.revokeObjectURL(url);
  }
};

export async function importDwgOrDxf(file: File): Promise<THREE.Object3D | null> {
  const ext = file.name.split(".").pop()?.toLowerCase();

  if (ext === "dxf") return importDxf(file);

  console.warn(
    "Import DWG belum didukung. Jika perlu, konversi DWG ke DXF dulu lalu import DXF."
  );
  return null;
}

