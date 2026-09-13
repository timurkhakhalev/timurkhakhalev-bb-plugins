import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { placeEditor } from "./editor-placement.js";
import { defaultShortcut, matchesShortcut } from "./shortcut.js";
import * as Dialog from "@radix-ui/react-dialog";
import {
  definePluginApp,
  useComposer,
  useRealtime,
  useRealtimeConnectionState,
  useRpc,
  type ComposerStructuredDraft,
  type ComposerView,
  type ExperimentalPluginBrowserToolbarActionProps,
} from "@get-bb/plugin-sdk/app";
import type { DesignChange, EditorDraft, rpcContract } from "./contracts.js";
import { planMentionReconciliation, removeStructuredMentionText } from "./composer.js";

type SessionEvent = {
  threadId?: string;
  tabId?: string;
  status?: "cancelled" | "error" | "sent";
  count?: number;
  batchId?: string;
  error?: string;
};

type LiveAnnotation = {
  id: string;
  tag: string;
  target: string;
  comment: string;
  designChange: DesignChange | null;
  previewDataUrl: string | null;
};

const composerDrafts = new Map<string, ComposerStructuredDraft>();

type DesktopBrowserVisibility = {
  setVisible(input: { tabId: string; visible: boolean }): void;
  setVisibleWithoutFocus(input: { tabId: string; visible: boolean }): void;
};
const composerDraftReady = new Set<string>();

