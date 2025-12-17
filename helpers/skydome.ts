import * as THREE from "three";

/**
 * Helper untuk membuat SkyDome dengan transisi warna waktu (Subuh - Siang - Malam)
 */
export class SkyDomeHelper {
  public mesh: THREE.Mesh;
  private uniforms: { [key: string]: { value: any } };

  constructor(scene: THREE.Scene, size = 4000) {
    // Vertex Shader: Menghitung posisi dunia untuk gradien
    const vertexShader = `
      varying vec3 vWorldPosition;
      void main() {
        vec4 worldPosition = modelMatrix * vec4( position, 1.0 );
        vWorldPosition = worldPosition.xyz;
        gl_Position = projectionMatrix * modelViewMatrix * vec4( position, 1.0 );
      }
    `;

    // Fragment Shader: Mencampur warna atas dan bawah berdasarkan ketinggian (Y)
    const fragmentShader = `
      uniform vec3 topColor;
      uniform vec3 bottomColor;
      uniform float offset;
      uniform float exponent;
      varying vec3 vWorldPosition;
      void main() {
        float h = normalize( vWorldPosition + offset ).y;
        gl_FragColor = vec4( mix( bottomColor, topColor, max( pow( max( h , 0.0), exponent ), 0.0 ) ), 1.0 );
      }
    `;

    // Default uniforms
    this.uniforms = {
      topColor: { value: new THREE.Color(0x0077ff) },
      bottomColor: { value: new THREE.Color(0xffffff) },
      offset: { value: 33 },
      exponent: { value: 0.6 },
    };

    const geometry = new THREE.SphereGeometry(size, 32, 15);
    const material = new THREE.ShaderMaterial({
      uniforms: this.uniforms,
      vertexShader: vertexShader,
      fragmentShader: fragmentShader,
      side: THREE.BackSide, // Render bagian dalam bola
    });

    this.mesh = new THREE.Mesh(geometry, material);
    this.mesh.name = "SkyDome";
    scene.add(this.mesh);

    // Set waktu awal default ke jam 6 pagi
    this.updateTime(6);
  }

  /**
   * Mengupdate warna langit berdasarkan jam (04.00 - 22.00)
   * @param hour Jam dalam format desimal (misal 6.5 untuk 06:30)
   */
  updateTime(hour: number) {
    // Batasi waktu antara 04:00 sampai 22:00 sesuai request
    const h = Math.max(4, Math.min(22, hour));

    // Definisi Keyframe Warna [Jam, WarnaAtas, WarnaBawah]
    const keyframes = [
      { t: 4, top: 0x000000, bot: 0x000000 },   // 04:00: Subuh (Gelap Total)
      { t: 5, top: 0x020205, bot: 0x050510 },   // 05:00: Jelang Fajar (Biru Gelap sekali)
      { t: 6, top: 0x0077ff, bot: 0xffaa00 },   // 06:00: Terbit Fajar (Biru & Oranye)
      { t: 9, top: 0x0099ff, bot: 0xffffff },   // 09:00: Pagi (Biru Langit & Putih)
      { t: 12, top: 0x00bfff, bot: 0xffffff },  // 12:00: Siang Bolong (Cerah Maksimal)
      { t: 16, top: 0x0099ff, bot: 0xffffee },  // 16:00: Sore Awal
      { t: 17, top: 0x0077ff, bot: 0xffaa00 },  // 17:00: Sore (Mulai Oranye)
      { t: 18, top: 0x0b0033, bot: 0xff4400 },  // 18:00: Terbenam (Ungu Gelap & Merah Bata)
      { t: 19, top: 0x000011, bot: 0x050505 },  // 19:00: Malam Awal
      { t: 22, top: 0x000000, bot: 0x000000 },  // 22:00: Malam Gelap
    ];

    // Cari interval waktu saat ini
    let start = keyframes[0];
    let end = keyframes[keyframes.length - 1];

    for (let i = 0; i < keyframes.length - 1; i++) {
      if (h >= keyframes[i].t && h <= keyframes[i + 1].t) {
        start = keyframes[i];
        end = keyframes[i + 1];
        break;
      }
    }

    // Hitung interpolasi (0.0 sampai 1.0) di antara dua keyframe
    const range = end.t - start.t;
    const alpha = range === 0 ? 0 : (h - start.t) / range;

    // Lerp (Linear Interpolation) warna
    const cTop = new THREE.Color(start.top).lerp(new THREE.Color(end.top), alpha);
    const cBot = new THREE.Color(start.bot).lerp(new THREE.Color(end.bot), alpha);

    this.uniforms.topColor.value.copy(cTop);
    this.uniforms.bottomColor.value.copy(cBot);
  }
}

