import type { Batch, ReactComponent } from "./contracts.js";

/**
 * Page-side annotator. Runs in BB's isolated world through
 * `experimental_page.evaluate`, so page scripts share the DOM but never see
 * this controller or `bb.postMessage`. It owns only untrusted selection
 * evidence, markers, design previews, and the editor popover, all inside a
 * closed shadow root. Only trusted (real user) input selects, saves, or
 * deletes. Everything here is lost when the document navigates.
 */

export const CONTROLLER = "__bbAnnotate";

export type PageTheme = {
  surface: string;
  text: string;
  muted: string;
  accent: string;
  border: string;
  field: string;
};

export type PageMessage =
  | { type: "changed"; revision: number }
  | { type: "committed"; annotationId: string }
  | { type: "cancel" };

export type PageState = {
  active: boolean;
  count: number;
  revision: number;
  url: string;
  startUrl: string;
};

const PAGE_SCRIPT = `
((bb, options) => {
  if (globalThis.__bbAnnotate) globalThis.__bbAnnotate.cleanup();
  document.querySelectorAll("#__bbAnnRoot, #__bbAnnDesignStyle").forEach((node) => node.remove());

  const post = (message) => { try { if (bb) bb.postMessage(message); } catch {} };
  const theme = options.theme || {};
  // Page scripts can dispatch synthetic events; only real user input selects.
  const trusted = (event) => event.isTrusted || options.allowSyntheticInput === true;
  const accent = theme.accent || "#3b82f6";
  const state = {
    items: [],
    seq: 0,
    revision: 0,
    startUrl: location.href,
    editor: null,
    editorPreviewRevision: 0,
    lastX: -1,
    lastY: -1,
  };
  const restoreBatch = options.restore || null;
  const shouldRestore = Boolean(
    restoreBatch && restoreBatch.url === location.href && Array.isArray(restoreBatch.annotations),
  );
  const previousCursor = document.documentElement.style.cursor;
  const rootHost = document.createElement("div");
  rootHost.id = "__bbAnnRoot";
  rootHost.style.cssText = "position:fixed;inset:0;z-index:2147483647;pointer-events:none";
  document.documentElement.appendChild(rootHost);
  const uiRoot = rootHost.attachShadow({ mode: "closed" });

  const surface = theme.surface || "rgba(20,22,28,.96)";
  const text = theme.text || "#e8eaf0";
  const muted = theme.muted || "#9aa0ad";
  const border = theme.border || "rgba(255,255,255,.12)";
  const field = theme.field || "rgba(255,255,255,.06)";
  const tint = (percent) => "color-mix(in srgb," + accent + " " + percent + "%,transparent)";
  const ease = "cubic-bezier(.2,.8,.2,1)";
  const font = "-apple-system,BlinkMacSystemFont,Segoe UI,Roboto,sans-serif";
  const css =
    ":host{all:initial}" +
    "#__bbAnnTip{position:fixed;z-index:2147483645;pointer-events:none;opacity:0;transform:translateY(3px);" +
    "transition:opacity .14s " + ease + ",transform .14s " + ease + ";background:" + surface + ";color:" + text + ";" +
    "font:12px/1.6 " + font + ";padding:6px 10px;border-radius:8px;max-width:70vw;box-shadow:0 4px 16px rgba(0,0,0,.35)}" +
    "#__bbAnnTip.on{opacity:1;transform:none}" +
    "#__bbAnnTip b{color:" + text + "}" +
    "#__bbAnnTip .dim{color:" + muted + "}" +
    "#__bbAnnBox{position:fixed;z-index:2147483644;pointer-events:none;opacity:0;border:2px solid " + accent + ";background:" + tint(12) + ";border-radius:5px;" +
    "transition:left .12s " + ease + ",top .12s " + ease + ",width .12s " + ease + ",height .12s " + ease + ",opacity .14s " + ease + "}" +
    "#__bbAnnBox.on{opacity:1}" +
    "#__bbAnnEditing{position:fixed;z-index:2147483644;pointer-events:none;display:none;border:2px dashed " + accent + ";background:" + tint(14) + ";border-radius:5px;" +
    "animation:bbAnnFade .18s " + ease + "}" +
    ":host([data-capturing]) #__bbAnnTip,:host([data-capturing]) #__bbAnnBox,:host([data-capturing]) #__bbAnnEditing,:host([data-capturing]) #__bbAnnPop{visibility:hidden}" +
    ".__bbAnnOutline{position:fixed;z-index:2147483643;pointer-events:none;border:2px solid " + accent + ";background:" + tint(8) + ";border-radius:5px;" +
    "animation:bbAnnFade .24s " + ease + "}" +
    ".__bbAnnPin{position:fixed;z-index:2147483645;pointer-events:auto;width:22px;height:22px;margin:-11px 0 0 -11px;border-radius:50%;" +
    "background:" + accent + ";color:#fff;font:700 12px/22px " + font + ";text-align:center;cursor:pointer;box-shadow:0 2px 8px rgba(0,0,0,.35);" +
    "transition:transform .16s " + ease + ";animation:bbAnnPop .32s " + ease + "}" +
    ".__bbAnnPin:hover{transform:scale(1.12)}" +
    "@keyframes bbAnnFade{from{opacity:0}to{opacity:1}}" +
    "@keyframes bbAnnPop{0%{opacity:0;transform:scale(.4)}60%{opacity:1;transform:scale(1.12)}100%{transform:scale(1)}}" +
    "#__bbAnnPop{position:fixed;z-index:2147483646;pointer-events:auto;display:none;box-sizing:border-box;width:340px;max-width:calc(100vw - 16px);" +
    "background:" + surface + ";color:" + text + ";border:1px solid " + border + ";border-radius:14px;box-shadow:0 12px 40px rgba(0,0,0,.35),0 2px 8px rgba(0,0,0,.2);" +
    "font:13px/1.45 " + font + ";opacity:0;transform:translateY(6px) scale(.97);transform-origin:top left;" +
    "transition:opacity .18s " + ease + ",transform .22s " + ease + ",top .2s " + ease + ",left .2s " + ease + "}" +
    "#__bbAnnPop.above{transform-origin:bottom left}" +
    "#__bbAnnPop.on{opacity:1;transform:none}" +
    "#__bbAnnPop *{box-sizing:border-box;font:inherit;color:inherit}" +
    "#__bbAnnPop .head{display:flex;align-items:center;gap:6px;padding:8px 8px 0}" +
    "#__bbAnnPop .chip{min-width:0;flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:11px;color:" + muted + "}" +
    "#__bbAnnPop .chip b{color:" + text + ";font-weight:600;margin-right:4px}" +
    "#__bbAnnPop button{cursor:pointer;border:0;background:transparent;border-radius:8px;transition:background .14s " + ease + ",color .14s " + ease + ",opacity .14s " + ease + ",transform .14s " + ease + "}" +
    "#__bbAnnPop button:active{transform:scale(.96)}" +
    "#__bbAnnPop button:disabled{opacity:.4;cursor:default;transform:none}" +
    "#__bbAnnPop button:focus-visible,#__bbAnnPop textarea:focus-visible,#__bbAnnPop input:focus-visible,#__bbAnnPop select:focus-visible{outline:2px solid " + tint(60) + ";outline-offset:1px}" +
    "#__bbAnnPop .icon{display:grid;place-items:center;width:28px;height:28px;color:" + muted + "}" +
    "#__bbAnnPop .icon:hover{background:" + field + ";color:" + text + "}" +
    "#__bbAnnPop .icon.on{color:" + accent + "}" +
    "#__bbAnnPop textarea.comment{display:block;width:100%;resize:none;border:0;outline:0;background:transparent;padding:6px 12px 4px;min-height:44px;max-height:160px;field-sizing:content}" +
    "#__bbAnnPop textarea.comment::placeholder{color:" + muted + "}" +
    "#__bbAnnPop .drawer{display:grid;grid-template-rows:0fr;transition:grid-template-rows .26s " + ease + "}" +
    "#__bbAnnPop .drawer.open{grid-template-rows:1fr}" +
    "#__bbAnnPop .drawer>div{min-height:0;overflow:hidden}" +
    "#__bbAnnPop .settings{max-height:min(280px,45vh);overflow-y:auto;padding:0 12px;border-top:1px solid " + border + ";opacity:0;transition:opacity .2s " + ease + "}" +
    "#__bbAnnPop .drawer.open .settings{opacity:1}" +
    "#__bbAnnPop h4{margin:10px 0 4px;font-size:11px;font-weight:600;color:" + muted + "}" +
    "#__bbAnnPop label.f{display:grid;grid-template-columns:minmax(0,1fr) minmax(0,1.3fr);align-items:center;gap:8px;min-height:30px;font-size:12px}" +
    "#__bbAnnPop label.f>span{color:" + muted + ";overflow:hidden;text-overflow:ellipsis;white-space:nowrap}" +
    "#__bbAnnPop .in{width:100%;height:26px;min-width:0;border:1px solid " + border + ";border-radius:7px;background:" + field + ";padding:0 7px;outline:0;font-size:12px;transition:border-color .14s " + ease + "}" +
    "#__bbAnnPop .in:focus{border-color:" + accent + "}" +
    "#__bbAnnPop textarea.in{height:auto;min-height:26px;padding:4px 7px;resize:none;field-sizing:content;max-height:80px}" +
    "#__bbAnnPop .color{display:grid;grid-template-columns:26px minmax(0,1fr);gap:6px}" +
    "#__bbAnnPop input[type=color]{width:26px;height:26px;padding:2px;border:1px solid " + border + ";border-radius:7px;background:" + field + ";cursor:pointer}" +
    "#__bbAnnPop .reset{font-size:11px;color:" + muted + ";padding:2px 6px;float:right;margin-top:8px}" +
    "#__bbAnnPop .reset:hover{color:" + text + ";background:" + field + "}" +
    "#__bbAnnPop .actions{display:flex;align-items:center;gap:6px;padding:6px 8px 8px}" +
    "#__bbAnnPop .actions .grow{flex:1}" +
    "#__bbAnnPop .ghost{height:28px;padding:0 10px;font-size:12px;color:" + muted + "}" +
    "#__bbAnnPop .ghost:hover{background:" + field + ";color:" + text + "}" +
    "#__bbAnnPop .danger:hover{color:#ef4444}" +
    "#__bbAnnPop .primary{height:28px;padding:0 12px;font-size:12px;font-weight:600;background:" + accent + ";color:#fff}" +
    "#__bbAnnPop .primary:hover:not(:disabled){filter:brightness(1.08)}" +
    "#__bbAnnPop .hint{font-size:11px;color:" + muted + "}" +
    "@media (prefers-reduced-motion:reduce){#__bbAnnBox,#__bbAnnTip,#__bbAnnPop,#__bbAnnPop *,.__bbAnnPin,.__bbAnnOutline,#__bbAnnEditing{transition:none!important;animation:none!important}}";

  const style = document.createElement("style");
  style.id = "__bbAnnStyle";
  style.textContent = css;
  uiRoot.appendChild(style);
  const designStyle = document.createElement("style");
  designStyle.id = "__bbAnnDesignStyle";
  document.documentElement.appendChild(designStyle);

  const el = (id, tag, parent) => {
    const node = document.createElement(tag || "div");
    node.id = id;
    (parent || uiRoot).appendChild(node);
    return node;
  };

  const tip = el("__bbAnnTip");
  const box = el("__bbAnnBox");
  const editing = el("__bbAnnEditing");

  let formTarget = null; // element being annotated, or the annotation being edited
  let formAnnotation = null;
  let formDraft = null;
  let formPendingItem = null;

  const selectorFor = (element) => {
    const path = [];
    let node = element;
    while (node && node.nodeType === 1 && path.length < 6) {
      const tag = node.tagName.toLowerCase();
      if (node.id) { path.unshift(tag + "#" + CSS.escape(node.id)); break; }
      const siblings = Array.from(node.parentNode ? node.parentNode.children : []).filter((s) => s.tagName === node.tagName);
      const index = siblings.indexOf(node);
      path.unshift(siblings.length > 1 ? tag + ":nth-of-type(" + (index + 1) + ")" : tag);
      node = node.parentNode;
    }
    return path.join(" > ");
  };
  const safeSelectorFor = (element) => {
    const selector = selectorFor(element);
    return selector.length <= 2000 ? selector : "";
  };
  const descriptiveTagFor = (element) => element.tagName.toLowerCase().slice(0, 64);

  const roleFor = (element) => {
    const explicit = element.getAttribute("role");
    if (explicit) return explicit.slice(0, 128);
    const tag = element.tagName.toLowerCase();
    if (tag === "a" && element.hasAttribute("href")) return "link";
    if (tag === "button") return "button";
    if (tag === "textarea") return "textbox";
    if (tag === "select") return "combobox";
    if (tag === "img") return "img";
    if (/^h[1-6]$/.test(tag)) return "heading";
    if (tag === "li") return "listitem";
    if (tag === "ul" || tag === "ol") return "list";
    if (tag === "nav") return "navigation";
    if (tag === "main") return "main";
    if (tag === "input") {
      const type = (element.getAttribute("type") || "text").toLowerCase();
      if (type === "checkbox") return "checkbox";
      if (type === "radio") return "radio";
      if (type === "button" || type === "submit" || type === "reset") return "button";
      return "textbox";
    }
    return null;
  };

  const ownNode = (node) => node === rootHost || (node instanceof Element && node.closest("#__bbAnnRoot") !== null);
  const isRoot = (node) => node === document.documentElement || node === document.body;

  const BASE_STYLE_PROPERTIES = [
    "color", "background-color", "opacity", "font-family", "font-size", "font-weight",
    "border-radius", "border-color", "border-width", "width", "height",
    "padding-top", "padding-right", "padding-bottom", "padding-left",
    "margin-top", "margin-right", "margin-bottom", "margin-left",
  ];
  const FLEX_STYLE_PROPERTIES = [
    "flex-direction", "justify-content", "align-items", "gap", "row-gap", "column-gap",
  ];
  const taggedElements = new Set();
  let previewFrame = 0;
  let disposed = false;

  const soleTextNode = (element) => {
    const nodes = Array.from(element.childNodes).filter(
      (node) => node.nodeType === Node.TEXT_NODE,
    );
    const childHasText = Array.from(element.children).some(
      (child) => ((child.innerText || child.textContent || "").trim().length > 0),
    );
    return nodes.length === 1 && !childHasText ? nodes[0] : null;
  };
  const directTextNode = (element) => {
    const node = soleTextNode(element);
    return node && (node.nodeValue || "").trim().length > 0 ? node : null;
  };
  const fullTextValueFor = (element) => {
    const node = directTextNode(element);
    return node ? node.nodeValue || "" : null;
  };
  const textValueFor = (element) => {
    const value = fullTextValueFor(element);
    return value === null ? null : value.trim().slice(0, 4000);
  };
  const resolveElement = (item) => {
    if (item.element && item.element.isConnected) return item.element;
    try {
      const element = item.selector ? document.querySelector(item.selector) : null;
      if (element) item.element = element;
      return element;
    } catch {
      return null;
    }
  };
  const trackedTextNode = (item, adoptReplacement) => {
    let node = item.textNode;
    if (!node || !node.isConnected) {
      const element = resolveElement(item);
      node = element ? soleTextNode(element) : null;
      item.textNode = node;
      if (node && adoptReplacement) item.rollbackText = node.nodeValue || "";
    }
    return node;
  };
  const setTrackedText = (item, value) => {
    const node = trackedTextNode(item, false);
    if (node && node.nodeValue !== value) node.nodeValue = value;
  };
  const activeSources = () => {
    const saved = state.items.filter((item) => !formAnnotation || item.id !== formAnnotation.id);
    return formDraft ? [...saved, formDraft] : saved;
  };
  const restoreDesignText = (item) => {
    if (!item || !item.designChange || !item.designChange.text) return;
    const node = trackedTextNode(item, true);
    if (node) {
      node.nodeValue = typeof item.rollbackText === "string"
        ? item.rollbackText
        : item.designChange.text.previousValue;
    }
  };
  const renderDesignPreview = () => {
    if (disposed || !designStyle.isConnected) return;
    mutationObserver.disconnect();
    const known = [...state.items, ...(formDraft ? [formDraft] : [])];
    for (const item of known) {
      if (!item.designChange || !item.designChange.text) continue;
      restoreDesignText(item);
    }
    for (const element of taggedElements) element.removeAttribute("data-bb-annotation-design");
    taggedElements.clear();
    designStyle.textContent = "";
    const sheet = designStyle.sheet;
    for (const item of activeSources()) {
      const design = item.designChange;
      if (!design) continue;
      const element = resolveElement(item);
      if (!element) continue;
      const changes = design.declarations.filter(
        (change) => change.value !== change.previousValue && CSS.supports(change.property, change.value),
      );
      if (changes.length > 0 && sheet) {
        const tokens = new Set((element.getAttribute("data-bb-annotation-design") || "").split(/\\s+/).filter(Boolean));
        tokens.add(item.id);
        element.setAttribute("data-bb-annotation-design", [...tokens].join(" "));
        taggedElements.add(element);
        try {
          const ruleIndex = sheet.cssRules.length;
          sheet.insertRule('[data-bb-annotation-design~="' + CSS.escape(item.id) + '"]{}', ruleIndex);
          const rule = sheet.cssRules[ruleIndex];
          for (const change of changes) rule.style.setProperty(change.property, change.value, "important");
        } catch {
          // Ignore a value the browser refuses to represent as a CSS declaration.
        }
      }
      if (design.text && design.text.value !== design.text.previousValue) {
        setTrackedText(item, design.text.value);
      }
    }
    observePage();
  };

  const createDesignDraft = (element, annotation, id) => {
    const computed = getComputedStyle(element);
    const saved = annotation && annotation.designChange;
    const savedDeclarations = new Map(
      (saved ? saved.declarations : []).map((change) => [change.property, change]),
    );
    const properties = [...BASE_STYLE_PROPERTIES];
    if (computed.display === "flex" || computed.display === "inline-flex") properties.push(...FLEX_STYLE_PROPERTIES);
    const currentText = textValueFor(element);
    const text = saved && saved.text
      ? { ...saved.text }
      : currentText === null ? null : { previousValue: currentText, value: currentText };
    return {
      id,
      element,
      textNode: directTextNode(element),
      selector: annotation ? annotation.selector : selectorFor(element),
      rollbackText: annotation && typeof annotation.rollbackText === "string"
        ? annotation.rollbackText
        : fullTextValueFor(element),
      designChange: {
        text,
        declarations: properties.map((property) => {
          const change = savedDeclarations.get(property);
          const current = computed.getPropertyValue(property).trim().slice(0, 1000);
          return change ? { ...change } : { property, previousValue: current, value: current };
        }),
      },
    };
  };

  const paintHover = (element) => {
    const rect = element.getBoundingClientRect();
    if (rect.width < 1 && rect.height < 1) { hideHover(); return; }
    box.classList.add("on");
    box.style.left = rect.left - 2 + "px";
    box.style.top = rect.top - 2 + "px";
    box.style.width = rect.width + 4 + "px";
    box.style.height = rect.height + 4 + "px";
    const cs = getComputedStyle(element);
    const color = cs.color;
    const font = cs.fontSize + ' "' + (cs.fontFamily.split(",")[0] || "") + '"';
    tip.innerHTML =
      "<b>" + element.tagName.toLowerCase() + "</b> <span class='dim'>" +
      Math.round(rect.width) + "x" + Math.round(rect.height) + "</span><br>" +
      "<span class='dim'>color</span> " + color + "<br>" +
      "<span class='dim'>font</span> " + font;
    tip.classList.add("on");
    const vw = document.documentElement.clientWidth || innerWidth;
    tip.style.left = Math.max(8, Math.min(rect.left, vw - 240)) + "px";
    tip.style.top = Math.max(8, rect.top > 90 ? rect.top - 82 : rect.bottom + 8) + "px";
  };
  const hideHover = () => { box.classList.remove("on"); tip.classList.remove("on"); };

  const pins = new Map();
  const paintPin = (item) => {
    let pin = pins.get(item.id);
    if (!pin) {
      pin = document.createElement("div");
      pin.className = "__bbAnnPin";
      pin.dataset.annotationId = item.id;
      pin.addEventListener("click", (event) => {
        event.preventDefault();
        event.stopPropagation();
        if (!trusted(event)) return;
        const annotation = state.items.find((candidate) => candidate.id === pin.dataset.annotationId);
        if (annotation) openTrustedEditor(annotation.element, annotation);
      });
      uiRoot.appendChild(pin);
      pins.set(item.id, pin);
    }
    pin.textContent = String(item.seq);
    const rect = item.element && item.element.isConnected
      ? item.element.getBoundingClientRect()
      : {
          x: item.rect.x,
          y: item.rect.y,
          left: item.rect.x,
          top: item.rect.y,
          right: item.rect.x + item.rect.width,
          bottom: item.rect.y + item.rect.height,
          width: item.rect.width,
          height: item.rect.height,
        };
    item.rect = { x: rect.x, y: rect.y, width: rect.width, height: rect.height };
    item.clientX = rect.left + Math.min(18, Math.max(8, rect.width / 2));
    item.clientY = rect.top;
    const visible = rect.bottom >= 0 && rect.right >= 0 && rect.top <= innerHeight && rect.left <= innerWidth;
    pin.style.display = visible ? "block" : "none";
    pin.style.left = item.clientX + "px";
    pin.style.top = item.clientY + "px";
  };
  const dropPin = (id) => {
    const pin = pins.get(id);
    if (pin) pin.remove();
    pins.delete(id);
  };

  const outlines = new Map();
  const paintOutline = (item) => {
    let outline = outlines.get(item.id);
    if (!outline) {
      outline = document.createElement("div");
      outline.className = "__bbAnnOutline";
      uiRoot.appendChild(outline);
      outlines.set(item.id, outline);
    }
    const rect = item.element && item.element.isConnected
      ? item.element.getBoundingClientRect()
      : item.rect;
    outline.style.left = rect.x - 2 + "px";
    outline.style.top = rect.y - 2 + "px";
    outline.style.width = rect.width + 4 + "px";
    outline.style.height = rect.height + 4 + "px";
  };
  const dropOutline = (id) => {
    const outline = outlines.get(id);
    if (outline) outline.remove();
    outlines.delete(id);
  };

  const bumpRevision = () => {
    state.revision += 1;
    post({ type: "changed", revision: state.revision });
  };

  // A new version means the saved screenshot no longer matches; the renderer
  // asks BB to capture the tab again after the overlay repaints.
  const queueCapture = (item) => {
    item.version = (item.version || 0) + 1;
  };

  const removeItem = (item) => {
    restoreDesignText(item);
    state.items = state.items.filter((candidate) => candidate.id !== item.id);
    dropPin(item.id);
    dropOutline(item.id);
    state.items.forEach((candidate, index) => {
      candidate.seq = index + 1;
      if (candidate.element && candidate.element.isConnected) {
        const rect = candidate.element.getBoundingClientRect();
        candidate.snapshotRect = { x: rect.x, y: rect.y, width: rect.width, height: rect.height };
        candidate.nodePosition = { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
      }
      queueCapture(candidate);
      paintPin(candidate);
      paintOutline(candidate);
    });
    renderDesignPreview();
    bumpRevision();
  };

  const hideForm = () => {
    restoreDesignText(formDraft);
    formTarget = null;
    formAnnotation = null;
    formDraft = null;
    formPendingItem = null;
    state.editor = null;
    editing.style.display = "none";
    state.editorPreviewRevision = 0;
    hidePopover();
    renderDesignPreview();
  };
  const paintEditing = () => {
    if (!formTarget || !formTarget.isConnected) { editing.style.display = "none"; return; }
    const rect = formTarget.getBoundingClientRect();
    editing.style.display = "block";
    editing.style.left = rect.left - 3 + "px";
    editing.style.top = rect.top - 3 + "px";
    editing.style.width = rect.width + 6 + "px";
    editing.style.height = rect.height + 6 + "px";
    placePopover();
  };

  // ---- In-page editor popover (closed shadow root, isolated world) ----
  const DESIGN_GROUPS = [
    ["Content", ["text", "color", "background-color", "opacity"]],
    ["Typography", ["font-family", "font-size", "font-weight"]],
    ["Border", ["border-radius", "border-color", "border-width"]],
    ["Dimensions", ["width", "height"]],
    ["Padding", ["padding-top", "padding-right", "padding-bottom", "padding-left"]],
    ["Margin", ["margin-top", "margin-right", "margin-bottom", "margin-left"]],
    ["Flex layout", ["flex-direction", "justify-content", "align-items", "gap", "row-gap", "column-gap"]],
  ];
  const DESIGN_LABELS = {
    text: "Text", color: "Text color", "background-color": "Background", opacity: "Opacity",
    "font-family": "Font", "font-size": "Font size", "font-weight": "Font weight",
    "border-radius": "Radius", "border-color": "Border color", "border-width": "Border width",
    width: "Width", height: "Height",
    "padding-top": "Top", "padding-right": "Right", "padding-bottom": "Bottom", "padding-left": "Left",
    "margin-top": "Top", "margin-right": "Right", "margin-bottom": "Bottom", "margin-left": "Left",
    "flex-direction": "Direction", "justify-content": "Distribution", "align-items": "Alignment",
    gap: "Gap", "row-gap": "Row gap", "column-gap": "Column gap",
  };
  const SELECT_VALUES = {
    "font-weight": ["100", "200", "300", "400", "500", "600", "700", "800", "900"],
    "flex-direction": ["row", "row-reverse", "column", "column-reverse"],
    "justify-content": ["flex-start", "center", "flex-end", "space-between", "space-around", "space-evenly"],
    "align-items": ["flex-start", "center", "flex-end", "stretch", "baseline"],
  };
  const PIXEL_PROPERTIES = new Set([
    "font-size", "border-radius", "border-width", "width", "height",
    "padding-top", "padding-right", "padding-bottom", "padding-left",
    "margin-top", "margin-right", "margin-bottom", "margin-left", "gap", "row-gap", "column-gap",
  ]);
  const COLOR_PROPERTIES = new Set(["color", "background-color", "border-color"]);
  const SVG_NS = "http://www.w3.org/2000/svg";
  const numericValue = (value) => {
    const number = Number.parseFloat(value);
    return Number.isFinite(number) ? String(Math.round(number * 100) / 100) : "0";
  };
  const toHex = (value) => {
    const match = String(value).match(/^rgba?\\(\\s*(\\d+)\\D+(\\d+)\\D+(\\d+)/i);
    if (!match) return /^#[0-9a-f]{6}$/i.test(value) ? value : "#000000";
    return "#" + [match[1], match[2], match[3]]
      .map((part) => Math.max(0, Math.min(255, Number(part))).toString(16).padStart(2, "0"))
      .join("");
  };
  const node = (tag, attrs, children) => {
    const element = document.createElement(tag);
    for (const [key, value] of Object.entries(attrs || {})) {
      if (key === "text") element.textContent = value;
      else if (key === "class") element.className = value;
      else element.setAttribute(key, value);
    }
    for (const child of children || []) if (child) element.appendChild(child);
    return element;
  };
  const slidersIcon = () => {
    const svg = document.createElementNS(SVG_NS, "svg");
    svg.setAttribute("viewBox", "0 0 24 24");
    svg.setAttribute("width", "16");
    svg.setAttribute("height", "16");
    svg.setAttribute("fill", "none");
    svg.setAttribute("stroke", "currentColor");
    svg.setAttribute("stroke-width", "1.8");
    svg.setAttribute("stroke-linecap", "round");
    for (const d of ["M4 7h9M17 7h3M4 17h3M11 17h9"]) {
      const path = document.createElementNS(SVG_NS, "path");
      path.setAttribute("d", d);
      svg.appendChild(path);
    }
    for (const [cx, cy] of [[15, 7], [9, 17]]) {
      const circle = document.createElementNS(SVG_NS, "circle");
      circle.setAttribute("cx", String(cx));
      circle.setAttribute("cy", String(cy));
      circle.setAttribute("r", "2");
      svg.appendChild(circle);
    }
    return svg;
  };

  const pop = el("__bbAnnPop");
  pop.setAttribute("role", "dialog");
  let popHideTimer = 0;
  let previewQueued = 0;
  let popExpanded = false;
  let popRefs = null;

  const changedDesign = (design) => {
    if (!design) return null;
    const declarations = design.declarations
      .filter((change) => change.value !== change.previousValue)
      .map((change) => ({ ...change }));
    const textChange = design.text && design.text.value !== design.text.previousValue ? { ...design.text } : null;
    return declarations.length > 0 || textChange ? { text: textChange, declarations } : null;
  };

  const queuePreview = () => {
    if (previewQueued) return;
    previewQueued = requestAnimationFrame(() => {
      previewQueued = 0;
      if (!formDraft) return;
      renderDesignPreview();
      refreshOverlay();
    });
  };

  const syncPopControls = () => {
    if (!popRefs || !formDraft) return;
    const designChanged = Boolean(changedDesign(formDraft.designChange));
    popRefs.save.disabled = !(popRefs.comment.value.trim().length > 0 || designChanged);
    popRefs.toggle.classList.toggle("on", popExpanded || designChanged);
    popRefs.reset.style.display = designChanged ? "" : "none";
  };

  const setDesignValue = (property, value) => {
    if (!formDraft) return;
    const design = formDraft.designChange;
    if (property === "text") {
      if (design.text) design.text = { ...design.text, value: String(value).slice(0, 4000) };
    } else {
      design.declarations = design.declarations.map((change) =>
        change.property === property ? { ...change, value: String(value).slice(0, 1000) } : change,
      );
    }
    if (state.editor) state.editor.designChange = design;
    queuePreview();
    syncPopControls();
  };

  const buildField = (property, design) => {
    const declaration = design.declarations.find((change) => change.property === property);
    const value = property === "text" ? (design.text ? design.text.value : "") : (declaration ? declaration.value : "");
    const label = node("label", { class: "f" }, [node("span", { text: DESIGN_LABELS[property] || property })]);
    let control;
    if (property === "text") {
      control = node("textarea", { class: "in", rows: "1", maxlength: "4000" });
      control.value = value;
      control.addEventListener("input", () => setDesignValue("text", control.value));
    } else if (COLOR_PROPERTIES.has(property)) {
      const picker = node("input", { type: "color", "aria-label": (DESIGN_LABELS[property] || property) + " picker" });
      const input = node("input", { class: "in" });
      picker.value = toHex(value);
      input.value = value;
      picker.addEventListener("input", () => { input.value = picker.value; setDesignValue(property, picker.value); });
      input.addEventListener("input", () => { picker.value = toHex(input.value); setDesignValue(property, input.value); });
      control = node("span", { class: "color" }, [picker, input]);
    } else if (SELECT_VALUES[property]) {
      control = node("select", { class: "in" });
      const options = SELECT_VALUES[property].includes(value) ? SELECT_VALUES[property] : [value, ...SELECT_VALUES[property]];
      for (const option of options) control.appendChild(node("option", { value: option, text: option }));
      control.value = value;
      control.addEventListener("change", () => setDesignValue(property, control.value));
    } else {
      const numeric = property === "opacity" || PIXEL_PROPERTIES.has(property);
      control = node("input", { class: "in", type: numeric ? "number" : "text" });
      if (property === "opacity") { control.min = "0"; control.max = "1"; control.step = "0.05"; }
      else if (numeric) control.step = "1";
      control.value = numeric ? numericValue(value) : value;
      control.addEventListener("input", () => {
        const next = control.value;
        setDesignValue(property, PIXEL_PROPERTIES.has(property) ? (next || "0") + "px" : next);
      });
    }
    label.appendChild(control);
    return label;
  };

  const buildSettings = (container) => {
    container.textContent = "";
    if (!formDraft) return;
    const design = formDraft.designChange;
    const reset = node("button", { type: "button", class: "reset", text: "Reset all" });
    reset.addEventListener("click", (event) => {
      if (!trusted(event) || !formDraft) return;
      formDraft.designChange = {
        text: formDraft.designChange.text ? { ...formDraft.designChange.text, value: formDraft.designChange.text.previousValue } : null,
        declarations: formDraft.designChange.declarations.map((change) => ({ ...change, value: change.previousValue })),
      };
      if (state.editor) state.editor.designChange = formDraft.designChange;
      buildSettings(container);
      queuePreview();
      syncPopControls();
    });
    container.appendChild(reset);
    if (popRefs) popRefs.reset = reset;
    const available = new Set(design.declarations.map((change) => change.property));
    for (const [title, properties] of DESIGN_GROUPS) {
      const shown = properties.filter((property) => (property === "text" ? Boolean(design.text) : available.has(property)));
      if (shown.length === 0) continue;
      container.appendChild(node("h4", { text: title }));
      for (const property of shown) container.appendChild(buildField(property, design));
    }
    container.appendChild(node("div", { style: "height:10px" }));
  };

  const placePopover = () => {
    if (!formTarget || pop.style.display === "none") return;
    const fallback = state.editor.rect;
    const rect = formTarget.isConnected
      ? formTarget.getBoundingClientRect()
      : { left: fallback.x, top: fallback.y, bottom: fallback.y + fallback.height };
    const viewportWidth = document.documentElement.clientWidth || innerWidth;
    const width = pop.offsetWidth || 340;
    const height = pop.offsetHeight || 140;
    const gap = 10;
    const left = Math.max(8, Math.min(rect.left, viewportWidth - width - 8));
    let top;
    let above = false;
    if (rect.bottom + gap + height <= innerHeight - 8) top = rect.bottom + gap;
    else if (rect.top - gap - height >= 8) { top = rect.top - gap - height; above = true; }
    else top = Math.max(8, innerHeight - height - 8);
    pop.classList.toggle("above", above);
    pop.style.left = left + "px";
    pop.style.top = top + "px";
  };

  const showPopover = () => {
    clearTimeout(popHideTimer);
    if (!state.editor || !formDraft) return;
    popExpanded = false;
    pop.textContent = "";
    const toggle = node("button", { type: "button", class: "icon", "aria-label": "Element settings", "aria-expanded": "false" }, [slidersIcon()]);
    const chip = node("span", { class: "chip", title: state.editor.target }, [
      node("b", { text: "<" + state.editor.tag + ">" }),
      document.createTextNode(state.editor.target),
    ]);
    const comment = node("textarea", { class: "comment", rows: "2", maxlength: "4000", placeholder: "Add a comment…", "aria-label": "Annotation comment" });
    comment.value = state.editor.comment || "";
    const settings = node("div", { class: "settings" });
    const drawer = node("div", { class: "drawer" }, [node("div", {}, [settings])]);
    const save = node("button", { type: "button", class: "primary", text: formAnnotation ? "Update" : "Save" });
    const cancel = node("button", { type: "button", class: "ghost", text: "Cancel" });
    const remove = formAnnotation ? node("button", { type: "button", class: "ghost danger", text: "Delete" }) : null;
    const hint = node("span", { class: "hint", text: "↵ to save" });
    pop.appendChild(node("div", { class: "head" }, [chip, toggle]));
    pop.appendChild(comment);
    pop.appendChild(drawer);
    pop.appendChild(node("div", { class: "actions" }, [remove, hint, node("span", { class: "grow" }), cancel, save]));
    popRefs = { comment, save, toggle, reset: null };
    buildSettings(settings);

    toggle.addEventListener("click", (event) => {
      if (!trusted(event)) return;
      popExpanded = !popExpanded;
      drawer.classList.toggle("open", popExpanded);
      toggle.setAttribute("aria-expanded", String(popExpanded));
      comment.placeholder = popExpanded ? "Describe these changes…" : "Add a comment…";
      syncPopControls();
      comment.focus({ preventScroll: true });
      // Follow the drawer while it animates so the popover stays on screen.
      const started = performance.now();
      const follow = () => {
        placePopover();
        if (performance.now() - started < 320) requestAnimationFrame(follow);
      };
      requestAnimationFrame(follow);
    });
    comment.addEventListener("input", syncPopControls);
    comment.addEventListener("keydown", (event) => {
      if (event.key === "Enter" && !event.shiftKey && !event.isComposing && trusted(event)) {
        event.preventDefault();
        if (!save.disabled) saveFromPopover();
      }
    });
    save.addEventListener("click", (event) => { if (trusted(event)) saveFromPopover(); });
    cancel.addEventListener("click", (event) => { if (trusted(event)) hideForm(); });
    if (remove) {
      remove.addEventListener("click", (event) => {
        if (!trusted(event) || !formAnnotation) return;
        const item = formAnnotation;
        hideForm();
        removeItem(item);
      });
    }

    pop.style.display = "block";
    pop.classList.remove("on");
    syncPopControls();
    placePopover();
    requestAnimationFrame(() => {
      pop.classList.add("on");
      comment.focus({ preventScroll: true });
      const end = comment.value.length;
      comment.setSelectionRange(end, end);
    });
  };

  const hidePopover = () => {
    popRefs = null;
    pop.classList.remove("on");
    clearTimeout(popHideTimer);
    popHideTimer = setTimeout(() => {
      if (!state.editor) { pop.style.display = "none"; pop.textContent = ""; }
    }, 200);
  };

  const saveFromPopover = () => {
    if (!state.editor || !popRefs || !formDraft) return;
    commitTrustedEditor(state.editor.id, popRefs.comment.value, changedDesign(formDraft.designChange));
  };


  const makeEvidenceItem = (element) => {
    const rect = element.getBoundingClientRect();
    const selection = window.getSelection();
    const selectedText = selection && element.contains(selection.anchorNode)
      ? selection.toString().trim().slice(0, 4000) || null
      : null;
    const directText = Array.from(element.childNodes)
      .filter((node) => node.nodeType === Node.TEXT_NODE)
      .map((node) => node.textContent || "")
      .join(" ")
      .replace(/\\s+/g, " ")
      .trim()
      .slice(0, 2000) || null;
    const fullText = (element.innerText || element.textContent || "")
      .replace(/\\s+/g, " ")
      .trim();
    const target = (
      element.getAttribute("aria-label") ||
      element.getAttribute("alt") ||
      element.getAttribute("title") ||
      directText ||
      fullText ||
      element.tagName.toLowerCase()
    ).slice(0, 1000);
    const metadata = {};
    for (const attribute of Array.from(element.attributes).slice(0, 30)) {
      const key = attribute.name.slice(0, 256);
      if (key && !Object.prototype.hasOwnProperty.call(metadata, key)) {
        metadata[key] = attribute.value.slice(0, 1000);
      }
    }
    return {
      id: "ann_" + Date.now().toString(36) + "_" + (++state.seq),
      version: 0,
      seq: state.items.length + 1,
      kind: "element",
      comment: "",
      designChange: null,
      selector: safeSelectorFor(element),
      tag: descriptiveTagFor(element),
      classes: element.className && typeof element.className === "string" ? element.className.slice(0, 2000) : null,
      text: fullText.slice(0, 4000) || null,
      target,
      targetRole: roleFor(element),
      targetPath: safeSelectorFor(element),
      immediateText: directText,
      nearbyText: ((element.parentElement && (element.parentElement.innerText || element.parentElement.textContent)) || fullText).replace(/\\s+/g, " ").trim().slice(0, 4000) || null,
      selectedText,
      nodePosition: { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 },
      theme: matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light",
      metadata,
      rect: { x: rect.x, y: rect.y, width: rect.width, height: rect.height },
      snapshotRect: { x: rect.x, y: rect.y, width: rect.width, height: rect.height },
      element,
      clientX: rect.left + rect.width / 2,
      clientY: rect.top,
    };
  };

  const openTrustedEditor = (element, annotation) => {
    if (!annotation && state.items.length >= 50) return false;
    if (state.editor) hideForm();
    formTarget = element || (annotation && annotation.element) || null;
    formAnnotation = annotation || null;
    if (!formTarget) return false;
    formDraft = createDesignDraft(
      formTarget,
      annotation,
      annotation ? annotation.id : "draft_" + Date.now().toString(36),
    );
    formPendingItem = annotation ? null : makeEvidenceItem(formTarget);
    state.editorPreviewRevision = 0;
    state.editor = {
      id: "editor_" + Date.now().toString(36) + "_" + Math.random().toString(36).slice(2),
      rect: (() => { const r = formTarget.getBoundingClientRect(); return { x: r.x, y: r.y, width: r.width, height: r.height }; })(),
      annotationId: annotation ? annotation.id : null,
      viewport: { width: innerWidth, height: innerHeight },
      tag: descriptiveTagFor(formTarget),
      target: annotation ? annotation.target : formPendingItem.target,
      comment: annotation ? annotation.comment : "",
      designChange: formDraft.designChange,
    };
    renderDesignPreview();
    hideHover();
    paintEditing();
    showPopover();
    return true;
  };

  const closeFormFromPage = () => {
    hideForm();
  };

  const refreshOverlay = () => {
    for (const item of state.items) { paintPin(item); paintOutline(item); }
    if (state.editor) { paintEditing(); return; }
    if (state.lastX < 0) return;
    const node = document.elementFromPoint(state.lastX, state.lastY);
    if (!node || ownNode(node) || isRoot(node)) { hideHover(); return; }
    paintHover(node);
  };

  const onMove = (event) => {
    if (formTarget || formAnnotation) return;
    state.lastX = event.clientX;
    state.lastY = event.clientY;
    if (ownNode(event.target)) { hideHover(); return; }
    const node = event.target instanceof Element ? event.target : null;
    if (!node || isRoot(node)) { hideHover(); return; }
    paintHover(node);
  };

  const blockClick = (event) => {
    if (ownNode(event.target)) return;
    event.preventDefault();
    event.stopPropagation();
    event.stopImmediatePropagation();
  };

  const onPointerDown = (event) => {
    if (ownNode(event.target)) return;
    event.preventDefault();
    event.stopPropagation();
    event.stopImmediatePropagation();
    // Synthetic events from page scripts must not drive selection.
    if (!trusted(event)) return;
    if (state.editor) {
      closeFormFromPage();
      return;
    }
    const node = event.target instanceof Element ? event.target : null;
    if (!node || isRoot(node)) return;
    hideHover();
    openTrustedEditor(node, null);
  };

  const onKey = (event) => {
    if (event.key !== "Escape" || !trusted(event)) return;
    event.preventDefault();
    if (state.editor) {
      closeFormFromPage();
    } else {
      cleanup();
      post({ type: "cancel" });
    }
  };

  const commitTrustedEditor = (editorId, comment, designChange) => {
    if (!state.editor || state.editor.id !== editorId || !formTarget || !formDraft) return null;
    const trustedComment = String(comment || "").trim().slice(0, 4000);
    if (!trustedComment && !designChange) return null;
    const item = formAnnotation || formPendingItem;
    if (!item) return null;
    item.comment = trustedComment;
    item.designChange = designChange || null;
    item.rollbackText = formDraft.rollbackText;
    item.textNode = formDraft.textNode;
    const rect = formTarget.getBoundingClientRect();
    item.snapshotRect = { x: rect.x, y: rect.y, width: rect.width, height: rect.height };
    item.nodePosition = { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
    if (!formAnnotation) {
      item.seq = state.items.length + 1;
      state.items.push(item);
      paintPin(item);
      paintOutline(item);
    }
    queueCapture(item);
    hideForm();
    bumpRevision();
    post({ type: "committed", annotationId: item.id });
    return { annotationId: item.id };
  };

  const serialize = () => state.items.map((item) => {
    paintPin(item);
    const annotation = {
      id: item.id,
      version: item.version,
      kind: item.kind,
      comment: item.comment,
      designChange: item.designChange,
      selector: item.selector,
      tag: item.tag,
      classes: item.classes,
      text: item.text,
      target: item.target,
      targetRole: item.targetRole,
      targetPath: item.targetPath,
      immediateText: item.immediateText,
      nearbyText: item.nearbyText,
      selectedText: item.selectedText,
      nodePosition: item.nodePosition,
      theme: item.theme,
      metadata: item.metadata,
      rect: item.snapshotRect,
    };
    if (Array.isArray(item.components) && item.components.length > 0) annotation.components = item.components;
    return annotation;
  });

  const serializedBatch = () => ({
    url: state.startUrl,
    title: (document.title || "").slice(0, 500),
    viewport: Math.round(window.visualViewport ? window.visualViewport.width : innerWidth) + "x" +
      Math.round(window.visualViewport ? window.visualViewport.height : innerHeight),
    dpr: window.devicePixelRatio || 1,
    annotations: serialize(),
  });

  const pageState = () => ({
    active: !disposed,
    count: state.items.length,
    revision: state.revision,
    url: location.href,
    startUrl: state.startUrl,
  });

  const cleanup = () => {
    if (disposed) return;
    disposed = true;
    mutationObserver.disconnect();
    window.cancelAnimationFrame(previewFrame);
    window.cancelAnimationFrame(previewQueued);
    clearTimeout(popHideTimer);
    document.removeEventListener("mousemove", onMove, true);
    document.removeEventListener("pointerdown", onPointerDown, true);
    document.removeEventListener("click", blockClick, true);
    document.removeEventListener("keydown", onKey, true);
    window.removeEventListener("scroll", refreshOverlay, true);
    window.removeEventListener("resize", refreshOverlay, true);
    for (const pin of pins.values()) pin.remove();
    pins.clear();
    for (const outline of outlines.values()) outline.remove();
    outlines.clear();
    for (const item of state.items) restoreDesignText(item);
    if (formDraft) restoreDesignText(formDraft);
    for (const element of taggedElements) element.removeAttribute("data-bb-annotation-design");
    taggedElements.clear();
    designStyle.remove();
    rootHost.remove();
    document.documentElement.style.cursor = previousCursor;
    if (globalThis.__bbAnnotate === controller) globalThis.__bbAnnotate = null;
  };

  const controller = {
    state: pageState,
    snapshot: () => (disposed ? null : serializedBatch()),
    open: (annotationId) => {
      const item = state.items.find((candidate) => candidate.id === annotationId);
      if (!item) return false;
      hideHover();
      const element = item.element && item.element.isConnected ? item.element : null;
      if (element) element.scrollIntoView({ block: "center", inline: "nearest" });
      return openTrustedEditor(element, item);
    },
    remove: (annotationId) => {
      const item = state.items.find((candidate) => candidate.id === annotationId);
      if (!item) return false;
      if (formAnnotation && formAnnotation.id === item.id) closeFormFromPage();
      removeItem(item);
      return true;
    },
    /** Hide hover chrome while BB screenshots the tab; markers stay visible. */
    setCapturing: (capturing) => {
      if (capturing) rootHost.setAttribute("data-capturing", "");
      else rootHost.removeAttribute("data-capturing");
      return true;
    },
    /** Tag an annotated element so a main-world probe can read React internals. */
    tagForProbe: (annotationId, token) => {
      const item = state.items.find((candidate) => candidate.id === annotationId);
      const element = item && resolveElement(item);
      if (!element) return false;
      element.setAttribute("data-bb-annotate-probe", token);
      return true;
    },
    setComponents: (annotationId, components) => {
      const item = state.items.find((candidate) => candidate.id === annotationId);
      if (!item) return false;
      item.components = Array.isArray(components) ? components.slice(0, 12) : [];
      return true;
    },
    cleanup,
  };
  if (options.allowSyntheticInput === true) globalThis.__bbAnnotateTestRoot = uiRoot;

  document.addEventListener("mousemove", onMove, true);
  document.addEventListener("pointerdown", onPointerDown, true);
  document.addEventListener("click", blockClick, true);
  document.addEventListener("keydown", onKey, true);
  window.addEventListener("scroll", refreshOverlay, true);
  window.addEventListener("resize", refreshOverlay, true);
  const mutationObserver = new MutationObserver((records) => {
    if (disposed || previewFrame || !records.some((record) => !ownNode(record.target))) return;
    if (!activeSources().some((item) => item.designChange)) return;
    previewFrame = requestAnimationFrame(() => {
      previewFrame = 0;
      renderDesignPreview();
    });
  });
  const observePage = () => {
    if (!disposed && document.body) {
      mutationObserver.observe(document.body, { childList: true, characterData: true, subtree: true });
    }
  };
  observePage();
  if (shouldRestore) {
    state.items = restoreBatch.annotations.map((annotation, index) => {
      let element = null;
      try { element = annotation.selector ? document.querySelector(annotation.selector) : null; } catch {}
      const rect = annotation.rect;
      return {
        ...annotation,
        seq: index + 1,
        element,
        textNode: element ? directTextNode(element) : null,
        rollbackText: element ? fullTextValueFor(element) : null,
        snapshotRect: rect,
        clientX: rect.x + Math.min(18, Math.max(8, rect.width / 2)),
        clientY: rect.y,
      };
    });
    state.seq = state.items.length;
    for (const item of state.items) {
      paintPin(item);
      paintOutline(item);
    }
    renderDesignPreview();
  }
  document.documentElement.style.cursor = "crosshair";
  globalThis.__bbAnnotate = controller;
  return { ...pageState(), restored: shouldRestore };
})(typeof bb === "undefined" ? null : bb, __OPTIONS__)`;

