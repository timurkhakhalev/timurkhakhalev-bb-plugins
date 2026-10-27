---
name: compact-composer
description: Change how the Compact Composer plugin lays out the BB thread composer (prompt height, footer placement, collapse animation, git changes bar) through its plugin settings.
---

# Compact Composer settings

The Compact Composer plugin restyles BB's thread composer. It has no CLI command of its own; change it through plugin settings. Changes apply in open windows immediately.

```sh
bb plugin config compact-composer                         # show current values
bb plugin config compact-composer set <key> <value>
bb plugin config compact-composer unset <key>             # back to the default
```

| Key | Type | Default | Effect |
| --- | --- | --- | --- |
| `editorMaxLines` | number | `8` | Lines the prompt grows to before it scrolls; clamped to 2–30. |
| `inlineFooter` | boolean | `true` | Show the branch chip, permissions, and context in the composer's action row. `false` restores BB's own row under the composer. |
| `animateCollapse` | boolean | `true` | Animate the composer when it collapses or expands. |
| `hideGitBar` | boolean | `false` | Hide the git changes bar (`Untracked · N files, +X -Y`) above the thread composer. |

Constraints:

- Only the thread composer gets the inline footer; the new-thread screen keeps BB's layout except for the prompt height cap.
- The inline footer turns off by itself when the composer is narrower than 600px.
- The plugin styles BB's composer markup, which isn't a public API. If the composer looks broken after a BB update, disable the plugin with `bb plugin disable compact-composer` and report it.
