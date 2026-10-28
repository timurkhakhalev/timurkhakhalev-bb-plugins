# Compact Composer

Makes the BB thread composer shorter, so more of the chat stays on screen.

- **Prompt height cap.** The prompt grows to `editorMaxLines` lines (8 by default) and then scrolls. BB's own limit is half the viewport.
- **Footer in the action row.** The row under the composer (project, machine, branch, permissions, context) moves into the action row, between the model picker and mic/send. It is anchored to the real controls, so it follows the send button's width (empty, with a send menu, Stop).
- **Branch chip.** Only the branch is visible. Hovering (or focusing) it opens a card with the project, the machine, and the "new thread in this environment" button. BB's "Copy branch name" tooltip is hidden while you hover the chip, so it doesn't cover the card.
- **Permission control.** BB's short label ("Full" instead of "Full Access") with a shield icon instead of the dropdown chevron: a crossed-out shield for Full Access (no sandbox, no approvals), a shield with a check for the other modes. The icon shows in side chats and when the footer is in its own row too.
- **Collapse/expand animation.** The composer resizes smoothly when BB collapses or expands it, and the controls fade in. Respects `prefers-reduced-motion`.
- **Draft stays open after the keyboard closes (touch devices).** BB collapses the composer when the keyboard's Done button closes the keyboard, squeezing a typed draft into a one-line pill. With a draft, the composer now stays open; tapping outside it, or closing the keyboard on an empty composer, still collapses it.
- **Optional:** hide the git changes bar (`Untracked · N files, +X -Y`) above the composer.

- **New-thread composer.** Its picker row (project, environment or machine, branch, permissions) moves into the action row the same way. The last picker, usually the branch, stays visible; project and environment open in a card on hover, and the card stays open while one of its dropdowns is open.

The same layout applies to side chats. When a composer is narrower than 440px (a phone), the footer keeps BB's own row under it.

## Settings

Settings → Installed plugins → Compact Composer, or from a terminal:

```sh
bb plugin config compact-composer
bb plugin config compact-composer set editorMaxLines 10
```

| Key | Default | Effect |
| --- | --- | --- |
| `editorMaxLines` | `8` | Lines the prompt grows to before it scrolls (2–30). |
| `inlineFooter` | `true` | Footer in the action row with the branch chip. `false` keeps BB's own row. |
| `animateCollapse` | `true` | Animate collapse and expand. |
| `keepExpandedAfterKeyboard` | `true` | On touch devices, keep a composer with a draft open when the keyboard's Done button closes the keyboard. |
| `hideGitBar` | `false` | Hide the git changes bar above the thread composer. |

Changes apply immediately; no reload needed.

## How it works

- `src/styles.ts`: the stylesheet. Defaults (inline footer, animation) apply from CSS alone, so nothing jumps while settings load.
- `src/app.tsx`: a content script injects the stylesheet and starts the animation. An app overlay with no UI mirrors the settings onto `<html>` attributes (`data-cc-footer-below`, `data-cc-no-animate`, `data-cc-allow-keyboard-collapse`, `data-cc-hide-git-bar`) and the `--cc-editor-max-lines` variable.
- `src/collapse-animation.ts`: BB swaps the composer layout in one commit when it toggles `data-promptbox-compact` on the form, so the plugin plays a FLIP animation from the last observed height to the new one with the Web Animations API.
- `src/keep-expanded.ts`: after a blur to `<body>` with no recent tap outside the composer, BB waits for the keyboard to close and then collapses. It skips that collapse while the composer contains an open menu (`[aria-haspopup][aria-expanded="true"]`), so the plugin puts a hidden marker with those attributes into the form until the composer is focused again.
- `src/server.ts`: declares the settings only.

BB's composer markup isn't a public contract. The selectors use its `data-promptbox-*` / `data-follow-up-composer-*` attributes, ids, and aria labels rather than Tailwind classes, but a BB update can still break them. Things that are easy to get wrong:

- On blur, BB removes `data-follow-up-composer-expanded` and sets `data-promptbox-collapsed` while the full composer is still shown. Only `data-promptbox-compact` marks the one-line pill.
- `:has()` can't be nested, so selectors built from `FOOTER`/`ENV` can't go inside another `:has()`.
- Rules for portaled elements (tooltips) must live outside `@container`, because container queries only match descendants of the container.
- Don't declare a `container` on BB's elements. BB already names them (`promptbox-shell` on `[data-app-composer]`, `follow-up-composer` on the thread composer) and uses them for its compact layout; a new name replaces BB's and breaks that layout on phones. Width checks query BB's `promptbox-shell` instead.

## Development

```sh
bun install
bun run check
bb plugin build
```

For a live loop against a local BB server, install the directory and run `bb plugin dev`:

```sh
bb plugin install "$PWD"
bb plugin dev
```

If the BB server runs on another machine, the path must exist there: copy `package.json`, `src/`, `skills/`, and `dist/` to that machine (for example with `bb file write --host <host-id>`), install that path, and run `bb plugin reload compact-composer` after each copy.
