const translation = document.querySelector<HTMLElement>("#translation")!;
const overlayState = window.createSubTandemOverlayState();

function applyTypography(): void {
  const typography = window.calculateSubTandemOverlayTypography(window.innerHeight);
  translation.style.fontSize = `${typography.fontSize}px`;
  translation.style.fontWeight = String(typography.fontWeight);
  translation.style.webkitTextStrokeWidth = `${typography.strokeWidth}px`;
  translation.style.textShadow = `0 0 ${typography.strokeWidth}px #000`;
}

function writeLines(lines: string[]): void {
  translation.replaceChildren();
  lines.forEach((line, index) => {
    if (index > 0) translation.append(document.createElement("br"));
    translation.append(document.createTextNode(line));
  });
  translation.hidden = false;
}

function clearText(): void {
  translation.replaceChildren();
  translation.hidden = true;
}

function layoutCurrent(): void {
  if (!overlayState.snapshot.frame || translation.hidden) return;
  applyTypography();
  const measured = translation.getBoundingClientRect();
  const result = overlayState.layout(window.innerHeight, measured.height);
  if (!result?.changed) return;
  translation.style.top = `${result.layout.topOffset}px`;
  translation.style.left = `${result.layout.horizontalMargin}px`;
  translation.style.right = `${result.layout.horizontalMargin}px`;
}

function scheduleLayout(): void {
  window.requestAnimationFrame(layoutCurrent);
}

window.iina?.onMessage("overlay:render", (raw: unknown) => {
  if (!overlayState.applyRender(raw)) return;
  applyTypography();
  writeLines(overlayState.snapshot.frame!.lines);
  scheduleLayout();
});

window.iina?.onMessage("overlay:layout", (raw: unknown) => {
  if (!overlayState.applyLayout(raw)) return;
  scheduleLayout();
});

window.iina?.onMessage("overlay:clear", (raw: unknown) => {
  if (!overlayState.clear(raw)) return;
  clearText();
});

window.addEventListener("resize", scheduleLayout);
window.iina?.postMessage("overlay:ready", {});