/**
 * UI Controller untuk SkyDome
 * Menampilkan slider interaktif di layar
 */
export class SkyDomeUI {
  private container: HTMLDivElement;
  private helper: SkyDomeHelper;
  private timeLabel: HTMLSpanElement;

  constructor(helper: SkyDomeHelper) {
    this.helper = helper;
    this.container = document.createElement("div");
    
    this.initStyles();
    this.initElements();
    
    // Inisialisasi tampilan pada jam 06:00
    this.update(6);
  }

  private initStyles() {
    const s = this.container.style;
    s.position = "absolute";
    s.bottom = "40px";
    s.left = "50%";
    s.transform = "translateX(-50%)";
    s.backgroundColor = "rgba(15, 23, 42, 0.8)"; // Dark slate background
    s.backdropFilter = "blur(8px)";
    s.padding = "16px 24px";
    s.borderRadius = "999px";
    s.display = "flex";
    s.alignItems = "center";
    s.gap = "16px";
    s.color = "white";
    s.fontFamily = "ui-sans-serif, system-ui, sans-serif";
    s.boxShadow = "0 10px 25px -5px rgba(0, 0, 0, 0.3)";
    s.zIndex = "10000";
    s.userSelect = "none";
    s.border = "1px solid rgba(255, 255, 255, 0.1)";
  }

  private initElements() {
    // Label Ikon
    const iconLabel = document.createElement("div");
    iconLabel.innerHTML = "<span>☀️</span>";
    iconLabel.style.fontSize = "18px";
    this.container.appendChild(iconLabel);

    // Slider Input
    const slider = document.createElement("input");
    slider.type = "range";
    slider.min = "4";   // Mulai jam 04:00
    slider.max = "22";  // Sampai jam 22:00
    slider.step = "0.05"; // Presisi menit
    slider.value = "6";
    
    // Styling Slider
    slider.style.width = "200px";
    slider.style.cursor = "pointer";
    slider.style.accentColor = "#f59e0b"; // Amber color
    
    slider.oninput = (e: Event) => {
      const val = parseFloat((e.target as HTMLInputElement).value);
      this.update(val);
    };
    this.container.appendChild(slider);

    // Label Waktu Digital
    this.timeLabel = document.createElement("div");
    this.timeLabel.style.fontVariantNumeric = "tabular-nums";
    this.timeLabel.style.minWidth = "50px";
    this.timeLabel.style.textAlign = "right";
    this.timeLabel.style.fontWeight = "600";
    this.timeLabel.style.fontSize = "14px";
    this.timeLabel.style.color = "#fcd34d"; // Light amber
    this.container.appendChild(this.timeLabel);

    document.body.appendChild(this.container);
  }

  private update(val: number) {
    // Update SkyDome
    this.helper.updateTime(val);
    
    // Update Label UI (Format HH:MM)
    const h = Math.floor(val);
    const m = Math.floor((val - h) * 60);
    const timeStr = `${h.toString().padStart(2, '0')}:${m.toString().padStart(2, '0')}`;
    
    // Tambahkan indikator AM/PM atau keterangan waktu sederhana
    let period = "";
    if (val < 5) period = "Subuh";
    else if (val < 10) period = "Pagi";
    else if (val < 15) period = "Siang";
    else if (val < 18.5) period = "Sore";
    else period = "Malam";

    this.timeLabel.innerText = `${timeStr}`;
    this.timeLabel.title = period; // Tooltip
  }

  public dispose() {
    if (this.container.parentElement) {
      this.container.parentElement.removeChild(this.container);
    }
  }
}
