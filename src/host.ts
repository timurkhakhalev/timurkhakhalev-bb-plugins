import { z } from "zod";
import { experimental_defineHostEntry } from "@get-bb/plugin-sdk/host";
import { batchSchema, hostContract } from "./contracts.js";

/**
 * Runs on the desktop machine (bb.host). Talks raw CDP over the wsEndpoint the
 * server hands it and injects the annotation overlay into the page itself —
 * the whole picker is one self-contained script string, no build artifacts.
 */

const CONTROL_ENDED = "Browser control ended";

const PAGE_SCRIPT = `
(() => {
  if (window.__bbAnnotateCleanup) window.__bbAnnotateCleanup();

  const NS = "__bbAnnotate";
  const state = {
    items: [],
    captureQueue: [],
    seq: 0,
    revision: 0,
    lastX: -1,
    lastY: -1,
  };
  window[NS] = state;
  const previousCursor = document.documentElement.style.cursor;

  const css =
    "#__bbAnnBar{position:fixed;top:12px;left:50%;transform:translateX(-50%);z-index:2147483646;" +
    "display:flex;align-items:center;gap:12px;padding:8px 10px 8px 16px;border-radius:999px;" +
    "background:rgba(20,22,28,.96);color:#e8eaf0;font:13px/1.4 -apple-system,Segoe UI,Roboto,sans-serif;" +
    "box-shadow:0 6px 24px rgba(0,0,0,.45);user-select:none}" +
    "#__bbAnnBar .title{font-weight:650}" +
    "#__bbAnnBar button{appearance:none;border:0;border-radius:999px;padding:6px 14px;font:600 13px/1 -apple-system,Segoe UI,Roboto,sans-serif;cursor:pointer}" +
    "#__bbAnnBar .send{background:#3b82f6;color:#fff}" +
    "#__bbAnnBar .send:disabled{opacity:.45;cursor:default}" +
    "#__bbAnnTip{position:fixed;z-index:2147483645;pointer-events:none;display:none;background:rgba(20,22,28,.96);color:#e8eaf0;" +
    "font:12px/1.6 -apple-system,Segoe UI,Roboto,sans-serif;padding:6px 10px;border-radius:8px;max-width:70vw;box-shadow:0 4px 16px rgba(0,0,0,.4)}" +
    "#__bbAnnTip b{color:#fff}" +
    "#__bbAnnTip .dim{color:#9aa0ad}" +
    "#__bbAnnBox{position:fixed;z-index:2147483644;pointer-events:none;display:none;border:2px solid #3b82f6;background:rgba(59,130,246,.12);border-radius:4px}" +
    ".__bbAnnOutline{position:fixed;z-index:2147483643;pointer-events:none;border:2px solid #3b82f6;background:rgba(59,130,246,.08);border-radius:4px}" +
    ".__bbAnnPin{position:fixed;z-index:2147483645;width:22px;height:22px;margin:-11px 0 0 -11px;border-radius:50%;" +
    "background:#3b82f6;color:#fff;font:700 12px/22px -apple-system,Segoe UI,Roboto,sans-serif;text-align:center;cursor:pointer;box-shadow:0 2px 8px rgba(0,0,0,.4)}" +
    "#__bbAnnForm{position:fixed;z-index:2147483647;width:336px;max-width:calc(100vw - 20px);max-height:min(420px,calc(100vh - 20px));overflow:hidden;background:#25262b;border:1px solid rgba(255,255,255,.1);" +
    "border-radius:13px;box-shadow:0 10px 30px rgba(0,0,0,.5);font:13px/1.4 -apple-system,Segoe UI,Roboto,sans-serif;color:#e8eaf0}" +
    "#__bbAnnForm [hidden]{display:none!important}" +
    "#__bbAnnForm .note{display:flex;align-items:center;gap:6px;min-height:46px;padding:5px 6px}" +
    "#__bbAnnForm .icon-button{appearance:none;display:grid;place-items:center;width:36px;height:36px;flex:0 0 auto;padding:0;border:0;border-radius:9px;background:transparent;color:#b9bdc7;cursor:pointer}" +
    "#__bbAnnForm .icon-button:hover{background:rgba(255,255,255,.07);color:#fff}" +
    "#__bbAnnForm .icon-button:focus-visible,#__bbAnnForm button:focus-visible{outline:2px solid #8bb1ff;outline-offset:1px}" +
    "#__bbAnnForm .mode[aria-expanded=true],#__bbAnnForm .mode.has-changes{background:rgba(59,130,246,.16);color:#8bb1ff}" +
    "#__bbAnnForm .quick-save{border-radius:50%;background:#3b82f6;color:#fff}" +
    "#__bbAnnForm .quick-save:hover{background:#4b8df7}" +
    "#__bbAnnForm .quick-save:disabled{background:rgba(255,255,255,.08);color:#747984;cursor:default}" +
    "#__bbAnnForm .quick-drop:hover{color:#ff9c9c}" +
    "#__bbAnnForm svg{width:18px;height:18px;fill:none;stroke:currentColor;stroke-width:1.8;stroke-linecap:round;stroke-linejoin:round}" +
    "#__bbAnnForm textarea{width:100%;box-sizing:border-box;height:36px;min-height:36px;max-height:72px;resize:none;border:0;background:transparent;color:#fff;padding:8px 4px;font:inherit;line-height:20px;outline:none;overflow:auto}" +
    "#__bbAnnForm textarea::placeholder{color:#8a8e98}" +
    "#__bbAnnForm .inspector{border-top:1px solid rgba(255,255,255,.08)}" +
    "#__bbAnnForm .element{display:flex;align-items:center;justify-content:space-between;gap:8px;padding:8px 10px;border-bottom:1px solid rgba(255,255,255,.08)}" +
    "#__bbAnnForm .tag{min-width:0;overflow:hidden;text-overflow:ellipsis;color:#f0f1f4;font:600 12px/1.2 ui-monospace,SFMono-Regular,Menlo,monospace}" +
    "#__bbAnnForm .reset-all{padding:5px 4px!important;color:#9ca1ad;background:transparent!important;font-size:11px!important;white-space:nowrap}" +
    "#__bbAnnForm .controls{max-height:min(214px,calc(100vh - 166px));overflow:auto;padding:4px 10px 7px}" +
    "#__bbAnnForm .group{padding:7px 0;border-bottom:1px solid rgba(255,255,255,.07)}" +
    "#__bbAnnForm .group:last-child{border-bottom:0}" +
    "#__bbAnnForm .group-title{margin:0 0 4px;color:#858a96;font-size:11px;font-weight:600}" +
    "#__bbAnnForm .control{display:grid;grid-template-columns:minmax(88px,.85fr) minmax(140px,1.25fr);align-items:center;gap:9px;min-height:36px}" +
    "#__bbAnnForm .control>label{min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:#b8bbc5}" +
    "#__bbAnnForm input,#__bbAnnForm select{width:100%;height:30px;box-sizing:border-box;border:1px solid rgba(255,255,255,.12);border-radius:8px;background:#303137;color:#f4f5f7;padding:0 8px;font:12px/1 ui-monospace,SFMono-Regular,Menlo,monospace;outline:none}" +
    "#__bbAnnForm input:focus,#__bbAnnForm select:focus{border-color:#7da6ff;box-shadow:0 0 0 1px #7da6ff}" +
    "#__bbAnnForm input[type=color]{padding:3px;cursor:pointer}" +
    "#__bbAnnForm .color-pair{display:grid;grid-template-columns:38px 1fr;gap:6px}" +
    "#__bbAnnForm .quad{display:grid;grid-template-columns:1fr 1fr;gap:6px}" +
    "#__bbAnnForm .quad input{min-width:0}" +
    "#__bbAnnForm .row{display:flex;align-items:center;justify-content:flex-end;gap:6px;padding:7px 8px;border-top:1px solid rgba(255,255,255,.08)}" +
    "#__bbAnnForm .row .drop{margin-right:auto}" +
    "#__bbAnnForm button{appearance:none;border:0;border-radius:8px;padding:7px 12px;font:600 12px/1 -apple-system,Segoe UI,Roboto,sans-serif;cursor:pointer}" +
    "#__bbAnnForm .save{background:#3b82f6;color:#fff}" +
    "#__bbAnnForm .save:disabled{opacity:.45;cursor:default}" +
    "#__bbAnnForm .cancel{background:rgba(255,255,255,.06);color:#d6d8df}" +
    "#__bbAnnForm .drop{background:transparent;color:#9aa0ad}" +
    "#__bbAnnForm .drop:hover{color:#ffb0b0}" +
    "@media (max-width:420px){#__bbAnnForm{width:320px}#__bbAnnForm .control{grid-template-columns:92px minmax(0,1fr)}}" +
    "@media (prefers-reduced-motion:reduce){#__bbAnnForm *{transition:none!important}}";

  const style = document.createElement("style");
  style.id = "__bbAnnStyle";
  style.textContent = css;
  document.documentElement.appendChild(style);
  const designStyle = document.createElement("style");
  designStyle.id = "__bbAnnDesignStyle";
  document.documentElement.appendChild(designStyle);

  const el = (id, tag, parent) => {
    const node = document.createElement(tag || "div");
    node.id = id;
    (parent || document.documentElement).appendChild(node);
    return node;
  };

  const bar = el("__bbAnnBar");
  bar.innerHTML =
    '<span class="title">Annotate Page</span>' +
    '<button type="button" class="send" data-act="send">Send</button>';
  const sendBtn = bar.querySelector('[data-act="send"]');

  const tip = el("__bbAnnTip");
  const box = el("__bbAnnBox");
  const form = el("__bbAnnForm");
  form.style.display = "none";
  form.innerHTML =
    '<div class="note"><button type="button" class="icon-button mode" data-act="toggle-design" aria-expanded="false" aria-label="Show design controls" title="Design controls">' +
    '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 7h10M18 7h2M4 17h2M10 17h10M14 4v6M10 14v6"/></svg></button>' +
    '<textarea placeholder="Add a comment…" aria-label="Annotation comment"></textarea>' +
    '<button type="button" class="icon-button quick-drop" data-act="drop" aria-label="Delete annotation" title="Delete annotation" hidden>' +
    '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 7h16M9 7V4h6v3M7 7l1 13h8l1-13M10 11v5M14 11v5"/></svg></button>' +
    '<button type="button" class="icon-button quick-save" data-act="save" aria-label="Save annotation" title="Save annotation">' +
    '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m6 12 4 4 8-9"/></svg></button></div>' +
    '<div class="inspector" data-role="inspector" hidden>' +
    '<div class="element"><span class="tag" data-role="tag">&lt;element&gt;</span>' +
    '<button type="button" class="reset-all" data-act="reset">Reset all</button></div>' +
    '<div class="controls" data-role="controls"></div>' +
    '<div class="row"><button type="button" class="drop" data-act="drop" hidden>Delete</button>' +
    '<button type="button" class="cancel" data-act="cancel">Cancel</button>' +
    '<button type="button" class="save" data-act="save">Save</button></div></div>';
  const textarea = form.querySelector("textarea");
  const inspector = form.querySelector('[data-role="inspector"]');
  const modeButton = form.querySelector('[data-act="toggle-design"]');
  const quickSave = form.querySelector(".quick-save");
  const quickDrop = form.querySelector(".quick-drop");
  const controls = form.querySelector('[data-role="controls"]');
  const tagLabel = form.querySelector('[data-role="tag"]');
  const formSaves = Array.from(form.querySelectorAll('[data-act="save"]'));
  const dropButtons = Array.from(form.querySelectorAll('[data-act="drop"]'));

  let formTarget = null; // element being annotated, or the annotation being edited
  let formAnnotation = null;
  let formDraft = null;

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

  const roleFor = (element) => {
    const explicit = element.getAttribute("role");
    if (explicit) return explicit;
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

  const ownNode = (node) => node instanceof Element && node.closest("#__bbAnnBar, #__bbAnnForm, #__bbAnnTip, #__bbAnnBox, .__bbAnnPin") !== null;
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
  const LABELS = {
    "color": "Text color", "background-color": "Background", "opacity": "Opacity",
    "font-family": "Font", "font-size": "Font size", "font-weight": "Font weight",
    "border-radius": "Border radius", "border-color": "Border color", "border-width": "Border width",
    "width": "Width", "height": "Height", "padding-top": "Padding top", "padding-right": "Padding right",
    "padding-bottom": "Padding bottom", "padding-left": "Padding left", "margin-top": "Margin top",
    "margin-right": "Margin right", "margin-bottom": "Margin bottom", "margin-left": "Margin left",
    "flex-direction": "Layout direction", "justify-content": "Distribution", "align-items": "Alignment",
    "gap": "Spacing", "row-gap": "Vertical gap", "column-gap": "Horizontal gap",
  };
  const GROUPS = [
    { title: "Content", properties: ["text", "color", "background-color", "opacity"] },
    { title: "Typography", properties: ["font-family", "font-size", "font-weight"] },
    { title: "Border", properties: ["border-radius", "border-color", "border-width"] },
    { title: "Dimensions", properties: ["width", "height"] },
    { title: "Padding", properties: ["padding-top", "padding-right", "padding-bottom", "padding-left"] },
    { title: "Margin", properties: ["margin-top", "margin-right", "margin-bottom", "margin-left"] },
    { title: "Flex layout", properties: FLEX_STYLE_PROPERTIES },
  ];
  const PX_PROPERTIES = new Set([
    "font-size", "border-radius", "border-width", "width", "height",
    "padding-top", "padding-right", "padding-bottom", "padding-left",
    "margin-top", "margin-right", "margin-bottom", "margin-left", "gap", "row-gap", "column-gap",
  ]);
  const COLOR_PROPERTIES = new Set(["color", "background-color", "border-color"]);
  const SELECT_VALUES = {
    "font-weight": ["100", "200", "300", "400", "500", "600", "700", "800", "900"],
    "flex-direction": ["row", "row-reverse", "column", "column-reverse"],
    "justify-content": ["flex-start", "center", "flex-end", "space-between", "space-around", "space-evenly"],
    "align-items": ["flex-start", "center", "flex-end", "stretch", "baseline"],
  };
  const taggedElements = new Set();
  let applyingPreview = false;
  let previewGuardTimer = 0;

  const directTextNode = (element) => {
    const nodes = Array.from(element.childNodes).filter(
      (node) => node.nodeType === Node.TEXT_NODE && (node.nodeValue || "").trim().length > 0,
    );
    const childHasText = Array.from(element.children).some(
      (child) => ((child.innerText || child.textContent || "").trim().length > 0),
    );
    return nodes.length === 1 && !childHasText ? nodes[0] : null;
  };
  const textValueFor = (element) => {
    const node = directTextNode(element);
    return node ? (node.nodeValue || "").trim() : null;
  };
  const setDirectText = (element, value) => {
    const node = directTextNode(element);
    if (node) node.nodeValue = value;
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
  const activeSources = () => {
    const saved = state.items.filter((item) => !formAnnotation || item.id !== formAnnotation.id);
    return formDraft ? [...saved, formDraft] : saved;
  };
  const restoreDesignText = (item) => {
    if (!item || !item.designChange || !item.designChange.text) return;
    const element = resolveElement(item);
    if (element) setDirectText(element, item.designChange.text.previousValue);
  };
  const renderDesignPreview = () => {
    if (!designStyle.isConnected) return;
    applyingPreview = true;
    window.clearTimeout(previewGuardTimer);
    const known = [...state.items, ...(formDraft ? [formDraft] : [])];
    for (const item of known) {
      if (!item.designChange || !item.designChange.text) continue;
      const element = resolveElement(item);
      if (element) setDirectText(element, item.designChange.text.previousValue);
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
        setDirectText(element, design.text.value);
      }
    }
    previewGuardTimer = window.setTimeout(() => { applyingPreview = false; }, 0);
  };

  const rgbToHex = (value) => {
    const match = value.match(/^rgba?\\(\\s*(\\d+)\\D+(\\d+)\\D+(\\d+)/i);
    if (!match) return /^#[0-9a-f]{6}$/i.test(value) ? value : "#000000";
    return "#" + [match[1], match[2], match[3]]
      .map((part) => Math.max(0, Math.min(255, Number(part))).toString(16).padStart(2, "0"))
      .join("");
  };
  const numericValue = (value) => {
    const number = Number.parseFloat(value);
    return Number.isFinite(number) ? String(Math.round(number * 100) / 100) : "0";
  };
  const changedDesign = (draft) => {
    const declarations = draft.designChange.declarations.filter(
      (change) => change.value !== change.previousValue,
    );
    const text = draft.designChange.text && draft.designChange.text.value !== draft.designChange.text.previousValue
      ? { ...draft.designChange.text }
      : null;
    return declarations.length > 0 || text ? { declarations, text } : null;
  };
  const syncFormValidity = () => {
    const design = formDraft ? changedDesign(formDraft) : null;
    const disabled = !formDraft || (textarea.value.trim().length === 0 && design === null);
    for (const save of formSaves) save.disabled = disabled;
    modeButton.classList.toggle("has-changes", design !== null);
  };

  const makeInput = (property, value) => {
    if (COLOR_PROPERTIES.has(property)) {
      const pair = document.createElement("div");
      pair.className = "color-pair";
      const picker = document.createElement("input");
      picker.type = "color";
      picker.value = rgbToHex(value);
      picker.setAttribute("aria-label", LABELS[property] + " picker");
      const text = document.createElement("input");
      text.type = "text";
      text.value = value;
      text.dataset.property = property;
      text.setAttribute("aria-label", LABELS[property]);
      picker.addEventListener("input", () => {
        text.value = picker.value;
        text.dispatchEvent(new Event("input", { bubbles: true }));
      });
      text.addEventListener("input", () => { picker.value = rgbToHex(text.value); });
      pair.append(picker, text);
      return pair;
    }
    if (SELECT_VALUES[property]) {
      const select = document.createElement("select");
      const values = SELECT_VALUES[property];
      if (!values.includes(value)) {
        const current = document.createElement("option");
        current.value = value;
        current.textContent = value;
        select.appendChild(current);
      }
      for (const optionValue of values) {
        const option = document.createElement("option");
        option.value = optionValue;
        option.textContent = optionValue;
        select.appendChild(option);
      }
      select.value = value;
      select.dataset.property = property;
      return select;
    }
    const input = document.createElement("input");
    input.dataset.property = property;
    input.setAttribute("aria-label", LABELS[property]);
    if (property === "opacity") {
      input.type = "number";
      input.min = "0";
      input.max = "1";
      input.step = "0.05";
      input.value = numericValue(value);
    } else if (PX_PROPERTIES.has(property)) {
      input.type = "number";
      input.step = "1";
      input.value = numericValue(value);
    } else {
      input.type = "text";
      input.value = value;
    }
    return input;
  };

  const availableGroups = () => {
    if (!formDraft) return [];
    const declarationMap = new Map(
      formDraft.designChange.declarations.map((change) => [change.property, change]),
    );
    return GROUPS.map((group) => ({
      ...group,
      available: group.properties.filter(
        (property) => property === "text" ? formDraft.designChange.text : declarationMap.has(property),
      ),
    })).filter((group) => group.available.length > 0);
  };

  const buildControls = () => {
    controls.replaceChildren();
    if (!formDraft) return;
    const declarationMap = new Map(
      formDraft.designChange.declarations.map((change) => [change.property, change]),
    );
    for (const group of availableGroups()) {
      const section = document.createElement("section");
      section.className = "group";
      const heading = document.createElement("p");
      heading.className = "group-title";
      heading.textContent = group.title;
      section.appendChild(heading);
      for (const property of group.available) {
        const row = document.createElement("div");
        row.className = "control";
        const label = document.createElement("label");
        label.textContent = property === "text" ? "Text" : LABELS[property];
        let input;
        if (property === "text") {
          input = document.createElement("input");
          input.type = "text";
          input.value = formDraft.designChange.text.value;
          input.dataset.text = "true";
          input.setAttribute("aria-label", "Text");
        } else {
          input = makeInput(property, declarationMap.get(property).value);
        }
        const labelledInput = input.matches && input.matches("input,select")
          ? input
          : input.querySelector('[data-property]');
        if (labelledInput) {
          labelledInput.id = "__bbAnnControl_" + property.replace(/[^a-z0-9]/gi, "_");
          label.htmlFor = labelledInput.id;
        }
        row.append(label, input);
        section.appendChild(row);
      }
      controls.appendChild(section);
    }
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
      selector: annotation ? annotation.selector : selectorFor(element),
      designChange: {
        text,
        declarations: properties.map((property) => {
          const change = savedDeclarations.get(property);
          const current = computed.getPropertyValue(property).trim();
          return change ? { ...change } : { property, previousValue: current, value: current };
        }),
      },
    };
  };

  const paintHover = (element) => {
    const rect = element.getBoundingClientRect();
    if (rect.width < 1 && rect.height < 1) { hideHover(); return; }
    box.style.display = "block";
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
    tip.style.display = "block";
    const vw = document.documentElement.clientWidth || innerWidth;
    tip.style.left = Math.max(8, Math.min(rect.left, vw - 240)) + "px";
    tip.style.top = Math.max(8, rect.top > 90 ? rect.top - 82 : rect.bottom + 8) + "px";
  };
  const hideHover = () => { box.style.display = "none"; tip.style.display = "none"; };

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
        const annotation = state.items.find((candidate) => candidate.id === pin.dataset.annotationId);
        if (annotation) openForm(annotation.element, annotation);
      });
      document.documentElement.appendChild(pin);
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
      document.documentElement.appendChild(outline);
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

  const syncBar = () => {
    sendBtn.disabled = state.items.length === 0 || state.items.some((item) => item.capturePending);
    sendBtn.textContent = "Send";
    window.__bbAnnotateCount = state.items.length;
  };

  const bumpRevision = () => { state.revision += 1; };

  const queueCapture = (item) => {
    state.captureQueue = state.captureQueue.filter((capture) => capture.id !== item.id);
    item.capturePending = true;
    state.captureQueue.push({ id: item.id });
  };

  const hideForm = () => {
    restoreDesignText(formDraft);
    form.style.display = "none";
    formTarget = null;
    formAnnotation = null;
    formDraft = null;
    textarea.value = "";
    controls.replaceChildren();
    renderDesignPreview();
  };

  const placeForm = () => {
    if (!formTarget || form.style.display === "none") return;
    const rect = formTarget.getBoundingClientRect();
    const vw = document.documentElement.clientWidth || innerWidth;
    const vh = document.documentElement.clientHeight || innerHeight;
    const margin = 10;
    const gap = 10;
    const width = form.offsetWidth || 336;
    const height = form.offsetHeight || 54;
    const maxLeft = Math.max(margin, vw - width - margin);
    const maxTop = Math.max(margin, vh - height - margin);
    let left;
    let top;
    if (rect.right + gap + width <= vw - margin) {
      left = rect.right + gap;
      top = Math.max(margin, Math.min(rect.top, maxTop));
    } else if (rect.left - gap - width >= margin) {
      left = rect.left - gap - width;
      top = Math.max(margin, Math.min(rect.top, maxTop));
    } else {
      left = Math.max(margin, Math.min(rect.left, maxLeft));
      const fitsBelow = rect.bottom + gap + height <= vh - margin;
      top = fitsBelow ? rect.bottom + gap : rect.top - gap - height;
      top = Math.max(margin, Math.min(top, maxTop));
    }
    form.style.left = left + "px";
    form.style.top = top + "px";
  };

  const setDesignOpen = (open) => {
    inspector.hidden = !open;
    quickSave.hidden = open;
    quickDrop.hidden = open || !formAnnotation;
    modeButton.setAttribute("aria-expanded", String(open));
    modeButton.setAttribute("aria-label", open ? "Hide design controls" : "Show design controls");
    modeButton.title = open ? "Hide design controls" : "Design controls";
    requestAnimationFrame(placeForm);
  };

  const openForm = (element, annotation) => {
    formTarget = element || (annotation && annotation.element) || null;
    formAnnotation = annotation || null;
    if (!formTarget) return;
    textarea.value = annotation ? annotation.comment : "";
    textarea.style.height = "36px";
    formDraft = createDesignDraft(
      formTarget,
      annotation,
      annotation ? annotation.id : "draft_" + Date.now().toString(36),
    );
    tagLabel.textContent = "<" + formTarget.tagName.toLowerCase() + ">";
    const showDesign = Boolean(annotation && annotation.designChange);
    buildControls();
    for (const button of dropButtons) button.hidden = !annotation;
    setDesignOpen(showDesign);
    renderDesignPreview();
    syncFormValidity();
    form.style.display = "block";
    requestAnimationFrame(placeForm);
    textarea.focus();
  };

  const updateDraftFromControl = (target) => {
    if (!formDraft || !(target instanceof HTMLInputElement || target instanceof HTMLSelectElement)) return;
    if (target.dataset.text === "true" && formDraft.designChange.text) {
      formDraft.designChange.text.value = target.value.slice(0, 4000);
    } else if (target.dataset.property) {
      const property = target.dataset.property;
      const declaration = formDraft.designChange.declarations.find((change) => change.property === property);
      if (!declaration) return;
      let value = target.value;
      if (property === "opacity") {
        value = String(Math.max(0, Math.min(1, Number.parseFloat(value) || 0)));
      } else if (PX_PROPERTIES.has(property)) {
        value = numericValue(value) + "px";
      }
      declaration.value = value.slice(0, 1000);
    }
    renderDesignPreview();
    requestAnimationFrame(refreshOverlay);
    syncFormValidity();
  };
  controls.addEventListener("input", (event) => updateDraftFromControl(event.target));
  controls.addEventListener("change", (event) => updateDraftFromControl(event.target));
  textarea.addEventListener("input", () => {
    textarea.style.height = "36px";
    textarea.style.height = Math.min(72, Math.max(36, textarea.scrollHeight)) + "px";
    syncFormValidity();
    requestAnimationFrame(placeForm);
  });

  form.addEventListener("click", (event) => {
    const actionTarget = event.target instanceof Element ? event.target.closest("[data-act]") : null;
    const act = actionTarget && actionTarget.dataset ? actionTarget.dataset.act : null;
    if (act === "save") {
      const comment = textarea.value.trim();
      const designChange = formDraft ? changedDesign(formDraft) : null;
      if (!comment && !designChange) { textarea.focus(); return; }
      if (formAnnotation) {
        formAnnotation.comment = comment;
        formAnnotation.designChange = designChange;
        const rect = formTarget.getBoundingClientRect();
        formAnnotation.snapshotRect = { x: rect.x, y: rect.y, width: rect.width, height: rect.height };
        formAnnotation.nodePosition = { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
        queueCapture(formAnnotation);
        bumpRevision();
      } else if (formTarget && state.items.length < 50) {
        const rect = formTarget.getBoundingClientRect();
        const selection = window.getSelection();
        const selectedText = selection && formTarget.contains(selection.anchorNode)
          ? selection.toString().trim().slice(0, 4000) || null
          : null;
        const directText = Array.from(formTarget.childNodes)
          .filter((node) => node.nodeType === Node.TEXT_NODE)
          .map((node) => node.textContent || "")
          .join(" ")
          .replace(/\\s+/g, " ")
          .trim()
          .slice(0, 2000) || null;
        const fullText = (formTarget.innerText || formTarget.textContent || "")
          .replace(/\\s+/g, " ")
          .trim();
        const target = (
          formTarget.getAttribute("aria-label") ||
          formTarget.getAttribute("alt") ||
          formTarget.getAttribute("title") ||
          directText ||
          fullText ||
          formTarget.tagName.toLowerCase()
        ).slice(0, 1000);
        const metadata = {};
        for (const attribute of Array.from(formTarget.attributes).slice(0, 30)) {
          metadata[attribute.name] = attribute.value.slice(0, 1000);
        }
        const item = {
          id: "ann_" + Date.now().toString(36) + "_" + (++state.seq),
          seq: state.items.length + 1,
          kind: "element",
          comment,
          designChange,
          selector: selectorFor(formTarget),
          tag: formTarget.tagName.toLowerCase(),
          classes: formTarget.className && typeof formTarget.className === "string" ? formTarget.className : null,
          text: fullText.slice(0, 4000) || null,
          target,
          targetRole: roleFor(formTarget),
          targetPath: selectorFor(formTarget),
          immediateText: directText,
          nearbyText: ((formTarget.parentElement && (formTarget.parentElement.innerText || formTarget.parentElement.textContent)) || fullText).replace(/\\s+/g, " ").trim().slice(0, 4000) || null,
          selectedText,
          nodePosition: { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 },
          theme: matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light",
          metadata,
          rect: { x: rect.x, y: rect.y, width: rect.width, height: rect.height },
          snapshotRect: { x: rect.x, y: rect.y, width: rect.width, height: rect.height },
          element: formTarget,
          clientX: rect.left + rect.width / 2,
          clientY: rect.top,
          capturePending: false,
        };
        state.items.push(item);
        paintPin(item);
        paintOutline(item);
        queueCapture(item);
        bumpRevision();
      }
      syncBar();
      hideForm();
    } else if (act === "toggle-design") {
      setDesignOpen(inspector.hidden);
    } else if (act === "cancel") {
      hideForm();
    } else if (act === "reset" && formDraft) {
      for (const change of formDraft.designChange.declarations) change.value = change.previousValue;
      if (formDraft.designChange.text) formDraft.designChange.text.value = formDraft.designChange.text.previousValue;
      buildControls();
      renderDesignPreview();
      syncFormValidity();
    } else if (act === "drop") {
      if (formAnnotation) {
        restoreDesignText(formAnnotation);
        state.items = state.items.filter((i) => i.id !== formAnnotation.id);
        dropPin(formAnnotation.id);
        dropOutline(formAnnotation.id);
        // renumber
        state.captureQueue = [];
        state.items.forEach((i, idx) => {
          i.seq = idx + 1;
          if (i.element && i.element.isConnected) {
            const rect = i.element.getBoundingClientRect();
            i.snapshotRect = { x: rect.x, y: rect.y, width: rect.width, height: rect.height };
            i.nodePosition = { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
          }
          i.capturePending = true;
          state.captureQueue.push({ id: i.id });
          paintPin(i);
          paintOutline(i);
        });
        bumpRevision();
        syncBar();
      }
      hideForm();
    }
  });
  form.addEventListener("keydown", (event) => {
    if (event.key === "Escape") { event.stopPropagation(); hideForm(); }
    if ((event.metaKey || event.ctrlKey) && event.key === "Enter") {
      event.stopPropagation();
      form.querySelector('[data-act="save"]').click();
    }
  });

  const refreshOverlay = () => {
    for (const item of state.items) { paintPin(item); paintOutline(item); }
    if (formTarget || formAnnotation) { placeForm(); return; }
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

  const onClick = (event) => {
    if (ownNode(event.target)) return;
    event.preventDefault();
    event.stopPropagation();
    event.stopImmediatePropagation();
    if (formTarget || formAnnotation) {
      hideForm();
      return;
    }
    const node = event.target instanceof Element ? event.target : null;
    if (!node || isRoot(node)) return;
    hideHover();
    openForm(node, null);
  };

  const onKey = (event) => {
    if (event.key === "Escape" && !formTarget && !formAnnotation) {
      event.preventDefault();
      finish("cancel");
    }
  };

  const serialize = () => state.items.map((item) => {
    paintPin(item);
    return {
      id: item.id,
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
  });

  const serializedBatch = () => ({
    url: location.href,
    title: document.title || "",
    viewport: Math.round(window.visualViewport ? window.visualViewport.width : innerWidth) + "x" +
      Math.round(window.visualViewport ? window.visualViewport.height : innerHeight),
    dpr: window.devicePixelRatio || 1,
    annotations: serialize(),
  });

  window.__bbAnnotateRead = () => ({ revision: state.revision, batch: serializedBatch() });
  window.__bbAnnotateMutate = (annotationId, action) => {
    const item = state.items.find((candidate) => candidate.id === annotationId);
    if (!item) return false;
    if (action === "open") {
      hideHover();
      const element = item.element && item.element.isConnected ? item.element : null;
      if (element) element.scrollIntoView({ block: "center", inline: "nearest" });
      openForm(element, item);
      return true;
    } else if (action === "delete") {
      restoreDesignText(item);
      state.items = state.items.filter((candidate) => candidate.id !== annotationId);
      dropPin(annotationId);
      dropOutline(annotationId);
      state.captureQueue = state.captureQueue.filter((capture) => capture.id !== annotationId);
      state.items.forEach((candidate, index) => {
        candidate.seq = index + 1;
        paintPin(candidate);
      });
      renderDesignPreview();
    } else {
      return false;
    }
    bumpRevision();
    syncBar();
    return true;
  };

  const done = (kind) => {
    window.__bbAnnotateDone = {
      kind,
      batch: serializedBatch(),
    };
    if (kind === "cancel") cleanup();
    else {
      bar.style.display = "none";
      tip.style.display = "none";
      box.style.display = "none";
      form.style.display = "none";
      document.documentElement.style.cursor = previousCursor;
    }
  };
  const finish = (kind) => { if (!window.__bbAnnotateDone) done(kind); };

  bar.addEventListener("click", (event) => {
    const act = event.target && event.target.dataset ? event.target.dataset.act : null;
    if (act === "cancel") finish("cancel");
    else if (act === "send" && state.items.length > 0) finish("send");
  });

  const cleanup = () => {
    mutationObserver.disconnect();
    window.clearTimeout(previewGuardTimer);
    document.removeEventListener("mousemove", onMove, true);
    document.removeEventListener("click", onClick, true);
    document.removeEventListener("keydown", onKey, true);
    window.removeEventListener("scroll", refreshOverlay, true);
    window.removeEventListener("resize", refreshOverlay, true);
    for (const pin of pins.values()) pin.remove();
    pins.clear();
    for (const outline of outlines.values()) outline.remove();
    outlines.clear();
    for (const item of state.items) restoreDesignText(item);
    for (const element of taggedElements) element.removeAttribute("data-bb-annotation-design");
    taggedElements.clear();
    for (const node of [bar, tip, box, form, style, designStyle]) node.remove();
    document.documentElement.style.cursor = previousCursor;
    window.__bbAnnotateCleanup = null;
    window.__bbAnnotateRead = null;
    window.__bbAnnotateMutate = null;
  };

  document.addEventListener("mousemove", onMove, true);
  document.addEventListener("click", onClick, true);
  document.addEventListener("keydown", onKey, true);
  window.addEventListener("scroll", refreshOverlay, true);
  window.addEventListener("resize", refreshOverlay, true);
  const mutationObserver = new MutationObserver(() => {
    if (!applyingPreview) requestAnimationFrame(renderDesignPreview);
  });
  if (document.body) {
    mutationObserver.observe(document.body, { childList: true, characterData: true, subtree: true });
  }
  document.documentElement.style.cursor = "crosshair";
  syncBar();
  window.__bbAnnotateCleanup = cleanup;
  window.__bbAnnotateTakeCapture = () => state.captureQueue.shift() || null;
  window.__bbAnnotateFinishCapture = (id) => {
    const item = state.items.find((candidate) => candidate.id === id);
    if (item) item.capturePending = false;
    syncBar();
    return true;
  };
  return true;
})()`;

