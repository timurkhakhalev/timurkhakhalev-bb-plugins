# Timur UI

Timur's personal bb look, in one plugin: a shorter composer (formerly Compact Composer) and the restyled chat from [Beautiful Chat](https://github.com/diip3sh/bb-plugin-beautiful-chat) (MIT, © Diip3sh; see `LICENSE-beautiful-chat`), without Beautiful Chat's own composer styling. Not meant for the marketplace.

## Composer

Makes the BB thread composer shorter, so more of the chat stays on screen.

- **Prompt height cap.** The prompt grows to `editorMaxLines` lines (8 by default) and then scrolls. BB's own limit is half the viewport.
- **Footer in the action row.** The row under the composer (project, machine, branch, permissions, context) moves into the action row, between the model picker and mic/send. It is anchored to the real controls, so it follows the send button's width (empty, with a send menu, Stop).
- **Machine and branch chips.** The machine (environment) and the branch stay visible; in composers narrower than 600px (side chats) the machine shows as its icon. Hovering (or focusing) them opens a card with the project and the "new thread in this environment" button. BB's "Copy branch name" tooltip is hidden while you hover, so it doesn't cover the card. BB itself now hides this footer on wide screens; inline, the plugin shows it whenever the composer is expanded.
- **Voice input.** While recording, the inline footer hides so it doesn't sit on top of BB's waveform.
- **Permission control.** BB's short label ("Full" instead of "Full Access") with a shield icon instead of the dropdown chevron: a crossed-out shield for Full Access (no sandbox, no approvals), a shield with a check for the other modes. The icon shows in side chats and when the footer is in its own row too.
- **Collapse/expand animation.** The composer resizes smoothly when BB collapses or expands it, and the controls fade in. Respects `prefers-reduced-motion`.
- **Mobile drawer animation.** BB's bottom drawers (model picker, environment, branch) slide up on every open, except the first one after a page load, which appears instantly. The plugin gives that first open a starting position, so it slides up too. Off with `animateCollapse=false` or `prefers-reduced-motion`.
- **Draft stays open after the keyboard closes (touch devices).** BB collapses the composer when the keyboard's Done button closes the keyboard, squeezing a typed draft into a one-line pill. With a draft, the composer now stays open; tapping outside it, or closing the keyboard on an empty composer, still collapses it.
- **Optional:** hide the git changes bar (`Untracked · N files, +X -Y`) above the composer.

- **New-thread composer.** Its picker row (project, environment or machine, branch, permissions) moves into the action row the same way. All pickers stay visible as chips; when space runs out, only the environment label truncates. On phones the row stays under the composer, but the branch shows as an icon and the project name truncates, so nothing overlaps the agent-mode button.

The same layout applies to side chats. When a composer is narrower than 440px (a phone), the footer keeps BB's own row under it.

## Chat look (from Beautiful Chat)

Based on Beautiful Chat 0.1.2+ (upstream commit `5921e7c`). Kept: user message bubbles, code chips, compact work rows and tool chips, pixel loaders, label shimmer, streaming caret, approval cards, selection pill, merged banner stack and background-commands card, tree lines, unread marker, spatial tooltips, and the changed-files list under the latest response. Dropped, because the composer above replaces them: the prompt bar restyle (raised field, filled send button, model popover animation), the tray composer, and "minimize while generating".

## Settings

Settings → Installed plugins → Timur UI, or from a terminal:

```sh
bb plugin config timur-ui
bb plugin config timur-ui set editorMaxLines 10
```

