import { describe, expect, it } from "bun:test";
import { batchSchema, screenshotSchema } from "./contracts.js";
import { buildBatchMentionInput, renderBatch } from "./server.js";

const batch = batchSchema.parse({
  url: "https://example.com/products",
  title: "Example products",
  viewport: "1280x720",
  dpr: 2,
  annotations: [
    {
      id: "ann_1",
      kind: "element",
      comment: "Make this CTA less prominent.",
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

  it("builds one resolvable mention for direct thread send", () => {
    expect(
      buildBatchMentionInput("browser-annotate", {
        id: "batch_1",
        threadId: "thread_1",
        createdAt: 1,
        batch,
        images: [],
        previewDataUrl: null,
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
});
