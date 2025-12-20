type IconName = "chevron" | "close";

const ICONS: Record<IconName, string> = {
  chevron: `<svg viewBox="0 0 12 12" xmlns="http://www.w3.org/2000/svg">
    <path d="M3 4.5L6 7.5L9 4.5" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"/>
  </svg>`,
  close: `<svg viewBox="0 0 12 12" xmlns="http://www.w3.org/2000/svg">
    <path d="M3 3L9 9M9 3L3 9" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"/>
  </svg>`,
};

export type UnitsName = "Meters" | "Millimeters" | "Inches" | "Feet";

export type RightSidebarValues = {
  viewport: string;
  unit: UnitsName;
  tolerance: number;
  dimensionSnap: number;
  angleSnap: number;
  parallelSnap: boolean;
  perpendicularSnap: boolean;
};

export type RightSidebarCallbacks = {
  onViewportChange?: (viewport: string) => void;
  onUnitChange?: (unit: UnitsName) => void;
  onToleranceChange?: (value: number) => void;
  onDimensionSnapChange?: (value: number) => void;
  onAngleSnapChange?: (value: number) => void;
  onParallelSnapChange?: (value: boolean) => void;
  onPerpendicularSnapChange?: (value: boolean) => void;
};

export type RightSidebarHandle = {
  setValues: (patch: Partial<RightSidebarValues>) => void;
  getValues: () => RightSidebarValues;
};

function ensureContainer(root?: HTMLElement): HTMLElement {
  if (root) return root;
  const existing = document.getElementById("rightSidebar");
  const container = existing || document.createElement("aside");

  if (!existing) {
    container.id = "rightSidebar";
    document.body.appendChild(container);
  }

  // posisinya fixed kanan, di bawah gizmo (gizmo: top 16px; kira2 height 90px)
  container.style.position = "fixed";
  container.style.top = "120px";
  container.style.right = "12px";
  container.style.left = "auto";
  container.style.marginTop = "0";

  return container;
}

function createIconElement(name: IconName): HTMLElement {
  const span = document.createElement("span");
  span.className = `sidebar-icon icon-${name}`;
  span.innerHTML = ICONS[name];
  span.setAttribute("aria-hidden", "true");
  return span;
}

function clampNumber(n: number, fallback = 0) {
  return Number.isFinite(n) ? n : fallback;
}

