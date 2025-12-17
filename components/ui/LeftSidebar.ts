type IconName = "chevron" | "plus" | "eye" | "grid";

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
};

type SidebarItem = {
  label: string;
  icon: "eye" | "grid";
};

type SidebarSection = {
  title: string;
  subtitle?: string;
  items: SidebarItem[];
  collapsed?: boolean;
};

const sections: SidebarSection[] = [
  {
    title: "3D Views",
    items: [{ label: "Default", icon: "eye" }],
  },
  {
    title: "Elevations",
    subtitle: "(Building Elevation)",
    items: [
      { label: "North", icon: "eye" },
      { label: "South", icon: "eye" },
      { label: "West", icon: "eye" },
      { label: "East", icon: "eye" },
    ],
  },
  {
    title: "Section",
    subtitle: "(Building Elevation)",
    items: [
      { label: "Section 1", icon: "grid" },
      { label: "North", icon: "grid" },
      { label: "South", icon: "grid" },
      { label: "West", icon: "grid" },
    ],
  },
];

function ensureContainer(root?: HTMLElement): HTMLElement {
  if (root) return root;
  const existing = document.getElementById("leftSidebar");
  if (existing) return existing;
  const container = document.createElement("aside");
  container.id = "leftSidebar";
  document.body.appendChild(container);
  return container;
}

function createIconElement(name: IconName): HTMLElement {
  const span = document.createElement("span");
  span.className = `sidebar-icon icon-${name}`;
  span.innerHTML = ICONS[name];
  span.setAttribute("aria-hidden", "true");
  return span;
}

export function setupLeftSidebar(root?: HTMLElement) {
  const container = ensureContainer(root);
  container.innerHTML = "";
  container.setAttribute("role", "navigation");
  container.setAttribute("aria-label", "Project views");

  sections.forEach((section) => {
    const sectionEl = document.createElement("section");
    sectionEl.className = "sidebar-section";
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
    section.items.forEach((item) => {
      const li = document.createElement("li");
      li.className = "sidebar-item";

      const itemBtn = document.createElement("button");
      itemBtn.type = "button";
      itemBtn.className = "sidebar-item-button";
      itemBtn.appendChild(createIconElement(item.icon));

      const label = document.createElement("span");
      label.className = "sidebar-item-label";
      label.textContent = item.label;
      itemBtn.appendChild(label);

      li.appendChild(itemBtn);
      list.appendChild(li);
    });
    sectionEl.appendChild(list);

    toggleButton.addEventListener("click", () => {
      const collapsed = sectionEl.classList.toggle("collapsed");
      toggleButton.setAttribute("aria-expanded", String(!collapsed));
    });

    addButton.addEventListener("click", (event) => {
      event.stopPropagation();
      // Placeholder for future add action
    });

    container.appendChild(sectionEl);
  });
}
