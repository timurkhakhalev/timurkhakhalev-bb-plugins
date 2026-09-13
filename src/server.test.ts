import { describe, expect, it } from "bun:test";
import { batchSchema, screenshotSchema } from "./contracts.js";
import { planMentionReconciliation, removeStructuredMentionText } from "./composer.js";
import {
  buildBatchMentionInput,
  missingCaptureAnnotationIds,
  renderBatch,
  type PendingBatch,
} from "./server.js";

const batch = batchSchema.parse({
  url: "https://example.com/products",
  title: "Example products",
  viewport: "1280x720",
  dpr: 2,
  annotations: [
    {
      id: "ann_1",
      version: 1,
      kind: "element",
      comment: "Make this CTA less prominent.",
      designChange: null,
      selector: "main > a:nth-of-type(1)",
      tag: "a",
      classes: "button primary",
      text: "Buy now",
      target: "Buy now",
      targetRole: "link",
      targetPath: "main > a:nth-of-type(1)",
      immediateText: "Buy now",
      nearbyText: "Featured product Buy now",
      selectedText: null,
      nodePosition: { x: 84, y: 98 },
      theme: "light",
      metadata: { href: "/checkout" },
      rect: { x: 24, y: 80, width: 120, height: 36 },
    },
  ],
});

describe("browser annotation payload", () => {
  it("keeps user comments distinct from untrusted page context", () => {
    const message = renderBatch(batch);

    expect(message).toContain("# Browser comments:");
    expect(message).toContain("Untrusted page evidence");
    expect(message).toContain("Target selector: main > a:nth-of-type(1)");
    expect(message).toContain("Comment:\nMake this CTA less prominent.");
  });

  it("accepts the bounded JPEG attachment returned by the host", () => {
    expect(
      screenshotSchema.parse({
        base64: "aGVsbG8=",
        width: 1280,
        height: 720,
        mimeType: "image/jpeg",
      }),
    ).toMatchObject({ mimeType: "image/jpeg", width: 1280, height: 720 });
  });

  it("rejects empty comments", () => {
    expect(() =>
      batchSchema.parse({
        ...batch,
        annotations: [{ ...batch.annotations[0], comment: "   " }],
      }),
    ).toThrow();
  });

  it("accepts a design-only annotation and renders exact before/after values", () => {
    const designBatch = batchSchema.parse({
      ...batch,
      annotations: [
        {
          ...batch.annotations[0],
          comment: "",
          designChange: {
            text: { previousValue: "Buy now", value: "View details" },
            declarations: [
              { property: "font-size", previousValue: "14px", value: "18px" },
              { property: "color", previousValue: "rgb(0, 0, 0)", value: "#ffffff" },
            ],
          },
        },
      ],
    });

    const message = renderBatch(designBatch);
    expect(message).toContain("Requested design changes:");
    expect(message).toContain("text: Buy now -> View details");
    expect(message).toContain("font-size: 14px -> 18px");
    expect(message).toContain("color: rgb(0, 0, 0) -> #ffffff");
  });

  it("builds one resolvable mention for direct thread send", () => {
    expect(
      buildBatchMentionInput("browser-annotate", {
        id: "batch_1",
        threadId: "thread_1",
        createdAt: 1,
        sent: false,
        batch,
        images: [],
        previewDataUrls: new Map(),
      }),
    ).toEqual({
      type: "text",
      text: "1 annotation",
      mentions: [
        {
          start: 0,
          end: 12,
          resource: {
            kind: "plugin",
            pluginId: "browser-annotate",
            itemId: "browser-comments:batch_1",
            label: "1 annotation",
          },
        },
      ],
    });
  });

  it("requires the screenshot version to match the current annotation", () => {
    const item: PendingBatch = {
      id: "batch_1",
      threadId: "thread_1",
      createdAt: 1,
      sent: false,
      batch,
      images: [{ annotationId: "ann_1", version: 0, path: "/tmp/stale.jpg" }],
      previewDataUrls: new Map(),
    };

    expect(missingCaptureAnnotationIds(item)).toEqual(["ann_1"]);
    item.images[0].version = 1;
    expect(missingCaptureAnnotationIds(item)).toEqual([]);
  });

  it("removes only the structured mention range, not matching user text", () => {
    expect(
      removeStructuredMentionText("1 annotation keep 1 annotation", { from: 0, to: 12 }),
    ).toBe("keep 1 annotation");
  });

  it("keeps trusted comment input out of the page document", async () => {
    const hostSource = await Bun.file(new URL("./host.ts", import.meta.url)).text();
    const appSource = await Bun.file(new URL("./app.tsx", import.meta.url)).text();
    expect(hostSource).toContain('worldName: "bb-browser-annotate"');
    expect(hostSource).toContain('attachShadow({ mode: "closed" })');
    expect(hostSource).toContain('status: "missing" as const');
    expect(hostSource).not.toContain('<textarea placeholder="Add a comment');
    expect(appSource).toContain('aria-label="Annotation comment"');
    expect(appSource).toContain('rpc.call("save"');
  });

  it("preserves an existing structured mention during bootstrap", () => {
    const mention = { id: "batch_1", label: "1 annotation", from: 0, to: 12 };
    const plan = planMentionReconciliation(
      [mention],
      [{ id: "batch_1", label: "1 annotation" }],
      new Set(),
      new Map(),
    );
    expect(plan.remove).toEqual([]);
    expect(plan.insert).toEqual([]);
    expect(plan.discard).toEqual([]);
    expect(plan.observed.has("batch_1")).toBe(true);
  });

  it("discards only a previously observed mention removed by the user", () => {
    const batch = [{ id: "batch_1", label: "1 annotation" }];
    const initial = planMentionReconciliation([], batch, new Set(), new Map());
    expect(initial.insert).toEqual(batch);
    expect(initial.discard).toEqual([]);

    const removed = planMentionReconciliation(
      [],
      batch,
      new Set(["batch_1"]),
      new Map(),
    );
    expect(removed.discard).toEqual(["batch_1"]);
  });
});
