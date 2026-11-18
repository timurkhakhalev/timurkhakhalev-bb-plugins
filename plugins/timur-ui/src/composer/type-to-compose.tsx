// Type to compose: a printable key pressed while nothing editable has focus goes into
// the composer, so typing starts a message without ⌘⇧C first (as in Codex).
//
// Every thread and new-thread composer mounts an invisible banner that registers its
// SDK handle and DOM node here. One document listener picks the target: the composer
// in the pane the user last clicked, else the only one on screen, else the first.
// The key is inserted through the SDK (`insert` at the end, then `focus`), so it does
// not depend on the browser routing a keystroke into a just-focused editor.
import { useEffect, useRef } from "react";
import { useComposer, useSettings } from "@get-bb/plugin-sdk/app";
import { shouldCapture } from "./type-to-compose-policy";

type Composer = ReturnType<typeof useComposer>;
type Entry = { composer: Composer; marker: HTMLElement };

const entries = new Map<string, Entry>();
let lastPointerTarget: Element | null = null;
let stop: (() => void) | null = null;

// The hidden marker has no box; its composer (or the banner wrapper) does.
const boxOf = (marker: HTMLElement) => marker.closest("[data-app-composer]") ?? marker.parentElement;

function visible(el: Element | null): el is HTMLElement {
  return el instanceof HTMLElement && el.isConnected && el.getClientRects().length > 0;
}

/** How many levels up from `from` until an ancestor contains `el`: lower is closer. */
function distance(from: Element, el: Element): number {
  let depth = 0;
  for (let node: Element | null = from; node; node = node.parentElement, depth += 1) {
    if (node.contains(el)) return depth;
  }
  return Number.POSITIVE_INFINITY;
}

// With split panes several composers are on screen; take the one sharing the
// closest ancestor with the last click, which is the pane the user is working in.
// bb's pane markup is not a public contract, so this avoids depending on it.
function pick(): Composer | null {
  const shown = [...entries.values()].filter((entry) => visible(boxOf(entry.marker)));
  if (shown.length <= 1 || !lastPointerTarget?.isConnected) return shown[0]?.composer ?? null;
  const from = lastPointerTarget;
  const best = shown.reduce((a, b) => (distance(from, b.marker) < distance(from, a.marker) ? b : a));
  return best.composer;
}

function onKeyDown(event: KeyboardEvent) {
  if (!shouldCapture(event, document.activeElement, document)) return;
  const composer = pick();
  if (!composer) return;
  event.preventDefault();
  try {
    composer.insert(event.key, { at: "end" });
    composer.focus();
  } catch {
    // The draft went away between pick and insert; let the next key retry.
  }
}

const onPointerDown = (event: PointerEvent) => {
  lastPointerTarget = event.target instanceof Element ? event.target : null;
};

function start() {
  if (stop) return;
  // Bubble phase: bb's own shortcuts and any focused widget see the key first and can
  // claim it with preventDefault.
  document.addEventListener("keydown", onKeyDown);
  document.addEventListener("pointerdown", onPointerDown, true);
  stop = () => {
    document.removeEventListener("keydown", onKeyDown);
    document.removeEventListener("pointerdown", onPointerDown, true);
    lastPointerTarget = null;
    stop = null;
  };
}

/** Bare composer banner that renders an invisible marker and registers its composer. */
export function TypeToCompose() {
  const composer = useComposer();
  const { values = {} } = useSettings();
  const enabled = values.typeToCompose !== false;
  const marker = useRef<HTMLSpanElement>(null);
  const handle = useRef(composer);
  handle.current = composer;

  useEffect(() => {
    const el = marker.current;
    if (!enabled || !el) return;
    const key = composer.key;
    // A getter so the listener always uses the latest handle from this render.
    entries.set(key, {
      get composer() {
        return handle.current;
      },
      marker: el,
    });
    start();
    return () => {
      entries.delete(key);
      if (entries.size === 0) stop?.();
    };
  }, [enabled, composer.key]);

  return enabled ? <span ref={marker} hidden data-timur-type-to-compose="" /> : null;
}
