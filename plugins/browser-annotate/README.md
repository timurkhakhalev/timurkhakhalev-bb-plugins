# Browser Annotate

This plugin brings the core Browser comments workflow from Codex App to BB: users select page elements, leave comments, and send them with their next message.

## Demo

https://github.com/user-attachments/assets/51067015-72bb-43c3-9459-a9c4a36ec2cd

## Workflow

1. Open a page in the built-in Browser.
2. Click **Annotate** in the Browser toolbar next to the address bar.
3. Select a DOM element. The page outlines it and an editor popover opens next to the element. Write a comment, open element settings to preview design changes live on the page if needed, and save it.
4. After every save, the composer receives an annotation mention. Hover over it to review, edit, or delete a comment.
5. Repeat for any other elements. You can also click a marker on the page to edit or delete its comment.
6. Click **Send** next to **Annotate** in the toolbar, or send the mention with your next composer message.
7. The plugin sends one `N annotations` message to the current chat with the full context and screenshots. The picker turns off, and the sent annotations remain available by hovering over the mention in the chat history.

`Escape` and a second click on **Annotate** turn off the picker while preserving annotations already added to the composer. Removing the mention from the composer discards the entire unsent batch.

## Agent context

When the mention is sent, it resolves into user-hidden, agent-only inputs containing:

- a `# Browser comments:` block with a separate section for each comment;
- the page URL, target, role, CSS selector, and DOM path;
- element attribute metadata and coordinates;
- immediate, nearby, and selected text;
- React component names, innermost first, with source locations on dev builds;
- the interface theme at the time of capture;
- one JPEG per comment, captured after it is saved, with its numbered marker visible.

Page text and images are explicitly marked as untrusted page evidence. The picker, markers, and design preview run in BB's isolated world for the tab (`experimental_page`), so page scripts share the DOM but cannot reach the controller or `bb.postMessage`, and synthetic page events cannot select elements. The editor popover lives in a closed shadow root created from the isolated world and accepts only trusted (real user) clicks and keys, so only a comment the user confirmed counts as a user instruction.

## Data flow

```text
Browser toolbar action (desktop renderer)
  -> experimental_page.evaluate injects the picker into the tab's isolated world
  -> the editor popover opens next to the element inside a closed shadow root;
     design edits preview on the page; only trusted input saves
  -> Save commits on the page; the renderer probes React names in the main world
  -> sync sends the page batch to the server, which persists it in thread storage
  -> annotations without a screenshot for their current version are captured with
     sdk.experimental_desktopBrowsers.captureTab (no CDP lease, no host worker)
  -> the composer gets one Browser comments mention per pending batch
  -> reload or navigation drops the page script; the toolbar action re-injects it
     and restores the draft stored for that URL
  -> Send (toolbar or composer) resolves the mention into agent-only text +
     labeled localImage inputs; sent comments are mirrored in plugin KV for hover details
```

Nothing runs on the desktop host except BB itself, so the same flow works when the BB server lives on a remote machine.

`Send` calls `threads.send` in `steer-if-active` mode: an idle chat starts the message immediately, while an active run receives it as a steering message. The model, reasoning level, and permission mode come from the current thread settings.

## Structure

- `src/app.tsx` — Browser toolbar action and Send button, composer mention sync, and hover card.
- `src/page-script.ts` — isolated-world picker, markers, editor popover, design preview, and the main-world React probe.
- `src/server.ts` — pending batches, screenshots via `captureTab`, mention provider, and thread storage.
- `src/contracts.ts` — Zod contracts shared by the renderer and server.
- Requires BB 0.48 or newer (`@get-bb/plugin-sdk` 0.6) for `experimental_page` and `captureTab`.

## Limitations

- Requires desktop BB with the native Browser.
- Supports DOM elements in the top-level document. Cross-origin iframes, arbitrary regions, and virtual targets are not supported yet. Screenshots cover the visible viewport.
- Up to 50 comments per batch.
- Pending batches are stored in thread storage and indexed in plugin KV. Sent comments are mirrored in plugin KV so their hover details survive thread-storage cleanup. Pending drafts recover after page reloads and plugin restarts, and expire after 24 hours.

## Verification

```sh
bun install
bun run check
bb plugin build
```

The checks compile against `@get-bb/plugin-sdk@0.6.79`. Install from the [release tag](https://github.com/timurkhakhalev/timurkhakhalev-bb-plugins/tags) with `bb plugin install` and `--plugin browser-annotate`.
