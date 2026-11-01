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

export const reactComponentSchema = z
  .object({
    name: z.string().min(1).max(200),
    source: z.string().max(1000).nullable(),
  })
  .strict();
export type ReactComponent = z.infer<typeof reactComponentSchema>;

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
    components: z.array(reactComponentSchema).max(12).optional(),
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

export const liveAnnotationSchema = z
  .object({
    id: idSchema,
    tag: z.string(),
    target: z.string(),
    comment: z.string(),
    designChange: designChangeSchema.nullable(),
    previewDataUrl: z.string().nullable(),
  })
  .strict();
export type LiveAnnotation = z.infer<typeof liveAnnotationSchema>;

const captureTargetSchema = z
  .object({ id: idSchema, version: z.number().int().positive() })
  .strict();

/** app.tsx ↔ server */
export const rpcContract = {
  /** Find the draft to restore for this page, or allocate a new batch id. */
  start: {
    input: z.object({ threadId: idSchema, url: z.string().max(8192) }).strict(),
    output: z.object({ batchId: idSchema, batch: batchSchema.nullable() }).strict(),
  },
  /** Replace the stored draft with the page's current annotations. */
  sync: {
    input: z.object({ threadId: idSchema, batchId: idSchema, batch: batchSchema }).strict(),
    output: z.object({ missingCaptures: z.array(captureTargetSchema) }).strict(),
  },
  /** Screenshot the tab once and attach it to each listed annotation version. */
  capture: {
    input: z
      .object({
        threadId: idSchema,
        tabId: idSchema,
        batchId: idSchema,
        annotations: z.array(captureTargetSchema).min(1).max(50),
      })
      .strict(),
    output: z.object({ captured: z.array(idSchema) }).strict(),
  },
  send: {
    input: z.object({ threadId: idSchema, batchId: idSchema }).strict(),
    output: z.object({ sent: z.boolean() }).strict(),
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
  /** Delete one annotation from a stored, unsent draft (page not live). */
  remove: {
    input: z.object({ threadId: idSchema, batchId: idSchema, annotationId: idSchema }).strict(),
    output: z.object({ changed: z.boolean() }).strict(),
  },
  batch: {
    input: z.object({ threadId: idSchema, batchId: idSchema }).strict(),
    output: z
      .object({ sent: z.boolean(), annotations: z.array(liveAnnotationSchema) })
      .strict(),
  },
  discard: {
    input: z.object({ threadId: idSchema, batchId: idSchema }).strict(),
    output: z.object({ discarded: z.boolean() }).strict(),
  },
} satisfies PluginRpcContract;
