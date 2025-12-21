type IconName = "chevron" | "plus" | "eye" | "grid" | "close" | "hamburger";

const ICONS: Record<IconName, string> = {
  chevron: `<svg viewBox="0 0 12 12" xmlns="http://www.w3.org/2000/svg">
    <path d="M3 4.5L6 7.5L9 4.5" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"/>
  </svg>`,
  plus: `<svg viewBox="0 0 12 12" xmlns="http://www.w3.org/2000/svg">
    <path d="M6 2V10M2 6H10" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"/>
  </svg>`,
  eye: `<svg viewBox="0 0 16 16" xmlns="http://www.w3.org/2000/svg">
    <path d="M8 3.5C4.5 3.5 2.25 6.11 1.25 7.5C2.25 8.89 4.5 11.5 8 11.5C11.5 11.5 13.75 8.89 14.75 7.5C13.75 6.11 11.5 3.5 8 3.5Z" stroke="currentColor" stroke-width="1.2" fill="none" stroke-linecap="round" stroke-linejoin="round"/>
    <circle cx="8" cy="7.5" r="1.6" stroke="currentColor" stroke-width="1.2" fill="none"/>
  </svg>`,
  grid: `<svg viewBox="0 0 16 16" xmlns="http://www.w3.org/2000/svg">
    <rect x="2.5" y="2.5" width="11" height="11" rx="1.2" stroke="currentColor" stroke-width="1.2" fill="none"/>
    <path d="M7.5 2.5V13.5M2.5 7.5H13.5" stroke="currentColor" stroke-width="1.2"/>
  </svg>`,
  close: `<svg viewBox="0 0 12 12" xmlns="http://www.w3.org/2000/svg">
    <path d="M3 3L9 9M9 3L3 9" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"/>
  </svg>`,
  hamburger: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
    <line x1="3" y1="12" x2="21" y2="12"></line>
    <line x1="3" y1="6" x2="21" y2="6"></line>
    <line x1="3" y1="18" x2="21" y2="18"></line>
  </svg>`,
};

export type SidebarSectionItem = {
  id: string;
  label: string;
  icon: "eye" | "grid";
  active?: boolean;
  onSelect?: () => void;
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

export type LeftSidebarCallbacks = {
  onDefault?: () => void;
  onElevation?: (dir: "north" | "south" | "west" | "east") => void;
  onViewportChange?: (viewport: string) => void;
  onUnitChange?: (unit: UnitsName) => void;
  onToleranceChange?: (value: number) => void;
  onDimensionSnapChange?: (value: number) => void;
  onAngleSnapChange?: (value: number) => void;
  onParallelSnapChange?: (value: boolean) => void;
  onPerpendicularSnapChange?: (value: boolean) => void;
};

export type LeftSidebarHandle = {
  setSectionItems: (items: SidebarSectionItem[]) => void;
  onSectionAdd: (handler: () => void) => void;
  setValues: (patch: Partial<RightSidebarValues>) => void;
  getValues: () => RightSidebarValues;
};

type SidebarSection = {
  id: string;
  title: string;
  subtitle?: string;
  items: SidebarSectionItem[];
  collapsed?: boolean;
};

function ensureContainer(root?: HTMLElement): HTMLElement {
  if (root) return root;
  const existing = document.getElementById("leftSidebar");
  const container = existing || document.createElement("aside");

  if (!existing) {
    container.id = "leftSidebar";
    document.body.appendChild(container);
  }

  // Posisi sidebar fixed di kiri, memanjang hingga bawah, tetapi scrollable
  container.style.position = "fixed";
  container.style.top = "70px";
  container.style.left = "12px";
  container.style.bottom = "12px"; // Sampai bawah dengan sedikit margin
  container.style.marginTop = "0";
  container.style.overflowY = "auto"; // Scrollable jika konten melebihi height
  container.style.maxHeight = "calc(100vh - 82px)"; // 70px top + 12px bottom

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

export function setupLeftSidebar(root?: HTMLElement, callbacks?: LeftSidebarCallbacks): LeftSidebarHandle {
  const container = ensureContainer(root);
  container.innerHTML = "";
  container.setAttribute("role", "navigation");
  container.setAttribute("aria-label", "Project views");

  // State untuk properties (dari RightSidebar)
  const state: RightSidebarValues = {
    viewport: "Personal Camera",
    unit: "Millimeters",
    tolerance: 0.0,
    dimensionSnap: 100.0,
    angleSnap: 5,
    parallelSnap: true,
    perpendicularSnap: true,
  };

  // ===== TOP ROW: Viewport + Close Button =====
  const topRow = document.createElement("div");
  topRow.className = "sidebar-section-row sidebar-viewport-row"; // Reuse viewport style
  topRow.style.marginBottom = "8px"; // Spacing to next section
  // Override justify-content to space-between for layout
  topRow.style.display = "flex";
  topRow.style.alignItems = "center";
  topRow.style.justifyContent = "space-between";
  topRow.style.padding = "12px 16px";

  // 1. Viewport Group (Label + Select)
  const viewportContent = document.createElement("div");
  viewportContent.style.display = "flex";
  viewportContent.style.alignItems = "center";
  viewportContent.style.flex = "1";
  viewportContent.style.marginRight = "12px"; // Gap to close button
  viewportContent.style.gap = "12px";

  const viewportLabel = document.createElement("div");
  viewportLabel.className = "sidebar-section-title";
  viewportLabel.textContent = "Viewport";
  // viewportLabel.style.width = "auto";

  const viewportSelectWrap = document.createElement("div");
  viewportSelectWrap.className = "sidebar-field";
  viewportSelectWrap.style.flex = "1"; // Grow to fill space

  const viewportSelect = document.createElement("select");
  viewportSelect.className = "sidebar-input";
  ["Personal Camera"].forEach((opt) => {
    const o = document.createElement("option");
    o.value = opt;
    o.textContent = opt;
    viewportSelect.appendChild(o);
  });
  viewportSelect.value = state.viewport;

  viewportSelect.addEventListener("change", () => {
    state.viewport = viewportSelect.value;
    callbacks?.onViewportChange?.(state.viewport);
  });

  viewportSelectWrap.appendChild(viewportSelect);
  // viewportChevron removed as requested (native select arrow remains)

  viewportContent.appendChild(viewportLabel);
  viewportContent.appendChild(viewportSelectWrap);
  // 2. Close Button (Now Hamburger)
  const closeBtn = document.createElement("button");
  closeBtn.type = "button";
  closeBtn.title = "Toggle Sidebar"; // Changed title to reflect toggle nature
  closeBtn.style.background = "transparent";
  closeBtn.style.border = "none";
  closeBtn.style.cursor = "pointer";
  closeBtn.style.color = "inherit";
  closeBtn.style.padding = "0";
  closeBtn.style.display = "flex";
  closeBtn.style.alignItems = "center";
  closeBtn.style.justifyContent = "center";
  closeBtn.classList.add("sidebar-toggle-btn"); // Add class for animation
  closeBtn.appendChild(createIconElement("hamburger")); // Default Open

  closeBtn.addEventListener("click", () => {
    // window.dispatchEvent(new CustomEvent("sidebar-toggle-left"));
    // New logic: Collapse sidebar instead of hiding
    const isCollapsed = container.classList.toggle("collapsed");

    // User request: "dapat silang kalo dia nutup" implies Closed State = X
    // Open State (default) = Hamburger
    closeBtn.innerHTML = "";
    if (isCollapsed) {
      closeBtn.appendChild(createIconElement("close")); // X when collapsed
    } else {
      closeBtn.appendChild(createIconElement("hamburger")); // Hamburger when open
    }
  });

  topRow.appendChild(viewportContent);
  topRow.appendChild(closeBtn);

  container.appendChild(topRow);

  // ===== Left Sidebar Sections =====
  let sectionListRef: HTMLUListElement | null = null;
  let sectionAddButton: HTMLButtonElement | null = null;

  const sections: SidebarSection[] = [
    {
      id: "views",
      title: "3D Views",
      items: [{ id: "default", label: "Default", icon: "eye", onSelect: () => callbacks?.onDefault?.() }],
    },
    {
      id: "elevations",
      title: "Elevations",
      subtitle: "(Building Elevation)",
      items: [
        { id: "north", label: "North", icon: "eye", onSelect: () => callbacks?.onElevation?.("north") },
        { id: "south", label: "South", icon: "eye", onSelect: () => callbacks?.onElevation?.("south") },
        { id: "west", label: "West", icon: "eye", onSelect: () => callbacks?.onElevation?.("west") },
        { id: "east", label: "East", icon: "eye", onSelect: () => callbacks?.onElevation?.("east") },
      ],
    },
    {
      id: "sections",
      title: "Section",
      subtitle: "(Plans)",
      items: [],
    },
  ];

  sections.forEach((section) => {
    const sectionEl = document.createElement("section");
    sectionEl.className = "sidebar-section";
    sectionEl.dataset.sectionId = section.id;
    if (section.collapsed) sectionEl.classList.add("collapsed");

    const headerRow = document.createElement("div");
    headerRow.className = "sidebar-section-row";

    const toggleButton = document.createElement("button");
    toggleButton.type = "button";
    toggleButton.className = "sidebar-section-toggle";
    toggleButton.setAttribute("aria-expanded", String(!section.collapsed));

    const chevron = createIconElement("chevron");
    chevron.classList.add("icon-chevron");

    const titleWrap = document.createElement("span");
    titleWrap.className = "sidebar-section-title";
    titleWrap.textContent = section.title;

    toggleButton.appendChild(chevron);
    toggleButton.appendChild(titleWrap);
    if (section.subtitle) {
      const subtitle = document.createElement("span");
      subtitle.className = "sidebar-section-subtitle";
      subtitle.textContent = ` ${section.subtitle}`;
      titleWrap.appendChild(subtitle);
    }
    headerRow.appendChild(toggleButton);

    const addButton = document.createElement("button");
    addButton.type = "button";
    addButton.className = "sidebar-add";
    addButton.title = `Add ${section.title}`;
    addButton.appendChild(createIconElement("plus"));
    headerRow.appendChild(addButton);

    sectionEl.appendChild(headerRow);

    const list = document.createElement("ul");
    list.className = "sidebar-items";
    const renderItems = (items: SidebarSectionItem[]) => {
      list.innerHTML = "";
      items.forEach((item) => {
        const li = document.createElement("li");
        li.className = "sidebar-item";

        const itemBtn = document.createElement("button");
        itemBtn.type = "button";
        itemBtn.className = "sidebar-item-button";
        if (item.active) itemBtn.classList.add("active");
        itemBtn.appendChild(createIconElement(item.icon));

        const label = document.createElement("span");
        label.className = "sidebar-item-label";
        label.textContent = item.label;
        itemBtn.appendChild(label);

        if (item.onSelect) {
          itemBtn.addEventListener("click", () => item.onSelect?.());
        }

        li.appendChild(itemBtn);
        list.appendChild(li);
      });
    };

    renderItems(section.items);

    if (section.id === "sections") {
      sectionListRef = list;
      sectionAddButton = addButton;
    }

    sectionEl.appendChild(list);

    toggleButton.addEventListener("click", () => {
      const collapsed = sectionEl.classList.toggle("collapsed");
      toggleButton.setAttribute("aria-expanded", String(!collapsed));
    });

    container.appendChild(sectionEl);
  });

  // Section: Properties (Replaces Merged Right Sidebar Content part)
  const propertiesSection = document.createElement("section");
  propertiesSection.className = "sidebar-section";
  propertiesSection.dataset.sectionId = "properties";

  const propsHeaderRow = document.createElement("div");
  propsHeaderRow.className = "sidebar-section-row";

  const propsToggleButton = document.createElement("button");
  propsToggleButton.type = "button";
  propsToggleButton.className = "sidebar-section-toggle";
  propsToggleButton.setAttribute("aria-expanded", "true");

  const propsChevron = createIconElement("chevron");
  propsChevron.classList.add("icon-chevron");

  const propsTitleWrap = document.createElement("span");
  propsTitleWrap.className = "sidebar-section-title";
  propsTitleWrap.textContent = "Properties";

  propsToggleButton.appendChild(propsChevron);
  propsToggleButton.appendChild(propsTitleWrap);

  propsHeaderRow.appendChild(propsToggleButton);
  propertiesSection.appendChild(propsHeaderRow);

  // Wrapper for collapsible content (styled like other sections)
  const contentWrapper = document.createElement("div");
  contentWrapper.className = "sidebar-items"; // Reuses 'display: none' when collapsed style & indentation
  // No custom padding here to allow standard "sidebar-items" indentation (24px)

  // helper row builder
  const addFieldRow = (labelText: string, controlEl: HTMLElement) => {
    const row = document.createElement("div");
    row.className = "sidebar-form-row";
    // Uses sidebar-form-row for space-between, but sits inside sidebar-items for indentation

    const label = document.createElement("label");
    label.className = "sidebar-form-label";
    label.textContent = labelText;

    row.appendChild(label);
    row.appendChild(controlEl);
    contentWrapper.appendChild(row); // Append directly to wrapper
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

  unitSelect.addEventListener("change", () => {
    state.unit = unitSelect.value as UnitsName;
    callbacks?.onUnitChange?.(state.unit);
  });

  unitWrap.appendChild(unitSelect);
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
    btn.appendChild(knob); // Add knob to switch

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

  propertiesSection.appendChild(contentWrapper);

  propsToggleButton.addEventListener("click", () => {
    const collapsed = propertiesSection.classList.toggle("collapsed");
    propsToggleButton.setAttribute("aria-expanded", String(!collapsed));
  });

  container.appendChild(propertiesSection);


  return {
    setSectionItems: (items) => {
      const listEl = sectionListRef;
      if (!listEl) return;
      listEl.innerHTML = "";
      items.forEach((item) => {
        const li = document.createElement("li");
        li.className = "sidebar-item";

        const itemBtn = document.createElement("button");
        itemBtn.type = "button";
        itemBtn.className = "sidebar-item-button";
        itemBtn.appendChild(createIconElement(item.icon));
        if (item.active) itemBtn.classList.add("active");

        const label = document.createElement("span");
        label.className = "sidebar-item-label";
        label.textContent = item.label;
        itemBtn.appendChild(label);

        if (item.onSelect) {
          itemBtn.addEventListener("click", () => item.onSelect?.());
        }

        li.appendChild(itemBtn);
        listEl.appendChild(li);
      });
    },
    onSectionAdd: (handler) => {
      sectionAddButton?.addEventListener("click", (event) => {
        event.stopPropagation();
        handler();
      });
    },
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
