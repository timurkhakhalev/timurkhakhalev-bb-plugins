import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { experimental_createHostEntryHarness } from "@get-bb/plugin-sdk/testing/host";
import { CdpFixture, loadBundledHostEntry, restoredBatch } from "./cdp-fixture.js";
import { batchSchema, type Batch } from "./contracts.js";

type HostEntry = Parameters<typeof experimental_createHostEntryHarness>[0];
type HostHarness = ReturnType<typeof experimental_createHostEntryHarness>;

let bundledEntry: HostEntry;
let cleanupBundle: (() => Promise<void>) | undefined;

beforeAll(async () => {
  const loaded = await loadBundledHostEntry();
  bundledEntry = loaded.entry as HostEntry;
  cleanupBundle = loaded.cleanup;
});

afterAll(async () => {
  await cleanupBundle?.();
});

function hostFor(): HostHarness {
  return experimental_createHostEntryHarness(bundledEntry, {
    experimental_paths: {
      dataDir: "/tmp/browser-annotate-test-data",
      tempDir: "/tmp/browser-annotate-test-temp",
    },
  });
}

async function start(
  harness: HostHarness,
  fixture: CdpFixture,
  batch: Batch | null = null,
) {
  return harness.experimental_call("startSession", {
    wsEndpoint: fixture.endpoint,
    batch,
  });
}

async function read(harness: HostHarness, fixture: CdpFixture, afterRevision = -1) {
  return harness.experimental_call("readSession", {
    wsEndpoint: fixture.endpoint,
    afterRevision,
  });
}

function click(window: CdpFixture["dom"]["window"], selector: string): void {
  const element = window.document.querySelector(selector);
  if (!element) throw new Error(`fixture element not found: ${selector}`);
  element.dispatchEvent(new window.Event("pointerdown", { bubbles: true, cancelable: true }));
}

async function closeSession(harness: HostHarness, fixture: CdpFixture): Promise<void> {
  const errors: unknown[] = [];
  try {
    await harness.experimental_call("cleanupSession", { wsEndpoint: fixture.endpoint });
  } catch (error) {
    errors.push(error);
  }
  try {
    await harness.experimental_dispose();
  } catch (error) {
    errors.push(error);
  }
  try {
    await fixture.close();
  } catch (error) {
    errors.push(error);
  }
  if (errors.length > 0) throw new AggregateError(errors, "Could not clean up the host fixture");
}

