export type SelectionRect = {
  left: number;
  right: number;
  top: number;
  bottom: number;
};

type SelectionMarqueeOptions = {
  onSelection?: (rect: SelectionRect, event: PointerEvent) => void;
  requireShift?: boolean;
  dragThreshold?: number;
  minSizePx?: number;
};

export function createSelectionMarquee(container: HTMLElement, options: SelectionMarqueeOptions = {}) {
  const overlay = document.createElement("div");
  overlay.className = "selection-marquee";
  container.appendChild(overlay);

  let isEnabled = false;
  let isPointerDown = false;
  let isDragging = false;
  let activePointerId: number | null = null;
  let lastDragEndAt = 0;
  let startX = 0;
  let startY = 0;

  const dragThreshold = options.dragThreshold ?? 3;
  const minSizePx = options.minSizePx ?? 2;

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
    if (options.requireShift && !event.shiftKey) return;
    if (isPointerDown) return;
    isPointerDown = true;
    isDragging = false;
    activePointerId = event.pointerId;
    const { x, y } = getRelativePosition(event);
    startX = x;
    startY = y;
    hideOverlay();
    window.addEventListener("pointermove", onPointerMove, { capture: true });
    window.addEventListener("pointerup", onPointerUp, { capture: true });
  };

  const onPointerMove = (event: PointerEvent) => {
    if (!isPointerDown) return;
    if (activePointerId !== null && event.pointerId !== activePointerId) return;

    const { x, y } = getRelativePosition(event);
    const dx = x - startX;
    const dy = y - startY;
    if (!isDragging) {
      if (Math.hypot(dx, dy) < dragThreshold) return;
      isDragging = true;
    }

    event.preventDefault();
    event.stopPropagation();
    updateOverlay(event);
  };

  const onPointerUp = (event: PointerEvent) => {
    if (!isPointerDown) return;
    if (activePointerId !== null && event.pointerId !== activePointerId) return;
    isPointerDown = false;
    window.removeEventListener("pointermove", onPointerMove, { capture: true });
    window.removeEventListener("pointerup", onPointerUp, { capture: true });

    if (!isDragging) {
      activePointerId = null;
      hideOverlay();
      return;
    }

    event.preventDefault();
    event.stopPropagation();
    updateOverlay(event);
    const bounds = container.getBoundingClientRect();
    const left = parseFloat(overlay.style.left || "0");
    const top = parseFloat(overlay.style.top || "0");
    const width = parseFloat(overlay.style.width || "0");
    const height = parseFloat(overlay.style.height || "0");
    if (width > minSizePx && height > minSizePx) {
      const rect: SelectionRect = {
        left: left / bounds.width,
        right: (left + width) / bounds.width,
        top: top / bounds.height,
        bottom: (top + height) / bounds.height,
      };
      options.onSelection?.(rect, event);
    }
    hideOverlay();
    isDragging = false;
    activePointerId = null;
    lastDragEndAt = performance.now();
  };

  const onClickCapture = (event: MouseEvent) => {
    if (!lastDragEndAt) return;
    const elapsed = performance.now() - lastDragEndAt;
    if (elapsed > 250) {
      lastDragEndAt = 0;
      return;
    }
    lastDragEndAt = 0;
    event.preventDefault();
    event.stopPropagation();
  };

  container.addEventListener("pointerdown", onPointerDown, { capture: true });
  container.addEventListener("click", onClickCapture, { capture: true });

  return {
    enable() {
      isEnabled = true;
    },
    disable() {
      isEnabled = false;
      if (!isPointerDown && !isDragging) return;
      isPointerDown = false;
      isDragging = false;
      activePointerId = null;
      hideOverlay();
      window.removeEventListener("pointermove", onPointerMove, { capture: true });
      window.removeEventListener("pointerup", onPointerUp, { capture: true });
    },
    isDragging() {
      return isDragging;
    },
    dispose() {
      container.removeEventListener("pointerdown", onPointerDown, { capture: true });
      container.removeEventListener("click", onClickCapture, { capture: true });
      window.removeEventListener("pointermove", onPointerMove, { capture: true });
      window.removeEventListener("pointerup", onPointerUp, { capture: true });
      overlay.remove();
    },
  };
}
