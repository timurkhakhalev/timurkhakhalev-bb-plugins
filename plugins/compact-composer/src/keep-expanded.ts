// On touch devices bb collapses the composer whenever it loses focus to
// <body> and the keyboard closes, including the keyboard's "Done" button,
// which leaves a typed draft squeezed into the one-line pill. bb skips that
// collapse while the composer contains an open menu
// (`[aria-haspopup][aria-expanded="true"]`), so after a keyboard dismissal of
// a non-empty draft we park a hidden "open menu" marker in the form until the
// composer is focused again. Taps outside the composer still collapse it.

const FORM = "form[data-promptbox]";
export const ATTR_ALLOW_KEYBOARD_COLLAPSE = "data-cc-allow-keyboard-collapse";
const MARKER_ATTR = "data-cc-keep-expanded";
// A pointer press this recent outside the composer means the user tapped away.
const OUTSIDE_TAP_WINDOW_MS = 600;

export function startKeepExpanded(signal: AbortSignal): () => void {
  const coarse = window.matchMedia("(pointer: coarse)");
  let lastOutsidePress = 0;

  const onPointerDown = (event: PointerEvent) => {
    const target = event.target;
    if (target instanceof Element && target.closest(FORM)) return;
    lastOutsidePress = performance.now();
  };

  const onFocusOut = (event: FocusEvent) => {
    const form = formOf(event.target);
    if (!form || !enabled(coarse)) return;
    if (event.relatedTarget instanceof Node && form.contains(event.relatedTarget)) return;
    if (event.relatedTarget !== null) return; // focus moved to another control
    if (performance.now() - lastOutsidePress < OUTSIDE_TAP_WINDOW_MS) return;
    if (!hasDraft(form)) return;
    addMarker(form);
  };

  const onFocusIn = (event: FocusEvent) => {
    const form = formOf(event.target);
    if (form) removeMarker(form);
  };

  document.addEventListener("pointerdown", onPointerDown, { capture: true });
  // Capture phase so the marker is in place before bb checks on the next frame.
  document.addEventListener("focusout", onFocusOut, { capture: true });
  document.addEventListener("focusin", onFocusIn, { capture: true });

  const stop = () => {
    document.removeEventListener("pointerdown", onPointerDown, { capture: true });
    document.removeEventListener("focusout", onFocusOut, { capture: true });
    document.removeEventListener("focusin", onFocusIn, { capture: true });
    document.querySelectorAll(`[${MARKER_ATTR}]`).forEach((marker) => marker.remove());
  };
  signal.addEventListener("abort", stop, { once: true });
  return stop;
}

function enabled(coarse: MediaQueryList): boolean {
  return coarse.matches && !document.documentElement.hasAttribute(ATTR_ALLOW_KEYBOARD_COLLAPSE);
}

function formOf(target: EventTarget | null): HTMLFormElement | null {
  return target instanceof Element ? target.closest<HTMLFormElement>(FORM) : null;
}

function hasDraft(form: HTMLFormElement): boolean {
  const editor = form.querySelector("[contenteditable='true']");
  return Boolean(editor?.textContent?.trim()) || form.querySelector("img") !== null;
}

function addMarker(form: HTMLFormElement) {
  if (form.querySelector(`:scope > [${MARKER_ATTR}]`)) return;
  const marker = document.createElement("span");
  marker.setAttribute(MARKER_ATTR, "");
  marker.setAttribute("aria-haspopup", "true");
  marker.setAttribute("aria-expanded", "true");
  marker.hidden = true;
  form.appendChild(marker);
}

function removeMarker(form: HTMLFormElement) {
  form.querySelectorAll(`:scope > [${MARKER_ATTR}]`).forEach((marker) => marker.remove());
}
