// Animates the composer's height when bb collapses or expands it. bb swaps the
// layout in one commit (it toggles data-promptbox-compact on the form), so
// this plays a FLIP: the last observed height → the height after the swap.

const FORM = "form[data-promptbox]";
const COMPACT_ATTR = "data-promptbox-compact";
export const ATTR_NO_ANIMATE = "data-cc-no-animate";
const DURATION_MS = 220;
const EASING = "cubic-bezier(0.16, 1, 0.3, 1)";

export function startCollapseAnimation(signal: AbortSignal): () => void {
  const heights = new WeakMap<Element, number>();
  const running = new WeakMap<Element, Animation>();

  const resizes = new ResizeObserver((entries) => {
    for (const entry of entries) {
      // Ignore the frames of our own animation; keep the settled height.
      if (running.has(entry.target)) continue;
      heights.set(entry.target, entry.target.getBoundingClientRect().height);
    }
  });
  const track = (root: ParentNode) => {
    if (root instanceof Element && root.matches(FORM)) resizes.observe(root);
    root.querySelectorAll?.(FORM).forEach((form) => resizes.observe(form));
  };

  const animate = (form: HTMLElement) => {
    const from = heights.get(form);
    if (from === undefined || !enabled()) return;
    running.get(form)?.cancel();
    const to = form.getBoundingClientRect().height;
    if (Math.abs(to - from) < 1) return;
    const animation = form.animate(
      [
        { height: `${from}px`, overflow: "hidden" },
        { height: `${to}px`, overflow: "hidden" },
      ],
      { duration: DURATION_MS, easing: EASING },
    );
    running.set(form, animation);
    const settle = () => {
      if (running.get(form) !== animation) return;
      running.delete(form);
      heights.set(form, form.getBoundingClientRect().height);
    };
    animation.addEventListener("finish", settle);
    animation.addEventListener("cancel", settle);
  };

  const mutations = new MutationObserver((records) => {
    for (const record of records) {
      if (record.type === "childList") {
        record.addedNodes.forEach((node) => {
          if (node instanceof Element) track(node);
        });
      } else if (record.target instanceof HTMLElement && record.target.matches(FORM)) {
        animate(record.target);
      }
    }
  });

  track(document);
  mutations.observe(document.body, {
    subtree: true,
    childList: true,
    attributes: true,
    attributeFilter: [COMPACT_ATTR],
  });

  const stop = () => {
    mutations.disconnect();
    resizes.disconnect();
  };
  signal.addEventListener("abort", stop, { once: true });
  return stop;
}

function enabled(): boolean {
  return (
    !document.documentElement.hasAttribute(ATTR_NO_ANIMATE) &&
    !window.matchMedia("(prefers-reduced-motion: reduce)").matches
  );
}
