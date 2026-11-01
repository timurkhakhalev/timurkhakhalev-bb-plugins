import { afterEach, describe, expect, test } from "bun:test";
import { JSDOM } from "jsdom";
import { batchSchema, type Batch } from "./contracts.js";
import { activateExpression, pageCalls, reactProbeExpression, type PageMessage } from "./page-script.js";

const URL = "https://example.test/page";
const HTML = `<!doctype html><html><head><title>Checkout</title></head><body>
  <main><button class="cta" type="submit">Continue</button><p id="note">Some sample text</p></main>
</body></html>`;

const pages: JSDOM[] = [];

/** JSDOM stand-in for one Browser tab's isolated world plus `bb.postMessage`. */
function openPage(url = URL) {
  const dom = new JSDOM(HTML, { url, runScripts: "outside-only" });
  pages.push(dom);
  const window = dom.window;
  Object.defineProperty(window, "innerWidth", { value: 1000, configurable: true });
  Object.defineProperty(window, "innerHeight", { value: 700, configurable: true });
  Object.defineProperty(window, "CSS", {
    value: {
      supports: () => true,
      escape: (value: string) => value.replace(/[^a-zA-Z0-9_-]/g, "_"),
    },
    configurable: true,
  });
  window.matchMedia = (() => ({ matches: false })) as unknown as typeof window.matchMedia;
  window.HTMLElement.prototype.scrollIntoView = () => undefined;
  window.requestAnimationFrame = (callback: FrameRequestCallback) => window.setTimeout(() => callback(Date.now()), 0);
  window.cancelAnimationFrame = (handle: number) => window.clearTimeout(handle);
  const messages: PageMessage[] = [];
  Object.defineProperty(window, "bb", {
    value: { postMessage: (message: PageMessage) => messages.push(JSON.parse(JSON.stringify(message))) },
    configurable: true,
  });
  const evaluate = (expression: string) => JSON.parse(JSON.stringify(window.eval(expression) ?? null));
  const pointer = (selector: string) => {
    const target = window.document.querySelector(selector);
    if (!target) throw new Error(`missing ${selector}`);
    target.dispatchEvent(new window.MouseEvent("pointerdown", { bubbles: true, cancelable: true }));
  };
  const ui = () => (window as unknown as { __bbAnnotateTestRoot?: ShadowRoot }).__bbAnnotateTestRoot ?? null;
  const popover = () => {
    const root = ui();
    const pop = root?.getElementById("__bbAnnPop") as HTMLElement | null | undefined;
    return pop && pop.style.display === "block" && pop.childElementCount > 0 ? pop : null;
  };
  const press = (button: Element | null | undefined) => {
    if (!button) throw new Error("missing button");
    button.dispatchEvent(new window.MouseEvent("click", { bubbles: true, cancelable: true, composed: true }));
  };
  const button = (label: string) =>
    [...(popover()?.querySelectorAll("button") ?? [])].find((candidate) => candidate.textContent === label) ?? null;
  const type = (value: string) => {
    const comment = popover()?.querySelector("textarea.comment") as HTMLTextAreaElement | null;
    if (!comment) throw new Error("popover is not open");
    comment.value = value;
    comment.dispatchEvent(new window.Event("input", { bubbles: true }));
  };
  const snapshot = () => batchSchema.parse(evaluate(pageCalls.snapshot()));
  return { window, messages, evaluate, pointer, ui, popover, press, button, type, snapshot };
}

type Page = ReturnType<typeof openPage>;

function activate(page: Page, restore: Batch | null = null, allowSyntheticInput = true) {
  return page.evaluate(activateExpression({ restore, theme: null, allowSyntheticInput }));
}

function annotate(page: Page, selector: string, comment: string) {
  page.pointer(selector);
  page.type(comment);
  page.press(page.button("Save"));
  const committed = [...page.messages].reverse().find((message) => message.type === "committed");
  if (!committed || committed.type !== "committed") throw new Error("not committed");
  return committed.annotationId;
}

afterEach(() => {
  for (const page of pages.splice(0)) page.window.close();
});

