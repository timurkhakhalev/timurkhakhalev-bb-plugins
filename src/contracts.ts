import { z } from "zod";
import type { PluginRpcContract } from "@get-bb/plugin-sdk";

export const idSchema = z.string().min(1).max(256);

const rectSchema = z
  .object({
    x: z.number().finite(),
    y: z.number().finite(),
    width: z.number().finite(),
    height: z.number().finite(),
  })
  .strict();

const declarationChangeSchema = z
  .object({
    property: z.enum([
      "color",
      "background-color",
      "opacity",
      "font-family",
      "font-size",
      "font-weight",
      "border-radius",
      "border-color",
      "border-width",
      "width",
      "height",
      "padding-top",
      "padding-right",
      "padding-bottom",
      "padding-left",
      "margin-top",
      "margin-right",
      "margin-bottom",
      "margin-left",
      "flex-direction",
      "justify-content",
      "align-items",
      "gap",
      "row-gap",
      "column-gap",
    ]),
    previousValue: z.string().max(1000),
    value: z.string().max(1000),
  })
  .strict();

export const designChangeSchema = z
  .object({
    text: z
      .object({ previousValue: z.string().max(4000), value: z.string().max(4000) })
      .strict()
      .nullable(),
    declarations: z.array(declarationChangeSchema).max(26),
  })
  .strict();
export type DesignChange = z.infer<typeof designChangeSchema>;

export const annotationSchema = z
  .object({
    id: idSchema,
    version: z.number().int().positive(),
    kind: z.literal("element"),
    comment: z.string().trim().max(4000),
    designChange: designChangeSchema.nullable(),
    selector: z.string().max(2000),
    tag: z.string().max(64),
    classes: z.string().max(2000).nullable(),
    text: z.string().max(4000).nullable(),
    target: z.string().max(1000),
    targetRole: z.string().max(128).nullable(),
    targetPath: z.string().max(2000),
    immediateText: z.string().max(2000).nullable(),
    nearbyText: z.string().max(4000).nullable(),
    selectedText: z.string().max(4000).nullable(),
    nodePosition: z.object({ x: z.number().finite(), y: z.number().finite() }).strict(),
    theme: z.enum(["light", "dark"]),
    metadata: z
      .record(z.string().max(256), z.string().max(1000))
      .refine((value) => Object.keys(value).length <= 30, "Too many metadata fields"),
    rect: rectSchema,
  })
  .strict()
  .refine(
    (annotation) =>
      annotation.comment.length > 0 ||
      Boolean(
        annotation.designChange &&
          ((annotation.designChange.text !== null &&
            annotation.designChange.text.value !== annotation.designChange.text.previousValue) ||
            annotation.designChange.declarations.some(
              (change) => change.value !== change.previousValue,
            )),
      ),
    "Annotation needs a comment or a design change",
  );
export type Annotation = z.infer<typeof annotationSchema>;

export const screenshotSchema = z
  .object({
    base64: z.string().min(1),
    width: z.number().int().positive(),
    height: z.number().int().positive(),
    mimeType: z.literal("image/jpeg"),
  })
  .strict();
export type Screenshot = z.infer<typeof screenshotSchema>;

export const batchSchema = z
  .object({
    url: z.string().max(8192),
    title: z.string().max(500),
    viewport: z.string().max(32),
    dpr: z.number().finite().positive(),
    annotations: z.array(annotationSchema).max(50),
  })
  .strict();
export type Batch = z.infer<typeof batchSchema>;

const liveAnnotationSchema = z
  .object({
    id: idSchema,
    tag: z.string(),
    target: z.string(),
    comment: z.string(),
    designChange: designChangeSchema.nullable(),
    previewDataUrl: z.string().nullable(),
  })
  .strict();

/** server ↔ host (CDP execution on the desktop machine) */
export const hostContract = {
  startSession: {
    input: z
      .object({
        wsEndpoint: z.string().url(),
        batch: batchSchema.nullable(),
      })
      .strict(),
    output: z
      .object({
        started: z.literal(true),
        currentUrl: z.string().max(8192),
        restored: z.boolean(),
      })
      .strict(),
  },
  readSession: {
    input: z
      .object({
        wsEndpoint: z.string().url(),
        afterRevision: z.number().int().min(-1),
      })
      .strict(),
    output: z
      .object({
        status: z.enum(["active", "sent", "cancelled", "missing"]),
        revision: z.number().int().min(0),
        batch: batchSchema.nullable(),
        captures: z.array(
          z
            .object({
              annotationId: idSchema,
              version: z.number().int().positive(),
              image: screenshotSchema,
            })
            .strict(),
        ),
      })
      .strict(),
  },
  mutateSession: {
    input: z
      .object({
        wsEndpoint: z.string().url(),
        annotationId: idSchema,
        action: z.enum(["delete", "open"]),
      })
      .strict(),
    output: z.object({ changed: z.boolean() }).strict(),
  },
  cleanupSession: {
    input: z.object({ wsEndpoint: z.string().url() }).strict(),
    output: z.object({ cleaned: z.literal(true) }).strict(),
  },
} satisfies PluginRpcContract;

/** app.tsx ↔ server */
export const rpcContract = {
  start: {
    input: z
      .object({
        threadId: idSchema,
        tabId: idSchema,
      })
      .strict(),
    output: z.object({ ok: z.literal(true) }).strict(),
  },
  stop: {
    input: z.object({ threadId: idSchema }).strict(),
    output: z.object({ cancelled: z.boolean() }).strict(),
  },
  status: {
    input: z.object({ threadId: idSchema }).strict(),
    output: z.object({ active: z.boolean(), tabId: idSchema.nullable() }).strict(),
  },
  pending: {
    input: z.object({ threadId: idSchema }).strict(),
    output: z
      .object({
        batches: z.array(
          z
            .object({
              id: idSchema,
              threadId: idSchema,
              label: z.string(),
              count: z.number().int().min(0),
            })
            .strict(),
        ),
      })
      .strict(),
  },
  stage: {
    input: z.object({ threadId: idSchema, batchId: idSchema }).strict(),
    output: z.object({ staged: z.boolean() }).strict(),
  },
  live: {
    input: z
      .object({
        threadId: idSchema,
        afterRevision: z.number().int().min(-1),
      })
      .strict(),
    output: z
      .object({
        active: z.boolean(),
        revision: z.number().int().min(0),
        batchId: idSchema.nullable(),
        annotations: z.array(liveAnnotationSchema),
      })
      .strict(),
  },
  mutate: {
    input: z
      .object({
        threadId: idSchema,
        annotationId: idSchema,
        action: z.enum(["delete", "open"]),
      })
      .strict(),
    output: z.object({ changed: z.boolean() }).strict(),
  },
  batch: {
    input: z.object({ threadId: idSchema, batchId: idSchema }).strict(),
    output: z
      .object({ editable: z.boolean(), annotations: z.array(liveAnnotationSchema) })
      .strict(),
  },
  draft: {
    input: z.object({ threadId: idSchema }).strict(),
    output: z
      .object({
        batchId: idSchema.nullable(),
        annotations: z.array(liveAnnotationSchema),
      })
      .strict(),
  },
  discard: {
    input: z.object({ threadId: idSchema, batchId: idSchema }).strict(),
    output: z.object({ discarded: z.boolean() }).strict(),
  },
} satisfies PluginRpcContract;
