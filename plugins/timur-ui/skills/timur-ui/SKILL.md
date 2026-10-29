---
name: timur-ui
description: Change how the Timur UI plugin styles BB: the composer (prompt height, footer placement, collapse animation, keeping a draft open after the mobile keyboard closes, git changes bar) and the chat look taken from Beautiful Chat (loaders, tool rows, message bubbles, code chips, approval cards, tree lines, changed-files list) through its plugin settings.
---

# Timur UI settings

Timur UI restyles BB's composer and chat. It has no CLI command of its own; change it through plugin settings. Changes apply in open windows immediately.

```sh
bb plugin config timur-ui                         # show current values and descriptions
bb plugin config timur-ui set <key> <value>
bb plugin config timur-ui unset <key>             # back to the default
```

Composer:

| Key | Type | Default | Effect |
| --- | --- | --- | --- |
| `editorMaxLines` | number | `8` | Lines the prompt grows to before it scrolls; clamped to 2–30. |
| `inlineFooter` | boolean | `true` | Show the branch chip, permissions, and context in the composer's action row. `false` restores BB's own row under the composer. |
| `animateCollapse` | boolean | `true` | Animate the composer when it collapses or expands, and the first open of mobile drawers. |
| `keepExpandedAfterKeyboard` | boolean | `true` | On touch devices, keep a composer with a draft open when the keyboard's Done button closes the keyboard. |
| `hideGitBar` | boolean | `true` | Hide the git changes bar (`Untracked · N files, +X -Y`) above the thread composer. |

Chat look (from Beautiful Chat):

| Key | Type | Default | Effect |
| --- | --- | --- | --- |
| `loader` | select | `drive` | Pending work row icon: `drive`, `dots`, `orbit`, `coins`, `bb` (BB's own). |
| `toolChips` | select | `surface` | Tool call rows: `surface` (fill + hairline), `outline`, `plain`. |
| `shimmer` | boolean | `true` | Brighter, faster shimmer on pending labels. |
| `workRows` | boolean | `true` | Pill-shaped work row headers, 12.5px text, guide line under expanded details. |
| `streamingCaret` | boolean | `true` | Caret at the end of a streaming reply. |
| `approvalCard` | boolean | `true` | Raised cards with pill buttons for permission requests and questions. |
| `userBubbles` | boolean | `true` | Soft filled bubbles for the user's messages. |
| `codeChips` | boolean | `true` | Hairline chips for inline code, hairline cards for code blocks. |
| `selectionPill` | boolean | `true` | Pill style for the "Add to chat / Reply in side chat" popover. |
| `treeLines` | boolean | `true` | Rows of an expanded work group joined by tree lines. |
| `mergedBanners` | boolean | `true` | Cards above the composer grouped into one card; background-commands card style. |
| `unreadMarker` | boolean | `true` | `NEW` on the first unread work row instead of BB's separator. |
| `messageActions` | boolean | `true` | Hover chips and one shared gliding tooltip on rows of 3+ icon buttons. |
| `turnChanges` | boolean | `true` | Under the latest response, the files its turn edited with line counts. |

Constraints:

- The inline footer applies to thread, side-chat, and new-thread composers, and turns off by itself when the composer is narrower than 440px. On the new-thread screen the project and branch pickers stay visible and the environment opens in a hover card.
- Beautiful Chat's own composer styles (prompt bar, tray composer, minimize while generating) are not included; the composer is this plugin's.
- The plugin styles BB's markup, which isn't a public API. If something looks broken after a BB update, turn off the matching setting or disable the plugin with `bb plugin disable timur-ui`.