function call(expression: string): string {
  return `(() => { const c = globalThis.${CONTROLLER}; return c ? ${expression} : null; })()`;
}

export type ActivateOptions = {
  restore: Batch | null;
  theme: PageTheme | null;
  /** Tests only: JSDOM cannot create trusted input events. */
  allowSyntheticInput?: boolean;
};

export function activateExpression(options: ActivateOptions): string {
  return PAGE_SCRIPT.replace("__OPTIONS__", () => JSON.stringify(options));
}

export const pageCalls = {
  state: () => call("c.state()"),
  snapshot: () => call("c.snapshot()"),
  cleanup: () => call("(c.cleanup(), true)"),
  open: (annotationId: string) => call(`c.open(${JSON.stringify(annotationId)})`),
  remove: (annotationId: string) => call(`c.remove(${JSON.stringify(annotationId)})`),
  setCapturing: (capturing: boolean) => call(`c.setCapturing(${capturing})`),
  tagForProbe: (annotationId: string, token: string) =>
    call(`c.tagForProbe(${JSON.stringify(annotationId)}, ${JSON.stringify(token)})`),
  setComponents: (annotationId: string, components: ReactComponent[]) =>
    call(`c.setComponents(${JSON.stringify(annotationId)}, ${JSON.stringify(components)})`),
};

