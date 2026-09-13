import { z } from "zod";
import { experimental_defineHostEntry } from "@get-bb/plugin-sdk/host";
import { batchSchema, hostContract } from "./contracts.js";

/**
 * Runs on the desktop machine (bb.host). Talks raw CDP over the wsEndpoint the
 * server hands it and injects the annotation overlay into the page itself —
 * the whole picker is one self-contained script string, no build artifacts.
 */

const delay = (ms: number) => {
  const { promise, resolve } = Promise.withResolvers<void>();
  setTimeout(resolve, ms);
  return promise;
};

const CONTROL_ENDED = "Browser control ended";

const PAGE_SCRIPT = `
(() => {
  if (window.__bbAnnotateCleanup) window.__bbAnnotateCleanup();

  const NS = "__bbAnnotate";
  const state = {
    items: [],
    captureQueue: [],
    seq: 0,
    lastX: -1,
    lastY: -1,
  };
  window[NS] = state;
  const previousCursor = document.documentElement.style.cursor;

  const css =
    "#__bbAnnBar{position:fixed;top:12px;left:50%;transform:translateX(-50%);z-index:2147483646;" +
    "display:flex;align-items:center;gap:8px;padding:6px 10px 6px 14px;border-radius:999px;" +
    "background:rgba(20,22,28,.96);color:#e8eaf0;font:13px/1.4 -apple-system,Segoe UI,Roboto,sans-serif;" +
    "box-shadow:0 6px 24px rgba(0,0,0,.45);user-select:none}" +
    "#__bbAnnBar .dot{width:8px;height:8px;border-radius:50%;background:#3b82f6;box-shadow:0 0 8px #3b82f6}" +
    "#__bbAnnBar .title{font-weight:600}" +
    "#__bbAnnBar .count{color:#b9bfca;min-width:76px;text-align:center;font-variant-numeric:tabular-nums}" +
    "#__bbAnnBar button{appearance:none;border:0;border-radius:999px;padding:6px 14px;font:600 13px/1 -apple-system,Segoe UI,Roboto,sans-serif;cursor:pointer}" +
    "#__bbAnnBar .send{background:#3b82f6;color:#fff}" +
    "#__bbAnnBar .send:disabled{opacity:.45;cursor:default}" +
    "#__bbAnnBar .cancel{background:transparent;color:#9aa0ad}" +
    "#__bbAnnBar .cancel:hover{color:#fff}" +
    "#__bbAnnTip{position:fixed;z-index:2147483645;pointer-events:none;display:none;background:rgba(20,22,28,.96);color:#e8eaf0;" +
    "font:12px/1.6 -apple-system,Segoe UI,Roboto,sans-serif;padding:6px 10px;border-radius:8px;max-width:70vw;box-shadow:0 4px 16px rgba(0,0,0,.4)}" +
    "#__bbAnnTip b{color:#fff}" +
    "#__bbAnnTip .dim{color:#9aa0ad}" +
    "#__bbAnnBox{position:fixed;z-index:2147483644;pointer-events:none;display:none;border:2px solid #3b82f6;background:rgba(59,130,246,.12);border-radius:4px}" +
    ".__bbAnnOutline{position:fixed;z-index:2147483643;pointer-events:none;border:2px solid #3b82f6;background:rgba(59,130,246,.08);border-radius:4px}" +
    ".__bbAnnPin{position:fixed;z-index:2147483645;width:22px;height:22px;margin:-11px 0 0 -11px;border-radius:50%;" +
    "background:#3b82f6;color:#fff;font:700 12px/22px -apple-system,Segoe UI,Roboto,sans-serif;text-align:center;cursor:pointer;box-shadow:0 2px 8px rgba(0,0,0,.4)}" +
    "#__bbAnnForm{position:fixed;z-index:2147483647;width:320px;background:rgba(24,26,33,.98);border:1px solid rgba(255,255,255,.08);" +
    "border-radius:14px;box-shadow:0 12px 40px rgba(0,0,0,.55);padding:12px;font:13px/1.4 -apple-system,Segoe UI,Roboto,sans-serif;color:#e8eaf0}" +
    "#__bbAnnForm textarea{width:100%;box-sizing:border-box;min-height:64px;resize:vertical;border:1px solid rgba(255,255,255,.12);" +
    "border-radius:8px;background:rgba(255,255,255,.05);color:#fff;padding:8px 10px;font:inherit;outline:none}" +
    "#__bbAnnForm textarea:focus{border-color:#3b82f6}" +
    "#__bbAnnForm .row{display:flex;justify-content:flex-end;gap:8px;margin-top:10px}" +
    "#__bbAnnForm button{appearance:none;border:0;border-radius:8px;padding:7px 14px;font:600 13px/1 -apple-system,Segoe UI,Roboto,sans-serif;cursor:pointer}" +
    "#__bbAnnForm .save{background:#3b82f6;color:#fff}" +
    "#__bbAnnForm .drop{background:transparent;color:#9aa0ad}" +
    "#__bbAnnForm .drop:hover{color:#fff}";

  const style = document.createElement("style");
  style.id = "__bbAnnStyle";
  style.textContent = css;
  document.documentElement.appendChild(style);

  const el = (id, tag, parent) => {
    const node = document.createElement(tag || "div");
    node.id = id;
    (parent || document.documentElement).appendChild(node);
    return node;
  };

  const bar = el("__bbAnnBar");
  bar.innerHTML =
    '<span class="dot"></span><span class="title">Annotate page</span><span class="count">0 annotations</span>' +
    '<button type="button" class="cancel" data-act="cancel">Cancel</button>' +
    '<button type="button" class="send" data-act="send">Send</button>';
  const countEl = bar.querySelector(".count");
  const sendBtn = bar.querySelector('[data-act="send"]');

  const tip = el("__bbAnnTip");
  const box = el("__bbAnnBox");
  const form = el("__bbAnnForm");
  form.style.display = "none";
  form.innerHTML =
    '<textarea placeholder="Comment for the agent…"></textarea>' +
    '<div class="row"><button type="button" class="drop" data-act="drop">Delete</button>' +
    '<button type="button" class="save" data-act="save">Save</button></div>';
  const textarea = form.querySelector("textarea");

  let formTarget = null; // element being annotated, or the annotation being edited
  let formAnnotation = null;

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
    countEl.textContent = state.items.length + (state.items.length === 1 ? " annotation" : " annotations");
    sendBtn.disabled = state.items.length === 0 || state.items.some((item) => item.capturePending);
    sendBtn.textContent = state.items.length > 0 ? "Send " + state.items.length : "Send";
    window.__bbAnnotateCount = state.items.length;
  };

  const hideForm = () => {
    form.style.display = "none";
    formTarget = null;
    formAnnotation = null;
    textarea.value = "";
  };

  const openForm = (element, annotation) => {
    formTarget = element || (annotation && annotation.element) || null;
    formAnnotation = annotation || null;
    textarea.value = annotation ? annotation.comment : "";
    form.style.display = "block";
    const rect = formTarget
      ? formTarget.getBoundingClientRect()
      : { left: annotation.clientX, right: annotation.clientX, top: annotation.clientY, bottom: annotation.clientY };
    const vw = document.documentElement.clientWidth || innerWidth;
    const vh = document.documentElement.clientHeight || innerHeight;
    form.style.left = Math.max(8, Math.min(rect.left, vw - 336)) + "px";
    form.style.top = Math.max(8, Math.min(rect.bottom + 10, vh - 180)) + "px";
    textarea.focus();
  };

  form.addEventListener("click", (event) => {
    const act = event.target && event.target.dataset ? event.target.dataset.act : null;
    if (act === "save") {
      const comment = textarea.value.trim();
      if (!comment) { textarea.focus(); return; }
      if (formAnnotation) {
        formAnnotation.comment = comment;
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
          .replace(/\s+/g, " ")
          .trim()
          .slice(0, 2000) || null;
        const fullText = (formTarget.innerText || formTarget.textContent || "")
          .replace(/\s+/g, " ")
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
          selector: selectorFor(formTarget),
          tag: formTarget.tagName.toLowerCase(),
          classes: formTarget.className && typeof formTarget.className === "string" ? formTarget.className : null,
          text: fullText.slice(0, 4000) || null,
          target,
          targetRole: roleFor(formTarget),
          targetPath: selectorFor(formTarget),
          immediateText: directText,
          nearbyText: ((formTarget.parentElement && (formTarget.parentElement.innerText || formTarget.parentElement.textContent)) || fullText).replace(/\s+/g, " ").trim().slice(0, 4000) || null,
          selectedText,
          nodePosition: { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 },
          theme: matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light",
          metadata,
          rect: { x: rect.x, y: rect.y, width: rect.width, height: rect.height },
          snapshotRect: { x: rect.x, y: rect.y, width: rect.width, height: rect.height },
          element: formTarget,
          clientX: rect.left + rect.width / 2,
          clientY: rect.top,
          capturePending: true,
        };
        state.items.push(item);
        paintPin(item);
        paintOutline(item);
        state.captureQueue.push({ id: item.id });
      }
      syncBar();
      hideForm();
    } else if (act === "drop") {
      if (formAnnotation) {
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
        syncBar();
      }
      hideForm();
    }
  });
  textarea.addEventListener("keydown", (event) => {
    if (event.key === "Escape") { event.stopPropagation(); hideForm(); }
    if ((event.metaKey || event.ctrlKey) && event.key === "Enter") {
      event.stopPropagation();
      form.querySelector('[data-act="save"]').click();
    }
  });

  const refreshOverlay = () => {
    for (const item of state.items) { paintPin(item); paintOutline(item); }
    if (formTarget || formAnnotation || state.lastX < 0) return;
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

  const done = (kind) => {
    window.__bbAnnotateDone = {
      kind,
      batch: {
        url: location.href,
        title: document.title || "",
        viewport: Math.round(window.visualViewport ? window.visualViewport.width : innerWidth) + "x" +
          Math.round(window.visualViewport ? window.visualViewport.height : innerHeight),
        dpr: window.devicePixelRatio || 1,
        annotations: serialize(),
      },
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
    document.removeEventListener("mousemove", onMove, true);
    document.removeEventListener("click", onClick, true);
    document.removeEventListener("keydown", onKey, true);
    window.removeEventListener("scroll", refreshOverlay, true);
    window.removeEventListener("resize", refreshOverlay, true);
    for (const pin of pins.values()) pin.remove();
    pins.clear();
    for (const outline of outlines.values()) outline.remove();
    outlines.clear();
    for (const node of [bar, tip, box, form, style]) node.remove();
    document.documentElement.style.cursor = previousCursor;
    window.__bbAnnotateCleanup = null;
  };

  document.addEventListener("mousemove", onMove, true);
  document.addEventListener("click", onClick, true);
  document.addEventListener("keydown", onKey, true);
  window.addEventListener("scroll", refreshOverlay, true);
  window.addEventListener("resize", refreshOverlay, true);
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
    /**
     * Owns the tab for the whole annotate session: injects the overlay, then
     * polls for Send/Cancel. A long-running handler is fine — the server holds
     * one tab lease per session and aborts us on stop.
     */
    annotateSession: async (input, context) => {
      return withPage(input.wsEndpoint, context.signal, async (connection, sessionId) => {
        try {
          const identityOf = () =>
            evaluate(
              connection,
              sessionId,
              "String(performance.timeOrigin) + '|' + location.href",
            ) as Promise<string>;
          const before = await identityOf();
          await evaluate(
            connection,
            sessionId,
            "window.__bbAnnotateDone = null; window.__bbAnnotateCount = 0; true",
          );
          await evaluate(connection, sessionId, PAGE_SCRIPT);

          // The request traffic keeps the tab lease alive while the user works.
          await connection.request("Page.enable", {}, sessionId).catch(() => undefined);
          const screenshots = new Map<string, Awaited<ReturnType<typeof screenshot>>>();
          const deadline = Date.now() + 25 * 60_000;
          while (Date.now() < deadline) {
            context.signal.throwIfAborted();
            const capture = await evaluate(
              connection,
              sessionId,
              "window.__bbAnnotateTakeCapture ? window.__bbAnnotateTakeCapture() : null",
            );
            if (
              typeof capture === "object" &&
              capture !== null &&
              typeof (capture as { id?: unknown }).id === "string"
            ) {
              const annotationId = (capture as { id: string }).id;
              screenshots.set(annotationId, await screenshot(connection, sessionId));
              await evaluate(
                connection,
                sessionId,
                `window.__bbAnnotateFinishCapture(${JSON.stringify(annotationId)})`,
              );
              continue;
            }
            const result = await evaluate(connection, sessionId, "window.__bbAnnotateDone || null");
            if (result !== null && typeof result === "object") {
              const done = result as { kind: string; batch: unknown };
              if ((await identityOf()) !== before || done.kind === "cancel") {
                return { batch: null, screenshots: [], cancelled: true, count: 0 };
              }
              const batch = batchSchema.parse(done.batch);
              return {
                batch,
                screenshots: batch.annotations.flatMap((annotation) => {
                  const image = screenshots.get(annotation.id);
                  return image ? [{ annotationId: annotation.id, image }] : [];
                }),
                cancelled: false,
                count: batch.annotations.length,
              };
            }
            await delay(250);
          }
          return { batch: null, screenshots: [], cancelled: true, count: 0 };
        } finally {
          await evaluate(
            connection,
            sessionId,
            "window.__bbAnnotateCleanup && window.__bbAnnotateCleanup(); true",
          ).catch(() => undefined);
        }
      });
    },
  },
});
