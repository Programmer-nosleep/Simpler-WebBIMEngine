type IconName = "hamburger";

const ICONS: Record<IconName, string> = {
  hamburger: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
    <line x1="3" y1="12" x2="21" y2="12"></line>
    <line x1="3" y1="6" x2="21" y2="6"></line>
    <line x1="3" y1="18" x2="21" y2="18"></line>
  </svg>`,
};

export const SIDEBAR_EVENTS = {
  TOGGLE_LEFT: "sidebar-toggle-left",
  TOGGLE_RIGHT: "sidebar-toggle-right",
  CHANGE: "sidebar-change",
};

export type HamburgerHandle = {
  toggleLeft: () => void;
  toggleRight: () => void;
};

function ensureStyles() {
  const styleId = "hamburger-styles";
  if (document.getElementById(styleId)) return;

  const style = document.createElement("style");
  style.id = styleId;
  style.textContent = `
    .hamburger-btn {
      position: fixed;
      z-index: 2000; /* Di atas sidebar & gizmo */
      width: 36px;
      height: 36px;
      background: white;
      border: 1px solid #ddd;
      border-radius: 6px;
      cursor: pointer;
      display: flex;
      align-items: center;
      justify-content: center;
      color: #333;
      box-shadow: 0 2px 5px rgba(0,0,0,0.1);
      transition: background 0.2s, transform 0.2s;
    }
    .hamburger-btn:hover {
      background: #f5f5f5;
    }
    .hamburger-btn:active {
      transform: scale(0.95);
    }
    .hamburger-btn svg {
      width: 20px;
      height: 20px;
    }
    /* Class utility untuk menyembunyikan sidebar */
    .sidebar-hidden {
      display: none !important;
    }
  `;
  document.head.appendChild(style);
}

function createButton(title: string, top: string, side: "left" | "right", sideValue: string): HTMLButtonElement {
  const btn = document.createElement("button");
  btn.type = "button";
  btn.className = "hamburger-btn";
  btn.title = title;
  btn.innerHTML = ICONS.hamburger;
  
  btn.style.top = top;
  if (side === "left") {
    btn.style.left = sideValue;
  } else {
    btn.style.right = sideValue;
  }

  return btn;
}

export function setupHamburger(root?: HTMLElement): HamburgerHandle {
  ensureStyles();
  const container = root || document.body;

  // --- Tombol Kiri ---
  // Posisi: Top 20px, Left 12px (di atas LeftSidebar yang mulai di 70px)
  const leftBtn = createButton("Toggle Left Sidebar", "20px", "left", "12px");
  leftBtn.id = "hamburger-left-btn";
  
  leftBtn.addEventListener("click", () => {
    const sidebar = document.getElementById("leftSidebar");
    if (sidebar) {
      const isHidden = sidebar.classList.toggle("sidebar-hidden");
      leftBtn.setAttribute("aria-expanded", String(!isHidden));
      // Opsional: Ubah opacity tombol jika sidebar hidden agar user tahu statusnya
      leftBtn.style.opacity = isHidden ? "0.6" : "1";
      window.dispatchEvent(new CustomEvent(SIDEBAR_EVENTS.CHANGE, {
        detail: { side: "left", hidden: isHidden }
      }));
    }
  });
  container.appendChild(leftBtn);

  // --- Tombol Kanan ---
  // Posisi: Top 85px, Right 12px 
  // (Gizmo biasanya di top 16px dengan tinggi ~90px, jadi kita taruh di bawah Gizmo 
  // dan di atas RightSidebar yang mulai di 120px)
  const rightBtn = createButton("Toggle Right Sidebar", "85px", "right", "12px");
  rightBtn.id = "hamburger-right-btn";

  rightBtn.addEventListener("click", () => {
    const sidebar = document.getElementById("rightSidebar");
    if (sidebar) {
      const isHidden = sidebar.classList.toggle("sidebar-hidden");
      rightBtn.setAttribute("aria-expanded", String(!isHidden));
      rightBtn.style.opacity = isHidden ? "0.6" : "1";
      window.dispatchEvent(new CustomEvent(SIDEBAR_EVENTS.CHANGE, {
        detail: { side: "right", hidden: isHidden }
      }));
    }
  });
  container.appendChild(rightBtn);

  // Listeners for external triggers (agar bisa di-trigger dari file lain)
  window.addEventListener(SIDEBAR_EVENTS.TOGGLE_LEFT, () => leftBtn.click());
  window.addEventListener(SIDEBAR_EVENTS.TOGGLE_RIGHT, () => rightBtn.click());

  return {
    toggleLeft: () => leftBtn.click(),
    toggleRight: () => rightBtn.click(),
  };
}
