## What you get

A shorter thread composer that leaves more of the chat on screen. The prompt grows to a set number of lines and then scrolls, instead of taking up to half the window. The row under the composer (project, machine, branch, permissions, context) moves into the composer's own action row: only the branch stays visible, and project, machine, and "new thread here" open in a small card when you hover it. The new-thread composer gets the same treatment: the branch picker stays visible and project and environment open in a card. Permissions use the short label ("Full") with a shield icon instead of a dropdown arrow. Collapsing and expanding the composer is animated, and on a phone a draft stays open when you close the keyboard with Done.

## How it works

The plugin restyles BB's own composer elements; it doesn't replace them, so every click, picker, and shortcut works as before. Settings let you change the maximum prompt height, keep the footer row under the composer, turn the animation off, let the keyboard collapse a draft again, and hide the git changes bar above the composer.

## Requirements

BB 0.47 or newer. The styles target BB's composer markup, which isn't a public API, so a BB update can break parts of the layout until the plugin is updated. The footer stays in its own row when the composer is narrower than 440px.
