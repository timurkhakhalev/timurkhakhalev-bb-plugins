# Browser Annotate

This plugin brings the core Browser comments workflow from Codex App to BB: users select page elements, leave comments, and send them with their next message.

## Demo

https://github.com/user-attachments/assets/51067015-72bb-43c3-9459-a9c4a36ec2cd

## Workflow

1. Open a page in the built-in Browser.
2. Click **Annotate** in the Browser toolbar next to the address bar.
3. Select a DOM element. A compact trusted editor opens below the Browser toolbar. Write a comment, adjust the options in the scrollable category list if needed, and save it.
4. After every save, the banner above the composer immediately updates the annotation count and list. Hover over the list to edit or delete a comment, or discard the entire batch.
5. Repeat for any other elements. You can also open a marker on the page to edit or delete its comment.
6. Click **Send** in the compact **Annotate Page** panel.
7. The plugin sends one `N annotations` message to the current chat with the full context and screenshots. The live banner disappears, and the sent annotations remain available by hovering over the mention in the chat history.

`Escape` and a second click on **Annotate** turn off the picker while preserving annotations already added to the composer. Removing the mention from the composer discards the entire unsent batch.

## Agent context

When the mention is sent, it resolves into user-hidden, agent-only inputs containing:

- a `# Browser comments:` block with a separate section for each comment;
- the page URL and frame URL;
- the target, role, CSS selector, and DOM path;
- element attribute metadata;
- element and viewport coordinates;
- immediate, nearby, and selected text;
- the interface theme at the time of capture;
- one JPEG per comment, captured immediately after the selection is saved.

Page text and images are explicitly marked as untrusted page evidence. The page owns only the selection outline, markers, and design preview inside a CDP isolated world. The comment field, control values, Save, and Send live in the BB renderer outside the page webContents, so the page never receives user input or controls the send intent. Only a comment confirmed in the trusted editor counts as a user instruction.

## Data flow

```text
Browser toolbar action
  -> server resolves the active thread/tab to a desktop Browser instance
  -> host acquires the tab and injects only picker/markers into an isolated world
  -> the page supplies untrusted element evidence to a trusted BB editor
  -> Save commits through server RPC and persists before the UI confirms success
  -> every saved or edited comment queues a versioned CDP screenshot
  -> composer polls the live revision and renders the current annotation list
  -> edit/delete actions update the same page overlay
  -> reload reinjects the picker from the persisted draft; hard and SPA navigation pause the previous page batch
  -> Send drains the capture queue and stores current-version screenshots in thread storage
  -> batch metadata is persisted beside the screenshots and sent comments are mirrored in plugin KV for message hover details
  -> server sends one Browser comments mention to the current thread
  -> send resolves the mention
  -> agent-only text + labeled localImage inputs are appended to that turn
```

`Send` calls `threads.send` in `steer-if-active` mode: an idle chat starts the message immediately, while an active run receives it as a steering message. The model, reasoning level, and permission mode come from the current thread settings.

## Structure

- `src/app.tsx` — Browser toolbar action and composer bridge.
- `src/server.ts` — Browser lease, pending batches, mention provider, and thread storage.
- `src/host.ts` — CDP client, picker, and per-element screenshots.
- `src/contracts.ts` — Zod contracts shared across the frontend, server, and host.
- `src/server.test.ts` — prompt-format and input-boundary tests.
- BB 0.43.4 or newer — Browser toolbar slot and image inputs for mention providers, added in [get-bb/bb#3623](https://github.com/get-bb/bb/pull/3623).

## Limitations

- Requires desktop BB with the native Browser.
- Supports DOM elements in the top-level document. Cross-origin iframes, arbitrary regions, and virtual targets are not supported yet.
- Up to 50 comments per batch.
- Browser leases expire after 30 minutes.
- Pending batches are stored in thread storage and indexed in plugin KV. Sent comments are mirrored in plugin KV so their hover details survive thread-storage cleanup. Pending drafts recover after page reloads and plugin restarts, and expire after 24 hours.

## Verification

```sh
bun install
bun run check
bb plugin build
```

The checks compile against the published `@get-bb/plugin-sdk@0.5.9`. Install from the [release tag](https://github.com/timurkhakhalev/timurkhakhalev-bb-plugins/tags) with `bb plugin install` and `--plugin browser-annotate`.