type Connection = ReturnType<typeof connect>;

function connect(wsEndpoint: string) {
  const socket = new WebSocket(wsEndpoint);
  const pending = new Map<
    number,
    {
      resolve(value: unknown): void;
      reject(error: Error): void;
      timeout: ReturnType<typeof setTimeout>;
    }
  >();
  let nextId = 1;
  let ended = false;
  const {
    promise: opened,
    resolve: resolveOpened,
    reject: rejectOpened,
  } = Promise.withResolvers<void>();
  const failPending = (message: string) => {
    for (const request of pending.values()) {
      clearTimeout(request.timeout);
      request.reject(new Error(message));
    }
    pending.clear();
  };
  socket.addEventListener("open", () => resolveOpened(), { once: true });
  socket.addEventListener("error", () => {
    rejectOpened(new Error("Could not connect to the Browser tab"));
  });
  socket.addEventListener("message", ({ data }) => {
    try {
      const message = JSON.parse(String(data));
      if (typeof message.id === "number") {
        const request = pending.get(message.id);
        if (!request) return;
        pending.delete(message.id);
        clearTimeout(request.timeout);
        if ("error" in message)
          request.reject(new Error(message.error?.message ?? "Browser command failed"));
        else request.resolve(message.result ?? {});
      }
    } catch {
      // malformed frame; owning request times out
    }
  });
  socket.addEventListener("close", () => {
    ended = true;
    rejectOpened(new Error(CONTROL_ENDED));
    failPending(CONTROL_ENDED);
  });
  const request = (method: string, params: Record<string, unknown> = {}, sessionId?: string) => {
    if (ended || socket.readyState !== WebSocket.OPEN)
      return Promise.reject(new Error(CONTROL_ENDED));
    const id = nextId++;
    const { promise, resolve, reject } = Promise.withResolvers<unknown>();
    const timeout = setTimeout(() => {
      pending.delete(id);
      reject(new Error(`Timed out waiting for ${method}`));
    }, 30_000);
    pending.set(id, { resolve, reject, timeout });
    socket.send(JSON.stringify({ id, method, params, ...(sessionId ? { sessionId } : {}) }));
    return promise;
  };
  return {
    opened,
    request,
    close() {
      socket.close();
      for (const request of pending.values()) clearTimeout(request.timeout);
      pending.clear();
    },
  };
}

