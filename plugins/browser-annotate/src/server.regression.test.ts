import { afterEach, describe, expect, test } from "bun:test";
import { makeThreadResponse } from "@get-bb/plugin-sdk/testing";
import type { Batch } from "./contracts.js";
import {
  createServerHarness,
  disposeServerHarnesses,
  makeAnnotation,
  makeBatch,
  TEST_TAB_ID,
  TEST_THREAD_ID,
  TEST_URL,
} from "./test-support.js";
import browserAnnotate from "./server.js";

type Harness = ReturnType<typeof createServerHarness>;
type Pending = { batches: Array<{ id: string; count: number }> };
type Missing = { missingCaptures: Array<{ id: string; version: number }> };

function boot(harness: Harness) {
  browserAnnotate(harness.bb);
  return harness;
}

async function start(harness: Harness, threadId = TEST_THREAD_ID, url = TEST_URL) {
  return harness.harness.callRpc("start", { threadId, url }) as Promise<{ batchId: string; batch: Batch | null }>;
}

/** What the renderer does after a page change: sync, then capture what is missing. */
async function syncAndCapture(
  harness: Harness,
  batchId: string,
  batch: Batch = makeBatch(),
  threadId = TEST_THREAD_ID,
) {
  const { missingCaptures } = await harness.harness.callRpc("sync", { threadId, batchId, batch }) as Missing;
  if (missingCaptures.length === 0) return { captured: [] as string[] };
  return harness.harness.callRpc("capture", {
    threadId,
    tabId: TEST_TAB_ID,
    batchId,
    annotations: missingCaptures,
  }) as Promise<{ captured: string[] }>;
}

const resolveMention = (harness: Harness, batchId: string) =>
  harness.harness.registrations.mentionProviders[0].resolve(batchId) as Promise<{
    context: string;
    experimental_images?: Array<{ path: string; context: string }>;
  }>;