/**
 * Main-world probe: walks the React fiber of the tagged element and returns
 * component names, innermost first, with dev-build source locations.
 * Kept free of TypeScript-only runtime syntax because it is stringified.
 */
function probeReactComponents(token: string) {
  const element = document.querySelector('[data-bb-annotate-probe="' + token + '"]');
  if (!element) return null;
  element.removeAttribute("data-bb-annotate-probe");
  const key = Object.keys(element).find(
    (name) => name.startsWith("__reactFiber$") || name.startsWith("__reactInternalInstance$"),
  );
  if (!key) return { components: [] };
  const components: Array<{ name: string; source: string | null }> = [];
  const seen = new Set<string>();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let fiber: any = Reflect.get(element, key);
  let visited = 0;
  while (fiber && components.length < 12 && visited < 500) {
    visited += 1;
    const type = fiber.type;
    let name: unknown = null;
    if (typeof type === "function" || (typeof type === "object" && type !== null)) {
      name = type.displayName || type.name || (type.render && (type.render.displayName || type.render.name)) || null;
    }
    if (typeof name === "string" && /^[A-Z]/.test(name)) {
      const debug = fiber._debugSource;
      const source = debug && typeof debug.fileName === "string"
        ? (debug.fileName + (typeof debug.lineNumber === "number" ? ":" + debug.lineNumber : "")).slice(0, 1000)
        : null;
      const dedupe = name + "|" + (source || "");
      if (!seen.has(dedupe)) {
        seen.add(dedupe);
        components.push({ name: name.slice(0, 200), source });
      }
    }
    fiber = fiber.return;
  }
  return { components };
}

export function reactProbeExpression(token: string): string {
  if (!/^[a-z0-9_]+$/i.test(token)) throw new Error("Invalid probe token");
  return "(" + probeReactComponents.toString() + ")(" + JSON.stringify(token) + ")";
}