async function withPage<T>(
  wsEndpoint: string,
  signal: AbortSignal,
  run: (connection: Connection, sessionId: string) => Promise<T>,
): Promise<T> {
  signal.throwIfAborted();
  const connection = connect(wsEndpoint);
  let rejectOnAbort!: (reason: Error) => void;
  const aborted = new Promise<never>((_resolve, reject) => {
    rejectOnAbort = reject;
  });
  const onAbort = () => rejectOnAbort(new Error("Annotate session cancelled"));
  signal.addEventListener("abort", onAbort, { once: true });
  try {
    await Promise.race([connection.opened, aborted]);
  } finally {
    signal.removeEventListener("abort", onAbort);
  }
  let sessionId: string | null = null;
  try {
    const targets = z
      .object({
        targetInfos: z.array(z.object({ targetId: z.string(), type: z.string() })),
      })
      .parse(await connection.request("Target.getTargets"))
      .targetInfos.filter((target) => target.type === "page");
    if (targets.length !== 1) throw new Error("Selected Browser tab is no longer available");
    sessionId = z.object({ sessionId: z.string() }).parse(
      await connection.request("Target.attachToTarget", {
        targetId: targets[0].targetId,
        flatten: true,
      }),
    ).sessionId;
    return await run(connection, sessionId);
  } finally {
    if (sessionId !== null) {
      await connection.request("Target.detachFromTarget", { sessionId }).catch(() => undefined);
    }
    connection.close();
  }
}

