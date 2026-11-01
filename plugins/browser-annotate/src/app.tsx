import { useCallback, useEffect, useId, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import {
  definePluginApp,
  experimental_usePluginId,
  useComposer,
  useRealtime,
  useRealtimeConnectionState,
  useRpc,
  type ExperimentalPluginBrowserPage,
  type ExperimentalPluginBrowserToolbarActionProps,
  type JsonValue,
} from "@get-bb/plugin-sdk/app";
import {
  batchSchema,
  editorDraftSchema,
  reactComponentSchema,
  type DesignChange,
  type EditorDraft,
  type LiveAnnotation,
  type rpcContract,
} from "./contracts.js";
import { planMentionReconciliation, removeMentionsFromDraft } from "./composer.js";
import {
  activateExpression,
  pageCalls,
  reactProbeExpression,
  type PageState,
  type PageTheme,
} from "./page-script.js";
import { z } from "zod";

type SessionEvent = {
  threadId?: string;
  status?: "sent";
  count?: number;
  batchId?: string;
};

const MENTION_PROVIDER = "browser-comments";

/**
 * Live page sessions by thread, so the composer hover card can edit or delete
 * annotations that are still on the page.
 */
type LiveSession = {
  batchId: string;
  open(annotationId: string): Promise<boolean>;
  remove(annotationId: string): Promise<boolean>;
};
const liveSessions = new Map<string, LiveSession>();
const liveSessionListeners = new Set<() => void>();
function setLiveSession(threadId: string, session: LiveSession | null) {
  if (session) liveSessions.set(threadId, session);
  else liveSessions.delete(threadId);
  for (const listener of liveSessionListeners) listener();
}

/** Dashed element box with a pointer: "pick something on the page". */
const annotateIcon = (
  <svg
    aria-hidden
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="1.8"
    strokeLinecap="round"
    strokeLinejoin="round"
    className="size-4"
  >
    <path d="M14 3.5H6A2.5 2.5 0 0 0 3.5 6v8a2.5 2.5 0 0 0 2.5 2.5h3" strokeDasharray="2.6 2.6" />
    <path d="M17.5 9.5V6A2.5 2.5 0 0 0 15 3.5" strokeDasharray="2.6 2.6" />
    <path d="m12.2 12.2 8.6 3.1-3.7 1.6-1.6 3.7z" fill="currentColor" />
  </svg>
);

const pageStateSchema = z
  .object({
    active: z.boolean(),
    count: z.number().int().min(0),
    revision: z.number().int().min(0),
    url: z.string(),
    startUrl: z.string(),
  })
  .passthrough();
const commitResultSchema = z.object({ annotationId: z.string().min(1) }).nullable();
const probeResultSchema = z
  .object({ components: z.array(reactComponentSchema).max(12) })
  .nullable();
const pageMessageSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("editor"), editor: editorDraftSchema }),
  z.object({ type: z.literal("editor-closed"), editorId: z.string() }),
  z.object({ type: z.literal("changed"), revision: z.number() }),
  z.object({ type: z.literal("cancel") }),
]);

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

function errorText(error: unknown, fallback: string) {
  return error instanceof Error ? error.message : typeof error === "string" ? error : fallback;
}

function readTheme(): PageTheme | null {
  if (typeof document === "undefined" || typeof CSS === "undefined") return null;
  const computed = getComputedStyle(document.documentElement);
  const color = (name: string, fallback: string) => {
    const value = computed.getPropertyValue(name).trim();
    return value && CSS.supports("color", value) ? value : fallback;
  };
  return {
    surface: color("--popover", "rgba(20,22,28,.96)"),
    text: color("--popover-foreground", "#e8eaf0"),
    muted: color("--muted-foreground", "#9aa0ad"),
    accent: "#3b82f6",
  };
}

const designGroups = [
  { title: "Content", properties: ["text", "color", "background-color", "opacity"] },
  { title: "Typography", properties: ["font-family", "font-size", "font-weight"] },
  { title: "Border", properties: ["border-radius", "border-color", "border-width"] },
  { title: "Dimensions", properties: ["width", "height"] },
  { title: "Padding", properties: ["padding-top", "padding-right", "padding-bottom", "padding-left"] },
  { title: "Margin", properties: ["margin-top", "margin-right", "margin-bottom", "margin-left"] },
  { title: "Flex layout", properties: ["flex-direction", "justify-content", "align-items", "gap", "row-gap", "column-gap"] },
] as const;

const designLabels: Record<string, string> = {
  text: "Text",
  color: "Text color",
  "background-color": "Background",
  opacity: "Opacity",
  "font-family": "Font",
  "font-size": "Font size",
  "font-weight": "Font weight",
  "border-radius": "Border radius",
  "border-color": "Border color",
  "border-width": "Border width",
  width: "Width",
  height: "Height",
  "padding-top": "Padding top",
  "padding-right": "Padding right",
  "padding-bottom": "Padding bottom",
  "padding-left": "Padding left",
  "margin-top": "Margin top",
  "margin-right": "Margin right",
  "margin-bottom": "Margin bottom",
  "margin-left": "Margin left",
  "flex-direction": "Direction",
  "justify-content": "Distribution",
  "align-items": "Alignment",
  gap: "Spacing",
  "row-gap": "Vertical gap",
  "column-gap": "Horizontal gap",
};

const selectValues: Record<string, string[]> = {
  "font-weight": ["100", "200", "300", "400", "500", "600", "700", "800", "900"],
  "flex-direction": ["row", "row-reverse", "column", "column-reverse"],
  "justify-content": ["flex-start", "center", "flex-end", "space-between", "space-around", "space-evenly"],
  "align-items": ["flex-start", "center", "flex-end", "stretch", "baseline"],
};

