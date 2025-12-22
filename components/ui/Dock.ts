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
  { id: "line", label: "Line", icon: "Line" },
  { id: "circle", label: "Circle", icon: "Circle" },
  { id: "arc", label: "Arc", icon: "Arc" },
  { id: "rectangle", label: "Rectangle", icon: "Rectangle" },
  { id: "polygon", label: "Polygon", icon: "Octagon" },
  { id: "extrude", label: "Extrude", icon: "Extrude" },
  { id: "move", label: "Move", icon: "Move" },
  { id: "group", label: "Group", icon: "Group" },
  { id: "orbitTool", label: "Orbit", icon: "Orbit" },
  { id: "chat", label: "Chat", icon: "ChatCircle" },
];

export type DockToolId =
  | "select"
  | "hand"
  | "section"
  | "bezier"
  | "line"
  | "circle"
  | "arc"
  | "rectangle"
  | "polygon"
  | "extrude"
  | "move"
  | "group"
  | "orbitTool"
  | "chat";

export type DockOptions = {
  container?: HTMLElement;
  initialTool?: DockToolId;
  onToolChange?: (tool: DockToolId | null) => void;
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

  // tandai chat biar bisa distyle / dipush ke bawah
  if (button.id === "chat") {
    node.classList.add("dock-button--chat");
  }

  return node;
}

export async function setupDock(options: DockOptions = {}) {
  const target = options.container ?? document.body;

  const wrapper = document.createElement("div");
  wrapper.id = "dock-wrapper";

  const dock = document.createElement("div");
  dock.id = "dock";
  dock.role = "toolbar";

  // wrapper khusus untuk message/chat
  const messageWrapper = document.createElement("div");
  messageWrapper.id = "dock-message-wrapper";

  const messageDock = document.createElement("div");
  messageDock.id = "dock-message";
  messageDock.role = "toolbar";

  const buttonElements = await Promise.all(
    buttons.map(async (button) => {
      const icon = await fetchIcon(button.icon);
      return createButton(button, icon);
    })
  );

  buttonElements.forEach((btn) => {
    if (btn.dataset.buttonId === "chat") {
      messageDock.appendChild(btn);
    } else {
      dock.appendChild(btn);
    }
  });

  messageWrapper.appendChild(messageDock);

  wrapper.appendChild(dock);
  wrapper.appendChild(messageWrapper);
  target.appendChild(wrapper);

  let activeTool: DockToolId | null = options.initialTool ?? null;

  const setActive = (tool: DockToolId | null, optionsSet?: { silent?: boolean }) => {
    activeTool = tool;
    buttonElements.forEach((btn) => {
      btn.classList.toggle("active", btn.dataset.buttonId === tool);
    });
    if (!optionsSet?.silent) options.onToolChange?.(tool);
  };

  buttonElements.forEach((btn) => {
    btn.addEventListener("click", () => {
      const id = btn.dataset.buttonId as DockToolId;
      if (id === "chat" && activeTool === "chat") {
        setActive(null);
      } else {
        setActive(id);
      }
    });
  });

  if (activeTool) setActive(activeTool);

  return {
    dock: wrapper,
    setActiveTool: (tool: DockToolId | null, setOptions?: { silent?: boolean }) =>
      setActive(tool, setOptions),
    destroy() {
      wrapper.remove();
    },
  };
}