| Key | Default | Effect |
| --- | --- | --- |
| `editorMaxLines` | `8` | Lines the prompt grows to before it scrolls (2–30). |
| `inlineFooter` | `true` | Footer in the action row with the branch chip. `false` keeps BB's own row. |
| `animateCollapse` | `true` | Animate collapse and expand. |
| `keepExpandedAfterKeyboard` | `true` | On touch devices, keep a composer with a draft open when the keyboard's Done button closes the keyboard. |
| `hideGitBar` | `true` | Hide the git changes bar above the thread composer. |
| `loader` | `drive` | Pending-row loader: `drive`, `dots`, `orbit`, `coins`, or `bb` (BB's own). |
| `toolChips` | `surface` | Tool call rows: `surface`, `outline`, or `plain`. |
| `shimmer`, `workRows`, `streamingCaret`, `approvalCard`, `userBubbles`, `codeChips`, `selectionPill`, `treeLines`, `mergedBanners`, `unreadMarker`, `messageActions`, `turnChanges` | `true` | Beautiful Chat's on/off switches; see `src/server.ts` for what each one does. |

Changes apply immediately; no reload needed.

## How it works

Composer (`src/composer/`):

- `styles.ts`: the stylesheet. Defaults (inline footer, animation) apply from CSS alone, so nothing jumps while settings load.
- `../app.tsx`: a content script injects the stylesheet and starts the animation. An app overlay with no UI mirrors the settings onto `<html>`: `data-cc-footer-below`, `data-cc-no-animate`, `data-cc-allow-keyboard-collapse`, `data-cc-show-git-bar`, the `--cc-editor-max-lines` variable, and Beautiful Chat's `data-bui-loader`, `data-bui-chips`, `data-bui-off`.
- `collapse-animation.ts`: BB swaps the composer layout in one commit when it toggles `data-promptbox-compact` on the form, so the plugin plays a FLIP animation from the last observed height to the new one with the Web Animations API.
- `keep-expanded.ts`: after a blur to `<body>` with no recent tap outside the composer, BB waits for the keyboard to close and then collapses. It skips that collapse while the composer contains an open menu (`[aria-haspopup][aria-expanded="true"]`), so the plugin puts a hidden marker with those attributes into the form until the composer is focused again.

Chat look (`src/chat/`), kept close to upstream so changes can be pulled in:

- `app.css`: Beautiful Chat's stylesheet minus the composer sections. Every rule is gated by a `data-bui-off` token or a `data-bui-loader`/`data-bui-chips` value. The drive/dots/orbit/coins loaders and the label shimmer use looping APNG masks (like BB's own shine) to avoid per-frame CSS animation work. `scripts/loader-apng.py` regenerates them; `python3 scripts/check-loader-apng.py` checks the embedded masks, frame timing, and reduced-motion stills (requires Pillow). Native BB measurements are in [docs/performance-2026-10-29.md](docs/performance-2026-10-29.md).
- `settings.ts`: setting values → those attributes. `perf-markers.ts`: stamps `data-bui-*` markers so the CSS avoids broad `:has()`. `phase-sync.ts`, `spatial-tooltip.ts`: loop sync for BB's remaining CSS loops, shared tooltip.
- `changed-files.tsx`, `turn-changes*.ts`, `rpc.ts`: the changed-files list and the server RPC that reads the turn's `fileChange` events.

`src/server.ts` declares the settings and registers the changed-files RPC.

BB's composer markup isn't a public contract. The selectors use its `data-promptbox-*` / `data-follow-up-composer-*` attributes, ids, and aria labels rather than Tailwind classes, but a BB update can still break them. Things that are easy to get wrong:

- On blur, BB removes `data-follow-up-composer-expanded` and sets `data-promptbox-collapsed` while the full composer is still shown. Only `data-promptbox-compact` marks the one-line pill.
- `:has()` can't be nested, so selectors built from `FOOTER`/`ENV` can't go inside another `:has()`.
- Rules for portaled elements (tooltips) must live outside `@container`, because container queries only match descendants of the container.
- Don't declare a `container` on BB's elements. BB already names them (`promptbox-shell` on `[data-app-composer]`, `follow-up-composer` on the thread composer) and uses them for its compact layout; a new name replaces BB's and breaks that layout on phones. Width checks query BB's `promptbox-shell` instead.

## Development

```sh
bun install
bun run check
bun run test
bb plugin build
```

For a live loop against a local BB server, install the directory and run `bb plugin dev`:

```sh
bb plugin install "$PWD"
bb plugin dev
```

If the BB server runs on another machine, the path must exist there: copy `package.json`, `src/`, `skills/`, and `dist/` to that machine (for example with `bb file write --host <host-id>`), install that path, and run `bb plugin reload timur-ui` after each copy.
