import { afterEach, describe, expect, test } from "bun:test";
import { createServerHarness, disposeServerHarnesses, makeAnnotation, makeBatch, makeScreenshot, TEST_TAB_ID, TEST_THREAD_ID, TEST_URL } from "./test-support.js";
import browserAnnotate from "./server.js";

async function settleStart(
  harness: ReturnType<typeof createServerHarness>,
  threadId: string,
) {
  for (let attempt = 0; attempt < 20; attempt += 1) {
    await Promise.resolve();
    const status = await harness.harness.callRpc("status", { threadId }) as { active: boolean };
    if (status.active && harness.state.currentUrl === TEST_URL) return;
  }
  throw new Error("test server session did not become active");
}

async function startServer(
  harness: ReturnType<typeof createServerHarness>,
  threadId = TEST_THREAD_ID,
  tabId = TEST_TAB_ID,
) {
  browserAnnotate(harness.bb);
  await harness.harness.callRpc("start", { threadId, tabId });
  await settleStart(harness, threadId);
}

describe("server browser annotation workflow", () => {
  afterEach(async () => {
    await disposeServerHarnesses();
  });

  test("registered RPC saves the complete batch and restores the draft after reload", async () => {
    const harness = createServerHarness();
    await startServer(harness);

    const live = await harness.harness.callRpc("live", {
      threadId: TEST_THREAD_ID,
      afterRevision: -1,
    }) as { annotations: Array<{ id: string; comment: string; previewDataUrl: string | null }> };
    expect(live.annotations).toHaveLength(1);
    expect(live.annotations[0]).toMatchObject({ id: "ann_test", comment: "Keep this annotation." });
    expect(live.annotations[0].previewDataUrl).toContain("data:image/jpeg;base64,aGVsbG8=");

    const pending = await harness.harness.callRpc("pending", { threadId: TEST_THREAD_ID }) as {
      batches: Array<{ id: string; count: number }>;
    };
    expect(pending.batches).toHaveLength(1);
    expect(pending.batches[0].count).toBe(1);

    harness.state.editor = {
      id: "editor-test",
      rect: { x: 20, y: 40, width: 100, height: 32 },
      annotationId: "ann_test",
      viewport: { width: 1000, height: 700 },
      tag: "button",
      target: "Continue",
      comment: "Keep this annotation.",
      designChange: { text: null, declarations: [] },
      previewDataUrl: null,
    };
    await expect(
      harness.harness.callRpc("save", {
        threadId: TEST_THREAD_ID,
        editorId: "editor-test",
        comment: "Edited after the first capture.",
        designChange: null,
      }),
    ).resolves.toEqual({ saved: true });

    const stored = harness.files.get(
      `${harness.location.storageRootPath}/browser-comments/${pending.batches[0].id}.json`,
    );
    expect(stored?.content).toContain("Edited after the first capture.");
    const reloaded = await harness.harness.lifecycle.reload((bb) => browserAnnotate(bb));
    const restored = await reloaded.harness.callRpc("draft", { threadId: TEST_THREAD_ID }) as {
      batchId: string | null;
      annotations: Array<{ id: string; comment: string; previewDataUrl: string | null }>;
    };
    expect(restored.batchId).toBe(pending.batches[0].id);
    expect(restored.annotations).toEqual([
      expect.objectContaining({ id: "ann_test", comment: "Edited after the first capture." }),
    ]);
  });

  test("explicit stop preserves the saved draft", async () => {
    const harness = createServerHarness();
    await startServer(harness);
    await harness.harness.callRpc("live", { threadId: TEST_THREAD_ID, afterRevision: -1 });

    await expect(
      harness.harness.callRpc("stop", { threadId: TEST_THREAD_ID }),
    ).resolves.toEqual({ cancelled: true });
    await expect(
      harness.harness.callRpc("pending", { threadId: TEST_THREAD_ID }),
    ).resolves.toMatchObject({ batches: [{ count: 1 }] });
    expect(
      await harness.harness.callRpc("status", { threadId: TEST_THREAD_ID }),
    ).toEqual({ active: false, tabId: null });
  });

  test("normal send targets the current thread and keeps each annotation image association", async () => {
    const harness = createServerHarness({
      batch: makeBatch({
        annotations: [
          makeAnnotation(),
          makeAnnotation({ id: "ann_two", target: "Secondary", selector: "main > a" }),
        ],
      }),
      captures: [
        { annotationId: "ann_test", version: 1, image: makeScreenshot("aW1hZ2UtMQ==") },
        { annotationId: "ann_two", version: 1, image: makeScreenshot("aW1hZ2UtMg==") },
      ],
    });
    await startServer(harness);
    await harness.harness.callRpc("live", { threadId: TEST_THREAD_ID, afterRevision: -1 });
    const draft = await harness.harness.callRpc("pending", { threadId: TEST_THREAD_ID }) as { batches: Array<{ id: string }> };

    await expect(
      harness.harness.callRpc("send", { threadId: TEST_THREAD_ID }),
    ).resolves.toEqual({ sent: true });
    expect(harness.sent).toHaveLength(1);
    expect(harness.sent[0]).toMatchObject({
      threadId: TEST_THREAD_ID,
      mode: "steer-if-active",
      input: [{
        type: "text",
        text: "2 annotations",
        mentions: [{
          start: 0,
          end: "2 annotations".length,
          resource: {
            kind: "plugin",
            pluginId: "browser-annotate",
            itemId: `browser-comments:${draft.batches[0].id}`,
            label: "2 annotations",
          },
        }],
      }],
    });

    const provider = harness.harness.registrations.mentionProviders[0];
    const resolved = await provider.resolve(draft.batches[0].id) as unknown as {
      experimental_images?: Array<{ type: string; path: string; context: string }>;
    };
    expect(resolved.experimental_images).toHaveLength(2);
    expect(resolved.experimental_images?.[0]).toMatchObject({
      type: "localImage",
      path: expect.stringMatching(/ann_test\.jpg$/),
    });
    expect(resolved.experimental_images?.[0].context).toContain("Comment 1");
    expect(resolved.experimental_images?.[1]).toMatchObject({
      type: "localImage",
      path: expect.stringMatching(/ann_two\.jpg$/),
    });
    expect(resolved.experimental_images?.[1].context).toContain("Comment 2");
  });

  test("stale or missing captures block send", async () => {
    const harness = createServerHarness({ captures: [] });
    await startServer(harness);
    await harness.harness.callRpc("live", { threadId: TEST_THREAD_ID, afterRevision: -1 });

    await expect(
      harness.harness.callRpc("send", { threadId: TEST_THREAD_ID }),
    ).rejects.toThrow("still capturing");
    expect(harness.sent).toHaveLength(0);
  });

  test("a failed screenshot leaves capture pending and a later capture can recover", async () => {
    const harness = createServerHarness({ captures: [], captureFailed: true });
    await startServer(harness);
    const failed = await harness.harness.callRpc("live", {
      threadId: TEST_THREAD_ID,
      afterRevision: -1,
    }) as { capturePending: boolean; captureFailed: boolean };
    expect(failed).toMatchObject({ capturePending: true, captureFailed: true });

    harness.state.captures = [{ annotationId: "ann_test", version: 1, image: makeScreenshot("cmVjb3ZlcmVk") }];
    harness.state.captureFailed = false;
    harness.state.revision += 1;
    const recovered = await harness.harness.callRpc("live", {
      threadId: TEST_THREAD_ID,
      afterRevision: failed.capturePending ? -1 : 0,
    }) as { capturePending: boolean; annotations: Array<{ previewDataUrl: string | null }> };
    expect(recovered.capturePending).toBe(false);
    expect(recovered.annotations[0].previewDataUrl).toContain("cmVjb3ZlcmVk");
    await expect(
      harness.harness.callRpc("send", { threadId: TEST_THREAD_ID }),
    ).resolves.toEqual({ sent: true });
  });

  test("a failed screenshot write leaves the capture pending and a retry stores it", async () => {
    // Keep the write unavailable through live and both send staging passes.
    const harness = createServerHarness({ failScreenshotWrites: 3 });
    await startServer(harness);
    const failed = await harness.harness.callRpc("live", {
      threadId: TEST_THREAD_ID,
      afterRevision: -1,
    }) as { capturePending: boolean; annotations: Array<{ previewDataUrl: string | null }> };
    expect(failed.capturePending).toBe(true);
    expect(failed.annotations[0].previewDataUrl).toContain("aGVsbG8=");
    expect([...harness.files.keys()].some((path) => path.endsWith(".jpg"))).toBe(false);
    await expect(
      harness.harness.callRpc("send", { threadId: TEST_THREAD_ID }),
    ).rejects.toThrow("still capturing");
    expect(harness.sent).toHaveLength(0);

    harness.state.failScreenshotWrites = 0;
    harness.state.revision += 1;
    const recovered = await harness.harness.callRpc("live", {
      threadId: TEST_THREAD_ID,
      afterRevision: -1,
    }) as { capturePending: boolean };
    expect(recovered.capturePending).toBe(false);
    expect([...harness.files.keys()].some((path) => path.endsWith(".jpg"))).toBe(true);
    await expect(
      harness.harness.callRpc("send", { threadId: TEST_THREAD_ID }),
    ).resolves.toEqual({ sent: true });
  });

  test("drafts stay isolated when another thread polls pending batches", async () => {
    const harness = createServerHarness();
    await startServer(harness, "thread-a", "tab-thread-a");
    await harness.harness.callRpc("live", { threadId: "thread-a", afterRevision: -1 });

    await expect(
      harness.harness.callRpc("pending", { threadId: "thread-b" }),
    ).resolves.toEqual({ batches: [] });
    await expect(
      harness.harness.callRpc("pending", { threadId: "thread-a" }),
    ).resolves.toMatchObject({ batches: [{ threadId: "thread-a", count: 1 }] });
  });

  test("an open editor blocks send", async () => {
    const harness = createServerHarness({
      editor: {
        id: "editor-test",
        rect: { x: 1, y: 2, width: 3, height: 4 },
        annotationId: null,
        viewport: { width: 1000, height: 700 },
        tag: "button",
        target: "Continue",
        comment: "",
        designChange: { text: null, declarations: [] },
        previewDataUrl: null,
      },
    });
    await startServer(harness);
    await expect(
      harness.harness.callRpc("send", { threadId: TEST_THREAD_ID }),
    ).resolves.toEqual({ sent: false });
    expect(harness.sent).toHaveLength(0);
  });

  test("repeated reads do not duplicate or corrupt a batch", async () => {
    const harness = createServerHarness();
    await startServer(harness);
    const first = await harness.harness.callRpc("live", { threadId: TEST_THREAD_ID, afterRevision: -1 });
    const second = await harness.harness.callRpc("live", { threadId: TEST_THREAD_ID, afterRevision: 1 });
    expect((first as { annotations: unknown[] }).annotations).toHaveLength(1);
    expect((second as { annotations: unknown[] }).annotations).toHaveLength(1);
    expect(await harness.harness.callRpc("pending", { threadId: TEST_THREAD_ID })).toMatchObject({
      batches: [{ count: 1 }],
    });
  });

  test("disposing the plugin releases the browser lease", async () => {
    const harness = createServerHarness();
    await startServer(harness);
    await harness.harness.lifecycle.dispose();
    expect(harness.leases).toHaveLength(1);
    expect(harness.releasedLeases).toEqual(harness.leases);
  });

  test.failing("#2 downstream send failure retains an unsent draft for retry", async () => {
    const harness = createServerHarness();
    await startServer(harness);
    await harness.harness.callRpc("live", { threadId: TEST_THREAD_ID, afterRevision: -1 });
    harness.harness.sdk.stub("threads.send", async (input: unknown) => {
      const itemId = (input as { input: Array<{ mentions: Array<{ resource: { itemId: string } }> }> }).input[0].mentions[0].resource.itemId.replace(/^browser-comments:/, "");
      await harness.harness.registrations.mentionProviders[0].resolve(itemId);
      throw new Error("simulated downstream attachment failure");
    });

    await expect(
      harness.harness.callRpc("send", { threadId: TEST_THREAD_ID }),
    ).rejects.toThrow("simulated downstream attachment failure");
    const pending = await harness.harness.callRpc("pending", { threadId: TEST_THREAD_ID }) as {
      batches: Array<{ count: number }>;
    };
    expect(pending.batches).toHaveLength(1);
    expect(pending.batches[0].count).toBe(1);
  });

  test.failing("#6 discarded batches stay discarded after a plugin restart", async () => {
    const harness = createServerHarness();
    await startServer(harness);
    await harness.harness.callRpc("live", { threadId: TEST_THREAD_ID, afterRevision: -1 });
    const draft = await harness.harness.callRpc("pending", { threadId: TEST_THREAD_ID }) as {
      batches: Array<{ id: string }>;
    };
    const batchId = draft.batches[0].id;
    await expect(
      harness.harness.callRpc("discard", { threadId: TEST_THREAD_ID, batchId }),
    ).resolves.toEqual({ discarded: true });

    const reloaded = await harness.harness.lifecycle.reload((bb) => browserAnnotate(bb));
    await expect(
      reloaded.harness.registrations.mentionProviders[0].resolve(batchId),
    ).rejects.toThrow("expired or were removed");
  });

  test.failing("#7 sent annotation history survives the draft TTL", async () => {
    const harness = createServerHarness();
    await startServer(harness);
    await harness.harness.callRpc("live", { threadId: TEST_THREAD_ID, afterRevision: -1 });
    const draft = await harness.harness.callRpc("pending", { threadId: TEST_THREAD_ID }) as {
      batches: Array<{ id: string }>;
    };
    const batchId = draft.batches[0].id;
    await harness.harness.callRpc("send", { threadId: TEST_THREAD_ID });
    const path = `${harness.location.storageRootPath}/browser-comments/${batchId}.json`;
    const stored = harness.files.get(path);
    if (!stored) throw new Error("sent batch was not persisted by the test setup");
    const raw = JSON.parse(stored.content) as Record<string, unknown>;
    stored.content = JSON.stringify({ ...raw, createdAt: Date.now() - 25 * 60 * 60_000 });

    const reloaded = await harness.harness.lifecycle.reload((bb) => browserAnnotate(bb));
    let resolved: { context: string } | undefined;
    let error: unknown;
    try {
      resolved = await reloaded.harness.registrations.mentionProviders[0].resolve(batchId);
    } catch (cause) {
      error = cause;
    }
    expect(error).toBeUndefined();
    expect(resolved?.context).toContain("# Browser comments:");
  });

  test("the RPC boundary rejects an annotation image with a stale version", async () => {
    const harness = createServerHarness({
      batch: makeBatch({ annotations: [makeAnnotation({ version: 2 })] }),
      captures: [{ annotationId: "ann_test", version: 1, image: makeScreenshot() }],
    });
    await startServer(harness);
    await harness.harness.callRpc("live", { threadId: TEST_THREAD_ID, afterRevision: -1 });
    await expect(
      harness.harness.callRpc("send", { threadId: TEST_THREAD_ID }),
    ).rejects.toThrow("still capturing");
  });
});
