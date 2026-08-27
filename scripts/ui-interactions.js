function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

export function positionFloatingAtClient(element, layer, clientX, clientY, {
  offsetX = 0,
  offsetY = 0,
  margin = 8
} = {}) {
  if (!element?.isConnected || !layer?.isConnected) return;
  const layerRect = layer.getBoundingClientRect();
  const elementRect = element.getBoundingClientRect();
  const x = Number.isFinite(Number(clientX)) ? Number(clientX) : layerRect.left + layerRect.width / 2;
  const y = Number.isFinite(Number(clientY)) ? Number(clientY) : layerRect.top + layerRect.height / 2;
  const left = clamp(
    x - layerRect.left + offsetX,
    margin,
    Math.max(margin, layerRect.width - elementRect.width - margin)
  );
  const top = clamp(
    y - layerRect.top + offsetY,
    margin,
    Math.max(margin, layerRect.height - elementRect.height - margin)
  );
  element.style.left = `${left}px`;
  element.style.top = `${top}px`;
}

export function closeSpellTooltip(runtime) {
  if (!runtime) return;
  if (runtime.spellTooltipTimer) clearTimeout(runtime.spellTooltipTimer);
  runtime.spellTooltipTimer = 0;
  if (runtime.spellTooltipFrame) cancelAnimationFrame(runtime.spellTooltipFrame);
  runtime.spellTooltipFrame = 0;
  runtime.spellTooltip?.remove?.();
  runtime.spellTooltip = null;
}

export function bindDelayedSpellTooltip(runtime, button, markup, { delay = 500 } = {}) {
  if (!runtime || !button) return;
  let pointerX = 0;
  let pointerY = 0;

  const rememberPointer = (event) => {
    pointerX = Number(event?.clientX) || pointerX;
    pointerY = Number(event?.clientY) || pointerY;
  };

  const open = () => {
    closeSpellTooltip(runtime);
    runtime.spellTooltipTimer = window.setTimeout(() => {
      runtime.spellTooltipTimer = 0;
      if (!button.isConnected || runtime.movingSpellId || runtime.contextMenu) return;
      const layer = runtime.overlay?.querySelector?.(".gg-context-layer");
      if (!layer) return;
      const tooltip = document.createElement("div");
      tooltip.className = "gg-spell-tooltip";
      tooltip.innerHTML = markup;
      layer.append(tooltip);
      runtime.spellTooltip = tooltip;
      if (!pointerX || !pointerY) {
        const rect = button.getBoundingClientRect();
        pointerX = rect.right;
        pointerY = rect.top + rect.height / 2;
      }
      positionFloatingAtClient(tooltip, layer, pointerX, pointerY, { offsetX: 14, offsetY: 12 });
    }, Math.max(0, Number(delay) || 500));
  };

  button.addEventListener("pointerenter", (event) => {
    rememberPointer(event);
    open();
  });
  button.addEventListener("pointermove", (event) => {
    rememberPointer(event);
    if (!runtime.spellTooltip?.isConnected || runtime.spellTooltipFrame) return;
    runtime.spellTooltipFrame = requestAnimationFrame(() => {
      runtime.spellTooltipFrame = 0;
      const tooltip = runtime.spellTooltip;
      if (!tooltip?.isConnected) return;
      const layer = runtime.overlay?.querySelector?.(".gg-context-layer");
      if (layer) positionFloatingAtClient(tooltip, layer, pointerX, pointerY, { offsetX: 14, offsetY: 12 });
    });
  }, { passive: true });
  button.addEventListener("pointerleave", () => closeSpellTooltip(runtime));
  button.addEventListener("pointerdown", () => closeSpellTooltip(runtime), { passive: true });
}

export function clearLinkSparkSchedule(runtime) {
  if (!runtime) return;
  if (runtime.linkSparkTimer) clearTimeout(runtime.linkSparkTimer);
  runtime.linkSparkTimer = 0;
}

export function scheduleRandomLinkSparks(runtime) {
  clearLinkSparkSchedule(runtime);
  if (!runtime?.overlay?.isConnected) return;
  if (globalThis.matchMedia?.("(prefers-reduced-motion: reduce)")?.matches) return;

  const links = [...runtime.overlay.querySelectorAll(".gg-star-link[data-gg-link]")];
  if (!links.length) return;

  const scheduleNext = (initial = false) => {
    clearLinkSparkSchedule(runtime);
    const delay = initial
      ? 700 + Math.random() * 2600
      : 1400 + Math.random() * 7200;
    runtime.linkSparkTimer = window.setTimeout(() => {
      runtime.linkSparkTimer = 0;
      if (!runtime.overlay?.isConnected) return;
      const liveLinks = [...runtime.overlay.querySelectorAll(".gg-star-link[data-gg-link]")];
      if (!liveLinks.length) return;
      const selected = liveLinks[Math.floor(Math.random() * liveLinks.length)];
      selected.querySelector("[data-gg-spark-opacity]")?.beginElement?.();
      selected.querySelector("[data-gg-spark-motion]")?.beginElement?.();
      scheduleNext(false);
    }, delay);
  };

  scheduleNext(true);
}
