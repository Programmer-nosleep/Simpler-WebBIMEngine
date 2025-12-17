export type SelectionRect = {
  left: number;
  right: number;
  top: number;
  bottom: number;
};

type SelectionMarqueeOptions = {
  onSelection?: (rect: SelectionRect) => void;
};

export function createSelectionMarquee(container: HTMLElement, options: SelectionMarqueeOptions = {}) {
  const overlay = document.createElement("div");
  overlay.className = "selection-marquee";
  container.appendChild(overlay);

  let isEnabled = false;
  let isDragging = false;
  let startX = 0;
  let startY = 0;

  const getRelativePosition = (event: PointerEvent) => {
    const bounds = container.getBoundingClientRect();
    return {
      x: event.clientX - bounds.left,
      y: event.clientY - bounds.top,
    };
  };

  const updateOverlay = (event: PointerEvent) => {
    const { x, y } = getRelativePosition(event);
    const width = Math.abs(x - startX);
    const height = Math.abs(y - startY);
    const left = Math.min(x, startX);
    const top = Math.min(y, startY);

    overlay.style.display = "block";
    overlay.style.left = `${left}px`;
    overlay.style.top = `${top}px`;
    overlay.style.width = `${width}px`;
    overlay.style.height = `${height}px`;
  };

  const hideOverlay = () => {
    overlay.style.display = "none";
    overlay.style.width = "0px";
    overlay.style.height = "0px";
  };

  const onPointerDown = (event: PointerEvent) => {
    if (!isEnabled || event.button !== 0) return;
    isDragging = true;
    const { x, y } = getRelativePosition(event);
    startX = x;
    startY = y;
    updateOverlay(event);
    window.addEventListener("pointermove", onPointerMove);
    window.addEventListener("pointerup", onPointerUp);
  };

  const onPointerMove = (event: PointerEvent) => {
    if (!isDragging) return;
    event.preventDefault();
    updateOverlay(event);
  };

  const onPointerUp = (event: PointerEvent) => {
    if (!isDragging) return;
    isDragging = false;
    updateOverlay(event);
    window.removeEventListener("pointermove", onPointerMove);
    window.removeEventListener("pointerup", onPointerUp);
    const bounds = container.getBoundingClientRect();
    const left = parseFloat(overlay.style.left || "0");
    const top = parseFloat(overlay.style.top || "0");
    const width = parseFloat(overlay.style.width || "0");
    const height = parseFloat(overlay.style.height || "0");
    if (width > 2 && height > 2) {
      const rect: SelectionRect = {
        left: left / bounds.width,
        right: (left + width) / bounds.width,
        top: top / bounds.height,
        bottom: (top + height) / bounds.height,
      };
      options.onSelection?.(rect);
    }
    hideOverlay();
  };

  container.addEventListener("pointerdown", onPointerDown);

  return {
    enable() {
      isEnabled = true;
    },
    disable() {
      isEnabled = false;
      if (isDragging) {
        isDragging = false;
        hideOverlay();
      }
    },
    dispose() {
      container.removeEventListener("pointerdown", onPointerDown);
      window.removeEventListener("pointermove", onPointerMove);
      window.removeEventListener("pointerup", onPointerUp);
      overlay.remove();
    },
  };
}
