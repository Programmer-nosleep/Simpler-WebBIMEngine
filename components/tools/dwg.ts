export async function importDwgOrDxf(_file: File): Promise<null> {
  console.warn(
    "Import DWG/DXF belum didukung. Perlu library tambahan (mis. dxf-parser) dan pipeline konversi ke geometry Three.js."
  );
  return null;
}
