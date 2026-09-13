import { z } from "zod";
import { experimental_defineHostEntry } from "@get-bb/plugin-sdk/host";
import { batchSchema, editorDraftSchema, hostContract } from "./contracts.js";

/**
 * Runs on the desktop machine (bb.host). Talks raw CDP over the wsEndpoint the
 * server hands it and injects only untrusted-page selection evidence, markers,
 * and design previews. Trusted comment/edit/send UI stays in the BB renderer.
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
    startUrl: location.href,
    editor: null,
    editorPreviewRevision: 0,
    captureFailed: false,
    lastX: -1,
    lastY: -1,
  };
  const restoreBatch = window.__bbAnnotateRestoreBatch || null;
  const shouldRestore = Boolean(
    restoreBatch && restoreBatch.url === location.href && Array.isArray(restoreBatch.annotations),
  );
  window.__bbAnnotateRestoreBatch = null;
  window[NS] = state;
  const previousCursor = document.documentElement.style.cursor;
  const rootHost = document.createElement("div");
  rootHost.id = "__bbAnnRoot";
  rootHost.style.cssText = "position:fixed;inset:0;z-index:2147483647;pointer-events:none";
  document.documentElement.appendChild(rootHost);
  const uiRoot = rootHost.attachShadow({ mode: "closed" });

  const css =
    ":host{all:initial}" +
    "#__bbAnnTip{position:fixed;z-index:2147483645;pointer-events:none;display:none;background:rgba(20,22,28,.96);color:#e8eaf0;" +
    "font:12px/1.6 -apple-system,Segoe UI,Roboto,sans-serif;padding:6px 10px;border-radius:8px;max-width:70vw;box-shadow:0 4px 16px rgba(0,0,0,.4)}" +
    "#__bbAnnTip b{color:#fff}" +
    "#__bbAnnTip .dim{color:#9aa0ad}" +
    "#__bbAnnBox{position:fixed;z-index:2147483644;pointer-events:none;display:none;border:2px solid #3b82f6;background:rgba(59,130,246,.12);border-radius:4px}" +
    ".__bbAnnOutline{position:fixed;z-index:2147483643;pointer-events:none;border:2px solid #3b82f6;background:rgba(59,130,246,.08);border-radius:4px}" +
    ".__bbAnnPin{position:fixed;z-index:2147483645;pointer-events:auto;width:22px;height:22px;margin:-11px 0 0 -11px;border-radius:50%;" +
    "background:#3b82f6;color:#fff;font:700 12px/22px -apple-system,Segoe UI,Roboto,sans-serif;text-align:center;cursor:pointer;box-shadow:0 2px 8px rgba(0,0,0,.4)}";

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
  let applyingPreview = false;
  let previewGuardTimer = 0;

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
    if (node) node.nodeValue = value;
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
    if (!designStyle.isConnected) return;
    applyingPreview = true;
    window.clearTimeout(previewGuardTimer);
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
    previewGuardTimer = window.setTimeout(() => { applyingPreview = false; }, 0);
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

  const syncBar = () => {
    window.__bbAnnotateCount = state.items.length;
  };

  const bumpRevision = () => { state.revision += 1; };

  const queueCapture = (item) => {
    state.captureQueue = state.captureQueue.filter((capture) => capture.id !== item.id);
    item.version = (item.version || 0) + 1;
    item.capturePending = true;
    state.captureFailed = false;
    state.captureQueue.push({ id: item.id, version: item.version, retryAt: 0 });
  };

  const removeItem = (item) => {
    restoreDesignText(item);
    state.items = state.items.filter((candidate) => candidate.id !== item.id);
    dropPin(item.id);
    dropOutline(item.id);
    state.captureQueue = [];
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
    syncBar();
  };

  const hideForm = () => {
    restoreDesignText(formDraft);
    formTarget = null;
    formAnnotation = null;
    formDraft = null;
    formPendingItem = null;
    state.editor = null;
    state.editorPreviewRevision = 0;
    renderDesignPreview();
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
      .replace(/\s+/g, " ")
      .trim()
      .slice(0, 2000) || null;
    const fullText = (element.innerText || element.textContent || "")
      .replace(/\s+/g, " ")
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
      metadata[attribute.name] = attribute.value.slice(0, 1000);
    }
    return {
      id: "ann_" + Date.now().toString(36) + "_" + (++state.seq),
      version: 0,
      seq: state.items.length + 1,
      kind: "element",
      comment: "",
      designChange: null,
      selector: selectorFor(element),
      tag: element.tagName.toLowerCase(),
      classes: element.className && typeof element.className === "string" ? element.className : null,
      text: fullText.slice(0, 4000) || null,
      target,
      targetRole: roleFor(element),
      targetPath: selectorFor(element),
      immediateText: directText,
      nearbyText: ((element.parentElement && (element.parentElement.innerText || element.parentElement.textContent)) || fullText).replace(/\s+/g, " ").trim().slice(0, 4000) || null,
      selectedText,
      nodePosition: { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 },
      theme: matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light",
      metadata,
      rect: { x: rect.x, y: rect.y, width: rect.width, height: rect.height },
      snapshotRect: { x: rect.x, y: rect.y, width: rect.width, height: rect.height },
      element,
      clientX: rect.left + rect.width / 2,
      clientY: rect.top,
      capturePending: false,
    };
  };

  const openTrustedEditor = (element, annotation) => {
    if (!annotation && state.items.length >= 50) return false;
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
      annotationId: annotation ? annotation.id : null,
      tag: formTarget.tagName.toLowerCase(),
      target: annotation ? annotation.target : formPendingItem.target,
      comment: annotation ? annotation.comment : "",
      designChange: formDraft.designChange,
    };
    renderDesignPreview();
    hideHover();
    return true;
  };

  const refreshOverlay = () => {
    for (const item of state.items) { paintPin(item); paintOutline(item); }
    if (state.editor) return;
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
    if (state.editor) {
      hideForm();
      return;
    }
    const node = event.target instanceof Element ? event.target : null;
    if (!node || isRoot(node)) return;
    hideHover();
    openTrustedEditor(node, null);
  };

  const onKey = (event) => {
    if (event.key === "Escape" && state.editor) {
      event.preventDefault();
      hideForm();
    } else if (event.key === "Escape") {
      event.preventDefault();
      finish("cancel");
    }
  };

  const commitTrustedEditor = (editorId, comment, designChange) => {
    if (!state.editor || state.editor.id !== editorId || !formTarget || !formDraft) return false;
    const trustedComment = String(comment || "").trim().slice(0, 4000);
    if (!trustedComment && !designChange) return false;
    const item = formAnnotation || formPendingItem;
    if (!item) return false;
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
    bumpRevision();
    syncBar();
    hideForm();
    return true;
  };

  const serialize = () => state.items.map((item) => {
    paintPin(item);
    return {
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
  });

  const serializedBatch = () => ({
    url: state.startUrl,
    title: document.title || "",
    viewport: Math.round(window.visualViewport ? window.visualViewport.width : innerWidth) + "x" +
      Math.round(window.visualViewport ? window.visualViewport.height : innerHeight),
    dpr: window.devicePixelRatio || 1,
    annotations: serialize(),
  });

  window.__bbAnnotateRead = () => ({
    revision: state.revision,
    currentUrl: location.href,
    batch: serializedBatch(),
    editor: state.editor,
    captureFailed: state.captureFailed,
  });
  window.__bbAnnotatePreview = (editorId, previewRevision, designChange) => {
    if (
      !state.editor ||
      state.editor.id !== editorId ||
      !formDraft ||
      previewRevision <= state.editorPreviewRevision
    ) return false;
    state.editorPreviewRevision = previewRevision;
    formDraft.designChange = designChange;
    state.editor.designChange = designChange;
    renderDesignPreview();
    requestAnimationFrame(refreshOverlay);
    return true;
  };
  window.__bbAnnotateCommit = commitTrustedEditor;
  window.__bbAnnotateCancelEditor = (editorId) => {
    if (!state.editor || state.editor.id !== editorId) return false;
    hideForm();
    return true;
  };
  window.__bbAnnotateMutate = (annotationId, action) => {
    const item = state.items.find((candidate) => candidate.id === annotationId);
    if (!item) return false;
    if (action === "open") {
      hideHover();
      const element = item.element && item.element.isConnected ? item.element : null;
      if (element) element.scrollIntoView({ block: "center", inline: "nearest" });
      return openTrustedEditor(element, item);
    } else if (action === "delete") {
      removeItem(item);
      if (formAnnotation && formAnnotation.id === item.id) hideForm();
      return true;
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
    cleanup();
  };
  const finish = (kind) => { if (!window.__bbAnnotateDone) done(kind); };

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
    designStyle.remove();
    rootHost.remove();
    document.documentElement.style.cursor = previousCursor;
    window.__bbAnnotateCleanup = null;
    window.__bbAnnotateRead = null;
    window.__bbAnnotateMutate = null;
    window.__bbAnnotatePreview = null;
    window.__bbAnnotateCommit = null;
    window.__bbAnnotateCancelEditor = null;
    window.__bbAnnotateTakeCapture = null;
    window.__bbAnnotateFinishCapture = null;
    window.__bbAnnotateRequeueCapture = null;
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
        capturePending: false,
      };
    });
    state.seq = state.items.length;
    state.revision = state.items.length > 0 ? 1 : 0;
    for (const item of state.items) {
      paintPin(item);
      paintOutline(item);
      queueCapture(item);
    }
    renderDesignPreview();
  }
  document.documentElement.style.cursor = "crosshair";
  syncBar();
  window.__bbAnnotateCleanup = cleanup;
  window.__bbAnnotateTakeCapture = () => {
    const next = state.captureQueue[0];
    if (!next || next.retryAt > Date.now()) return null;
    return state.captureQueue.shift();
  };
  window.__bbAnnotateRequeueCapture = (id, version) => {
    const item = state.items.find((candidate) => candidate.id === id);
    if (!item || item.version !== version) return false;
    state.captureFailed = true;
    if (!state.captureQueue.some((capture) => capture.id === id && capture.version === version)) {
      state.captureQueue.unshift({ id, version, retryAt: Date.now() + 750 });
    }
    return true;
  };
  window.__bbAnnotateFinishCapture = (id, version) => {
    const item = state.items.find((candidate) => candidate.id === id);
    if (item && item.version === version) item.capturePending = false;
    state.captureFailed = false;
    syncBar();
    return true;
  };
  return { currentUrl: location.href, restored: shouldRestore };
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
  run: (connection: Connection, sessionId: string, contextId: number) => Promise<T>,
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
    const frameId = z
      .object({ frameTree: z.object({ frame: z.object({ id: z.string() }) }) })
      .parse(await connection.request("Page.getFrameTree", {}, sessionId)).frameTree.frame.id;
    const contextId = z
      .object({ executionContextId: z.number().int().positive() })
      .parse(
        await connection.request(
          "Page.createIsolatedWorld",
          {
            frameId,
            worldName: "bb-browser-annotate",
            grantUniveralAccess: false,
          },
          sessionId,
        ),
      ).executionContextId;
    return await run(connection, sessionId, contextId);
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
  contextId: number,
  expression: string,
): Promise<unknown> {
  const response = (await connection.request(
    "Runtime.evaluate",
    { expression, contextId, returnByValue: true, awaitPromise: true },
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
  contextId: number,
): Promise<{
  base64: string;
  width: number;
  height: number;
  mimeType: "image/jpeg";
}> {
  const dpr = (await evaluate(
    connection,
    sessionId,
    contextId,
    "window.devicePixelRatio || 1",
  )) as number;
  const viewport = (await evaluate(
    connection,
    sessionId,
    contextId,
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

async function drainCaptures(
  connection: Connection,
  sessionId: string,
  contextId: number,
): Promise<{
  captures: Array<{
    annotationId: string;
    version: number;
    image: Awaited<ReturnType<typeof screenshot>>;
  }>;
  captureFailed: boolean;
}> {
  const captures: Array<{
    annotationId: string;
    version: number;
    image: Awaited<ReturnType<typeof screenshot>>;
  }> = [];
  for (let index = 0; index < 50; index += 1) {
    const raw = await evaluate(
      connection,
      sessionId,
      contextId,
      "window.__bbAnnotateTakeCapture ? window.__bbAnnotateTakeCapture() : null",
    );
    const capture = z
      .object({ id: z.string().min(1), version: z.number().int().positive() })
      .nullable()
      .parse(raw);
    if (!capture) break;
    try {
      await connection.request("Page.enable", {}, sessionId).catch(() => undefined);
      const image = await screenshot(connection, sessionId, contextId);
      await evaluate(
        connection,
        sessionId,
        contextId,
        `window.__bbAnnotateFinishCapture && window.__bbAnnotateFinishCapture(${JSON.stringify(capture.id)}, ${capture.version})`,
      );
      captures.push({ annotationId: capture.id, version: capture.version, image });
    } catch {
      await evaluate(
        connection,
        sessionId,
        contextId,
        `window.__bbAnnotateRequeueCapture && window.__bbAnnotateRequeueCapture(${JSON.stringify(capture.id)}, ${capture.version})`,
      ).catch(() => undefined);
      return { captures, captureFailed: true };
    }
  }
  return { captures, captureFailed: false };
}

export default experimental_defineHostEntry({
  contract: hostContract,
  handlers: {
    startSession: async (input, context) => {
      return withPage(input.wsEndpoint, context.signal, async (connection, sessionId, contextId) => {
        await evaluate(
          connection,
          sessionId,
          contextId,
          `window.__bbAnnotateDone = null; window.__bbAnnotateCount = 0; window.__bbAnnotateRestoreBatch = ${JSON.stringify(input.batch)}; true`,
        );
        const result = z
          .object({ currentUrl: z.string(), restored: z.boolean() })
          .parse(await evaluate(connection, sessionId, contextId, PAGE_SCRIPT));
        return { started: true as const, ...result };
      });
    },
    readSession: async (input, context) => {
      return withPage(input.wsEndpoint, context.signal, async (connection, sessionId, contextId) => {
        const doneRaw = await evaluate(
          connection,
          sessionId,
          contextId,
          "window.__bbAnnotateDone || null",
        );
        if (doneRaw !== null && typeof doneRaw === "object") {
          const done = doneRaw as { kind?: unknown; batch?: unknown };
          if (done.kind === "cancel") {
            return {
              status: "cancelled" as const,
              revision: Math.max(0, input.afterRevision),
              currentUrl: String(
                await evaluate(connection, sessionId, contextId, "location.href"),
              ),
              batch: null,
              editor: null,
              captureFailed: false,
              captures: [],
            };
          }
        }
        const raw = await evaluate(
          connection,
          sessionId,
          contextId,
          "window.__bbAnnotateRead ? window.__bbAnnotateRead() : null",
        );
        if (raw === null || typeof raw !== "object") {
          return {
            status: "missing" as const,
            revision: Math.max(0, input.afterRevision),
            currentUrl: String(
              await evaluate(connection, sessionId, contextId, "location.href"),
            ),
            batch: null,
            editor: null,
            captureFailed: false,
            captures: [],
          };
        }
        const value = z
          .object({
            revision: z.number().int().min(0),
            currentUrl: z.string(),
            batch: batchSchema,
            editor: editorDraftSchema.nullable(),
            captureFailed: z.boolean(),
          })
          .parse(raw);
        const captureResult = await drainCaptures(connection, sessionId, contextId);
        return {
          status: value.currentUrl === value.batch.url ? "active" as const : "navigated" as const,
          revision: value.revision,
          currentUrl: value.currentUrl,
          batch: value.batch,
          editor: value.editor,
          captureFailed: value.captureFailed || captureResult.captureFailed,
          captures: captureResult.captures,
        };
      });
    },
    mutateSession: async (input, context) => {
      return withPage(input.wsEndpoint, context.signal, async (connection, sessionId, contextId) => ({
        changed: Boolean(
          await evaluate(
            connection,
            sessionId,
            contextId,
            `window.__bbAnnotateMutate ? window.__bbAnnotateMutate(${JSON.stringify(input.annotationId)}, ${JSON.stringify(input.action)}) : false`,
          ),
        ),
      }));
    },
    previewEditor: async (input, context) => {
      return withPage(input.wsEndpoint, context.signal, async (connection, sessionId, contextId) => ({
        changed: Boolean(
          await evaluate(
            connection,
            sessionId,
            contextId,
            `window.__bbAnnotatePreview ? window.__bbAnnotatePreview(${JSON.stringify(input.editorId)}, ${input.previewRevision}, ${JSON.stringify(input.designChange)}) : false`,
          ),
        ),
      }));
    },
    saveEditor: async (input, context) => {
      return withPage(input.wsEndpoint, context.signal, async (connection, sessionId, contextId) => {
        const saved = Boolean(
          await evaluate(
            connection,
            sessionId,
            contextId,
            `window.__bbAnnotateCommit ? window.__bbAnnotateCommit(${JSON.stringify(input.editorId)}, ${JSON.stringify(input.comment)}, ${JSON.stringify(input.designChange)}) : false`,
          ),
        );
        if (!saved) {
          return {
            saved: false,
            revision: 0,
            batch: null,
            captures: [],
            captureFailed: false,
          };
        }
        const value = z
          .object({ revision: z.number().int().min(0), batch: batchSchema })
          .parse(
            await evaluate(
              connection,
              sessionId,
              contextId,
              "window.__bbAnnotateRead ? window.__bbAnnotateRead() : null",
            ),
          );
        const captureResult = await drainCaptures(connection, sessionId, contextId);
        return {
          saved: true,
          revision: value.revision,
          batch: value.batch,
          captures: captureResult.captures,
          captureFailed: captureResult.captureFailed,
        };
      });
    },
    cancelEditor: async (input, context) => {
      return withPage(input.wsEndpoint, context.signal, async (connection, sessionId, contextId) => ({
        changed: Boolean(
          await evaluate(
            connection,
            sessionId,
            contextId,
            `window.__bbAnnotateCancelEditor ? window.__bbAnnotateCancelEditor(${JSON.stringify(input.editorId)}) : false`,
          ),
        ),
      }));
    },
    cleanupSession: async (input, context) => {
      return withPage(input.wsEndpoint, context.signal, async (connection, sessionId, contextId) => {
        await evaluate(
          connection,
          sessionId,
          contextId,
          "window.__bbAnnotateCleanup && window.__bbAnnotateCleanup(); true",
        ).catch(() => undefined);
        return { cleaned: true as const };
      });
    },
  },
});
