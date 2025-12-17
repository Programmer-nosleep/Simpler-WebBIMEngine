type DockButton = {
  id: DockToolId;
  label: string;
  icon: string;
};

const buttons: DockButton[] = [
  { id: "select", label: "Select", icon: "NavigationArrow" },
  { id: "hand", label: "Hand (Plan)", icon: "BackHand" },
  { id: "section", label: "Section", icon: "Section" },
  { id: "bezier", label: "Bezier", icon: "BezierCurve" },
  { id: "circle", label: "Circle", icon: "Circle" },
  { id: "rect", label: "Rectangle", icon: "Rectangle" },
  { id: "oct", label: "Octagon", icon: "Octagon" },
  { id: "move", label: "Move", icon: "Move" },
  { id: "orbitTool", label: "Orbit", icon: "Orbit" },
  { id: "chat", label: "Chat", icon: "ChatCircle" },
];

export type DockToolId =
  | "select"
  | "hand"
  | "section"
  | "bezier"
  | "circle"
  | "rect"
  | "oct"
  | "move"
  | "orbitTool"
  | "chat";

export type DockOptions = {
  container?: HTMLElement;
  initialTool?: DockToolId;
  onToolChange?: (tool: DockToolId) => void;
};

const iconCache = new Map<string, string>();

async function fetchIcon(name: string): Promise<string> {
  if (iconCache.has(name)) return iconCache.get(name)!;
  const response = await fetch(`/assets/icon/${name}.svg`);
  const text = await response.text();
  iconCache.set(name, text);
  return text;
}

function createButton(button: DockButton, icon: string) {
  const node = document.createElement("button");
  node.type = "button";
  node.className = "dock-button";
  node.innerHTML = icon;
  node.setAttribute("aria-label", button.label);
  node.dataset.buttonId = button.id;
  return node;
}

export async function setupDock(options: DockOptions = {}) {
  const target = options.container ?? document.body;
  const dock = document.createElement("div");
  dock.id = "dock";
  dock.role = "toolbar";

  const buttonElements = await Promise.all(
    buttons.map(async (button) => {
      const icon = await fetchIcon(button.icon);
      return createButton(button, icon);
    })
  );

  buttonElements.forEach((btn) => dock.appendChild(btn));
  target.appendChild(dock);

  let activeTool: DockToolId | null = options.initialTool ?? null;

  const setActive = (tool: DockToolId, optionsSet?: { silent?: boolean }) => {
    activeTool = tool;
    buttonElements.forEach((btn) => {
      btn.classList.toggle("active", btn.dataset.buttonId === tool);
    });
    if (!optionsSet?.silent) {
      options.onToolChange?.(tool);
    }
  };

  buttonElements.forEach((btn) => {
    btn.addEventListener("click", () => {
      const id = btn.dataset.buttonId as DockToolId;
      setActive(id);
    });
  });

  if (activeTool) setActive(activeTool);

  return {
    dock,
    setActiveTool: (tool: DockToolId, setOptions?: { silent?: boolean }) => setActive(tool, setOptions),
    destroy() {
      dock.remove();
    },
  };
}
