// Keyed on data-promptbox-compact (the one-line pill). On blur bb drops
// data-follow-up-composer-expanded and sets data-promptbox-collapsed while
// the full composer is still shown, which made the footer jump on focus.
const FOOTER =
  "[data-follow-up-composer]:has(> * form[data-promptbox]:not([data-promptbox-compact])) > [data-follow-up-composer-footer]";
// Project, machine, branch, and "new thread here" row inside the footer.
// New-thread footer and its picker group. No :has() in either, so rules can
// add their own.
const NT_FOOTER = "[data-new-thread-footer]";
const NT_PICKERS = `${NT_FOOTER} > :first-child`;
const ENV = `${FOOTER} > :first-child > div:has(> [data-promptbox-hide-branch-compact])`;
// The project and "new thread here", which open in the hover card.
const ENV_CARD_ITEM = `:is([data-option-display], button[aria-label="New thread in this environment"])`;

// Lucide shield-check / shield-off, used as CSS masks so they take the label colour.
const svgUrl = (paths: string) =>
  `url("data:image/svg+xml,${encodeURIComponent(
    `<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='none' stroke='black' stroke-width='2' stroke-linecap='round' stroke-linejoin='round'>${paths}</svg>`,
  )}")`;
const SHIELD_CHECK = svgUrl(
  "<path d='M20 13c0 5-3.5 7.5-7.66 8.95a1 1 0 0 1-.67-.01C7.5 20.5 4 18 4 13V6a1 1 0 0 1 1-1c2 0 4.5-1.2 6.24-2.72a1.17 1.17 0 0 1 1.52 0C14.51 3.81 17 5 19 5a1 1 0 0 1 1 1z'/><path d='m9 12 2 2 4-4'/>",
);
const SHIELD_OFF = svgUrl(
  "<path d='m2 2 20 20'/><path d='M5 5a1 1 0 0 0-1 1v7c0 5 3.5 7.5 7.67 8.94a1 1 0 0 0 .67.01c2.35-.82 4.48-1.97 5.9-3.71'/><path d='M9.309 3.652A12.252 12.252 0 0 0 11.24 2.28a1.17 1.17 0 0 1 1.52 0C14.51 3.81 17 5 19 5a1 1 0 0 1 1 1v7a9.784 9.784 0 0 1-.08 1.264'/>",
);

