const GROUP = '[role="radiogroup"][aria-label="Reasoning"]';

// Keep BB's buttons as the source of truth and use their normal selection path.
export function startReasoningSlider(signal: AbortSignal): () => void {
  const sliders = new Map<HTMLElement, () => void>();

  function enhance(group: HTMLElement) {
    const heading = group.previousElementSibling;
    if (!(heading instanceof HTMLElement)) return;
    const control = document.createElement("div");
    control.className = "cc-reasoning";
    const value = document.createElement("div");
    value.className = "cc-reasoning-value";
    const track = document.createElement("div");
    track.className = "cc-reasoning-track";
    const fill = document.createElement("div");
    fill.className = "cc-reasoning-fill";
    const ticks = document.createElement("div");
    ticks.className = "cc-reasoning-ticks";
    const input = document.createElement("input");
    input.type = "range";
    input.min = "0";
    input.step = "1";
    input.setAttribute("aria-label", "Reasoning effort");
    track.append(fill, ticks, input);
    control.append(track);
    heading.classList.add("cc-reasoning-heading");
    heading.append(value);
    group.after(control);
    group.setAttribute("data-cc-reasoning-original", "");

    let buttons: HTMLButtonElement[] = [];
    const preview = () => {
      const index = Number(input.value);
      const label = buttons[index]?.getAttribute("aria-label") ?? "";
      value.textContent = label;
      input.setAttribute("aria-valuetext", label);
      control.style.setProperty("--cc-reasoning-position", String(index / Math.max(1, buttons.length - 1)));
    };
    const sync = () => {
      buttons = Array.from(group.querySelectorAll<HTMLButtonElement>('button[role="radio"]'));
      input.max = String(Math.max(0, buttons.length - 1));
      input.disabled = buttons.length < 2 || buttons.some((button) => button.disabled);
      control.toggleAttribute("data-disabled", input.disabled);
      const selected = buttons.findIndex((button) => button.getAttribute("aria-checked") === "true");
      input.value = String(Math.max(0, selected));
      if (ticks.childElementCount !== buttons.length) {
        ticks.replaceChildren(...buttons.map(() => document.createElement("span")));
      }
      preview();
      if (selected < 0) {
        value.textContent = "Default";
        input.setAttribute("aria-valuetext", "Default");
      }
    };
    input.addEventListener("input", preview);
    input.addEventListener("change", () => {
      const button = buttons[Number(input.value)];
      if (button && !button.disabled && button.getAttribute("aria-checked") !== "true") button.click();
      sync();
    });
    const observer = new MutationObserver(sync);
    observer.observe(group, { subtree: true, childList: true, attributes: true, attributeFilter: ["aria-checked", "disabled", "aria-label"] });
    sync();
    sliders.set(group, () => {
      observer.disconnect();
      control.remove();
      value.remove();
      heading.classList.remove("cc-reasoning-heading");
      group.removeAttribute("data-cc-reasoning-original");
    });
  }

  const discover = (node: Node) => {
    if (!(node instanceof HTMLElement)) return;
    if (node.matches(GROUP) && !sliders.has(node)) enhance(node);
    node.querySelectorAll<HTMLElement>(GROUP).forEach((group) => {
      if (!sliders.has(group)) enhance(group);
    });
  };
  const observer = new MutationObserver((records) => {
    for (const record of records) record.addedNodes.forEach(discover);
    for (const [group, remove] of sliders) {
      if (!group.isConnected) {
        remove();
        sliders.delete(group);
      }
    }
  });
  observer.observe(document.body, { childList: true, subtree: true });
  discover(document.body);
  const stop = () => {
    observer.disconnect();
    sliders.forEach((remove) => remove());
    sliders.clear();
  };
  signal.addEventListener("abort", stop, { once: true });
  return stop;
}