async function evaluate(
  connection: Connection,
  sessionId: string,
  expression: string,
): Promise<unknown> {
  const response = (await connection.request(
    "Runtime.evaluate",
    { expression, returnByValue: true, awaitPromise: true },
    sessionId,
  )) as {
    result?: { value?: unknown };
    exceptionDetails?: { text?: string; exception?: { description?: string } };
  };
  if (response.exceptionDetails) {
    const d = response.exceptionDetails;
    throw new Error(`Browser script error: ${d.exception?.description ?? d.text ?? "unknown"}`);
  }
  return response.result?.value;
}

async function screenshot(
  connection: Connection,
  sessionId: string,
): Promise<{
  base64: string;
  width: number;
  height: number;
  mimeType: "image/jpeg";
}> {
  const dpr = (await evaluate(connection, sessionId, "window.devicePixelRatio || 1")) as number;
  const viewport = (await evaluate(
    connection,
    sessionId,
    "(visualViewport ? { width: visualViewport.width, height: visualViewport.height } : { width: innerWidth, height: innerHeight })",
  )) as { width: number; height: number };
  const data = z
    .object({ data: z.string() })
    .parse(
      await connection.request(
        "Page.captureScreenshot",
        { format: "jpeg", quality: 85, captureBeyondViewport: false },
        sessionId,
      ),
    ).data;
  return {
    base64: data,
    width: Math.max(1, Math.round(viewport.width * dpr)),
    height: Math.max(1, Math.round(viewport.height * dpr)),
    mimeType: "image/jpeg" as const,
  };
}

