// Marks DOM nodes so app.css can style without broad `:has()` selectors.
// Chrome re-evaluates every `:has()` when timeline nodes mount on a thread
// switch; that was the main switch-lag cost. Markers are set in the same
// MutationObserver turn (before the next style pass), matching composer-tray.ts.
const CODE = "data-bui-code";
const PENDING = "data-bui-pending";
const PENDING_BELOW = "data-bui-pending-below";
const NESTED = "data-bui-nested";
const BUNDLE = "data-bui-bundle";
const UNREAD = "data-bui-unread-work";
const BANNERS = "data-bui-banners";
const STREAMING = "data-bui-streaming";

const setFlag = (el: Element | null | undefined, name: string, on: boolean) => {
  if (!el) return;
  if (on) el.setAttribute(name, "");
  else el.removeAttribute(name);
};

const markCode = () => {
  document.querySelectorAll(`[${CODE}]`).forEach((el) => {
    if (!el.querySelector(":scope > pre.bb-code-highlight")) el.removeAttribute(CODE);
  });
  document
    .querySelectorAll("[data-timeline-row-list] [data-markdown-preview] pre.bb-code-highlight")
    .forEach((pre) => setFlag(pre.parentElement, CODE, true));
};

const markPendingIcons = () => {
  document
    .querySelectorAll("[data-timeline-row-list] .group\\/timeline-row > button > span > span")
    .forEach((span) => {
      setFlag(span, PENDING, span.querySelector(":scope > span > .animate-shine") !== null);
    });
};

const markTree = () => {
  document
    .querySelectorAll(
      ':is([data-timeline-row-list="bundle"], [data-timeline-row-list="nested"]) > [data-timeline-row-id]',
    )
    .forEach((row) => {
      const pending = row.querySelector(".animate-shine") !== null;
      setFlag(row, PENDING, pending);
    });
  document.querySelectorAll(':is([data-timeline-row-list="bundle"], [data-timeline-row-list="nested"])').forEach((list) => {
    const rows = Array.from(list.children).filter((el) => el.hasAttribute("data-timeline-row-id"));
    let below = false;
    for (let i = rows.length - 1; i >= 0; i -= 1) {
      const row = rows[i]!;
      setFlag(row, PENDING_BELOW, below);
      if (row.hasAttribute(PENDING)) below = true;
    }
  });
};

const markNested = () => {
  document.querySelectorAll(`[${NESTED}]`).forEach((el) => {
    if (!el.querySelector(':scope > div > div > div > [data-timeline-row-list="nested"]')) {
      el.removeAttribute(NESTED);
    }
  });
  document.querySelectorAll('[data-timeline-row-list="nested"]').forEach((list) => {
    const wrap = list.parentElement?.parentElement?.parentElement?.parentElement;
    if (wrap?.classList.contains("isolate") && wrap.classList.contains("relative")) {
      setFlag(wrap, NESTED, true);
    }
  });
};

const markBundles = () => {
  document.querySelectorAll(`[${BUNDLE}]`).forEach((el) => {
    if (!el.querySelector(':scope > [data-timeline-row-list="bundle"]')) el.removeAttribute(BUNDLE);
  });
  document.querySelectorAll('[data-timeline-row-list="bundle"]').forEach((list) => {
    setFlag(list.parentElement, BUNDLE, true);
  });
};

const markUnread = () => {
  document.querySelectorAll(`[data-timeline-window-key^="divider:"]`).forEach((divider) => {
    const next = divider.nextElementSibling;
    const work =
      next?.hasAttribute("data-timeline-row-id") === true &&
      next.querySelector(".group\\/timeline-row") !== null;
    setFlag(divider, UNREAD, work);
  });
};

const markBanners = () => {
  document.querySelectorAll("[data-app-composer] > div.grid").forEach((stack) => {
    setFlag(stack, BANNERS, stack.querySelector(":scope > section[aria-label]") !== null);
  });
};

const markRunState = () => {
  const submit = document.querySelector<HTMLElement>("[data-promptbox-submit-action]");
  const label = submit?.getAttribute("aria-label") ?? "";
  const streaming = label === "Stop run" || label.startsWith("Steer current run");
  setFlag(document.querySelector("#thread-detail-timeline-panel"), STREAMING, streaming);
};

const scan = () => {
  markCode();
  markPendingIcons();
  markTree();
  markNested();
  markBundles();
  markUnread();
  markBanners();
  markRunState();
};

export function mountPerfMarkers(): () => void {
  let scheduled = false;
  const schedule = () => {
    if (scheduled) return;
    scheduled = true;
    requestAnimationFrame(() => {
      scheduled = false;
      scan();
    });
  };
  scan();
  const observer = new MutationObserver(schedule);
  // childList covers timeline remounts; aria-label covers Stop ↔ Steer on the send button
  // (the streaming caret keys on it).
  // Do not watch `class` — React rewrites className constantly and would thrash the scan.
  observer.observe(document.body, {
    childList: true,
    subtree: true,
    attributes: true,
    attributeFilter: ["aria-label"],
  });
  return () => {
    observer.disconnect();
    document
      .querySelectorAll(
        `[${CODE}], [${PENDING}], [${PENDING_BELOW}], [${NESTED}], [${BUNDLE}], [${UNREAD}], [${BANNERS}], [${STREAMING}]`,
      )
      .forEach((el) => {
        el.removeAttribute(CODE);
        el.removeAttribute(PENDING);
        el.removeAttribute(PENDING_BELOW);
        el.removeAttribute(NESTED);
        el.removeAttribute(BUNDLE);
        el.removeAttribute(UNREAD);
        el.removeAttribute(BANNERS);
        el.removeAttribute(STREAMING);
      });
  };
}