describe("isolated-world page script", () => {
  test("selection opens the in-page popover and Save produces a valid batch", () => {
    const page = openPage();
    expect(activate(page)).toMatchObject({ active: true, count: 0, restored: false, startUrl: URL });
    page.pointer("button");
    const pop = page.popover();
    expect(pop?.textContent).toContain("<button>");
    expect(pop?.textContent).toContain("Continue");
    expect(page.button("Save")?.hasAttribute("disabled")).toBe(true);
    page.type("  Make it green  ");
    expect(page.button("Save")?.hasAttribute("disabled")).toBe(false);
    page.press(page.button("Save"));
    expect(page.messages.slice(-2)).toEqual([
      { type: "changed", revision: 1 },
      { type: "committed", annotationId: expect.any(String) },
    ]);
    expect(page.popover()?.classList.contains("on") ?? false).toBe(false);
    const batch = page.snapshot();
    expect(batch).toMatchObject({ url: URL, title: "Checkout" });
    expect(batch.annotations).toHaveLength(1);
    expect(batch.annotations[0]).toMatchObject({
      version: 1,
      comment: "Make it green",
      tag: "button",
      classes: "cta",
      selector: "html > body > main > button",
      metadata: { class: "cta", type: "submit" },
    });
    expect(page.evaluate(pageCalls.state())).toMatchObject({ active: true, count: 1 });
  });

  test("Enter saves and Shift+Enter does not", () => {
    const page = openPage();
    activate(page);
    page.pointer("button");
    page.type("Via keyboard");
    const comment = page.popover()?.querySelector("textarea.comment");
    comment?.dispatchEvent(new page.window.KeyboardEvent("keydown", { key: "Enter", shiftKey: true, bubbles: true }));
    expect(page.snapshot().annotations).toHaveLength(0);
    comment?.dispatchEvent(new page.window.KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
    expect(page.snapshot().annotations).toMatchObject([{ comment: "Via keyboard" }]);
  });

  test("synthetic page events cannot select or save", () => {
    const page = openPage();
    activate(page, null, false);
    page.pointer("button");
    expect(page.ui()).toBeNull();
    expect(page.snapshot().annotations).toHaveLength(0);
  });

  test("clicking the page while editing closes the popover without saving", () => {
    const page = openPage();
    activate(page);
    page.pointer("button");
    page.type("Discard me");
    page.pointer("#note");
    expect(page.snapshot().annotations).toHaveLength(0);
    page.pointer("#note");
    expect(page.popover()?.textContent).toContain("<p>");
  });

  test("editing from a pin bumps the version and shows Update and Delete", () => {
    const page = openPage();
    activate(page);
    const id = annotate(page, "button", "First");
    expect(page.evaluate(pageCalls.open(id))).toBe(true);
    expect(page.button("Delete")).not.toBeNull();
    expect((page.popover()?.querySelector("textarea.comment") as HTMLTextAreaElement).value).toBe("First");
    page.type("Second");
    page.press(page.button("Update"));
    expect(page.snapshot().annotations).toMatchObject([{ id, version: 2, comment: "Second" }]);
  });

  test("Delete in the popover removes the annotation and renumbers the rest", () => {
    const page = openPage();
    activate(page);
    const first = annotate(page, "button", "First");
    annotate(page, "#note", "Second");
    page.evaluate(pageCalls.open(first));
    page.press(page.button("Delete"));
    expect(page.snapshot().annotations).toMatchObject([{ comment: "Second", version: 2 }]);
  });

  test("design settings preview on the page, Save keeps only changes, Cancel restores", () => {
    const page = openPage();
    activate(page);
    page.pointer("#note");
    const pop = page.popover();
    const textField = pop?.querySelector(".settings textarea.in") as HTMLTextAreaElement;
    textField.value = "Changed text";
    textField.dispatchEvent(new page.window.Event("input", { bubbles: true }));
    return new Promise<void>((resolve) => page.window.setTimeout(resolve, 5)).then(() => {
      expect(page.window.document.querySelector("#note")?.textContent).toBe("Changed text");
      expect(page.button("Save")?.hasAttribute("disabled")).toBe(false);
      page.press(page.button("Cancel"));
      expect(page.window.document.querySelector("#note")?.textContent).toBe("Some sample text");

      page.pointer("#note");
      const again = page.popover()?.querySelector(".settings textarea.in") as HTMLTextAreaElement;
      again.value = "Saved text";
      again.dispatchEvent(new page.window.Event("input", { bubbles: true }));
      page.press(page.button("Save"));
      expect(page.snapshot().annotations[0]).toMatchObject({
        comment: "",
        designChange: { text: { previousValue: "Some sample text", value: "Saved text" }, declarations: [] },
      });
    });
  });

  test("Escape closes the popover first, then turns the picker off", () => {
    const page = openPage();
    activate(page);
    annotate(page, "button", "Keep me");
    page.pointer("#note");
    const escape = () =>
      page.window.document.dispatchEvent(new page.window.KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    escape();
    expect(page.evaluate(pageCalls.state())).toMatchObject({ active: true, count: 1 });
    escape();
    expect(page.messages.at(-1)).toEqual({ type: "cancel" });
    expect(page.window.document.getElementById("__bbAnnRoot")).toBeNull();
    expect(page.evaluate(pageCalls.state())).toBeNull();
  });

  test("restores a stored batch only on the same URL without bumping versions", () => {
    const source = openPage();
    activate(source);
    annotate(source, "button", "Restored");
    const batch = source.snapshot();

    const same = openPage();
    expect(activate(same, batch)).toMatchObject({ restored: true, count: 1 });
    expect(same.snapshot().annotations).toMatchObject([
      { id: batch.annotations[0].id, version: 1, comment: "Restored" },
    ]);

    const other = openPage("https://example.test/other");
    expect(activate(other, batch)).toMatchObject({ restored: false, count: 0 });
  });

  test("React components set by the renderer are part of the snapshot", () => {
    const page = openPage();
    activate(page);
    const id = annotate(page, "button", "React");
    expect(page.evaluate(pageCalls.tagForProbe(id, "probe1"))).toBe(true);
    const button = page.window.document.querySelector("button") as unknown as Record<string, unknown>;
    button["__reactFiber$test"] = {
      type: "button",
      return: {
        type: { name: "CheckoutButton" },
        _debugSource: { fileName: "src/checkout.tsx", lineNumber: 7 },
        return: { type: { displayName: "Checkout" }, return: null },
      },
    };
    const probe = page.evaluate(reactProbeExpression("probe1"));
    expect(probe).toEqual({
      components: [
        { name: "CheckoutButton", source: "src/checkout.tsx:7" },
        { name: "Checkout", source: null },
      ],
    });
    expect(page.window.document.querySelector("[data-bb-annotate-probe]")).toBeNull();
    page.evaluate(pageCalls.setComponents(id, probe.components));
    expect(page.snapshot().annotations[0].components).toEqual(probe.components);
  });

  test("capturing hides hover chrome but keeps markers", () => {
    const page = openPage();
    activate(page);
    annotate(page, "button", "Shot");
    expect(page.evaluate(pageCalls.setCapturing(true))).toBe(true);
    expect(page.window.document.getElementById("__bbAnnRoot")?.hasAttribute("data-capturing")).toBe(true);
    page.evaluate(pageCalls.setCapturing(false));
    expect(page.window.document.getElementById("__bbAnnRoot")?.hasAttribute("data-capturing")).toBe(false);
  });
});
