import { defineRpcContract } from "@get-bb/plugin-sdk";
import { z } from "zod";

// bb caps voice uploads to plugin services at 5 MiB; base64 grows it by 4/3.
const AUDIO_BASE64_MAX_CHARS = Math.ceil((5 * 1024 * 1024 * 4) / 3) + 16;

export const statusSchema = z.discriminatedUnion("ready", [
  z.object({ ready: z.literal(true) }).strict(),
  z.object({ ready: z.literal(false), message: z.string().max(300) }).strict(),
]);

export const transcribeOutputSchema = z.discriminatedUnion("ok", [
  z.object({ ok: z.literal(true), text: z.string().max(200_000) }).strict(),
  z.object({ ok: z.literal(false), message: z.string().max(600) }).strict(),
]);

export const hostContract = defineRpcContract({
  status: {
    input: z.object({}).strict(),
    output: statusSchema,
    experimental_retryable: true,
  },
  transcribe: {
    input: z
      .object({
        audioBase64: z.string().min(1).max(AUDIO_BASE64_MAX_CHARS),
        mimeType: z.string().min(1).max(100),
        filename: z.string().min(1).max(200),
        hint: z.string().max(4_000).nullable(),
      })
      .strict(),
    output: transcribeOutputSchema,
  },
});

export type CodexVoiceStatus = z.infer<typeof statusSchema>;
export type TranscribeOutput = z.infer<typeof transcribeOutputSchema>;
