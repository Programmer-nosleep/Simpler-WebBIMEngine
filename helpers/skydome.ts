import * as THREE from "three";

/**
 * Helper untuk membuat SkyDome dengan transisi warna waktu.
 * Ukuran default diset ke 500 agar tidak terpotong oleh camera far plane.
 */
export class SkyDomeHelper {
  public mesh: THREE.Mesh;
  private uniforms: { [key: string]: { value: any } };

  constructor(scene: THREE.Scene, size = 500) {
    const vertexShader = `
      varying vec3 vWorldPosition;
      void main() {
        vec4 worldPosition = modelMatrix * vec4( position, 1.0 );
        vWorldPosition = worldPosition.xyz;
        gl_Position = projectionMatrix * modelViewMatrix * vec4( position, 1.0 );
      }
    `;

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
      side: THREE.BackSide,
    });

    this.mesh = new THREE.Mesh(geometry, material);
    this.mesh.name = "SkyDome";
    scene.add(this.mesh);

    this.updateTime(6);
  }

  updateTime(hour: number) {
    const h = Math.max(4, Math.min(22, hour));

    const keyframes = [
      { t: 4, top: 0x000000, bot: 0x000000 },
      { t: 5, top: 0x020205, bot: 0x050510 },
      { t: 6, top: 0x0077ff, bot: 0xffaa00 },
      { t: 9, top: 0x0099ff, bot: 0xffffff },
      { t: 12, top: 0x00bfff, bot: 0xffffff },
      { t: 16, top: 0x0099ff, bot: 0xffffee },
      { t: 17, top: 0x0077ff, bot: 0xffaa00 },
      { t: 18, top: 0x0b0033, bot: 0xff4400 },
      { t: 19, top: 0x000011, bot: 0x050505 },
      { t: 22, top: 0x000000, bot: 0x000000 },
    ];

    let start = keyframes[0];
    let end = keyframes[keyframes.length - 1];

    for (let i = 0; i < keyframes.length - 1; i++) {
      if (h >= keyframes[i].t && h <= keyframes[i + 1].t) {
        start = keyframes[i];
        end = keyframes[i + 1];
        break;
      }
    }

    const range = end.t - start.t;
    const alpha = range === 0 ? 0 : (h - start.t) / range;

    const cTop = new THREE.Color(start.top).lerp(new THREE.Color(end.top), alpha);
    const cBot = new THREE.Color(start.bot).lerp(new THREE.Color(end.bot), alpha);

    this.uniforms.topColor.value.copy(cTop);
    this.uniforms.bottomColor.value.copy(cBot);
  }
}

/**
 * UI Controller untuk SkyDome
 * Menempatkan UI Timeline sejajar dengan kontrol Camera/Navigasi
 */
export class SkyDomeUI {
  private container: HTMLDivElement;
  private helper: SkyDomeHelper;
  private timeLabel!: HTMLSpanElement;

  constructor(helper: SkyDomeHelper) {
    this.helper = helper;
    
    this.container = document.createElement("div");
    this.container.className = "control-panel";

    // Cari container UI utama
    const uiFloating = document.getElementById("ui-floating");
    let uiPanels = document.getElementById("ui-panels");

    if (uiFloating) {
      // Jika ui-panels belum ada, buat dan taruh di paling atas
      if (!uiPanels) {
        uiPanels = document.createElement("div");
        uiPanels.id = "ui-panels";
        uiFloating.prepend(uiPanels);
      }
      uiPanels.appendChild(this.container);
    } else {
      // Fallback jika struktur HTML tidak ditemukan
      document.body.appendChild(this.container);
      this.container.style.position = "fixed";
      this.container.style.top = "12px";
      this.container.style.left = "12px";
      this.container.style.zIndex = "100";
    }

    this.initElements();
    this.update(6);
  }

  private initElements() {
    const label = document.createElement("label");
    label.innerText = "Timeline";
    this.container.appendChild(label);

    const controls = document.createElement("div");
    controls.className = "timeline-row";

    const slider = document.createElement("input");
    slider.type = "range";
    slider.min = "4";
    slider.max = "22";
    slider.step = "0.05";
    slider.value = "6";
    
    slider.oninput = (e: Event) => {
      const val = parseFloat((e.target as HTMLInputElement).value);
      this.update(val);
    };
    controls.appendChild(slider);

    this.timeLabel = document.createElement("span");
    // Style font-size dan min-width sudah dihandle oleh CSS .timeline-row span
    controls.appendChild(this.timeLabel);

    this.container.appendChild(controls);
  }

  private update(val: number) {
    this.helper.updateTime(val);
    
    const h = Math.floor(val);
    const m = Math.floor((val - h) * 60);
    const timeStr = `${h.toString().padStart(2, '0')}:${m.toString().padStart(2, '0')}`;
    
    this.timeLabel.innerText = timeStr;
  }
}
