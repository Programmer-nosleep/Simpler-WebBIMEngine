import * as THREE from "three";
import { DwgLoader } from "./dwgLoader";

/**
 * DwgDragDrop
 * 
 * Menangani UI Drag & Drop untuk file DXF/DWG.
 * Membaca file yang di-drop, memparsing menggunakan DwgLoader,
 * dan menambahkannya ke scene.
 */
export class DwgDragDrop {
  private scene: THREE.Scene;
  private loader: DwgLoader;
  private dropZone: HTMLDivElement;
  private dragCounter: number = 0;

  constructor(scene: THREE.Scene) {
    this.scene = scene;
    this.loader = new DwgLoader();
    this.dropZone = this.createOverlay();
    this.initEvents();
  }

  private createOverlay(): HTMLDivElement {
    const div = document.createElement("div");
    Object.assign(div.style, {
      position: "fixed",
      top: "0",
      left: "0",
      width: "100%",
      height: "100%",
      backgroundColor: "rgba(0, 0, 0, 0.6)",
      display: "none",
      justifyContent: "center",
      alignItems: "center",
      zIndex: "10000",
      color: "#ffffff",
      fontFamily: "Arial, sans-serif",
      fontSize: "24px",
      pointerEvents: "none", // Membiarkan event drop tembus ke window/document
      border: "4px dashed #ffffff",
      boxSizing: "border-box"
    });
    
    div.innerHTML = `
      <div style="text-align: center;">
        <p style="margin: 0; font-weight: bold;">Drop DXF File Here</p>
        <p style="margin: 10px 0 0 0; font-size: 14px; opacity: 0.8;">(ASCII Format)</p>
      </div>
    `;
    
    document.body.appendChild(div);
    return div;
  }

  private initEvents() {
    // Menggunakan window untuk menangkap drag di seluruh layar
    window.addEventListener("dragenter", this.onDragEnter.bind(this));
    window.addEventListener("dragover", this.onDragOver.bind(this));
    window.addEventListener("dragleave", this.onDragLeave.bind(this));
    window.addEventListener("drop", this.onDrop.bind(this));
  }

  private onDragEnter(e: DragEvent) {
    e.preventDefault();
    this.dragCounter++;
    this.dropZone.style.display = "flex";
  }

  private onDragOver(e: DragEvent) {
    e.preventDefault(); // Wajib ada agar bisa di-drop
  }

  private onDragLeave(e: DragEvent) {
    e.preventDefault();
    this.dragCounter--;
    if (this.dragCounter === 0) {
      this.dropZone.style.display = "none";
    }
  }

  private onDrop(e: DragEvent) {
    e.preventDefault();
    this.dragCounter = 0;
    this.dropZone.style.display = "none";

    if (e.dataTransfer && e.dataTransfer.files.length > 0) {
      const file = e.dataTransfer.files[0];
      this.processFile(file);
    }
  }

  private processFile(file: File) {
    // Validasi ekstensi sederhana
    if (!file.name.toLowerCase().endsWith(".dxf")) {
      alert("Harap masukkan file .dxf (ASCII).");
      return;
    }

    const reader = new FileReader();
    reader.onload = (event) => {
      const text = event.target?.result;
      if (typeof text === "string") {
        try {
          console.log(`Parsing ${file.name}...`);
          const group = this.loader.parse(text);
          
          // Tambahkan ke scene
          this.scene.add(group);
          console.log("DXF berhasil ditambahkan ke scene:", group);

        } catch (err) {
          console.error("Gagal memparsing DXF:", err);
          alert("Gagal memproses file. Pastikan formatnya adalah DXF ASCII.");
        }
      }
    };
    reader.readAsText(file);
  }

  public dispose() {
    document.body.removeChild(this.dropZone);
    window.removeEventListener("dragenter", this.onDragEnter);
    window.removeEventListener("dragover", this.onDragOver);
    window.removeEventListener("dragleave", this.onDragLeave);
    window.removeEventListener("drop", this.onDrop);
  }
}