export const COMPACT_COMPOSER_CSS = /* css */ `
/* Editor: cap the height (bb allows up to half the viewport). */
[data-promptbox] [data-promptbox-editor-scroll] {
  max-height: calc(var(--cc-editor-max-lines, 8) * 1.6em + 16px) !important;
  min-height: 0 !important;
  padding: 10px 48px 6px 14px !important;
}
[data-promptbox] [data-promptbox-editor-content] .ProseMirror {
  line-height: 1.6 !important;
}
[data-promptbox] [data-promptbox-input-region] > [data-promptbox-standard-actions] {
  top: 4px !important;
}

/* Action row: slightly thinner. */
[data-promptbox] [data-promptbox-action-row] {
  padding: 2px 10px 6px 10px !important;
}

/* Thread footer (project, machine, branch, permissions): overlay it on the
   free space of the action row, between the model picker and mic/send.
   On by default so it never flashes below while settings load; sized by the
   composer's own width, not the window's. */
/* Width checks use bb's own "promptbox-shell" container on [data-app-composer].
   Never declare a container on bb's elements: that replaces bb's container
   name and breaks its compact layout (labels overlap on phones). */
[data-follow-up-composer] {
  anchor-scope: --cc-model, --cc-send;
}
[data-app-composer] button[aria-label^="Provider, model and reasoning"] {
  anchor-name: --cc-model;
}
[data-app-composer] [data-promptbox-action-row] > [data-promptbox-standard-actions]:last-child {
  anchor-name: --cc-send;
}
@container promptbox-shell (min-width: 440px) {
  html:not([data-cc-footer-below]) ${FOOTER} {
    position: absolute !important;
    left: 220px;
    right: 96px;
    bottom: 8px;
    margin: 0 !important;
    z-index: 21;
    justify-content: flex-end;
    pointer-events: none;
    overflow: visible !important;
    /* bb hides the footer on wide screens unless it sets
       data-follow-up-composer-footer-visible (phones only); inline it always shows. */
    opacity: 1;
    min-height: 24px;
    max-height: 24px;
  }
  /* Hug the real controls: the mic/send cluster changes width (send menu,
     stop button), so a fixed offset left a gap or overlapped. */
  @supports (anchor-name: --a) {
    html:not([data-cc-footer-below]) ${FOOTER} {
      left: calc(anchor(--cc-model right, 220px) + 8px);
      right: calc(anchor(--cc-send left, 96px) + 4px);
    }
  }
  /* bb pads the footer for its own row; inline, that only pushes it off the mic. */
  html:not([data-cc-footer-below]) ${FOOTER} {
    padding-right: 0 !important;
  }
  html:not([data-cc-footer-below]) ${FOOTER} button[aria-label^="Context window"] {
    margin-right: 0 !important;
  }
  html:not([data-cc-footer-below]) ${FOOTER} > * {
    pointer-events: auto;
  }
  html:not([data-cc-footer-below]) ${FOOTER} > :first-child {
    justify-content: flex-end;
    overflow: visible !important;
  }

  /* Environment: the machine and the branch stay visible; the project and
     "new thread here" move into a popover that opens on hover/focus. They
     stay bb's own elements, so their clicks keep working. */
  html:not([data-cc-footer-below]) ${ENV} {
    position: relative;
    min-width: 0;
    padding-right: 0 !important;
  }
  /* The machine label gives way first; the branch keeps its width. */
  html:not([data-cc-footer-below]) ${ENV} > span {
    min-width: 16px;
    max-width: 180px !important;
    flex: 0 1 auto !important;
  }
  html:not([data-cc-footer-below]) ${ENV} > span > span {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  html:not([data-cc-footer-below]) ${ENV} > [data-promptbox-hide-branch-compact] {
    min-width: 0;
    max-width: 160px;
    flex: 0 0 auto !important;
  }
  html:not([data-cc-footer-below]) ${ENV}::before,
  html:not([data-cc-footer-below]) ${ENV}::after,
  html:not([data-cc-footer-below]) ${ENV} > ${ENV_CARD_ITEM} {
    position: absolute !important;
    visibility: hidden;
    opacity: 0;
    transition: opacity 120ms ease-out, visibility 0s linear 120ms;
    z-index: 1;
  }
  /* Popover card, right-aligned to the chips, 8px above them. */
  html:not([data-cc-footer-below]) ${ENV}::before {
    content: "";
    box-sizing: border-box;
    right: -6px;
    bottom: calc(100% + 8px);
    width: 256px;
    height: 40px;
    border: 1px solid var(--border);
    border-radius: 10px;
    background: var(--popover);
    box-shadow: 0 8px 24px -6px rgb(0 0 0 / 0.18);
    z-index: 0;
  }
  /* Invisible bridge over the 8px gap so the pointer can travel up into the card. */
  html:not([data-cc-footer-below]) ${ENV}::after {
    content: "";
    right: -6px;
    bottom: 100%;
    width: 256px;
    height: 10px;
  }
  html:not([data-cc-footer-below]) ${ENV} > [data-option-display] {
    left: calc(100% - 238px);
    bottom: calc(100% + 16px);
    max-width: 200px;
  }
  html:not([data-cc-footer-below]) ${ENV} > button[aria-label="New thread in this environment"] {
    right: 4px;
    bottom: calc(100% + 14px);
    margin: 0 !important;
  }
  html:not([data-cc-footer-below]) ${ENV}:is(:hover, :focus-within)::before,
  html:not([data-cc-footer-below]) ${ENV}:is(:hover, :focus-within)::after,
  html:not([data-cc-footer-below]) ${ENV}:is(:hover, :focus-within) > ${ENV_CARD_ITEM} {
    visibility: visible;
    opacity: 1;
    transition: opacity 120ms ease-out;
  }
  /* Side chats and other narrow composers: the machine shows as its icon only,
     rather than a label cut to one letter. */
  @container promptbox-shell (max-width: 599.98px) {
    html:not([data-cc-footer-below]) ${ENV} > span > span {
      display: none;
    }
  }

  /* Permission mode: bb's short label ("Full") instead of "Full Access". */
  html:not([data-cc-footer-below]) ${FOOTER} button[aria-label="Permission mode"] [data-promptbox-full-label] {
    display: none !important;
  }
  html:not([data-cc-footer-below]) ${FOOTER} button[aria-label="Permission mode"] [data-promptbox-compact-label] {
    display: inline !important;
  }
}

/* Voice input: bb swaps the action row for a waveform that spans the whole
   row, so an inline footer would sit on top of it. Hide it while recording. */
@container promptbox-shell (min-width: 440px) {
  html:not([data-cc-footer-below]) [data-follow-up-composer]:has(> * form[data-promptbox-voice-active]) > [data-follow-up-composer-footer],
  html:not([data-cc-footer-below]) [data-app-composer]:has(> * form[data-promptbox-voice-active]) > ${NT_FOOTER} {
    visibility: hidden !important;
  }
}

/* A shield in place of the dropdown chevron: shield-off for Full Access
   (no sandbox, no approvals), shield-check for the other modes.
   Applies to thread and new-thread composers, inline or in their own row. */
[data-follow-up-composer-footer] button[aria-label="Permission mode"],
[data-new-thread-footer] button[aria-label="Permission mode"] {
  gap: 4px !important;
}
[data-follow-up-composer-footer] button[aria-label="Permission mode"] > svg,
[data-new-thread-footer] button[aria-label="Permission mode"] > svg {
  display: none !important;
}
[data-follow-up-composer-footer] button[aria-label="Permission mode"]::before,
[data-new-thread-footer] button[aria-label="Permission mode"]::before {
  content: "";
  flex: none;
  width: 14px;
  height: 14px;
  background-color: currentColor;
  -webkit-mask: ${SHIELD_CHECK} center / contain no-repeat;
  mask: ${SHIELD_CHECK} center / contain no-repeat;
}
[data-follow-up-composer-footer] button[aria-label="Permission mode"]:has(> [title^="Permission mode: Full"])::before,
[data-new-thread-footer] button[aria-label="Permission mode"]:has(> [title^="Permission mode: Full"])::before {
  -webkit-mask-image: ${SHIELD_OFF};
  mask-image: ${SHIELD_OFF};
}

/* New-thread composer: same idea. Its footer holds real pickers (project,
   environment/machine, branch); all stay visible as chips, each truncating
   its label. */
[data-app-composer]:has(> [data-new-thread-footer]) {
  position: relative;
  anchor-scope: --cc-model, --cc-send;
}
@container promptbox-shell (min-width: 440px) {
  html:not([data-cc-footer-below]) ${NT_FOOTER} {
    position: absolute !important;
    left: 220px;
    right: 96px;
    bottom: 8px;
    margin: 0 !important;
    padding: 0 !important;
    z-index: 21;
    justify-content: flex-end;
    gap: 8px !important;
    pointer-events: none;
    overflow: visible !important;
  }
  @supports (anchor-name: --a) {
    html:not([data-cc-footer-below]) ${NT_FOOTER} {
      left: calc(anchor(--cc-model right, 220px) + 8px);
      right: calc(anchor(--cc-send left, 96px) + 4px);
    }
  }
  html:not([data-cc-footer-below]) ${NT_FOOTER} > * {
    pointer-events: auto;
  }
  html:not([data-cc-footer-below]) ${NT_PICKERS} {
    position: relative;
    flex: 0 1 auto !important;
    min-width: 0;
    overflow: visible !important;
  }
  /* Only the environment label gives way; project and branch keep their
     (capped) width. The branch picker comes from the git plugin, inside a
     display: contents root. */
  html:not([data-cc-footer-below]) ${NT_PICKERS} > button,
  html:not([data-cc-footer-below]) ${NT_PICKERS} button[aria-label="Branch"] {
    min-width: 0;
    max-width: 170px;
    flex: 0 0 auto !important;
  }
  html:not([data-cc-footer-below]) ${NT_PICKERS} > [data-promptbox-project-control] {
    max-width: 150px;
  }
  html:not([data-cc-footer-below]) ${NT_PICKERS} > button[aria-label="Environment"] {
    min-width: 40px;
    max-width: 200px;
    flex: 0 1 auto !important;
  }
  html:not([data-cc-footer-below]) ${NT_FOOTER} button[aria-label="Permission mode"] [data-promptbox-full-label] {
    display: none !important;
  }
  html:not([data-cc-footer-below]) ${NT_FOOTER} button[aria-label="Permission mode"] [data-promptbox-compact-label] {
    display: inline !important;
  }
}

/* Narrow new-thread composer (phones): bb squeezes the branch picker's label
   to a sliver, and a long project name pushes that text over the agent-mode
   button. Show the branch as an icon only, let the project name truncate,
   and keep the picker group inside its own box. */
@container promptbox-shell (max-width: 439.98px) {
  ${NT_PICKERS} {
    overflow: hidden;
  }
  ${NT_FOOTER} button[aria-label="Branch"] > span > span:not(:has(svg)) {
    display: none !important;
  }
  /* The project name gives way first; environment and branch stay whole. */
  ${NT_PICKERS} button:not([data-promptbox-project-control]) {
    flex-shrink: 0 !important;
  }
  ${NT_PICKERS} [data-promptbox-project-control] {
    min-width: 0;
    flex-shrink: 1 !important;
  }
  ${NT_PICKERS} [data-promptbox-project-control] [data-promptbox-compact-label] {
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
}

/* Mobile drawers (model picker and other composer pickers): bb animates
   every open except the first one after a page load, when the drawer mounts
   straight at its open position. Give it a starting position so the first
   open slides up too; bb's own inline transition does the rest. */
@media (prefers-reduced-motion: no-preference) {
  @starting-style {
    html:not([data-cc-no-animate]) [data-persistent-drawer-content][data-state="open"] {
      transform: translate3d(0, 100%, 0) !important;
    }
    html:not([data-cc-no-animate]) [data-persistent-drawer-backdrop][data-state="open"] {
      opacity: 0 !important;
    }
  }
}

/* bb's own tooltips ("Copy branch name") would cover the env card. Keyed on
   the branch button directly because :has() cannot nest (ENV uses one), and
   kept outside @container because the tooltip is portaled out of the composer. */
html:not([data-cc-footer-below]):has([data-follow-up-composer-footer] [data-promptbox-hide-branch-compact]:hover) [data-radix-popper-content-wrapper]:has([role="tooltip"]) {
  display: none !important;
}

/* Git changes bar above the thread composer. Hide only the git row; the
   whole context section goes when git is its only row. The toggle's depth
   changes between bb versions (it moved into the bb--git plugin), so match
   it anywhere inside the section. */
html:not([data-cc-show-git-bar]) #thread-prompt-banner-git-toggle,
html:not([data-cc-show-git-bar]) #thread-prompt-banner-git-body {
  display: none !important;
}
html:not([data-cc-show-git-bar]) section:has(#thread-prompt-banner-git-toggle):not(:has(> :nth-child(3))) {
  display: none !important;
}

/* Expand: fade in the controls bb mounts or reveals (pickers, footer). */
@media (prefers-reduced-motion: no-preference) {
  html:not([data-cc-no-animate]) form[data-promptbox]:not([data-promptbox-compact]) [data-promptbox-action-row] > *,
  html:not([data-cc-no-animate]) [data-follow-up-composer-footer] {
    transition: opacity 200ms ease-out 60ms;
  }
  @starting-style {
    html:not([data-cc-no-animate]) form[data-promptbox]:not([data-promptbox-compact]) [data-promptbox-action-row] > *,
    html:not([data-cc-no-animate]) [data-follow-up-composer-footer] {
      opacity: 0;
    }
  }
}

/* Less space under the composer. */
.chat-prompt-box {
  padding-bottom: 10px !important;
}
`;