export function setupRightSidebar(root?: HTMLElement, callbacks?: RightSidebarCallbacks): RightSidebarHandle {
  const container = ensureContainer(root);
  container.innerHTML = "";
  container.setAttribute("role", "complementary");
  container.setAttribute("aria-label", "Project properties");

  // gunakan style panel yang sama dengan left
  // (#rightSidebar sudah kamu set di CSS jadi “kembar” left)

  const state: RightSidebarValues = {
    viewport: "Personal Camera",
    unit: "Millimeters",
    tolerance: 0.0,
    dimensionSnap: 100.0,
    angleSnap: 5,
    parallelSnap: true,
    perpendicularSnap: true,
  };

  // ===== Profile row (kanan atas) =====
  const profileRow = document.createElement("div");
  profileRow.className = "sidebar-profile-row";

  const profileName = document.createElement("div");
  profileName.className = "sidebar-profile-name";
//   profileName.textContent = "User Profile";

  const avatar = document.createElement("div");
  avatar.className = "sidebar-profile-avatar";
  avatar.textContent = "U";
  avatar.title = "Profile";

  profileRow.appendChild(profileName);
  profileRow.appendChild(avatar);

  const closeBtn = document.createElement("button");
  closeBtn.type = "button";
  closeBtn.title = "Close Sidebar";
  closeBtn.style.background = "transparent";
  closeBtn.style.border = "none";
  closeBtn.style.cursor = "pointer";
  closeBtn.style.color = "inherit";
  closeBtn.style.marginLeft = "auto";
  closeBtn.appendChild(createIconElement("close"));
  closeBtn.addEventListener("click", () => window.dispatchEvent(new CustomEvent("sidebar-toggle-right")));
  profileRow.appendChild(closeBtn);

  container.appendChild(profileRow);

  // ===== Viewport row =====
  const viewportRow = document.createElement("div");
  viewportRow.className = "sidebar-section-row sidebar-viewport-row";

  const viewportLabel = document.createElement("div");
  viewportLabel.className = "sidebar-section-title";
  viewportLabel.textContent = "Viewport";

  const viewportSelectWrap = document.createElement("div");
  viewportSelectWrap.className = "sidebar-field";

  const viewportSelect = document.createElement("select");
  viewportSelect.className = "sidebar-input";
  ["Personal Camera"].forEach((opt) => {
    const o = document.createElement("option");
    o.value = opt;
    o.textContent = opt;
    viewportSelect.appendChild(o);
  });
  viewportSelect.value = state.viewport;

  const viewportChevron = createIconElement("chevron");
  viewportChevron.classList.add("sidebar-select-chevron");

  viewportSelect.addEventListener("change", () => {
    state.viewport = viewportSelect.value;
    callbacks?.onViewportChange?.(state.viewport);
  });

  viewportSelectWrap.appendChild(viewportSelect);
  viewportSelectWrap.appendChild(viewportChevron);

  viewportRow.appendChild(viewportLabel);
  viewportRow.appendChild(viewportSelectWrap);

  container.appendChild(viewportRow);

  // ===== Section: Properties =====
  const section = document.createElement("section");
  section.className = "sidebar-section";
  section.dataset.sectionId = "properties";

  const headerRow = document.createElement("div");
  headerRow.className = "sidebar-section-row";

  const toggleButton = document.createElement("button");
  toggleButton.type = "button";
  toggleButton.className = "sidebar-section-toggle";
  toggleButton.setAttribute("aria-expanded", "true");

  const chevron = createIconElement("chevron");
  chevron.classList.add("icon-chevron");

  const titleWrap = document.createElement("span");
  titleWrap.className = "sidebar-section-title";
  titleWrap.textContent = "Properties";

  toggleButton.appendChild(chevron);
  toggleButton.appendChild(titleWrap);

  headerRow.appendChild(toggleButton);
  section.appendChild(headerRow);

  const form = document.createElement("div");
  form.className = "sidebar-form";

  // helper row builder
  const addFieldRow = (labelText: string, controlEl: HTMLElement) => {
    const row = document.createElement("div");
    row.className = "sidebar-form-row";

    const label = document.createElement("label");
    label.className = "sidebar-form-label";
    label.textContent = labelText;

    row.appendChild(label);
    row.appendChild(controlEl);
    form.appendChild(row);
  };

  // Units
  const unitWrap = document.createElement("div");
  unitWrap.className = "sidebar-field";

  const unitSelect = document.createElement("select");
  unitSelect.className = "sidebar-input";
  (["Meters", "Millimeters", "Inches", "Feet"] as UnitsName[]).forEach((u) => {
    const o = document.createElement("option");
    o.value = u;
    o.textContent = u;
    unitSelect.appendChild(o);
  });
  unitSelect.value = state.unit;

  const unitChevron = createIconElement("chevron");
  unitChevron.classList.add("sidebar-select-chevron");

  unitSelect.addEventListener("change", () => {
    state.unit = unitSelect.value as UnitsName;
    callbacks?.onUnitChange?.(state.unit);
  });

  unitWrap.appendChild(unitSelect);
  unitWrap.appendChild(unitChevron);
  addFieldRow("Units", unitWrap);

  // Tolerance
  const toleranceInput = document.createElement("input");
  toleranceInput.type = "number";
  toleranceInput.step = "0.001";
  toleranceInput.min = "0";
  toleranceInput.className = "sidebar-input sidebar-number";
  toleranceInput.value = String(state.tolerance);

  toleranceInput.addEventListener("change", () => {
    state.tolerance = clampNumber(Number(toleranceInput.value), 0);
    callbacks?.onToleranceChange?.(state.tolerance);
  });
  addFieldRow("Tolerance", toleranceInput);

  // Dimension Snap
  const dimInput = document.createElement("input");
  dimInput.type = "number";
  dimInput.step = "0.1";
  dimInput.min = "0";
  dimInput.className = "sidebar-input sidebar-number";
  dimInput.value = String(state.dimensionSnap);

  dimInput.addEventListener("change", () => {
    state.dimensionSnap = clampNumber(Number(dimInput.value), 0);
    callbacks?.onDimensionSnapChange?.(state.dimensionSnap);
  });
  addFieldRow("Dimension Snap", dimInput);

  // Angle Snap
  const angleInput = document.createElement("input");
  angleInput.type = "number";
  angleInput.step = "1";
  angleInput.min = "0";
  angleInput.max = "360";
  angleInput.className = "sidebar-input sidebar-number";
  angleInput.value = String(state.angleSnap);

  angleInput.addEventListener("change", () => {
    state.angleSnap = clampNumber(Number(angleInput.value), 0);
    callbacks?.onAngleSnapChange?.(state.angleSnap);
  });
  addFieldRow("Angle Snap", angleInput);

  // Switch maker
  const makeSwitch = (initial: boolean, onToggle: (v: boolean) => void) => {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "sidebar-switch";
    btn.setAttribute("aria-pressed", initial ? "true" : "false");

    const knob = document.createElement("span");
    knob.className = "sidebar-switch-knob";
    btn.appendChild(knob);

    const apply = (v: boolean) => {
      btn.setAttribute("aria-pressed", v ? "true" : "false");
    };
    let current = initial;
    apply(current);

    btn.addEventListener("click", () => {
      current = !current;
      apply(current);
      onToggle(current);
    });

    return btn;
  };

  // Parallel Snap
  const parallelSwitch = makeSwitch(state.parallelSnap, (v) => {
    state.parallelSnap = v;
    callbacks?.onParallelSnapChange?.(v);
  });
  addFieldRow("Parallel Snap", parallelSwitch);

  // Perpendicular Snap
  const perpSwitch = makeSwitch(state.perpendicularSnap, (v) => {
    state.perpendicularSnap = v;
    callbacks?.onPerpendicularSnapChange?.(v);
  });
  addFieldRow("Perpendicular Snap", perpSwitch);

  section.appendChild(form);

  // collapse behaviour (reuse pattern left)
  toggleButton.addEventListener("click", () => {
    const collapsed = section.classList.toggle("collapsed");
    toggleButton.setAttribute("aria-expanded", String(!collapsed));
  });

  container.appendChild(section);

  // ===== handle =====
  return {
    setValues: (patch) => {
      if (patch.viewport !== undefined) {
        state.viewport = patch.viewport;
        viewportSelect.value = state.viewport;
      }
      if (patch.unit !== undefined) {
        state.unit = patch.unit;
        unitSelect.value = state.unit;
      }
      if (patch.tolerance !== undefined) {
        state.tolerance = clampNumber(patch.tolerance, state.tolerance);
        toleranceInput.value = String(state.tolerance);
      }
      if (patch.dimensionSnap !== undefined) {
        state.dimensionSnap = clampNumber(patch.dimensionSnap, state.dimensionSnap);
        dimInput.value = String(state.dimensionSnap);
      }
      if (patch.angleSnap !== undefined) {
        state.angleSnap = clampNumber(patch.angleSnap, state.angleSnap);
        angleInput.value = String(state.angleSnap);
      }
      if (patch.parallelSnap !== undefined) {
        state.parallelSnap = patch.parallelSnap;
        parallelSwitch.setAttribute("aria-pressed", state.parallelSnap ? "true" : "false");
      }
      if (patch.perpendicularSnap !== undefined) {
        state.perpendicularSnap = patch.perpendicularSnap;
        perpSwitch.setAttribute("aria-pressed", state.perpendicularSnap ? "true" : "false");
      }
    },
    getValues: () => ({ ...state }),
  };
}