const pixelProperties = new Set([
  "font-size", "border-radius", "border-width", "width", "height",
  "padding-top", "padding-right", "padding-bottom", "padding-left",
  "margin-top", "margin-right", "margin-bottom", "margin-left", "gap", "row-gap", "column-gap",
]);
const colorProperties = new Set(["color", "background-color", "border-color"]);

function numericValue(value: string) {
  const number = Number.parseFloat(value);
  return Number.isFinite(number) ? String(Math.round(number * 100) / 100) : "0";
}

function rgbToHex(value: string) {
  const match = value.match(/^rgba?\(\s*(\d+)\D+(\d+)\D+(\d+)/i);
  if (!match) return /^#[0-9a-f]{6}$/i.test(value) ? value : "#000000";
  return `#${[match[1], match[2], match[3]]
    .map((part) => Math.max(0, Math.min(255, Number(part))).toString(16).padStart(2, "0"))
    .join("")}`;
}

function changedDesign(design: DesignChange): DesignChange | null {
  const declarations = design.declarations.filter((change) => change.value !== change.previousValue);
  const text = design.text && design.text.value !== design.text.previousValue
    ? { ...design.text }
    : null;
  return declarations.length > 0 || text ? { declarations, text } : null;
}

function DesignEditor({
  design,
  onChange,
}: {
  design: DesignChange;
  onChange: (design: DesignChange) => void;
}) {
  const declarationMap = new Map(
    design.declarations.map((declaration) => [declaration.property, declaration]),
  );
  const updateText = (value: string) => {
    if (!design.text) return;
    onChange({ ...design, text: { ...design.text, value: value.slice(0, 4000) } });
  };
  const updateDeclaration = (property: string, value: string) => {
    onChange({
      ...design,
      declarations: design.declarations.map((declaration) =>
        declaration.property === property
          ? { ...declaration, value: value.slice(0, 1000) }
          : declaration,
      ),
    });
  };
  const reset = () => onChange({
    text: design.text ? { ...design.text, value: design.text.previousValue } : null,
    declarations: design.declarations.map((declaration) => ({
      ...declaration,
      value: declaration.previousValue,
    })),
  });

  return (
    <div className="min-h-0 overflow-y-auto px-3 pb-2" style={{ maxHeight: 240 }}>
      {changedDesign(design) ? <div className="flex justify-end">
        <button
          type="button"
          className="rounded-md px-2 py-1 text-xs text-muted-foreground hover:bg-state-hover hover:text-foreground"
          onClick={reset}
        >
          Reset all
        </button>
      </div> : null}
      {designGroups.map((group) => {
        const properties = group.properties.filter((property) =>
          property === "text" ? Boolean(design.text) : declarationMap.has(property),
        );
        if (properties.length === 0) return null;
        return (
          <section key={group.title} className="border-b border-border py-2 last:border-b-0">
            {group.title !== "Content" ? <h3 className="mb-1 text-[11px] font-medium text-muted-foreground">{group.title}</h3> : null}
            <div className="space-y-1">
              {properties.map((property) => {
                const value = property === "text"
                  ? design.text?.value ?? ""
                  : declarationMap.get(property)?.value ?? "";
                const setValue = (next: string) => {
                  if (property === "text") updateText(next);
                  else updateDeclaration(property, next);
                };
                const options = selectValues[property];
                return (
                  <label
                    key={property}
                    className="grid min-h-8 grid-cols-[minmax(0,1fr)_minmax(0,1.15fr)] items-center gap-2 text-xs"
                  >
                    <span className="truncate text-muted-foreground">{designLabels[property]}</span>
                    {property === "text" ? (
                      <textarea
                        value={value}
                        rows={1}
                        maxLength={4000}
                        className="min-w-0 resize-none overflow-x-hidden overflow-y-auto whitespace-pre rounded-md border border-border bg-transparent px-2 py-1 leading-4 text-foreground [field-sizing:content] [block-size:1.75rem] [min-block-size:1.75rem] [max-block-size:1.75rem] focus:whitespace-pre-wrap focus:[overflow-wrap:anywhere] focus:[block-size:auto] focus:[max-block-size:calc(3lh+0.5rem+2px)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-ring"
                        onChange={(event) => setValue(event.target.value)}
                      />
                    ) : colorProperties.has(property) ? (
                      <span className="grid grid-cols-[2rem_minmax(0,1fr)] gap-1.5">
                        <input
                          type="color"
                          value={rgbToHex(value)}
                          aria-label={`${designLabels[property]} picker`}
                          className="h-7 w-8 cursor-pointer rounded-md border border-border bg-transparent p-1"
                          onChange={(event) => setValue(event.target.value)}
                        />
                        <input
                          value={value}
                          className="h-7 min-w-0 rounded-md border border-border bg-transparent px-2 text-foreground outline-none focus:border-ring"
                          onChange={(event) => setValue(event.target.value)}
                        />
                      </span>
                    ) : options ? (
                      <select
                        value={value}
                        className="h-7 min-w-0 rounded-md border border-border bg-transparent px-2 text-foreground outline-none focus:border-ring"
                        onChange={(event) => setValue(event.target.value)}
                      >
                        {!options.includes(value) ? <option value={value}>{value}</option> : null}
                        {options.map((option) => <option key={option}>{option}</option>)}
                      </select>
                    ) : (
                      <input
                        type={property === "opacity" || pixelProperties.has(property) ? "number" : "text"}
                        min={property === "opacity" ? 0 : undefined}
                        max={property === "opacity" ? 1 : undefined}
                        step={property === "opacity" ? 0.05 : pixelProperties.has(property) ? 1 : undefined}
                        value={property === "opacity" || pixelProperties.has(property) ? numericValue(value) : value}
                        className="h-7 min-w-0 rounded-md border border-border bg-transparent px-2 text-foreground outline-none focus:border-ring"
                        onChange={(event) => {
                          const next = event.target.value;
                          setValue(pixelProperties.has(property) ? `${next || "0"}px` : next);
                        }}
                      />
                    )}
                  </label>
                );
              })}
            </div>
          </section>
        );
      })}
    </div>
  );
}

function findBrowserNavigation(element: Element | null): Element | null {
  while (element) {
    const navigation = element.closest('[aria-label="Browser navigation"]');
    if (navigation) return navigation;
    const root = element.getRootNode();
    element = root instanceof ShadowRoot ? root.host : null;
  }
  return null;
}

function LoadingLabel({ children }: { children: React.ReactNode }) {
  return <span role="status" className="inline-flex items-center gap-1.5">
    <svg aria-hidden viewBox="0 0 16 16" className="size-3.5 shrink-0 motion-safe:animate-spin" fill="none">
      <circle cx="8" cy="8" r="6" stroke="currentColor" strokeWidth="2" opacity="0.25" />
      <path d="M8 2a6 6 0 0 1 6 6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
    </svg>
    {children}
  </span>;
}

function BrowserAnnotateAction({
  threadId,
  tabId,
  url,
  experimental_page: page,
}: ExperimentalPluginBrowserToolbarActionProps) {
  const tooltipId = useId();
  const rpc = useRpc<typeof rpcContract>();
  const commentRef = useRef<HTMLTextAreaElement | null>(null);
  const buttonRef = useRef<HTMLButtonElement | null>(null);
  const pageRef = useRef<ExperimentalPluginBrowserPage | null>(page);
  pageRef.current = page;
  const activeRef = useRef(false);
  const batchIdRef = useRef<string | null>(null);
  const startUrlRef = useRef<string | null>(null);
  const activatingRef = useRef<Promise<void> | null>(null);
  const syncTailRef = useRef<Promise<void>>(Promise.resolve());
  const syncQueuedRef = useRef(false);
  const previewRevisionRef = useRef(0);
  const [active, setActive] = useState(false);
  const [count, setCount] = useState(0);
  const [editor, setEditor] = useState<EditorDraft | null>(null);
  const [comment, setComment] = useState("");
  const [design, setDesign] = useState<DesignChange | null>(null);
  const [expanded, setExpanded] = useState(false);
  const [pendingAction, setPendingAction] = useState<string | null>(null);
  const [capturing, setCapturing] = useState(false);
  const [missingCaptures, setMissingCaptures] = useState(0);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [toolbarContainer, setToolbarContainer] = useState<HTMLDivElement | null>(null);
  const busy = pendingAction !== null;

  const evaluate = useCallback(async (expression: string, world?: "main") => {
    const current = pageRef.current;
    if (!current) throw new Error("Annotate works in Browser tabs of the desktop app");
    return current.evaluate(expression, world ? { world } : undefined);
  }, []);

  const closeEditor = useCallback(() => {
    setEditor(null);
    setExpanded(false);
    setComment("");
    setDesign(null);
  }, []);

  /** Push the page's annotations to the server and screenshot new versions. */
  const runSync = useCallback(async () => {
    const batchId = batchIdRef.current;
    if (!batchId) return;
    const raw = await evaluate(pageCalls.snapshot());
    if (raw === null) return;
    const batch = batchSchema.parse(raw);
    setCount(batch.annotations.length);
    const { missingCaptures: missing } = await rpc.call("sync", { threadId, batchId, batch });
    setMissingCaptures(missing.length);
    if (missing.length === 0) return;
    setCapturing(true);
    try {
      // Let the page repaint markers after the editor strip collapses.
      await sleep(160);
      await evaluate(pageCalls.setCapturing(true));
      const { captured } = await rpc.call("capture", { threadId, tabId, batchId, annotations: missing });
      setMissingCaptures(missing.length - captured.length);
    } finally {
      await evaluate(pageCalls.setCapturing(false)).catch(() => undefined);
      setCapturing(false);
    }
  }, [evaluate, rpc, tabId, threadId]);

  const scheduleSync = useCallback(() => {
    if (syncQueuedRef.current) return syncTailRef.current;
    syncQueuedRef.current = true;
    const next = syncTailRef.current
      .catch(() => undefined)
      .then(async () => {
        syncQueuedRef.current = false;
        await runSync();
      })
      .catch((error: unknown) => {
        setErrorMessage(errorText(error, "Could not save annotations"));
      });
    syncTailRef.current = next;
    return next;
  }, [runSync]);

  const deactivatePage = useCallback(async () => {
    activeRef.current = false;
    setActive(false);
    closeEditor();
    await evaluate(pageCalls.cleanup()).catch(() => undefined);
  }, [closeEditor, evaluate]);

  const activate = useCallback(async (pageUrl: string) => {
    if (activatingRef.current) return activatingRef.current;
    const run = (async () => {
      const { batchId, batch } = await rpc.call("start", { threadId, url: pageUrl });
      if (!pageRef.current) return;
      const state = pageStateSchema.extend({ restored: z.boolean() }).parse(
        await evaluate(activateExpression({ restore: batch, theme: readTheme() })),
      );
      // A restore that missed (redirect, different document) must not overwrite
      // the stored draft with an empty page.
      batchIdRef.current = batch && !state.restored
        ? `batch_${Date.now().toString(36)}_${crypto.randomUUID()}`
        : batchId;
      startUrlRef.current = state.startUrl;
      activeRef.current = true;
      setActive(true);
      setCount(state.count);
      setErrorMessage(null);
      if (state.restored) void scheduleSync();
    })();
    activatingRef.current = run;
    try {
      await run;
    } finally {
      activatingRef.current = null;
    }
  }, [evaluate, rpc, scheduleSync, threadId]);

  // Page messages: selection opened the editor, page closed it, batch changed, Escape.
  useEffect(() => {
    if (!page) return;
    return page.onMessage((data: JsonValue) => {
      const parsed = pageMessageSchema.safeParse(data);
      if (!parsed.success || !activeRef.current) return;
      const message = parsed.data;
      if (message.type === "editor") {
        previewRevisionRef.current = 0;
        setEditor(message.editor);
        setComment(message.editor.comment);
        setDesign(message.editor.designChange);
        setExpanded(false);
        setErrorMessage(null);
      } else if (message.type === "editor-closed") {
        setEditor((current) => (current?.id === message.editorId ? null : current));
      } else if (message.type === "changed") {
        void scheduleSync();
      } else if (message.type === "cancel") {
        activeRef.current = false;
        setActive(false);
        closeEditor();
      }
    });
  }, [closeEditor, page, scheduleSync]);

  // Reload or navigation drops the page script; restore the draft for the new document.
  useEffect(() => {
    if (!active || !page) return;
    let stopped = false;
    const check = async () => {
      if (stopped || activatingRef.current) return;
      try {
        const raw = await evaluate(pageCalls.state());
        if (stopped || !activeRef.current) return;
        const state = raw === null ? null : pageStateSchema.parse(raw as PageState);
        if (state && state.url === state.startUrl) return;
        closeEditor();
        if (state) await evaluate(pageCalls.cleanup()).catch(() => undefined);
        await syncTailRef.current.catch(() => undefined);
        await activate(state?.url ?? url);
      } catch (error) {
        if (!stopped) setErrorMessage(errorText(error, "Could not reach the page"));
      }
    };
    void check();
    const timer = window.setInterval(() => void check(), 1000);
    return () => {
      stopped = true;
      window.clearInterval(timer);
    };
  }, [activate, active, closeEditor, evaluate, page, url]);

  // Leaving the tab or thread turns the picker off; the draft stays stored.
  useEffect(() => () => {
    if (activeRef.current) {
      activeRef.current = false;
      void pageRef.current?.evaluate(pageCalls.cleanup()).catch(() => undefined);
    }
  }, []);

  useEffect(() => {
    if (!active || !batchIdRef.current) return;
    const batchId = batchIdRef.current;
    setLiveSession(threadId, {
      batchId,
      open: async (annotationId) => (await evaluate(pageCalls.open(annotationId))) === true,
      remove: async (annotationId) => (await evaluate(pageCalls.remove(annotationId))) === true,
    });
    return () => {
      if (liveSessions.get(threadId)?.batchId === batchId) setLiveSession(threadId, null);
    };
  }, [active, count, evaluate, threadId]);

  useRealtime(
    "annotate-session",
    useCallback(
      (rawPayload) => {
        const payload = rawPayload as SessionEvent;
        if (payload.threadId !== threadId || payload.status !== "sent") return;
        if (payload.batchId !== batchIdRef.current || !activeRef.current) return;
        void deactivatePage();
      },
      [deactivatePage, threadId],
    ),
  );

  // Live design preview on the page.
  useEffect(() => {
    if (!editor || !design) return;
    const revision = ++previewRevisionRef.current;
    const timer = window.setTimeout(() => {
      void evaluate(pageCalls.preview(editor.id, revision, design)).catch((error: unknown) => {
        setErrorMessage(errorText(error, "Could not preview design changes"));
      });
    }, 60);
    return () => window.clearTimeout(timer);
  }, [design, editor, evaluate]);

  // Reserve layout space above the page: DOM cannot paint over the native view.
  useLayoutEffect(() => {
    if (!active) return;
    const navigation = findBrowserNavigation(buttonRef.current);
    const viewport = navigation?.parentElement?.lastElementChild;
    if (!viewport) return;
    const container = document.createElement("div");
    container.style.cssText = "flex:none;position:relative;min-width:0";
    viewport.before(container);
    setToolbarContainer(container);
    return () => {
      container.remove();
      setToolbarContainer(null);
    };
  }, [active]);

  // Selecting an element focuses the page; pull keyboard focus into the editor.
  useEffect(() => {
    if (!editor) return;
    const frame = requestAnimationFrame(() =>
      requestAnimationFrame(() => {
        const input = commentRef.current;
        if (!input?.isConnected) return;
        window.focus();
        input.focus({ preventScroll: true });
      }),
    );
    return () => cancelAnimationFrame(frame);
  }, [editor?.id]);

  const run = useCallback(async (label: string, action: () => Promise<void>, fallback: string) => {
    if (pendingAction) return;
    setPendingAction(label);
    setErrorMessage(null);
    try {
      await action();
    } catch (error) {
      setErrorMessage(errorText(error, fallback));
    } finally {
      setPendingAction(null);
    }
  }, [pendingAction]);

  const toggle = () => run(active ? "Stopping…" : "Starting…", async () => {
    if (active) {
      await syncTailRef.current;
      await deactivatePage();
    } else {
      await activate(url);
    }
  }, "Could not start annotating");

  const saveEditor = () => {
    if (!editor || !design) return;
    const editorId = editor.id;
    return run("Saving…", async () => {
      const result = commitResultSchema.parse(
        await evaluate(pageCalls.commit(editorId, comment, changedDesign(design))),
      );
      if (!result) throw new Error("The selected element is no longer available");
      closeEditor();
      await probeComponents(result.annotationId);
      await scheduleSync();
    }, "Could not save annotation");
  };

  const probeComponents = async (annotationId: string) => {
    try {
      const token = `p${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
      if ((await evaluate(pageCalls.tagForProbe(annotationId, token))) !== true) return;
      const probe = probeResultSchema.safeParse(await evaluate(reactProbeExpression(token), "main"));
      if (probe.success && probe.data && probe.data.components.length > 0) {
        await evaluate(pageCalls.setComponents(annotationId, probe.data.components));
      }
    } catch {
      // React names are a hint; the annotation is useful without them.
    }
  };

  const cancelEditor = () => {
    if (!editor) return;
    const editorId = editor.id;
    closeEditor();
    void evaluate(pageCalls.cancelEditor(editorId)).catch(() => undefined);
  };

  const deleteEditor = () => {
    if (!editor?.annotationId) return;
    const annotationId = editor.annotationId;
    return run("Deleting…", async () => {
      if ((await evaluate(pageCalls.remove(annotationId))) !== true) {
        throw new Error("The annotation is no longer available");
      }
      closeEditor();
    }, "Could not delete annotation");
  };

  const send = () => run("Sending…", async () => {
    await scheduleSync();
    const batchId = batchIdRef.current;
    if (!batchId) return;
    const result = await rpc.call("send", { threadId, batchId });
    if (!result.sent) throw new Error("Add at least one annotation before sending");
    await deactivatePage();
  }, "Could not send annotations");

  const designChanged = design ? changedDesign(design) : null;
  const canSave = Boolean(editor && (comment.trim().length > 0 || designChanged));
  const actionLabel = pendingAction ?? (page === null
    ? "Annotate works in Browser tabs of the desktop app"
    : active ? "Stop annotating (Esc)" : "Annotate page elements");

  return (
    <>
      <span className="group relative inline-flex shrink-0">
        <button
          ref={buttonRef}
          type="button"
          className={`relative inline-flex h-8 shrink-0 items-center gap-1.5 rounded-md px-2 text-xs transition-colors hover:bg-state-hover focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:opacity-40 ${active ? "bg-card text-blue-500" : errorMessage && !active ? "text-destructive" : "text-muted-foreground hover:text-foreground"}`}
          aria-label={actionLabel}
          aria-describedby={tooltipId}
          aria-pressed={active}
          aria-busy={busy}
          disabled={busy || page === null}
          onClick={() => void toggle()}
        >
          {busy && !active ? <LoadingLabel><span className="hidden xl:inline">{pendingAction}</span></LoadingLabel> : <>
            {annotateIcon}
            <span className="hidden xl:inline">{active ? "Annotating" : "Annotate"}</span>
          </>}
          {count > 0 && active ? (
            <span className="absolute -right-0.5 -top-0.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-blue-500 px-1 text-[10px] font-semibold leading-none text-white">
              {count}
            </span>
          ) : null}
        </button>
        <span
          id={tooltipId}
          role="tooltip"
          className="pointer-events-none invisible absolute right-full top-1/2 z-50 mr-2 -translate-y-1/2 whitespace-nowrap rounded-md border border-border bg-popover px-2 py-1 text-xs text-popover-foreground opacity-0 shadow-md transition-opacity group-hover:visible group-hover:opacity-100 group-focus-within:visible group-focus-within:opacity-100"
        >
          {errorMessage && !active ? errorMessage : actionLabel}
        </span>
      </span>
      {active && toolbarContainer ? createPortal(
        <div data-bb-plugin-root="" data-bb-plugin="browser-annotate" className="border-b border-border bg-background">
          <div className="flex h-10 items-center gap-3 px-3 text-foreground">
            <span className="text-sm font-semibold tracking-[-0.01em]">Annotate Page</span>
            <span className="text-xs text-muted-foreground">
              {editor ? `Commenting on <${editor.tag}>` : count > 0 ? `${count} saved · click another element` : "Click an element to comment"}
            </span>
            {errorMessage ? <span role="status" className="min-w-0 truncate text-xs text-destructive">{errorMessage}</span> : null}
            <span className="ml-auto" />
            <button
              type="button"
              className="h-8 min-w-[4.5rem] rounded-lg bg-blue-500 px-3.5 text-sm font-semibold text-white transition-colors hover:bg-blue-400 active:bg-blue-600 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-300 disabled:cursor-not-allowed disabled:bg-white/10 disabled:text-white/35"
              disabled={busy || Boolean(editor) || count === 0}
              title={missingCaptures > 0 && !capturing ? "Some screenshots failed; they are retried on send" : undefined}
              onClick={() => void send()}
            >
              {pendingAction === "Sending…" ? <LoadingLabel>Sending…</LoadingLabel> : capturing ? <LoadingLabel>Capturing…</LoadingLabel> : "Send"}
            </button>
          </div>
          {editor && design ? (
            <div
              role="dialog"
              aria-label={`Annotate ${editor.target}`}
              aria-busy={busy}
              className="border-t border-border bg-popover text-popover-foreground"
              onKeyDown={(event) => {
                if (event.key === "Escape") {
                  event.preventDefault();
                  cancelEditor();
                }
              }}
            >
              <div className="flex items-center gap-2 px-2 py-1.5">
                <button type="button" aria-label={expanded ? "Hide element settings" : "Show element settings"} aria-expanded={expanded} disabled={busy} onClick={() => setExpanded((value) => !value)} className={`flex size-8 shrink-0 items-center justify-center rounded-full hover:bg-state-hover focus-visible:outline focus-visible:outline-2 focus-visible:outline-ring ${expanded || designChanged ? "text-blue-500" : "text-muted-foreground"}`}>
                  <svg aria-hidden viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" className="size-4"><path d="M3 6h8m4 0h6M3 12h3m4 0h11M3 18h11m4 0h3"/><circle cx="13" cy="6" r="2"/><circle cx="8" cy="12" r="2"/><circle cx="16" cy="18" r="2"/></svg>
                </button>
                <span className="max-w-40 shrink-0 truncate rounded-md bg-muted px-1.5 py-0.5 text-xs text-muted-foreground" title={editor.target}>
                  {editor.target}
                </span>
                <textarea
                  ref={commentRef}
                  value={comment}
                  disabled={busy}
                  maxLength={4000}
                  rows={1}
                  placeholder={expanded ? "Describe these changes…" : "Add a comment…"}
                  aria-label="Annotation comment"
                  style={{ minHeight: 32, maxHeight: 96, margin: 0, padding: "6px 0", lineHeight: "20px", border: 0, boxSizing: "border-box" }}
                  className="min-w-0 flex-1 resize-none bg-transparent text-sm text-foreground outline-none [field-sizing:content] placeholder:text-muted-foreground"
                  onChange={(event) => setComment(event.target.value)}
                  onKeyDown={(event) => {
                    if (!event.shiftKey && !event.nativeEvent.isComposing && event.key === "Enter" && canSave) {
                      event.preventDefault();
                      void saveEditor();
                    }
                  }}
                />
                {editor.annotationId ? (
                  <button type="button" disabled={busy} onClick={() => void deleteEditor()} className="h-8 shrink-0 rounded-md px-2 text-xs text-muted-foreground hover:bg-state-hover hover:text-destructive">
                    {pendingAction === "Deleting…" ? <LoadingLabel>Deleting…</LoadingLabel> : "Delete"}
                  </button>
                ) : null}
                <button type="button" disabled={busy} onClick={cancelEditor} className="h-8 shrink-0 rounded-md px-2 text-xs text-muted-foreground hover:bg-state-hover hover:text-foreground">
                  Cancel
                </button>
                <button type="button" disabled={busy || !canSave} onClick={() => void saveEditor()} className="h-8 shrink-0 rounded-md bg-primary px-3 text-xs font-semibold text-primary-foreground hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-40">
                  {pendingAction === "Saving…" ? <LoadingLabel>Saving…</LoadingLabel> : "Save"}
                </button>
              </div>
              {expanded ? (
                <fieldset disabled={busy} className="min-h-0 min-w-0 border-0 border-t border-border p-0">
                  <DesignEditor design={design} onChange={setDesign} />
                </fieldset>
              ) : null}
            </div>
          ) : null}
        </div>,
        toolbarContainer,
      ) : null}
    </>
  );
}

function pluralizeAnnotations(count: number) {
  return `${count} annotation${count === 1 ? "" : "s"}`;
}

/** Keep one composer mention per pending batch; removing the pill discards the batch. */
function useBrowserAnnotationsComposerSync() {
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const rpc = useRpc<typeof rpcContract>();
  const composer = useComposer();
  const pluginId = experimental_usePluginId();
  const connectionState = useRealtimeConnectionState();
  const composerRef = useRef(composer);
  composerRef.current = composer;
  const [pendingRevision, setPendingRevision] = useState(0);
  const requestedMentionsRef = useRef(new Map<string, string>());
  const observedMentionsRef = useRef(new Set<string>());
  const pollErrorRef = useRef(false);
  /** Mentions that left the draft because the message was submitted, not deleted. */
  const submittedRef = useRef(new Set<string>());
  const threadId = composer.scope.kind === "thread" ? composer.scope.threadId : null;
  const isOwnMention = useCallback(
    (mention: (typeof composer.draft.mentions)[number]) =>
      mention.kind === "plugin" && mention.pluginId === pluginId && mention.provider === MENTION_PROVIDER,
    [pluginId],
  );
  const browserMentions = composer.draft.mentions.flatMap((mention) =>
    mention.kind === "plugin" && isOwnMention(mention)
      ? [{ from: mention.from, to: mention.to, id: mention.id, label: mention.label }]
      : [],
  );
  const mentionsKey = JSON.stringify(browserMentions.map((mention) => [mention.id, mention.label]));

  useEffect(() => {
    requestedMentionsRef.current = new Map();
    observedMentionsRef.current = new Set();
    submittedRef.current = new Set();
    pollErrorRef.current = false;
  }, [threadId]);

  useEffect(() => composer.onSubmitted(() => {
    for (const id of observedMentionsRef.current) submittedRef.current.add(id);
  }), [composer]);

  useEffect(() => {
    if (!threadId) return;
    let disposed = false;
    void (async () => {
      try {
        const live = await rpc.call("pending", { threadId });
        if (disposed) return;
        const current = composerRef.current;
        const mentions = current.draft.mentions.flatMap((mention) =>
          mention.kind === "plugin" && isOwnMention(mention)
            ? [{ from: mention.from, to: mention.to, id: mention.id, label: mention.label }]
            : [],
        );
        const plan = planMentionReconciliation(
          mentions,
          live.batches.map((batch) => ({ id: batch.id, label: pluralizeAnnotations(batch.count) })),
          observedMentionsRef.current,
          requestedMentionsRef.current,
        );
        observedMentionsRef.current = plan.observed;
        requestedMentionsRef.current = plan.requested;
        if (plan.remove.length > 0) {
          const removeIds = new Set(plan.remove.map((mention) => `${mention.from}:${mention.to}`));
          current.replace((draft) =>
            removeMentionsFromDraft(draft, (mention) =>
              mention.kind === "plugin" && isOwnMention(mention) && removeIds.has(`${mention.from}:${mention.to}`),
            ),
          );
        }
        if (plan.insert.length > 0) {
          const needsSpace = current.text.length > 0 && !/\s$/.test(current.text);
          current.insert(
            [
              ...(needsSpace ? [" "] : []),
              ...plan.insert.flatMap((batch) => [
                { provider: MENTION_PROVIDER, id: batch.id, label: batch.label },
                " ",
              ]),
            ],
            { at: "end" },
          );
        }
        const pendingIds = new Set(live.batches.map((batch) => batch.id));
        for (const id of [...submittedRef.current]) {
          if (!pendingIds.has(id)) submittedRef.current.delete(id);
        }
        for (const batchId of plan.discard) {
          if (submittedRef.current.has(batchId)) continue;
          await rpc.call("discard", { threadId, batchId });
        }
        pollErrorRef.current = false;
        setErrorMessage(null);
      } catch (error) {
        if (!pollErrorRef.current) {
          pollErrorRef.current = true;
          setErrorMessage(errorText(error, "Could not sync browser annotations"));
        }
      }
    })();
    return () => {
      disposed = true;
    };
  }, [connectionState, isOwnMention, mentionsKey, pendingRevision, rpc, threadId]);

  useRealtime("annotate-pending", useCallback((rawPayload) => {
    if ((rawPayload as { threadId?: string }).threadId === threadId) {
      setPendingRevision((revision) => revision + 1);
    }
  }, [threadId]));

  useRealtime(
    "annotate-session",
    useCallback(
      (rawPayload) => {
        const payload = rawPayload as SessionEvent;
        if (!threadId || payload.threadId !== threadId || payload.status !== "sent" || !payload.batchId) return;
        const batchId = payload.batchId;
        composerRef.current.replace((draft) =>
          removeMentionsFromDraft(draft, (mention) =>
            mention.kind === "plugin" && isOwnMention(mention) && mention.id === batchId,
          ),
        );
        requestedMentionsRef.current.delete(batchId);
        observedMentionsRef.current.delete(batchId);
      },
      [isOwnMention, threadId],
    ),
  );
  return errorMessage;
}

function DesignChangeDetails({ designChange }: { designChange: DesignChange | null }) {
  if (!designChange) return null;
  const changes = [
    ...(designChange.text ? [{ property: "Text", ...designChange.text }] : []),
    ...designChange.declarations.map((change) => ({
      property: change.property,
      previousValue: change.previousValue,
      value: change.value,
    })),
  ];
  if (changes.length === 0) return null;
  return (
    <div className="mt-2 space-y-1 rounded-lg bg-muted/60 p-2 font-mono text-[11px] leading-4">
      {changes.map((change) => (
        <div key={change.property} className="grid grid-cols-[minmax(5rem,auto)_1fr] gap-2">
          <span className="truncate text-muted-foreground">{change.property}</span>
          <span className="min-w-0 break-words">
            <span className="text-muted-foreground line-through">{change.previousValue}</span>
            <span aria-hidden className="px-1 text-muted-foreground">→</span>
            <span>{change.value}</span>
          </span>
        </div>
      ))}
    </div>
  );
}

function useLiveSession(threadId: string | null) {
  const [session, setSession] = useState<LiveSession | null>(() =>
    threadId ? liveSessions.get(threadId) ?? null : null,
  );
  useEffect(() => {
    const update = () => setSession(threadId ? liveSessions.get(threadId) ?? null : null);
    update();
    liveSessionListeners.add(update);
    return () => {
      liveSessionListeners.delete(update);
    };
  }, [threadId]);
  return session;
}

function SentAnnotationsHover() {
  const syncError = useBrowserAnnotationsComposerSync();
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const rpc = useRpc<typeof rpcContract>();
  const composer = useComposer();
  const threadId = composer.scope.kind === "thread" ? composer.scope.threadId : null;
  const liveSession = useLiveSession(threadId);
  const closeTimerRef = useRef<number | null>(null);
  const requestRef = useRef(0);
  const [anchor, setAnchor] = useState<HTMLElement | null>(null);
  const [batchId, setBatchId] = useState<string | null>(null);
  const [sent, setSent] = useState(true);
  const [annotations, setAnnotations] = useState<LiveAnnotation[]>([]);
  const [loading, setLoading] = useState(false);
  const [popupStyle, setPopupStyle] = useState<React.CSSProperties>({});
  const editable = Boolean(batchId && !sent);
  const onPage = Boolean(batchId && liveSession?.batchId === batchId);

  const cancelClose = useCallback(() => {
    if (closeTimerRef.current !== null) window.clearTimeout(closeTimerRef.current);
  }, []);

  const reset = useCallback(() => {
    setAnchor(null);
    setBatchId(null);
    setSent(true);
    setAnnotations([]);
  }, []);

  const closeSoon = useCallback(() => {
    cancelClose();
    closeTimerRef.current = window.setTimeout(reset, 140);
  }, [cancelClose, reset]);

  useEffect(() => {
    const batchIdFor = (target: EventTarget | null) => {
      if (!(target instanceof Element)) return null;
      const pill = target.closest<HTMLElement>('[data-prompt-mention="true"]');
      if (!pill) return null;
      try {
        const resource = JSON.parse(
          pill.getAttribute("data-prompt-mention-resource") ?? "null",
        ) as { kind?: string; itemId?: string } | null;
        const prefix = `${MENTION_PROVIDER}:`;
        if (resource?.kind !== "plugin" || !resource.itemId?.startsWith(prefix)) return null;
        return { pill, batchId: resource.itemId.slice(prefix.length) };
      } catch {
        return null;
      }
    };

    const enter = (event: MouseEvent) => {
      const match = batchIdFor(event.target);
      if (!match) return;
      if (event.relatedTarget instanceof Node && match.pill.contains(event.relatedTarget)) return;
      cancelClose();
      const rect = match.pill.getBoundingClientRect();
      const viewportGutter = 12;
      const popoverWidth = Math.min(
        384,
        window.innerWidth - viewportGutter * 2,
        rect.right - viewportGutter,
      );
      setAnchor(match.pill);
      setPopupStyle({
        left: Math.max(viewportGutter, rect.right - popoverWidth),
        width: popoverWidth,
        ...(rect.top > 360
          ? { bottom: window.innerHeight - rect.top + 8 }
          : { top: rect.bottom + 8 }),
      });
      const request = ++requestRef.current;
      if (!threadId) return;
      setBatchId(match.batchId);
      setAnnotations([]);
      setErrorMessage(null);
      setLoading(true);
      void rpc.call("batch", { threadId, batchId: match.batchId }).then((result) => {
        if (request === requestRef.current) {
          setLoading(false);
          setSent(result.sent);
          setAnnotations(result.annotations);
        }
      }).catch((error: unknown) => {
        if (request === requestRef.current) {
          setLoading(false);
          setErrorMessage(errorText(error, "Could not load annotations"));
        }
      });
    };
    const leave = (event: MouseEvent) => {
      const match = batchIdFor(event.target);
      if (!match) return;
      if (event.relatedTarget instanceof Node && match.pill.contains(event.relatedTarget)) return;
      closeSoon();
    };
    document.addEventListener("mouseover", enter);
    document.addEventListener("mouseout", leave);
    return () => {
      document.removeEventListener("mouseover", enter);
      document.removeEventListener("mouseout", leave);
      cancelClose();
    };
  }, [cancelClose, closeSoon, rpc, threadId]);

  const editAnnotation = useCallback(async (annotationId: string) => {
    if (!onPage || !liveSession) return;
    try {
      if (!(await liveSession.open(annotationId))) {
        setErrorMessage("This annotation target is no longer available on the page");
        return;
      }
      reset();
    } catch (error) {
      setErrorMessage(errorText(error, "Could not open annotation"));
    }
  }, [liveSession, onPage, reset]);

  const deleteAnnotation = useCallback(async (annotationId: string) => {
    if (!threadId || !batchId || !editable) return;
    try {
      const changed = onPage && liveSession
        ? await liveSession.remove(annotationId)
        : (await rpc.call("remove", { threadId, batchId, annotationId })).changed;
      if (!changed) return;
      const next = annotations.filter((annotation) => annotation.id !== annotationId);
      setAnnotations(next);
      if (next.length === 0) reset();
    } catch (error) {
      setErrorMessage(errorText(error, "Could not delete annotation"));
    }
  }, [annotations, batchId, editable, liveSession, onPage, reset, rpc, threadId]);

  if (!anchor) return syncError ? <span role="status" className="text-xs text-destructive">{syncError}</span> : null;
  if (annotations.length === 0 && !errorMessage && !loading) return null;
  return createPortal(
    <div
      data-browser-annotations-popover=""
      data-bb-plugin-root=""
      data-bb-plugin="browser-annotate"
      data-bb-portaled-overlay=""
      className="fixed z-[1100] max-h-[min(28rem,70vh)] max-w-[calc(100vw-24px)] overflow-y-auto rounded-xl border border-border bg-popover p-2 text-popover-foreground shadow-2xl"
      style={popupStyle}
      onMouseEnter={cancelClose}
      onMouseLeave={closeSoon}
    >
      {loading ? <p className="p-2 text-xs text-muted-foreground"><LoadingLabel>Loading annotations…</LoadingLabel></p> : null}
      {errorMessage ? <p role="status" className="p-2 text-xs text-destructive">{errorMessage}</p> : null}
      {annotations.map((annotation, index) => (
        <div key={annotation.id} className="border-b border-border p-2 last:border-b-0">
          <div className="flex items-start gap-2">
            {annotation.previewDataUrl ? (
              <img
                src={annotation.previewDataUrl}
                alt=""
                className="mt-0.5 size-10 rounded-md border border-border object-cover"
              />
            ) : (
              <div className="mt-0.5 flex size-10 items-center justify-center rounded-md border border-border bg-muted text-xs text-muted-foreground">
                {index + 1}
              </div>
            )}
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2 text-xs text-muted-foreground">
                <span className="rounded-md bg-muted px-1.5 py-0.5">{annotation.tag}</span>
                <span className="truncate">{annotation.target}</span>
              </div>
              {annotation.comment ? (
                <p className="mt-2 whitespace-pre-wrap text-sm">{annotation.comment}</p>
              ) : null}
              <DesignChangeDetails designChange={annotation.designChange} />
            </div>
            {editable ? (
              <div className="flex shrink-0 items-center">
                {onPage ? (
                  <button
                    type="button"
                    className="rounded-md p-1.5 text-muted-foreground hover:bg-state-hover hover:text-foreground"
                    aria-label={`Edit annotation ${index + 1}`}
                    onClick={() => void editAnnotation(annotation.id)}
                  >
                    <svg aria-hidden viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" className="size-4">
                      <path d="m4 20 4.5-1 10-10a2.1 2.1 0 0 0-3-3l-10 10L4 20Z" />
                    </svg>
                  </button>
                ) : null}
                <button
                  type="button"
                  className="rounded-md p-1.5 text-muted-foreground hover:bg-state-hover hover:text-destructive"
                  aria-label={`Delete annotation ${index + 1}`}
                  onClick={() => void deleteAnnotation(annotation.id)}
                >
                  <svg aria-hidden viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" className="size-4">
                    <path d="M4 7h16M9 7V4h6v3m-9 0 1 13h10l1-13M10 11v5m4-5v5" />
                  </svg>
                </button>
              </div>
            ) : null}
          </div>
        </div>
      ))}
    </div>,
    document.body,
  );
}

export default definePluginApp((app) => {
  app.slots.experimental_browserToolbarAction({
    id: "browser-annotate",
    title: "Browser Annotate",
    component: BrowserAnnotateAction,
  });
  app.slots.experimental_appOverlay({
    id: "sent-annotation-hover",
    component: SentAnnotationsHover,
  });
});
