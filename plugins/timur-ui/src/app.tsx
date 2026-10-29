// Timur UI: a shorter composer (src/composer) plus Beautiful Chat's chat look
// (src/chat, without its own composer styling).
//
// bb's DOM is not a public contract. The selectors rely on its data-* attributes
// and ids, which are steadier than its Tailwind classes, but a bb update can
// still break them.
import "./chat/app.css";
import { useEffect } from "react";
import { definePluginApp, useSettings } from "@get-bb/plugin-sdk/app";
import { ATTR_NO_ANIMATE, startCollapseAnimation } from "./composer/collapse-animation";
import { ATTR_ALLOW_KEYBOARD_COLLAPSE, startKeepExpanded } from "./composer/keep-expanded";
import { COMPACT_COMPOSER_CSS } from "./composer/styles";
import { rootAttributes } from "./chat/settings";
import { registerCoinsWorklet } from "./chat/coins-worklet";
import { mountSpatialTooltips } from "./chat/spatial-tooltip";
import { mountPhaseSync } from "./chat/phase-sync";
import { mountPerfMarkers } from "./chat/perf-markers";
import { ChangedFiles } from "./chat/changed-files";

const ATTR_FOOTER_BELOW = "data-cc-footer-below";
const ATTR_SHOW_GIT_BAR = "data-cc-show-git-bar";
const VAR_MAX_LINES = "--cc-editor-max-lines";
const CHAT_ATTRIBUTES = ["data-bui-loader", "data-bui-chips", "data-bui-off"];

/** Mirrors the plugin settings onto <html> so the stylesheets can follow them.
 *  Until settings load, the CSS defaults apply; they match the setting defaults. */
function SettingsBridge() {
  const { values = {}, isLoading } = useSettings();
  const maxLines = clampLines(values.editorMaxLines);
  const inlineFooter = values.inlineFooter !== false;
  const hideGitBar = values.hideGitBar !== false;
  const animateCollapse = values.animateCollapse !== false;
  const keepExpanded = values.keepExpandedAfterKeyboard !== false;
  const { loader, chips, off } = rootAttributes(values);
  const offList = off.join(" ");

  useEffect(() => {
    if (isLoading) return;
    const root = document.documentElement;
    root.style.setProperty(VAR_MAX_LINES, String(maxLines));
    root.toggleAttribute(ATTR_FOOTER_BELOW, !inlineFooter);
    root.toggleAttribute(ATTR_SHOW_GIT_BAR, !hideGitBar);
    root.toggleAttribute(ATTR_NO_ANIMATE, !animateCollapse);
    root.toggleAttribute(ATTR_ALLOW_KEYBOARD_COLLAPSE, !keepExpanded);
    root.setAttribute("data-bui-loader", loader);
    root.setAttribute("data-bui-chips", chips);
    root.setAttribute("data-bui-off", offList);
    return () => {
      root.style.removeProperty(VAR_MAX_LINES);
      root.removeAttribute(ATTR_FOOTER_BELOW);
      root.removeAttribute(ATTR_SHOW_GIT_BAR);
      root.removeAttribute(ATTR_NO_ANIMATE);
      root.removeAttribute(ATTR_ALLOW_KEYBOARD_COLLAPSE);
      CHAT_ATTRIBUTES.forEach((name) => root.removeAttribute(name));
    };
  }, [isLoading, maxLines, inlineFooter, hideGitBar, animateCollapse, keepExpanded, loader, chips, offList]);

  // Pin looping animations to the document clock so remounted rows don't restart.
  useEffect(() => mountPhaseSync(), []);
  // Replace timeline `:has()` with data-* markers so thread switches stay cheap.
  useEffect(() => mountPerfMarkers(), []);

  const tooltips = !off.includes("actions");
  useEffect(() => (tooltips ? mountSpatialTooltips() : undefined), [tooltips]);

  // The coins loader paints through a CSS Paint Worklet; until it is registered (or if
  // it can't be) app.css keeps showing the drive loader instead of a blank icon.
  const coins = loader === "coins";
  useEffect(() => {
    if (!coins) return;
    let current = true;
    registerCoinsWorklet().then((ready) => {
      if (current && ready) document.documentElement.setAttribute("data-bui-coins-ready", "");
    });
    return () => {
      current = false;
      document.documentElement.removeAttribute("data-bui-coins-ready");
    };
  }, [coins]);

  return null;
}

function clampLines(value: unknown): number {
  const n = typeof value === "number" && Number.isFinite(value) ? Math.round(value) : 8;
  return Math.min(Math.max(n, 2), 30);
}

export default definePluginApp((app) => {
  app.contentScripts.register({
    id: "composer-styles",
    mount: ({ signal }) => {
      const style = document.createElement("style");
      style.dataset.bbPlugin = "timur-ui";
      style.textContent = COMPACT_COMPOSER_CSS;
      document.head.appendChild(style);
      const stopAnimation = startCollapseAnimation(signal);
      const stopKeepExpanded = startKeepExpanded(signal);
      const remove = () => {
        stopAnimation();
        stopKeepExpanded();
        style.remove();
      };
      signal.addEventListener("abort", remove, { once: true });
      return remove;
    },
  });
  app.slots.experimental_appOverlay({ id: "settings", component: SettingsBridge });
  app.composer.customize({
    id: "turn-changes",
    scopes: ["thread"],
    banners: [{ id: "changed-files", chrome: "bare", component: ChangedFiles }],
  });
});