describe("actual host entry and injected page script", () => {
  test("selection creates the trusted editor and save returns the complete comment batch", async () => {
    const fixture = new CdpFixture();
    const harness = hostFor();
    try {
      await expect(start(harness, fixture)).resolves.toMatchObject({
        started: true,
        currentUrl: fixture.url,
        restored: false,
      });
      click(fixture.dom.window, "button");
      const opened = await read(harness, fixture);
      expect(opened).toMatchObject({
        status: "active",
        editor: { tag: "button", annotationId: null },
        batch: { annotations: [] },
      });
      const editorId = (opened as { editor: { id: string } }).editor.id;
      const saved = await harness.experimental_call("saveEditor", {
        wsEndpoint: fixture.endpoint,
        editorId,
        comment: "Make this easier to find.",
        designChange: null,
      });
      expect(saved).toMatchObject({
        saved: true,
        batch: { annotations: [{ comment: "Make this easier to find.", version: 1 }] },
        captures: [{ annotationId: expect.any(String), version: 1, image: { mimeType: "image/jpeg" } }],
        captureFailed: false,
      });
    } finally {
      await closeSession(harness, fixture);
    }
  });

  test("preview cancel restores whitespace, empty text, replacement text nodes, and CSS", async () => {
    const fixture = new CdpFixture({
      html: "<!doctype html><html><head></head><body><main><button>  Some sample text  </button><span id='empty'></span></main></body></html>",
    });
    const harness = hostFor();
    try {
      await start(harness, fixture);
      click(fixture.dom.window, "button");
      const opened = await read(harness, fixture);
      const editorId = (opened as { editor: { id: string } }).editor.id;
      const designChange = {
        text: { previousValue: "Some sample text", value: "Changed text" },
        declarations: [{ property: "color", previousValue: "", value: "rgb(255, 0, 0)" }],
      } as const;
      await expect(harness.experimental_call("previewEditor", {
        wsEndpoint: fixture.endpoint,
        editorId,
        previewRevision: 1,
        designChange,
      })).resolves.toEqual({ changed: true });
      expect(fixture.dom.window.document.querySelector("button")?.textContent).toBe("Changed text");
      expect(fixture.dom.window.document.querySelector("button")?.getAttribute("data-bb-annotation-design")).toBeTruthy();

      const replacement = fixture.dom.window.document.createTextNode("  Some sample text  ");
      fixture.dom.window.document.querySelector("button")?.replaceChildren(replacement);
      await expect(harness.experimental_call("cancelEditor", {
        wsEndpoint: fixture.endpoint,
        editorId,
      })).resolves.toEqual({ changed: true });
      expect(fixture.dom.window.document.querySelector("button")?.textContent).toBe("  Some sample text  ");
      expect(fixture.dom.window.document.querySelector("button")?.getAttribute("data-bb-annotation-design")).toBeNull();
      expect(fixture.dom.window.document.getElementById("__bbAnnDesignStyle")?.textContent).toBe("");

      click(fixture.dom.window, "#empty");
      const emptyEditor = (await read(harness, fixture) as { editor: { id: string } }).editor;
      expect(emptyEditor).toMatchObject({ tag: "span", annotationId: null });
      await expect(harness.experimental_call("cancelEditor", {
        wsEndpoint: fixture.endpoint,
        editorId: emptyEditor.id,
      })).resolves.toEqual({ changed: true });
      expect(fixture.dom.window.document.querySelector("#empty")?.textContent).toBe("");
    } finally {
      await closeSession(harness, fixture);
    }
  });

  test("Escape closes the picker and removes its listeners and page-owned nodes", async () => {
    const fixture = new CdpFixture();
    const harness = hostFor();
    try {
      await start(harness, fixture);
      expect(fixture.dom.window.document.getElementById("__bbAnnRoot")).not.toBeNull();
      fixture.dom.window.document.dispatchEvent(new fixture.dom.window.KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
      const result = await read(harness, fixture);
      expect(result).toMatchObject({ status: "cancelled", batch: null, editor: null });
      expect(await fixture.evaluate("window.__bbAnnotateRead ?? null")).toBeNull();
      expect(fixture.dom.window.document.getElementById("__bbAnnRoot")).toBeNull();
      expect(fixture.dom.window.document.documentElement.style.cursor).toBe("");
    } finally {
      await closeSession(harness, fixture);
    }
  });

  test("editing an annotation increments its version and captures the edited image", async () => {
    const fixture = new CdpFixture();
    const harness = hostFor();
    try {
      await start(harness, fixture);
      click(fixture.dom.window, "button");
      const editor = (await read(harness, fixture) as { editor: { id: string } }).editor;
      await harness.experimental_call("saveEditor", {
        wsEndpoint: fixture.endpoint,
        editorId: editor.id,
        comment: "First comment",
        designChange: null,
      });
      const annotationId = ((await read(harness, fixture)) as { batch: { annotations: Array<{ id: string }> } }).batch.annotations[0].id;
      await expect(harness.experimental_call("mutateSession", {
        wsEndpoint: fixture.endpoint,
        annotationId,
        action: "open",
      })).resolves.toEqual({ changed: true });
      const edit = (await read(harness, fixture)) as { editor: { id: string; annotationId: string } };
      expect(edit.editor.annotationId).toBe(annotationId);
      const saved = await harness.experimental_call("saveEditor", {
        wsEndpoint: fixture.endpoint,
        editorId: edit.editor.id,
        comment: "Updated comment",
        designChange: null,
      });
      expect(saved).toMatchObject({
        saved: true,
        batch: { annotations: [{ id: annotationId, comment: "Updated comment", version: 2 }] },
        captures: [{ annotationId, version: 2 }],
      });
    } finally {
      await closeSession(harness, fixture);
    }
  });

  test("capture failure is requeued and succeeds on a later read", async () => {
    const fixture = new CdpFixture();
    const harness = hostFor();
    try {
      await start(harness, fixture);
      click(fixture.dom.window, "button");
      const editor = (await read(harness, fixture) as { editor: { id: string } }).editor;
      fixture.setScreenshotFailures(1);
      const failed = await harness.experimental_call("saveEditor", {
        wsEndpoint: fixture.endpoint,
        editorId: editor.id,
        comment: "Retry this capture",
        designChange: null,
      });
      expect(failed).toMatchObject({ saved: true, captures: [], captureFailed: true });

      fixture.setScreenshotFailures(0);
      await fixture.setTime(Date.now() + 10_000);
      const retried = await read(harness, fixture);
      expect(retried).toMatchObject({
        captures: [{ version: 1, image: { mimeType: "image/jpeg" } }],
      });
      await expect(read(harness, fixture, 1)).resolves.toMatchObject({ captureFailed: false, captures: [] });
    } finally {
      await closeSession(harness, fixture);
    }
  });

  test("restores a batch only on the same URL", async () => {
    const sameFixture = new CdpFixture({ url: "https://example.test/same" });
    const sameHarness = hostFor();
    try {
      const sameBatch = restoredBatch(1, sameFixture.url);
      await expect(start(sameHarness, sameFixture, sameBatch)).resolves.toMatchObject({ restored: true });
      await expect(read(sameHarness, sameFixture)).resolves.toMatchObject({
        batch: { annotations: [{ id: "ann_1" }] },
      });
    } finally {
      await closeSession(sameHarness, sameFixture);
    }

    const differentFixture = new CdpFixture({ url: "https://example.test/different" });
    const differentHarness = hostFor();
    try {
      const oldBatch = restoredBatch(1, "https://example.test/same");
      await expect(start(differentHarness, differentFixture, oldBatch)).resolves.toMatchObject({ restored: false });
      await expect(read(differentHarness, differentFixture)).resolves.toMatchObject({
        batch: { annotations: [] },
      });
    } finally {
      await closeSession(differentHarness, differentFixture);
    }
  });

  test("#3 50 large captures stay under the host RPC limit without losing queued captures", async () => {
    const fixture = new CdpFixture({ screenshotBase64: "A".repeat(200_000) });
    const harness = hostFor();
    try {
      await start(harness, fixture, restoredBatch(50, fixture.url));
      const limit = 8 * 1024 * 1024;
      const captures = new Map<string, { annotationId: string; version: number }>();
      let expectedAnnotations: Batch["annotations"] = [];
      let afterRevision = -1;
      let error: unknown;
      for (let attempt = 0; attempt < 20 && captures.size < 50; attempt += 1) {
        let result: { revision: number; batch: Batch; captures: Array<{ annotationId: string; version: number; image: { base64: string; width: number; height: number } }> };
        try {
          result = await read(harness, fixture, afterRevision) as typeof result;
        } catch (cause) {
          error = cause;
          break;
        }
        expect(new TextEncoder().encode(JSON.stringify(result)).byteLength).toBeLessThanOrEqual(limit);
        expectedAnnotations = result.batch.annotations;
        for (const capture of result.captures) {
          const key = `${capture.annotationId}:${capture.version}`;
          expect(captures.has(key)).toBe(false);
          expect(capture.image.base64).toHaveLength(200_000);
          expect(capture.image).toMatchObject({ width: 1000, height: 700 });
          captures.set(key, { annotationId: capture.annotationId, version: capture.version });
        }
        afterRevision = result.revision;
        if (result.captures.length === 0 && captures.size < 50) {
          await fixture.setTime(Date.now() + 1_000);
        }
      }
      expect(error).toBeUndefined();
      expect(captures.size).toBe(50);
      expect([...captures.values()].sort((left, right) => left.annotationId.localeCompare(right.annotationId))).toEqual(
        expectedAnnotations.map(({ id, version }) => ({ annotationId: id, version })).sort((left, right) => left.annotationId.localeCompare(right.annotationId)),
      );
    } finally {
      await closeSession(harness, fixture);
    }
  });

  test("#3 an oversized capture stays bounded and remains marked for delayed retry", async () => {
    const fixture = new CdpFixture({ screenshotBase64: "A".repeat(8_350_000) });
    const harness = hostFor();
    try {
      await start(harness, fixture, restoredBatch(1, fixture.url));
      const first = await read(harness, fixture) as {
        captures: unknown[];
        captureFailed: boolean;
      };
      expect(new TextEncoder().encode(JSON.stringify(first)).byteLength).toBeLessThanOrEqual(8 * 1024 * 1024);
      expect(first).toMatchObject({ captures: [], captureFailed: true });
      expect(fixture.screenshotCalls).toBe(4);

      await fixture.setTime(Date.now() + 1_000);
      const second = await read(harness, fixture) as {
        captures: unknown[];
        captureFailed: boolean;
      };
      expect(new TextEncoder().encode(JSON.stringify(second)).byteLength).toBeLessThanOrEqual(8 * 1024 * 1024);
      expect(second).toMatchObject({ captures: [], captureFailed: true });
      expect(fixture.screenshotCalls).toBe(8);
    } finally {
      await closeSession(harness, fixture);
    }
  });

  test("#5 active sessions retain the host worker until cleanup", async () => {
    const fixture = new CdpFixture();
    const harness = hostFor();
    try {
      await start(harness, fixture);
      expect(harness.experimental_getRetainedWorkerLeaseCount()).toBeGreaterThan(0);
      expect(harness.experimental_getRetainedWorkerLeaseCount()).toBe(1);
      expect(fixture.activeConnections).toBe(1);
      await read(harness, fixture);
      await read(harness, fixture);
      expect(harness.experimental_getRetainedWorkerLeaseCount()).toBe(1);
      expect(fixture.activeConnections).toBe(1);
      await harness.experimental_call("cleanupSession", { wsEndpoint: fixture.endpoint });
      expect(harness.experimental_getRetainedWorkerLeaseCount()).toBe(0);
      await fixture.waitForNoConnections();
      expect(fixture.activeConnections).toBe(0);
      expect(fixture.closedConnections).toBe(1);
      await harness.experimental_dispose();
      expect(harness.experimental_getRetainedWorkerLeaseCount()).toBe(0);
    } finally {
      await harness.experimental_dispose();
      await fixture.close();
    }
  });

  test("#5 independent sessions retain and release their own host workers", async () => {
    const firstFixture = new CdpFixture();
    const secondFixture = new CdpFixture();
    const harness = hostFor();
    try {
      await start(harness, firstFixture);
      await start(harness, secondFixture);
      expect(harness.experimental_getRetainedWorkerLeaseCount()).toBe(2);
      expect(firstFixture.activeConnections).toBe(1);
      expect(secondFixture.activeConnections).toBe(1);

      await harness.experimental_call("cleanupSession", { wsEndpoint: firstFixture.endpoint });
      expect(harness.experimental_getRetainedWorkerLeaseCount()).toBe(1);
      await firstFixture.waitForNoConnections();
      expect(firstFixture.activeConnections).toBe(0);
      expect(secondFixture.activeConnections).toBe(1);

      await harness.experimental_dispose();
      expect(harness.experimental_getRetainedWorkerLeaseCount()).toBe(0);
      await secondFixture.waitForNoConnections();
      expect(secondFixture.activeConnections).toBe(0);
      expect(firstFixture.closedConnections).toBe(1);
      expect(secondFixture.closedConnections).toBe(1);
    } finally {
      await harness.experimental_dispose();
      await firstFixture.close();
      await secondFixture.close();
    }
  });

  test("#5 failed and cancelled host calls do not retain workers", async () => {
    const failedFixture = new CdpFixture({ targetCount: 2 });
    const failedHarness = hostFor();
    try {
      await expect(start(failedHarness, failedFixture)).rejects.toThrow("Selected Browser tab is no longer available");
      expect(failedHarness.experimental_getRetainedWorkerLeaseCount()).toBe(0);
      await failedFixture.waitForNoConnections();
      expect(failedFixture.closedConnections).toBe(1);
      await failedHarness.experimental_dispose();
      expect(failedHarness.experimental_getRetainedWorkerLeaseCount()).toBe(0);
    } finally {
      await failedHarness.experimental_dispose();
      await failedFixture.close();
    }

    const cancelledFixture = new CdpFixture();
    const cancelledHarness = hostFor();
    try {
      const controller = new AbortController();
      const call = cancelledHarness.experimental_call("startSession", {
        wsEndpoint: cancelledFixture.endpoint,
        batch: null,
      }, { signal: controller.signal });
      controller.abort();
      await expect(call).rejects.toThrow();
      expect(cancelledHarness.experimental_getRetainedWorkerLeaseCount()).toBe(0);
    } finally {
      await cancelledHarness.experimental_dispose();
      await cancelledFixture.close();
    }
  });

  test("#8 long page title does not kill the annotation session", async () => {
    const fixture = new CdpFixture({ title: "T".repeat(501) });
    const harness = hostFor();
    try {
      await start(harness, fixture);
      click(fixture.dom.window, "button");
      let opened: unknown;
      let error: unknown;
      try {
        opened = await read(harness, fixture);
      } catch (cause) {
        error = cause;
      }
      expect(error).toBeUndefined();
      expect(opened).toMatchObject({ status: "active", editor: { tag: "button" } });
      if (error || !opened) return;
      expect((opened as { batch: { title: string } }).batch.title).toBe("T".repeat(500));
    } finally {
      await closeSession(harness, fixture);
    }
  });

  test("#8 long classes and role remain usable after saving an annotation", async () => {
    const longId = "element-" + "x".repeat(2_100);
    const longClass = "class-" + "x".repeat(2_100);
    const longRole = "role-" + "x".repeat(150);
    const longAttribute = "data-evidence-" + "x".repeat(300);
    const longAttributeValue = "value-" + "x".repeat(1_100);
    const fixture = new CdpFixture({
      html: `<!doctype html><html><head></head><body><main><button id="${longId}" class="${longClass}" role="${longRole}" ${longAttribute}="${longAttributeValue}">Continue</button></main></body></html>`,
    });
    const harness = hostFor();
    try {
      await start(harness, fixture);
      click(fixture.dom.window, "button");
      let opened: unknown;
      let error: unknown;
      try {
        opened = await read(harness, fixture);
      } catch (cause) {
        error = cause;
      }
      expect(error).toBeUndefined();
      expect(opened).toMatchObject({ status: "active", editor: { tag: "button" } });
      if (error || !opened || typeof opened !== "object" || !("editor" in opened) || !opened.editor || typeof opened.editor !== "object" || !("id" in opened.editor) || typeof opened.editor.id !== "string") return;
      const editorId = (opened as { editor: { id: string } }).editor.id;
      let saved: unknown;
      try {
        saved = await harness.experimental_call("saveEditor", {
          wsEndpoint: fixture.endpoint,
          editorId,
          comment: "Keep long page evidence.",
          designChange: null,
        });
      } catch (cause) {
        error = cause;
      }
      expect(error).toBeUndefined();
      expect(saved).toMatchObject({ saved: true });
      const batch = batchSchema.parse((saved as { batch: unknown }).batch);
      expect(batch.annotations).toHaveLength(1);
      const annotation = batch.annotations[0];
      expect(annotation.comment).toBe("Keep long page evidence.");
      expect(annotation.classes).toBeTruthy();
      expect(annotation.targetRole).toBeTruthy();
      expect(longClass.startsWith(annotation.classes!)).toBe(true);
      expect(longRole.startsWith(annotation.targetRole!)).toBe(true);
      expect(annotation.selector).toBe("");
      expect(annotation.targetPath).toBe("");
      const metadataKey = longAttribute.slice(0, 256);
      expect(annotation.metadata[metadataKey]).toBe(longAttributeValue.slice(0, 1000));
    } finally {
      await closeSession(harness, fixture);
    }
  });

  test("#8 a custom element tag longer than the contract remains editable", async () => {
    const longTag = "x-" + "a".repeat(70);
    const fixture = new CdpFixture({
      html: `<!doctype html><html><head></head><body><main><${longTag}>Continue</${longTag}></main></body></html>`,
    });
    const harness = hostFor();
    try {
      await start(harness, fixture);
      click(fixture.dom.window, longTag);
      const opened = await read(harness, fixture) as { editor: { id: string; tag: string } };
      expect(opened.editor.tag).toBe(longTag.slice(0, 64));
      const saved = await harness.experimental_call("saveEditor", {
        wsEndpoint: fixture.endpoint,
        editorId: opened.editor.id,
        comment: "Keep the custom element evidence.",
        designChange: null,
      });
      expect(saved).toMatchObject({ saved: true });
      const batch = batchSchema.parse((saved as { batch: unknown }).batch);
      expect(batch.annotations).toHaveLength(1);
      expect(batch.annotations[0].tag).toBe(longTag.slice(0, 64));
    } finally {
      await closeSession(harness, fixture);
    }
  });

  test("#9 evidence text preserves the letter s while normalizing whitespace", async () => {
    const fixture = new CdpFixture({
      html: "<!doctype html><html><head></head><body><main><button> Some\n sample\ttext </button></main></body></html>",
    });
    const harness = hostFor();
    try {
      await start(harness, fixture);
      click(fixture.dom.window, "button");
      const opened = await read(harness, fixture) as { editor: { id: string } };
      await harness.experimental_call("saveEditor", {
        wsEndpoint: fixture.endpoint,
        editorId: opened.editor.id,
        comment: "Keep the text intact",
        designChange: null,
      });
      const result = await read(harness, fixture) as { batch: { annotations: Array<{ text: string | null; immediateText: string | null; nearbyText: string | null }> } };
      expect(result.batch.annotations[0]).toMatchObject({
        text: "Some sample text",
        immediateText: "Some sample text",
        nearbyText: "Some sample text",
      });
    } finally {
      await closeSession(harness, fixture);
    }
  });
});
