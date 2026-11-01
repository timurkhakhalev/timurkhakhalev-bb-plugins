import { afterEach, describe, expect, test } from "bun:test";
import { JSDOM } from "jsdom";
import { batchSchema, editorDraftSchema, type Batch } from "./contracts.js";
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
  const click = (selector: string) => {
    const target = window.document.querySelector(selector);
    if (!target) throw new Error(`missing ${selector}`);
    target.dispatchEvent(new window.MouseEvent("pointerdown", { bubbles: true, cancelable: true }));
  };
  const lastEditor = () => {
    const message = [...messages].reverse().find((candidate) => candidate.type === "editor");
    if (!message || message.type !== "editor") throw new Error("editor did not open");
    return editorDraftSchema.parse(message.editor);
  };
  return { window, messages, evaluate, click, lastEditor };
}

function activate(page: ReturnType<typeof openPage>, restore: Batch | null = null, allowSyntheticInput = true) {
  return page.evaluate(activateExpression({ restore, theme: null, allowSyntheticInput }));
}

function annotate(page: ReturnType<typeof openPage>, selector: string, comment: string) {
  page.click(selector);
  const editor = page.lastEditor();
  return page.evaluate(pageCalls.commit(editor.id, comment, null)) as { annotationId: string } | null;
}

afterEach(() => {
  for (const page of pages.splice(0)) page.window.close();
});

describe("isolated-world page script", () => {
  test("selection opens the renderer editor and commit produces a valid batch", () => {
    const page = openPage();
    expect(activate(page)).toMatchObject({ active: true, count: 0, restored: false, startUrl: URL });
    page.click("button");
    const editor = page.lastEditor();
    expect(editor).toMatchObject({ tag: "button", target: "Continue", annotationId: null, comment: "" });
    expect(page.evaluate(pageCalls.commit(editor.id, "  Make it green  ", null))).toMatchObject({
      annotationId: expect.any(String),
    });
    expect(page.messages.at(-1)).toEqual({ type: "changed", revision: 1 });
    const batch = batchSchema.parse(page.evaluate(pageCalls.snapshot()));
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

  test("a stale editor id or empty comment does not commit", () => {
    const page = openPage();
    activate(page);
    page.click("button");
    const editor = page.lastEditor();
    expect(page.evaluate(pageCalls.commit("editor_other", "x", null))).toBeNull();
    expect(page.evaluate(pageCalls.commit(editor.id, "   ", null))).toBeNull();
    expect(batchSchema.parse(page.evaluate(pageCalls.snapshot())).annotations).toHaveLength(0);
  });

  test("synthetic page events cannot select elements", () => {
    const page = openPage();
    activate(page, null, false);
    page.click("button");
    expect(page.messages.filter((message) => message.type === "editor")).toHaveLength(0);
  });

  test("clicking the page while editing closes the editor and tells the renderer", () => {
    const page = openPage();
    activate(page);
    page.click("button");
    const editor = page.lastEditor();
    page.click("#note");
    expect(page.messages.at(-1)).toEqual({ type: "editor-closed", editorId: editor.id });
    expect(page.evaluate(pageCalls.commit(editor.id, "late", null))).toBeNull();
  });

  test("editing bumps the version so a new screenshot is requested", () => {
    const page = openPage();
    activate(page);
    const saved = annotate(page, "button", "First");
    if (!saved) throw new Error("not saved");
    expect(page.evaluate(pageCalls.open(saved.annotationId))).toBe(true);
    const editor = page.lastEditor();
    expect(editor).toMatchObject({ annotationId: saved.annotationId, comment: "First" });
    page.evaluate(pageCalls.commit(editor.id, "Second", null));
    const batch = batchSchema.parse(page.evaluate(pageCalls.snapshot()));
    expect(batch.annotations).toMatchObject([{ id: saved.annotationId, version: 2, comment: "Second" }]);
  });

  test("removing an annotation renumbers the rest and bumps their versions", () => {
    const page = openPage();
    activate(page);
    const first = annotate(page, "button", "First");
    annotate(page, "#note", "Second");
    if (!first) throw new Error("not saved");
    expect(page.evaluate(pageCalls.remove(first.annotationId))).toBe(true);
    const batch = batchSchema.parse(page.evaluate(pageCalls.snapshot()));
    expect(batch.annotations).toMatchObject([{ comment: "Second", version: 2 }]);
  });

  test("design preview applies on the page and cancel restores it", () => {
    const page = openPage();
    activate(page);
    page.click("#note");
    const editor = page.lastEditor();
    const design = {
      ...editor.designChange,
      text: { previousValue: "Some sample text", value: "Changed text" },
    };
    expect(page.evaluate(pageCalls.preview(editor.id, 1, design))).toBe(true);
    expect(page.window.document.querySelector("#note")?.textContent).toBe("Changed text");
    expect(page.evaluate(pageCalls.preview(editor.id, 1, design))).toBe(false);
    expect(page.evaluate(pageCalls.cancelEditor(editor.id))).toBe(true);
    expect(page.window.document.querySelector("#note")?.textContent).toBe("Some sample text");
  });

  test("Escape turns the picker off, removes page nodes and reports cancel", () => {
    const page = openPage();
    activate(page);
    annotate(page, "button", "Keep me");
    page.window.document.dispatchEvent(new page.window.KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    expect(page.messages.at(-1)).toEqual({ type: "cancel" });
    expect(page.window.document.getElementById("__bbAnnRoot")).toBeNull();
    expect(page.evaluate(pageCalls.state())).toBeNull();
  });

  test("restores a stored batch only on the same URL without bumping versions", () => {
    const source = openPage();
    activate(source);
    annotate(source, "button", "Restored");
    const batch = batchSchema.parse(source.evaluate(pageCalls.snapshot()));

    const same = openPage();
    expect(activate(same, batch)).toMatchObject({ restored: true, count: 1 });
    expect(batchSchema.parse(same.evaluate(pageCalls.snapshot())).annotations).toMatchObject([
      { id: batch.annotations[0].id, version: 1, comment: "Restored" },
    ]);

    const other = openPage("https://example.test/other");
    expect(activate(other, batch)).toMatchObject({ restored: false, count: 0 });
  });

  test("React components set by the renderer are part of the snapshot", () => {
    const page = openPage();
    activate(page);
    const saved = annotate(page, "button", "React");
    if (!saved) throw new Error("not saved");
    expect(page.evaluate(pageCalls.tagForProbe(saved.annotationId, "probe1"))).toBe(true);
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
    page.evaluate(pageCalls.setComponents(saved.annotationId, probe.components));
    expect(batchSchema.parse(page.evaluate(pageCalls.snapshot())).annotations[0].components).toEqual(probe.components);
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