export default experimental_defineHostEntry({
  contract: hostContract,
  handlers: {
    startSession: async (input, context) => {
      return withPage(input.wsEndpoint, context.signal, async (connection, sessionId) => {
        await evaluate(
          connection,
          sessionId,
          "window.__bbAnnotateDone = null; window.__bbAnnotateCount = 0; true",
        );
        await evaluate(connection, sessionId, PAGE_SCRIPT);
        return { started: true as const };
      });
    },
    readSession: async (input, context) => {
      return withPage(input.wsEndpoint, context.signal, async (connection, sessionId) => {
        const doneRaw = await evaluate(connection, sessionId, "window.__bbAnnotateDone || null");
        if (doneRaw !== null && typeof doneRaw === "object") {
          const done = doneRaw as { kind?: unknown; batch?: unknown };
          if (done.kind === "cancel") {
            return {
              status: "cancelled" as const,
              revision: Math.max(0, input.afterRevision),
              batch: null,
              preview: null,
              capture: null,
            };
          }
          if (done.kind === "send") {
            const batch = batchSchema.parse(done.batch);
            return {
              status: "sent" as const,
              revision: Math.max(input.afterRevision + 1, 0),
              batch,
              preview: batch.annotations.length > 0
                ? await screenshot(connection, sessionId)
                : null,
              capture: null,
            };
          }
        }
        const raw = await evaluate(
          connection,
          sessionId,
          "window.__bbAnnotateRead ? window.__bbAnnotateRead() : null",
        );
        if (raw === null || typeof raw !== "object") {
          return {
            status: "cancelled" as const,
            revision: Math.max(0, input.afterRevision),
            batch: null,
            preview: null,
            capture: null,
          };
        }
        const value = z
          .object({ revision: z.number().int().min(0), batch: batchSchema })
          .parse(raw);
        if (value.revision > input.afterRevision) {
          return {
            status: "active" as const,
            revision: value.revision,
            batch: value.batch,
            preview: null,
            capture: null,
          };
        }

        const captureRaw = await evaluate(
          connection,
          sessionId,
          "window.__bbAnnotateTakeCapture ? window.__bbAnnotateTakeCapture() : null",
        );
        if (
          typeof captureRaw === "object" &&
          captureRaw !== null &&
          typeof (captureRaw as { id?: unknown }).id === "string"
        ) {
          const annotationId = (captureRaw as { id: string }).id;
          await connection.request("Page.enable", {}, sessionId).catch(() => undefined);
          const image = await screenshot(connection, sessionId);
          await evaluate(
            connection,
            sessionId,
            `window.__bbAnnotateFinishCapture(${JSON.stringify(annotationId)})`,
          );
          return {
            status: "active" as const,
            revision: value.revision,
            batch: value.batch,
            preview: image,
            capture: { annotationId, image },
          };
        }

        return {
          status: "active" as const,
          revision: value.revision,
          batch: null,
          preview: null,
          capture: null,
        };
      });
    },
    mutateSession: async (input, context) => {
      return withPage(input.wsEndpoint, context.signal, async (connection, sessionId) => ({
        changed: Boolean(
          await evaluate(
            connection,
            sessionId,
            `window.__bbAnnotateMutate ? window.__bbAnnotateMutate(${JSON.stringify(input.annotationId)}, ${JSON.stringify(input.action)}) : false`,
          ),
        ),
      }));
    },
    cleanupSession: async (input, context) => {
      return withPage(input.wsEndpoint, context.signal, async (connection, sessionId) => {
        await evaluate(
          connection,
          sessionId,
          "window.__bbAnnotateCleanup && window.__bbAnnotateCleanup(); true",
        ).catch(() => undefined);
        return { cleaned: true as const };
      });
    },
  },
});
