# Browser Annotate live smoke checklist

Run this in desktop BB with the native Browser, the plugin loaded, and a disposable page containing several visible controls/text elements. Keep one current thread open for the whole run. Repeat the run once with the BB server on a remote host (desktop app connected to a remote server).

- [ ] **Toolbar.** Open the Browser tab and confirm the toolbar has **Annotate** with the dashed-box pointer icon. Click it; the button changes to **Annotating**, an **Annotate Page** strip appears above the page, and **Send** is disabled before a saved annotation.
- [ ] **Selection/editor.** Select an element. Confirm the dashed page highlight appears, the editor opens in the strip with keyboard focus in the comment field, enter a comment, press Enter, and confirm a marker plus the count badge. Select a second element and confirm both annotations remain.
- [ ] **Design preview.** Open element settings, change text and a color, confirm the page previews it live, then Cancel and confirm the page is restored.
- [ ] **Screenshots.** After saving, **Send** shows **Capturing…** briefly. Hover the composer mention and confirm each annotation has a thumbnail showing its marker.
- [ ] **React names.** On a React dev build, save an annotation and confirm the sent context lists `React components (innermost first)` with source locations.
- [ ] **Reload.** With a saved draft present, reload the Browser page at the same URL. Within a second the markers return from the stored draft. Run `bb plugin reload browser-annotate`, reopen **Annotate** and confirm the draft returns; the draft is not sent twice.
- [ ] **Navigation.** Navigate to another URL while annotating. Confirm the old page's draft stays in the composer and the new page starts empty (or with its own draft).
- [ ] **Ordinary composer send.** Confirm the draft appears as a Browser comments mention in the composer. Add ordinary text and use the normal composer **Send**. Confirm one chat turn contains the resolved comments and per-element screenshots, the pending mention disappears, and the page markers clear.
- [ ] **Direct Send.** Create a fresh annotation and click **Send** in **Annotate Page**. Confirm one message is sent to the current thread, the live mention disappears, the picker turns off, and the sent item remains in history.
- [ ] **Cleanup/reopen.** Save at least one annotation, press `Escape` or click **Annotating** to stop, and confirm the page overlay is gone while the draft remains. Reopen **Annotate** on the same URL and confirm the draft can be continued or discarded.
- [ ] **Hover history.** Hover the mention while annotating: edit opens the annotation in the strip, delete removes the marker. After a successful send, hover the mention in thread history and confirm the popover lists each target, comment, and screenshot.
