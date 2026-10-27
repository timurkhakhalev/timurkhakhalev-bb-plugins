import { useEffect } from "react";
import { definePluginApp, useSettings } from "@get-bb/plugin-sdk/app";
import { ATTR_NO_ANIMATE, startCollapseAnimation } from "./collapse-animation";
import { COMPACT_COMPOSER_CSS } from "./styles";

// bb's composer DOM is not a public contract. The selectors in styles.ts rely
// on its data-promptbox-* / data-follow-up-composer-* attributes and ids,
// which are steadier than its Tailwind classes, but a bb update can still
// break them.

const ATTR_FOOTER_BELOW = "data-cc-footer-below";
const ATTR_HIDE_GIT_BAR = "data-cc-hide-git-bar";
const VAR_MAX_LINES = "--cc-editor-max-lines";

/** Mirrors the plugin settings onto <html> so the stylesheet can follow them.
 *  Attributes mark departures from the defaults, which the CSS applies on its own. */
function SettingsBridge() {
  const { values = {}, isLoading } = useSettings();
  const maxLines = clampLines(values.editorMaxLines);
  const inlineFooter = values.inlineFooter !== false;
  const hideGitBar = values.hideGitBar === true;
  const animateCollapse = values.animateCollapse !== false;

  useEffect(() => {
    if (isLoading) return;
    const root = document.documentElement;
    root.style.setProperty(VAR_MAX_LINES, String(maxLines));
    root.toggleAttribute(ATTR_FOOTER_BELOW, !inlineFooter);
    root.toggleAttribute(ATTR_HIDE_GIT_BAR, hideGitBar);
    root.toggleAttribute(ATTR_NO_ANIMATE, !animateCollapse);
    return () => {
      root.style.removeProperty(VAR_MAX_LINES);
      root.removeAttribute(ATTR_FOOTER_BELOW);
      root.removeAttribute(ATTR_HIDE_GIT_BAR);
      root.removeAttribute(ATTR_NO_ANIMATE);
    };
  }, [isLoading, maxLines, inlineFooter, hideGitBar, animateCollapse]);

  return null;
}

function clampLines(value: unknown): number {
  const n = typeof value === "number" && Number.isFinite(value) ? Math.round(value) : 8;
  return Math.min(Math.max(n, 2), 30);
}

export default definePluginApp((app) => {
  app.contentScripts.register({
    id: "compact-composer-styles",
    mount: ({ signal }) => {
      const style = document.createElement("style");
      style.dataset.bbPlugin = "compact-composer";
      style.textContent = COMPACT_COMPOSER_CSS;
      document.head.appendChild(style);
      const stopAnimation = startCollapseAnimation(signal);
      const remove = () => {
        stopAnimation();
        style.remove();
      };
      signal.addEventListener("abort", remove, { once: true });
      return remove;
    },
  });
  app.slots.experimental_appOverlay({
    id: "compact-composer-settings",
    component: SettingsBridge,
  });
});
