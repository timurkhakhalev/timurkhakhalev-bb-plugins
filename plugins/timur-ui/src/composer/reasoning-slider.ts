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
    const modes = document.createElement("div");
    modes.className = "cc-reasoning-modes";
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
    control.append(modes, track);
    heading.classList.add("cc-reasoning-heading");
    heading.append(value);
    group.after(control);
    group.setAttribute("data-cc-reasoning-original", "");

    let buttons: HTMLButtonElement[] = [];
    let modeButtons: { source: HTMLButtonElement; button: HTMLButtonElement }[] = [];
    const preview = () => {
      const index = Number(input.value);
      const label = buttons[index]?.getAttribute("aria-label") ?? "";
      value.textContent = label;
      input.setAttribute("aria-valuetext", label);
      control.removeAttribute("data-inactive");
      control.style.setProperty("--cc-reasoning-position", String(index / Math.max(1, buttons.length - 1)));
    };
    const sync = () => {
      const options = Array.from(group.querySelectorAll<HTMLButtonElement>('button[role="radio"]'));
      const isMode = (button: HTMLButtonElement) => /^(default|none)$/i.test(button.getAttribute("aria-label") ?? "");
      const special = options.filter(isMode);
      buttons = options.filter((button) => !isMode(button));
      if (special.length !== modeButtons.length || special.some((source, index) => source !== modeButtons[index]?.source)) {
        modeButtons = special.map((source) => {
          const button = document.createElement("button");
          button.type = "button";
          button.addEventListener("click", () => source.click());
          return { source, button };
        });
        modes.replaceChildren(...modeButtons.map(({ button }) => button));
      }
      modes.hidden = special.length === 0;
      for (const { source, button } of modeButtons) {
        button.textContent = source.getAttribute("aria-label");
        button.disabled = source.disabled;
        button.setAttribute("aria-pressed", String(source.getAttribute("aria-checked") === "true"));
      }
      input.max = String(Math.max(0, buttons.length - 1));
      input.disabled = buttons.length === 0 || buttons.some((button) => button.disabled);
      track.hidden = buttons.length === 0;
      control.toggleAttribute("data-disabled", options.every((button) => button.disabled));
      const selected = buttons.findIndex((button) => button.getAttribute("aria-checked") === "true");
      input.value = String(Math.max(0, selected));
      if (ticks.childElementCount !== buttons.length) {
        ticks.replaceChildren(...buttons.map(() => document.createElement("span")));
      }
      preview();
      if (selected < 0) {
        const label = special.find((button) => button.getAttribute("aria-checked") === "true")?.getAttribute("aria-label") ?? "Default";
        value.textContent = label;
        input.setAttribute("aria-valuetext", label);
        control.setAttribute("data-inactive", "");
      }
    };
    input.addEventListener("input", preview);
    const select = () => {
      const button = buttons[Number(input.value)];
      if (button && !button.disabled && button.getAttribute("aria-checked") !== "true") button.click();
      sync();
    };
    input.addEventListener("change", select);
    // A tap on the first stop must also work when the range already holds zero.
    input.addEventListener("click", select);
    input.addEventListener("keydown", (event) => {
      if (!control.hasAttribute("data-inactive")) return;
      if (!["ArrowRight", "ArrowUp", "ArrowLeft", "ArrowDown", "Home", "End"].includes(event.key)) return;
      event.preventDefault();
      input.value = String(event.key === "End" ? buttons.length - 1 : 0);
      select();
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
