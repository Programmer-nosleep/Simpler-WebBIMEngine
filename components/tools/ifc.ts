import * as THREE from "three";
import * as OBC from "@thatopen/components";
import * as WEBIFC from "web-ifc";

export class IfcManager {
  components: OBC.Components;
  loader: OBC.IfcLoader;

  constructor(components: OBC.Components) {
    this.components = components;
    this.loader = components.get(OBC.IfcLoader);
  }

  async setup() {
    // Setup loader (pastikan file .wasm sudah tersedia di public directory atau dikonfigurasi)
    await this.loader.setup();

    // Optimasi: Exclude kategori yang berat dan jarang dibutuhkan visualisasinya
    const excludedCats = [
      WEBIFC.IFCTENDONANCHOR,
      WEBIFC.IFCREINFORCINGBAR,
      WEBIFC.IFCREINFORCINGELEMENT,
    ];

    for (const cat of excludedCats) {
      this.loader.settings.excludedCategories.add(cat);
    }

    // Optimasi: Memindahkan model ke titik origin (0,0,0) untuk menghindari floating point error
    // Cek apakah webIfc settings tersedia sebelum akses
    if (this.loader.settings.webIfc) {
      this.loader.settings.webIfc.COORDINATE_TO_ORIGIN = true;
    }
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
      const data = await file.arrayBuffer();
      const buffer = new Uint8Array(data);
      
      try {
        const model = await this.loader.load(buffer);
        scene.add(model);
      } catch (error) {
        console.error("Gagal memuat file IFC:", error);
      }
      
      // Reset value agar file yang sama bisa di-load ulang jika perlu
      input.value = "";
    });
  }
}