const annotateIcon = (
  <svg
    aria-hidden
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="1.8"
    strokeLinecap="round"
    strokeLinejoin="round"
    className="size-3.5"
  >
    <path d="M12 20h9" />
    <path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z" />
  </svg>
);

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
                    {colorProperties.has(property) ? (
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

function useAnnotationShortcut() {
  const rpc = useRpc<typeof rpcContract>();
  const [shortcut, setShortcut] = useState(defaultShortcut);
  const refresh = useCallback(() => { void rpc.call("getShortcut", {}).then((value) => setShortcut(value.shortcut)); }, [rpc]);
  useEffect(refresh, [refresh]);
  useRealtime("shortcut-changed", refresh);
  return shortcut;
}

function ShortcutSettings() {
  const shortcut = useAnnotationShortcut();
  const rpc = useRpc<typeof rpcContract>();
  const [recording, setRecording] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const save = async (value: string) => {
    setRecording(false);
    setSaving(true);
    setError("");
    try { await rpc.call("setShortcut", { shortcut: value }); }
    catch (cause) { setError(cause instanceof Error ? cause.message : "Could not save shortcut"); }
    finally { setSaving(false); }
  };
  return <div className="flex flex-wrap items-center justify-between gap-3">
    <div><p className="text-sm font-medium">Annotation mode shortcut</p><p className="text-xs text-muted-foreground">Click to record. Press a modifier + letter. Escape cancels.</p>{error ? <p role="alert" className="text-xs text-destructive">{error}</p> : null}</div>
    <div className="flex items-center gap-2">
      <button type="button" disabled={saving} aria-pressed={recording} onBlur={() => setRecording(false)} onClick={() => { setError(""); setRecording(true); }}
        onKeyDown={(event) => {
          if (!recording) return;
          event.preventDefault(); event.stopPropagation();
          if (event.key === "Escape") { setRecording(false); return; }
          if (event.repeat || event.nativeEvent.isComposing || !/^(Key[A-Z]|Period)$/.test(event.code)) return;
          const modifiers = [event.metaKey && "Meta", event.ctrlKey && "Ctrl", event.altKey && "Alt", event.shiftKey && "Shift"].filter(Boolean);
          if (!modifiers.length) { setError("Include Cmd, Ctrl, Alt or Shift."); return; }
          void save([...modifiers, event.code === "Period" ? "." : event.code.slice(3)].join("+"));
        }}
        className="min-w-40 rounded-md border border-border px-3 py-2 text-sm focus-visible:outline focus-visible:outline-2 focus-visible:outline-ring">{recording ? "Press shortcut…" : saving ? "Saving…" : shortcut || "Set shortcut"}</button>
      <button type="button" disabled={saving || !shortcut} onClick={() => void save("")} className="px-2 py-2 text-xs text-muted-foreground">Disable</button>
    </div>
  </div>;
}

function BrowserAnnotateAction({ threadId, tabId }: ExperimentalPluginBrowserToolbarActionProps) {
  const shortcut = useAnnotationShortcut();
  const commentRef = useRef<HTMLTextAreaElement | null>(null);
  const [previewReadyId, setPreviewReadyId] = useState<string | null>(null);
  const rpc = useRpc<typeof rpcContract>();
  const connectionState = useRealtimeConnectionState();
  const buttonRef = useRef<HTMLButtonElement | null>(null);
  const revisionRef = useRef(-1);
  const editorIdRef = useRef<string | null>(null);
  const previewRevisionRef = useRef(0);
  const pollErrorRef = useRef(false);
  const previewErrorRef = useRef(false);
  const [busy, setBusy] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const showSessionError = (error: unknown, fallback: string) => setErrorMessage(error instanceof Error ? error.message : typeof error === "string" ? error : fallback);
  const [active, setActive] = useState(false);
  const [editor, setEditor] = useState<EditorDraft | null>(null);
  const [expanded, setExpanded] = useState(false);
  const editorRef = useRef<HTMLDivElement | null>(null);
  const editorViewportRef = useRef<DOMRect | null>(null);
  const [editorStyle, setEditorStyle] = useState<React.CSSProperties>({ visibility: "hidden" });
  const [comment, setComment] = useState("");
  const [design, setDesign] = useState<DesignChange | null>(null);
  const [annotationCount, setAnnotationCount] = useState(0);
  const [capturePending, setCapturePending] = useState(false);
  const [captureFailed, setCaptureFailed] = useState(false);
  const [toolbarContainer, setToolbarContainer] = useState<HTMLDivElement | null>(null);
  const [pageStyle, setPageStyle] = useState<React.CSSProperties>({});
  const [selectionStyle, setSelectionStyle] = useState<React.CSSProperties>({});

  const refreshStatus = useCallback(() => {
    void rpc
      .call("status", { threadId })
      .then((status) => setActive(status.active && status.tabId === tabId))
      .catch(() => undefined);
  }, [rpc, tabId, threadId]);

  useLayoutEffect(() => {
    if (!editor) return;
    // Electron's native browser view sits above DOM portals. The editor uses a
    // page snapshot while the native view is hidden, then restores it on close.
    const browser = (window as typeof window & {
      bbDesktop?: { browser?: DesktopBrowserVisibility };
    }).bbDesktop?.browser;
    if (!browser) return;
    const navigation = findBrowserNavigation(buttonRef.current);
    const viewport = navigation?.parentElement?.lastElementChild;
    if (viewport) {
      const rect = viewport.getBoundingClientRect();
      editorViewportRef.current = rect;
      setPageStyle({ left: rect.left, top: rect.top, width: rect.width, height: rect.height });
    }
    if (previewReadyId !== editor.id) return;
    browser.setVisible({ tabId, visible: false });
    return () => {
      if (buttonRef.current?.getBoundingClientRect().width) {
        browser.setVisibleWithoutFocus({ tabId, visible: true });
      }
    };
  }, [editor?.id, previewReadyId, tabId]);

  useEffect(refreshStatus, [connectionState, refreshStatus]);

  useLayoutEffect(() => {
    if (!editor) return;
    const position = () => {
      const navigation = findBrowserNavigation(buttonRef.current);
      const viewport = navigation?.parentElement?.lastElementChild;
      const popup = editorRef.current;
      if (!viewport || !popup) return;
      const liveBounds = viewport.getBoundingClientRect();
      const bounds = liveBounds.height > 0 ? liveBounds : editorViewportRef.current;
      if (!bounds) return;
      const placement = placeEditor(bounds, editor.viewport, editor.rect, expanded);
      setEditorStyle(placement.popup);
      setSelectionStyle(placement.target);
      setPageStyle({ left: bounds.left, top: bounds.top, width: bounds.width, height: bounds.height });
    };
    const frame = requestAnimationFrame(() => {
      position();
    });
    window.addEventListener("resize", position);
    return () => { cancelAnimationFrame(frame); window.removeEventListener("resize", position); };
  }, [editor?.id, expanded, previewReadyId]);


  useLayoutEffect(() => {
    if (!active) return;
    const navigation = findBrowserNavigation(buttonRef.current);
    const viewport = navigation?.parentElement?.lastElementChild;
    if (!viewport) return;
    // Reserve layout space: a DOM overlay cannot paint over Electron's native view.
    const container = document.createElement("div");
    container.style.cssText = "flex:none;position:relative;min-width:0";
    viewport.before(container);
    setToolbarContainer(container);
    return () => { container.remove(); setToolbarContainer(null); };
  }, [active]);

  useEffect(() => {
    if (!active) {
      revisionRef.current = -1;
      editorIdRef.current = null;
      setEditor(null);
      return;
    }
    let disposed = false;
    let running = false;
    const poll = async () => {
      if (disposed || running) return;
      running = true;
      try {
        const live = await rpc.call("live", { threadId, afterRevision: revisionRef.current });
        if (disposed) return;
        revisionRef.current = Math.max(revisionRef.current, live.revision);
        setAnnotationCount(live.annotations.length);
        setCapturePending(live.capturePending);
        setCaptureFailed(live.captureFailed);
        if (live.editor?.id !== editorIdRef.current) {
          editorIdRef.current = live.editor?.id ?? null;
          setEditor(live.editor);
          setExpanded(false);
          setComment(live.editor?.comment ?? "");
          setDesign(live.editor?.designChange ?? null);
          previewRevisionRef.current = 0;
          previewErrorRef.current = false;
        } else if (live.editor) {
          const previewDataUrl = live.editor.previewDataUrl;
          setEditor((current) => current && current.previewDataUrl !== previewDataUrl
            ? { ...current, previewDataUrl }
            : current);
        }
        if (!live.active) setActive(false);
        pollErrorRef.current = false;
      } catch (error) {
        if (!disposed && !pollErrorRef.current) {
          pollErrorRef.current = true;
          setActive(false);
          showSessionError(error, "Could not read annotation state");
        }
      } finally {
        running = false;
      }
    };
    void poll();
    const timer = window.setInterval(() => void poll(), 150);
    return () => {
      disposed = true;
      window.clearInterval(timer);
    };
  }, [active, rpc, threadId]);

  useEffect(() => {
    if (!active || !editor || !design) return;
    const previewRevision = ++previewRevisionRef.current;
    const timer = window.setTimeout(() => {
      void rpc.call("preview", {
        threadId,
        editorId: editor.id,
        previewRevision,
        designChange: design,
      }).then(() => {
        previewErrorRef.current = false;
      }).catch((error) => {
        if (!previewErrorRef.current) {
          previewErrorRef.current = true;
          setErrorMessage(error instanceof Error ? error.message : "Could not preview design changes");
        }
      });
    }, 80);
    return () => window.clearTimeout(timer);
  }, [active, design, editor, rpc, threadId]);

  useRealtime(
    "annotate-session",
    useCallback(
      (rawPayload) => {
        const payload = rawPayload as SessionEvent;
        if (payload.threadId !== threadId || payload.tabId !== tabId) return;
        setActive(false);
        if (payload.status === "error") {
          showSessionError(payload.error, "Browser annotation failed");
        }
      },
      [tabId, threadId],
    ),
  );

  const toggle = useCallback(async () => {
    setBusy(true);
    try {
      if (active) {
        await rpc.call("stop", { threadId });
        setActive(false);
      } else {
        setErrorMessage(null);
        await rpc.call("start", { threadId, tabId });
        setActive(true);
      }
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : String(error));
    } finally {
      setBusy(false);
    }
  }, [active, rpc, tabId, threadId]);

  const saveEditor = useCallback(async () => {
    if (!editor || !design) return;
    setErrorMessage(null);
    setBusy(true);
    try {
      const result = await rpc.call("save", {
        threadId,
        editorId: editor.id,
        comment,
        designChange: changedDesign(design),
      });
      if (!result.saved) throw new Error("The selected element is no longer available");
      editorIdRef.current = null;
      setEditor(null);
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : "Could not save annotation");
    } finally {
      setBusy(false);
    }
  }, [comment, design, editor, rpc, threadId]);

  const cancelEditor = useCallback(async () => {
    if (!editor) return;
    try {
      await rpc.call("cancelEditor", { threadId, editorId: editor.id });
      editorIdRef.current = null;
      setEditor(null);
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : "Could not close annotation editor");
    }
  }, [editor, rpc, threadId]);

  const deleteEditor = useCallback(async () => {
    if (!editor?.annotationId) return;
    setBusy(true);
    try {
      const result = await rpc.call("mutate", {
        threadId,
        annotationId: editor.annotationId,
        action: "delete",
      });
      if (!result.changed) throw new Error("The annotation is no longer available");
      editorIdRef.current = null;
      setEditor(null);
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : "Could not delete annotation");
    } finally {
      setBusy(false);
    }
  }, [editor, rpc, threadId]);

  const send = useCallback(async () => {
    setBusy(true);
    try {
      const result = await rpc.call("send", { threadId });
      if (!result.sent) throw new Error("Finish the current annotation before sending");
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : "Could not send annotations");
    } finally {
      setBusy(false);
    }
  }, [rpc, threadId]);

  const designChanged = design ? changedDesign(design) : null;
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.defaultPrevented || event.repeat || event.isComposing || busy) return;
      const button = buttonRef.current;
      if (!button || !button.checkVisibility() || !button.getBoundingClientRect().width) return;
      if (!matchesShortcut(event, shortcut, /Mac/.test(navigator.platform))) return;
      event.preventDefault();
      event.stopPropagation();
      void toggle();
    };
    window.addEventListener("keydown", onKeyDown, true);
    return () => window.removeEventListener("keydown", onKeyDown, true);
  }, [shortcut, busy, editor, toggle]);
  const canSave = Boolean(editor && (comment.trim().length > 0 || designChanged));

  return (
    <>
      <button
        ref={buttonRef}
        type="button"
        className={`inline-flex h-8 shrink-0 items-center gap-1.5 rounded-md px-2 text-xs transition-colors hover:bg-state-hover focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:opacity-40 ${active ? "bg-card text-blue-500" : "text-muted-foreground hover:text-foreground"}`}
        title={active ? "Stop annotating" : "Annotate this page"}
        aria-label={active ? "Stop annotating this page" : "Annotate this page"}
        aria-pressed={active}
        disabled={busy}
        onClick={() => void toggle()}
      >
        {annotateIcon}
        <span className="hidden xl:inline">{active ? "Annotating" : "Annotate"}</span>
      </button>
      {errorMessage && !editor ? <span role="status" className="max-w-48 text-xs text-destructive">{errorMessage}</span> : null}
      {editor?.previewDataUrl ? createPortal(
        <>
          <img key={editor.id} src={editor.previewDataUrl} alt="" onLoad={() => setPreviewReadyId(editor.id)} style={{ position: "fixed", zIndex: 1199, pointerEvents: "none", ...pageStyle }} />
          <div aria-hidden style={{ position: "fixed", zIndex: 1200, pointerEvents: "none", outline: "2px solid #3385ff", ...selectionStyle }} />
        </>,
        document.body,
      ) : null}
      {active && toolbarContainer ? createPortal(
        <div data-bb-plugin-root="" data-bb-plugin="browser-annotate" className="flex justify-center border-b border-border bg-background px-3 py-1">
          <div className="flex h-9 items-center gap-3 text-foreground">
            <span className="text-sm font-semibold tracking-[-0.01em]">Annotate Page</span>
            <button
              type="button"
              className="h-8 min-w-[4.5rem] rounded-lg bg-blue-500 px-3.5 text-sm font-semibold text-white transition-colors hover:bg-blue-400 active:bg-blue-600 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-300 disabled:cursor-not-allowed disabled:bg-white/10 disabled:text-white/35"
              disabled={busy || Boolean(editor) || annotationCount === 0 || capturePending}
              title={captureFailed ? "Screenshot failed; retrying automatically" : undefined}
              onClick={() => void send()}
            >
              Send
            </button>
          </div>
          {editor && design && previewReadyId === editor.id ? (
            <Dialog.Root open onOpenChange={(open) => { if (!open) void cancelEditor(); }}>
            <Dialog.Portal>
            <Dialog.Content
              ref={editorRef}
              data-bb-plugin-root=""
              data-bb-plugin="browser-annotate"
              aria-label={`Annotate ${editor.target}`}
              aria-describedby={undefined}
              onOpenAutoFocus={(event) => {
                event.preventDefault();
                const input = commentRef.current;
                // Portal mount is the focus boundary, not the parent render.
                // Let placement commit before moving keyboard focus out of WebContents.
                requestAnimationFrame(() => requestAnimationFrame(() => {
                  if (!input?.isConnected) return;
                  window.focus();
                  input.focus({ preventScroll: true });
                }));
              }}
              style={editorStyle}
              className={`fixed z-[1201] flex flex-col overflow-hidden border border-border bg-popover text-popover-foreground shadow-2xl ${expanded ? "rounded-xl" : "rounded-full"}`}
            >
              <Dialog.Title className="sr-only">Annotate {editor.target}</Dialog.Title>
              <div className={`flex shrink-0 items-center gap-2 px-2 py-1.5 ${expanded ? "border-b border-border" : ""}`}>
                <button type="button" aria-label={expanded ? "Hide element settings" : "Show element settings"} aria-expanded={expanded} onClick={() => setExpanded((value) => !value)} className="flex size-8 shrink-0 items-center justify-center rounded-full text-muted-foreground hover:bg-state-hover focus-visible:outline focus-visible:outline-2 focus-visible:outline-ring">
                  <svg aria-hidden viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" className="size-4"><path d="M3 6h8m4 0h6M3 12h3m4 0h11M3 18h11m4 0h3"/><circle cx="13" cy="6" r="2"/><circle cx="8" cy="12" r="2"/><circle cx="16" cy="18" r="2"/></svg>
                </button>
                <textarea
                  ref={commentRef}
                  value={comment}
                  maxLength={4000}
                  rows={1}
                  placeholder={expanded ? "Describe these changes…" : "Add a comment…"}
                  aria-label="Annotation comment"
                  style={{ height: 32, minHeight: 32, maxHeight: 32, margin: 0, padding: "6px 0", lineHeight: "20px", border: 0, boxSizing: "border-box" }}
                  className="min-w-0 flex-1 resize-none bg-transparent text-sm text-foreground outline-none placeholder:text-muted-foreground"
                  onChange={(event) => setComment(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === "Escape") void cancelEditor();
                    if (!event.shiftKey && !event.nativeEvent.isComposing && event.key === "Enter" && canSave) {
                      event.preventDefault();
                      void saveEditor();
                    }
                  }}
                />
                {!expanded && canSave ? <button type="button" disabled={busy} onClick={() => void saveEditor()} className="h-8 shrink-0 rounded-full px-2 text-xs text-foreground hover:bg-state-hover">Save</button> : null}
              </div>
              {expanded ? <>
                <div className="shrink-0 border-b border-border px-3 py-2 text-xs text-muted-foreground">&lt;{editor.tag}&gt;</div>
                <DesignEditor design={design} onChange={setDesign} />
              </> : null}
              {errorMessage ? <p role="status" className="px-3 py-1 text-xs text-destructive">{errorMessage}</p> : null}
              {expanded ? <div className="flex shrink-0 items-center justify-end gap-2 border-t border-border bg-popover px-3 py-2">
                {editor.annotationId ? (
                  <button
                    type="button"
                    className="mr-auto h-8 rounded-md px-2 text-sm text-muted-foreground hover:bg-state-hover hover:text-destructive"
                    disabled={busy}
                    onClick={() => void deleteEditor()}
                  >
                    Delete
                  </button>
                ) : null}
                <button
                  type="button"
                  className="h-8 rounded-md px-3 text-sm text-muted-foreground hover:bg-state-hover hover:text-foreground"
                  disabled={busy}
                  onClick={() => void cancelEditor()}
                >
                  Cancel
                </button>
                <button
                  type="button"
                  className="h-8 rounded-md bg-primary px-3 text-sm font-semibold text-primary-foreground hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-40"
                  disabled={busy || !canSave}
                  onClick={() => void saveEditor()}
                >
                  Save
                </button>
              </div> : null}
            </Dialog.Content>
            </Dialog.Portal>
            </Dialog.Root>
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

function browserMentions(threadId: string) {
  return (composerDrafts.get(threadId)?.mentions ?? []).filter(
    (mention) => mention.provider === "browser-comments",
  );
}

function useBrowserAnnotationsComposerSync() {
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const rpc = useRpc<typeof rpcContract>();
  const composer = useComposer();
  const connectionState = useRealtimeConnectionState();
  const composerRef = useRef(composer);
  const revisionRef = useRef(-1);
  const requestedMentionsRef = useRef(new Map<string, string>());
  const observedMentionsRef = useRef(new Set<string>());
  const pollErrorRef = useRef(false);
  const threadId = composer.scope.kind === "thread" ? composer.scope.threadId : null;
  composerRef.current = composer;

  const detach = useCallback((batchId: string) => {
    if (!threadId) return;
    const mentions = browserMentions(threadId).filter((mention) => mention.id === batchId);
    for (const mention of [...mentions].sort((left, right) => right.from - left.from)) {
      composerRef.current.updateText((text) => removeStructuredMentionText(text, mention));
    }
    requestedMentionsRef.current.delete(batchId);
    observedMentionsRef.current.delete(batchId);
  }, [threadId]);

  useEffect(() => {
    revisionRef.current = -1;
    requestedMentionsRef.current = new Map();
    observedMentionsRef.current = new Set();
    pollErrorRef.current = false;
  }, [threadId]);

  useEffect(() => {
    if (!threadId) return;
    let disposed = false;
    let running = false;
    const poll = async () => {
      if (running || disposed) return;
      running = true;
      try {
        const live = await rpc.call("live", {
          threadId,
          afterRevision: revisionRef.current,
        });
        if (disposed) return;
        revisionRef.current = Math.max(revisionRef.current, live.revision);

        if (!composerDraftReady.has(threadId)) return;
        const mentions = browserMentions(threadId);
        const plan = planMentionReconciliation(
          mentions,
          live.batches.map((batch) => ({ id: batch.id, label: pluralizeAnnotations(batch.count) })),
          observedMentionsRef.current,
          requestedMentionsRef.current,
        );
        observedMentionsRef.current = plan.observed;
        requestedMentionsRef.current = plan.requested;
        for (const mention of [...plan.remove].sort((left, right) => right.from - left.from)) {
          composerRef.current.updateText((text) => removeStructuredMentionText(text, mention));
        }
        for (const batch of plan.insert) {
          composerRef.current.insertMention({
            provider: "browser-comments",
            id: batch.id,
            label: batch.label,
          });
        }
        for (const batchId of plan.discard) {
          await rpc.call("discard", { threadId, batchId });
        }
        pollErrorRef.current = false;
      } catch (error) {
        if (!pollErrorRef.current) {
          pollErrorRef.current = true;
          setErrorMessage(error instanceof Error ? error.message : "Could not sync browser annotations");
        }
      } finally {
        running = false;
      }
    };
    void poll();
    const timer = window.setInterval(() => void poll(), 250);
    return () => {
      disposed = true;
      window.clearInterval(timer);
    };
  }, [connectionState, detach, rpc, threadId]);

  useRealtime(
    "annotate-session",
    useCallback(
      (rawPayload) => {
        const payload = rawPayload as SessionEvent;
        if (!threadId || payload.threadId !== threadId) return;
        if (payload.status === "sent" && payload.batchId) detach(payload.batchId);
      },
      [detach, threadId],
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

function SentAnnotationsHover() {
  const syncError = useBrowserAnnotationsComposerSync();
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const rpc = useRpc<typeof rpcContract>();
  const composer = useComposer();
  const threadId = composer.scope.kind === "thread" ? composer.scope.threadId : null;
  const closeTimerRef = useRef<number | null>(null);
  const requestRef = useRef(0);
  const [anchor, setAnchor] = useState<HTMLElement | null>(null);
  const [batchId, setBatchId] = useState<string | null>(null);
  const [editable, setEditable] = useState(false);
  const [annotations, setAnnotations] = useState<LiveAnnotation[]>([]);
  const [popupStyle, setPopupStyle] = useState<React.CSSProperties>({});

  const cancelClose = useCallback(() => {
    if (closeTimerRef.current !== null) window.clearTimeout(closeTimerRef.current);
  }, []);

  const closeSoon = useCallback(() => {
    cancelClose();
    closeTimerRef.current = window.setTimeout(() => {
      setAnchor(null);
      setBatchId(null);
      setEditable(false);
      setAnnotations([]);
    }, 140);
  }, [cancelClose]);

  useEffect(() => {
    const batchIdFor = (target: EventTarget | null) => {
      if (!(target instanceof Element)) return null;
      const pill = target.closest<HTMLElement>('[data-prompt-mention="true"]');
      if (!pill) return null;
      try {
        const resource = JSON.parse(
          pill.getAttribute("data-prompt-mention-resource") ?? "null",
        ) as { kind?: string; itemId?: string } | null;
        const prefix = "browser-comments:";
        if (resource?.kind !== "plugin" || !resource.itemId?.startsWith(prefix)) return null;
        return { pill, batchId: resource.itemId.slice(prefix.length) };
      } catch {
        return null;
      }
    };

    const enter = (event: MouseEvent) => {
      const match = batchIdFor(event.target);
      if (!match) return;
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
      void rpc.call("batch", { threadId, batchId: match.batchId }).then((result) => {
        if (request === requestRef.current) {
          setEditable(result.editable);
          setAnnotations(result.annotations);
        }
      }).catch((error) => {
        if (request === requestRef.current) {
          setErrorMessage(error instanceof Error ? error.message : "Could not load annotations");
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

  const editAnnotation = useCallback(
    async (annotationId: string) => {
      if (!threadId || !editable) return;
      try {
        const result = await rpc.call("mutate", { threadId, annotationId, action: "open" });
        if (!result.changed) {
          setErrorMessage("This annotation target is no longer available on the page");
          return;
        }
        setAnchor(null);
        setBatchId(null);
        setEditable(false);
        setAnnotations([]);
      } catch (error) {
        setErrorMessage(error instanceof Error ? error.message : "Could not open annotation");
      }
    },
    [editable, rpc, threadId],
  );

  const deleteAnnotation = useCallback(
    async (annotationId: string) => {
      if (!threadId || !batchId || !editable) return;
      try {
        const result = await rpc.call("mutate", { threadId, annotationId, action: "delete" });
        if (!result.changed) return;
        const next = annotations.filter((annotation) => annotation.id !== annotationId);
        setAnnotations(next);
        if (next.length === 0) {
          setAnchor(null);
          setBatchId(null);
          setEditable(false);
        }
      } catch (error) {
        setErrorMessage(error instanceof Error ? error.message : "Could not delete annotation");
      }
    },
    [annotations, batchId, editable, rpc, threadId],
  );

  if (!anchor) return syncError ? <span role="status" className="text-xs text-destructive">{syncError}</span> : null;
  if (annotations.length === 0 && !errorMessage) return null;
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
  app.slots.settingsSection({ id: "annotation-shortcut", title: "Keyboard shortcut", component: ShortcutSettings });
  app.composer.customize({
    id: "browser-annotations-draft",
    scopes: ["thread"],
    richText: {
      onDraftChange(draft: ComposerStructuredDraft, view: ComposerView) {
        if (view.scope.kind === "thread") {
          composerDrafts.set(view.scope.threadId, draft);
          composerDraftReady.add(view.scope.threadId);
        }
      },
    },
  });
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
