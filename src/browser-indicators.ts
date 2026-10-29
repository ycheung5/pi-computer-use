// Runs only in this extension's isolated browser realm. Keep the function self-contained.
export function updateBrowserIndicator(input: {
  mode: "mark" | "hide" | "show" | "clear";
  point?: { x: number; y: number };
}) {
  type Cue = {
    host: HTMLDivElement;
    marker: SVGSVGElement;
    icon: HTMLLinkElement;
  };
  const world = globalThis as unknown as { __piComputerUseCue?: Cue };
  let cue = world.__piComputerUseCue;
  if (input.mode === "clear") {
    cue?.host.remove();
    cue?.icon.remove();
    delete world.__piComputerUseCue;
    return { active: false, tabBadge: false, clickMarker: false };
  }
  if (
    !cue?.host.isConnected &&
    input.mode === "mark" &&
    document.documentElement
  ) {
    cue?.icon.remove();
    const host = document.createElement("div");
    host.setAttribute("aria-hidden", "true");
    host.setAttribute("role", "presentation");
    host.style.cssText =
      "all:initial!important;position:fixed!important;left:0!important;top:0!important;width:0!important;height:0!important;overflow:visible!important;pointer-events:none!important;z-index:2147483647!important";
    const root = host.attachShadow({ mode: "closed" });
    const marker = document.createElementNS(
      "http://www.w3.org/2000/svg",
      "svg",
    );
    marker.setAttribute("viewBox", "0 0 28 34");
    marker.setAttribute("aria-hidden", "true");
    marker.style.cssText =
      "position:fixed;width:28px;height:34px;pointer-events:none;display:none;filter:drop-shadow(0 0 3px #2d9cff)";
    const arrow = document.createElementNS(
      "http://www.w3.org/2000/svg",
      "path",
    );
    arrow.setAttribute("d", "M2 2 L2 25 L8 20 L13 31 L18 28 L13 18 L23 18 Z");
    arrow.setAttribute("fill", "#2d9cff");
    arrow.setAttribute("stroke", "white");
    arrow.setAttribute("stroke-width", "1.5");
    marker.append(arrow);
    root.append(marker);
    document.documentElement.append(host);
    const icon = document.createElement("link");
    icon.rel = "icon";
    icon.type = "image/svg+xml";
    icon.href =
      "data:image/svg+xml," +
      encodeURIComponent(
        '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32"><rect width="32" height="32" rx="6" fill="#247fd9"/><text x="16" y="23" font-family="sans-serif" font-size="23" text-anchor="middle" fill="white">π</text></svg>',
      );
    (document.head ?? document.documentElement).append(icon);
    cue = { host, marker, icon };
    world.__piComputerUseCue = cue;
  }
  if (!cue) return { active: false, tabBadge: false, clickMarker: false };
  if (input.mode === "hide")
    cue.host.style.setProperty("display", "none", "important");
  else if (input.mode === "show") cue.host.style.removeProperty("display");
  else {
    cue.host.style.removeProperty("display");
    if (
      input.point &&
      Number.isFinite(input.point.x) &&
      Number.isFinite(input.point.y)
    ) {
      cue.marker.style.left = `${input.point.x}px`;
      cue.marker.style.top = `${input.point.y}px`;
      cue.marker.style.display = "block";
    }
  }
  return {
    active: cue.host.isConnected,
    tabBadge: cue.icon.isConnected,
    clickMarker: cue.marker.style.display !== "none",
    hidden: cue.host.style.display === "none",
    ariaHidden: cue.host.getAttribute("aria-hidden") === "true",
    pointerEvents: cue.host.style.pointerEvents,
    shadowClosed: cue.host.shadowRoot === null,
  };
}