describe("server browser annotation workflow", () => {
  afterEach(async () => {
    await disposeServerHarnesses();
  });

  test("sync persists the page batch and reports annotations that need a screenshot", async () => {
    const harness = boot(createServerHarness());
    const { batchId, batch } = await start(harness);
    expect(batch).toBeNull();
    await expect(
      harness.harness.callRpc("sync", { threadId: TEST_THREAD_ID, batchId, batch: makeBatch() }),
    ).resolves.toEqual({ missingCaptures: [{ id: "ann_test", version: 1 }] });
    expect(harness.harness.realtimeSignals).toContainEqual({
      channel: "annotate-pending",
      payload: { threadId: TEST_THREAD_ID },
    });
    await expect(harness.harness.callRpc("pending", { threadId: TEST_THREAD_ID })).resolves.toMatchObject({
      batches: [{ id: batchId, count: 1 }],
    });
  });

  test("capture stores one screenshot per annotation version without CDP", async () => {
    const harness = boot(createServerHarness());
    const { batchId } = await start(harness);
    await expect(syncAndCapture(harness, batchId)).resolves.toEqual({ captured: ["ann_test"] });
    expect(harness.state.captureCalls).toBe(1);
    expect([...harness.files.keys()].filter((path) => path.endsWith(".jpg"))).toHaveLength(1);
    await expect(
      harness.harness.callRpc("sync", { threadId: TEST_THREAD_ID, batchId, batch: makeBatch() }),
    ).resolves.toEqual({ missingCaptures: [] });
  });

  test("a new annotation version drops the stale screenshot and asks for another", async () => {
    const harness = boot(createServerHarness());
    const { batchId } = await start(harness);
    await syncAndCapture(harness, batchId);
    const edited = makeBatch({ annotations: [makeAnnotation({ version: 2, comment: "Edited" })] });
    await expect(
      harness.harness.callRpc("sync", { threadId: TEST_THREAD_ID, batchId, batch: edited }),
    ).resolves.toEqual({ missingCaptures: [{ id: "ann_test", version: 2 }] });
    expect([...harness.files.keys()].filter((path) => path.endsWith(".jpg"))).toHaveLength(0);
    const resolved = await resolveMention(harness, batchId);
    expect(resolved.context).toContain("Saved marker screenshot: unavailable");
    expect(resolved.experimental_images ?? []).toHaveLength(0);
  });

  test("a capture for an outdated version is ignored", async () => {
    const harness = boot(createServerHarness());
    const { batchId } = await start(harness);
    await harness.harness.callRpc("sync", {
      threadId: TEST_THREAD_ID,
      batchId,
      batch: makeBatch({ annotations: [makeAnnotation({ version: 3 })] }),
    });
    await expect(
      harness.harness.callRpc("capture", {
        threadId: TEST_THREAD_ID,
        tabId: TEST_TAB_ID,
        batchId,
        annotations: [{ id: "ann_test", version: 2 }],
      }),
    ).resolves.toEqual({ captured: [] });
  });

  test("a failed capture leaves the screenshot missing and a retry recovers", async () => {
    const harness = boot(createServerHarness({ captureFailures: 1 }));
    const { batchId } = await start(harness);
    await expect(syncAndCapture(harness, batchId)).rejects.toThrow("simulated capture failure");
    await expect(syncAndCapture(harness, batchId)).resolves.toEqual({ captured: ["ann_test"] });
  });

  test("a failed screenshot write is reported as not captured", async () => {
    const harness = boot(createServerHarness({ failScreenshotWrites: 1 }));
    const { batchId } = await start(harness);
    await expect(syncAndCapture(harness, batchId)).resolves.toEqual({ captured: [] });
    await expect(syncAndCapture(harness, batchId)).resolves.toEqual({ captured: ["ann_test"] });
  });

  test("start restores the draft for the same URL after a plugin reload", async () => {
    const harness = boot(createServerHarness());
    const { batchId } = await start(harness);
    await syncAndCapture(harness, batchId);
    const reloaded = await harness.harness.lifecycle.reload((bb) => browserAnnotate(bb));
    const restored = await reloaded.harness.callRpc("start", { threadId: TEST_THREAD_ID, url: TEST_URL }) as {
      batchId: string;
      batch: Batch | null;
    };
    expect(restored.batchId).toBe(batchId);
    expect(restored.batch?.annotations.map((annotation) => annotation.id)).toEqual(["ann_test"]);
    const other = await reloaded.harness.callRpc("start", {
      threadId: TEST_THREAD_ID,
      url: "https://example.test/other",
    }) as { batchId: string; batch: Batch | null };
    expect(other.batch).toBeNull();
    expect(other.batchId).not.toBe(batchId);
  });

  test("an empty sync removes the draft and its screenshots", async () => {
    const harness = boot(createServerHarness());
    const { batchId } = await start(harness);
    await syncAndCapture(harness, batchId);
    await harness.harness.callRpc("sync", {
      threadId: TEST_THREAD_ID,
      batchId,
      batch: makeBatch({ annotations: [] }),
    });
    await expect(harness.harness.callRpc("pending", { threadId: TEST_THREAD_ID })).resolves.toEqual({ batches: [] });
    expect([...harness.files.keys()]).toHaveLength(0);
  });

  test("send targets the current thread and keeps each annotation image association", async () => {
    const harness = boot(createServerHarness());
    const { batchId } = await start(harness);
    const batch = makeBatch({
      annotations: [
        makeAnnotation(),
        makeAnnotation({
          id: "ann_two",
          comment: "Second",
          target: "Second target",
          components: [{ name: "PricingCard", source: "src/pricing.tsx:12" }],
        }),
      ],
    });
    await syncAndCapture(harness, batchId, batch);
    await expect(
      harness.harness.callRpc("send", { threadId: TEST_THREAD_ID, batchId }),
    ).resolves.toEqual({ sent: true });
    expect(harness.sent).toHaveLength(1);
    expect(harness.sent[0]).toMatchObject({
      threadId: TEST_THREAD_ID,
      mode: "steer-if-active",
      input: [{ text: "2 annotations" }],
    });
    expect(harness.harness.realtimeSignals).toContainEqual({
      channel: "annotate-session",
      payload: { threadId: TEST_THREAD_ID, status: "sent", count: 2, batchId },
    });
    const resolved = await resolveMention(harness, batchId);
    expect(resolved.context).toContain("React components (innermost first): PricingCard (src/pricing.tsx:12)");
    expect(resolved.experimental_images?.map((image) => image.context.match(/Comment (\d)/)?.[1])).toEqual(["1", "2"]);
    expect(resolved.experimental_images?.[1].path).toContain("ann_two");
    await expect(
      harness.harness.callRpc("send", { threadId: TEST_THREAD_ID, batchId }),
    ).resolves.toEqual({ sent: false });
  });

  test("drafts stay isolated between threads", async () => {
    const harness = boot(createServerHarness());
    const a = await start(harness, "thread-a");
    await syncAndCapture(harness, a.batchId, makeBatch(), "thread-a");
    await expect(harness.harness.callRpc("pending", { threadId: "thread-b" })).resolves.toEqual({ batches: [] });
    await expect(
      harness.harness.callRpc("send", { threadId: "thread-b", batchId: a.batchId }),
    ).resolves.toEqual({ sent: false });
    await expect(
      harness.harness.callRpc("batch", { threadId: "thread-b", batchId: a.batchId }),
    ).resolves.toEqual({ sent: false, annotations: [] });
  });

  test("#2 downstream send failure retains an unsent draft for retry", async () => {
    const harness = boot(createServerHarness());
    const { batchId } = await start(harness);
    await syncAndCapture(harness, batchId);
    harness.harness.sdk.stub("threads.send", async () => {
      throw new Error("simulated downstream attachment failure");
    });
    await expect(
      harness.harness.callRpc("send", { threadId: TEST_THREAD_ID, batchId }),
    ).rejects.toThrow("simulated downstream attachment failure");
    const pending = await harness.harness.callRpc("pending", { threadId: TEST_THREAD_ID }) as Pending;
    expect(pending.batches).toMatchObject([{ id: batchId, count: 1 }]);
  });

  test("#2 accepted composer mention marks the draft sent and announces it", async () => {
    const harness = boot(createServerHarness());
    const { batchId } = await start(harness);
    await syncAndCapture(harness, batchId);
    harness.harness.sdk.stub("threads.events.list", async () => [{
      id: "request-test",
      scope: { threadId: TEST_THREAD_ID, turnId: null },
      threadId: TEST_THREAD_ID,
      seq: 7,
      type: "client/turn/requested",
      data: {
        input: [{
          type: "text",
          text: "1 annotation",
          mentions: [{
            start: 0,
            end: 12,
            resource: {
              kind: "plugin",
              pluginId: "browser-annotate",
              itemId: `browser-comments:${batchId}`,
              label: "1 annotation",
            },
          }],
        }],
      },
      createdAt: Date.now(),
    }]);
    await harness.harness.emitThreadEvent("experimental_thread.events", {
      thread: makeThreadResponse({ id: TEST_THREAD_ID }),
      sequence: 7,
    });
    await expect(harness.harness.callRpc("pending", { threadId: TEST_THREAD_ID })).resolves.toEqual({ batches: [] });
    expect(harness.files.get(
      `${harness.location.storageRootPath}/browser-comments/${batchId}.json`,
    )?.content).toContain('"sent":true');
    expect(harness.harness.realtimeSignals).toContainEqual({
      channel: "annotate-session",
      payload: { threadId: TEST_THREAD_ID, status: "sent", count: 1, batchId },
    });
    // A late sync from the page must not reopen a sent batch.
    await expect(
      harness.harness.callRpc("sync", { threadId: TEST_THREAD_ID, batchId, batch: makeBatch() }),
    ).resolves.toEqual({ missingCaptures: [] });
    await expect(harness.harness.callRpc("pending", { threadId: TEST_THREAD_ID })).resolves.toEqual({ batches: [] });
  });

  test("#6 discarded batches stay discarded after a plugin restart", async () => {
    const harness = boot(createServerHarness());
    const { batchId } = await start(harness);
    await syncAndCapture(harness, batchId);
    const batchPath = `${harness.location.storageRootPath}/browser-comments/${batchId}.json`;
    const imagePath = [...harness.files.keys()].find((path) => path.endsWith(".jpg"));
    expect(harness.files.has(batchPath)).toBe(true);
    expect(imagePath).toBeDefined();
    await expect(
      harness.harness.callRpc("discard", { threadId: TEST_THREAD_ID, batchId }),
    ).resolves.toEqual({ discarded: true });
    expect(harness.files.has(batchPath)).toBe(false);
    expect(imagePath && harness.files.has(imagePath)).toBe(false);
    await expect(
      harness.harness.callRpc("discard", { threadId: TEST_THREAD_ID, batchId }),
    ).resolves.toEqual({ discarded: false });
    const reloaded = await harness.harness.lifecycle.reload((bb) => browserAnnotate(bb));
    await expect(
      reloaded.harness.registrations.mentionProviders[0].resolve(batchId),
    ).rejects.toThrow("expired or were removed");
  });

  test("#6 a tampered batch cannot remove another batch's screenshot", async () => {
    const harness = boot(createServerHarness());
    const first = await start(harness);
    await syncAndCapture(harness, first.batchId);
    const firstImage = [...harness.files.keys()].find((path) => path.endsWith(".jpg"));
    if (!firstImage) throw new Error("missing first screenshot");
    const second = await start(harness, TEST_THREAD_ID, "https://example.test/second");
    await syncAndCapture(harness, second.batchId, makeBatch({ url: "https://example.test/second" }));
    const secondPath = `${harness.location.storageRootPath}/browser-comments/${second.batchId}.json`;
    const stored = harness.files.get(secondPath);
    if (!stored) throw new Error("missing second batch");
    const raw = JSON.parse(stored.content) as { images: Array<{ path: string }> };
    raw.images = [{ ...raw.images[0], path: firstImage }];
    stored.content = JSON.stringify(raw);
    const reloaded = await harness.harness.lifecycle.reload((bb) => browserAnnotate(bb));
    await reloaded.harness.callRpc("discard", { threadId: TEST_THREAD_ID, batchId: second.batchId });
    expect(harness.files.has(firstImage)).toBe(true);
  });

  test("#6 removing one annotation from a stored draft removes only its screenshot", async () => {
    const harness = boot(createServerHarness());
    const { batchId } = await start(harness);
    await syncAndCapture(harness, batchId, makeBatch({
      annotations: [makeAnnotation(), makeAnnotation({ id: "ann_two", comment: "Second" })],
    }));
    expect([...harness.files.keys()].filter((path) => path.endsWith(".jpg"))).toHaveLength(2);
    await expect(
      harness.harness.callRpc("remove", { threadId: TEST_THREAD_ID, batchId, annotationId: "ann_test" }),
    ).resolves.toEqual({ changed: true });
    const images = [...harness.files.keys()].filter((path) => path.endsWith(".jpg"));
    expect(images).toHaveLength(1);
    expect(images[0]).toContain("ann_two");
    await expect(
      harness.harness.callRpc("batch", { threadId: TEST_THREAD_ID, batchId }),
    ).resolves.toMatchObject({ sent: false, annotations: [{ id: "ann_two" }] });
    await expect(
      harness.harness.callRpc("remove", { threadId: TEST_THREAD_ID, batchId, annotationId: "ann_two" }),
    ).resolves.toEqual({ changed: true });
    await expect(harness.harness.callRpc("pending", { threadId: TEST_THREAD_ID })).resolves.toEqual({ batches: [] });
  });

  test("#7 sent history survives the draft TTL and missing thread-storage files", async () => {
    const harness = boot(createServerHarness());
    const { batchId } = await start(harness);
    await syncAndCapture(harness, batchId);
    await harness.harness.callRpc("send", { threadId: TEST_THREAD_ID, batchId });
    for (const path of [...harness.files.keys()]) harness.files.delete(path);
    const reloaded = await harness.harness.lifecycle.reload((bb) => browserAnnotate(bb));
    await expect(
      reloaded.harness.callRpc("batch", { threadId: TEST_THREAD_ID, batchId }),
    ).resolves.toMatchObject({ sent: true, annotations: [{ id: "ann_test", comment: "Keep this annotation." }] });
    await expect(
      reloaded.harness.registrations.mentionProviders[0].resolve(batchId),
    ).resolves.toMatchObject({ context: expect.stringContaining("# Browser comments:") });
  });

  test("#7 draft expiry removes unsent storage", async () => {
    const harness = boot(createServerHarness());
    const { batchId } = await start(harness);
    await syncAndCapture(harness, batchId);
    const path = `${harness.location.storageRootPath}/browser-comments/${batchId}.json`;
    const stored = harness.files.get(path);
    if (!stored) throw new Error("missing persisted batch");
    stored.content = JSON.stringify({ ...JSON.parse(stored.content), createdAt: Date.now() - 25 * 60 * 60_000 });
    const reloaded = await harness.harness.lifecycle.reload((bb) => browserAnnotate(bb));
    await expect(reloaded.harness.callRpc("pending", { threadId: TEST_THREAD_ID })).resolves.toEqual({ batches: [] });
    expect(harness.files.has(path)).toBe(false);
  });

  test("the RPC boundary rejects an unsafe batch id", async () => {
    const harness = boot(createServerHarness());
    await expect(
      harness.harness.callRpc("sync", { threadId: TEST_THREAD_ID, batchId: "../escape", batch: makeBatch() }),
    ).rejects.toThrow();
  });
});
