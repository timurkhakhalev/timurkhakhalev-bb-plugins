// Runs on the bb host machine: that is where Codex keeps its sign-in.
import { experimental_defineHostEntry } from "@get-bb/plugin-sdk";
import { readCodexAuth, type CodexChatGptAuth } from "./codex-auth.js";
import { hostContract, type CodexVoiceStatus, type TranscribeOutput } from "./contract.js";

// The endpoint the Codex desktop app's dictation posts to.
const TRANSCRIBE_URL = "https://chatgpt.com/backend-api/transcribe";
const RESPONSE_MAX_BYTES = 1024 * 1024;
const ERROR_TEXT_MAX = 300;

function headersFor(auth: CodexChatGptAuth): Headers {
  const headers = new Headers();
  headers.set("Authorization", `Bearer ${auth.accessToken}`);
  headers.set("chatgpt-account-id", auth.accountId);
  headers.set("originator", "bb");
  headers.set("User-Agent", "bb-plugin-codex-voice");
  if (auth.isFedramp) headers.set("X-OpenAI-Fedramp", "true");
  return headers;
}

function httpFailure(status: number, body: string): string {
  if (status === 401 || status === 403) {
    return "Codex rejected the sign-in. Open Codex or run `codex login`.";
  }
  if (status === 429) return "Codex transcription is rate limited. Try again shortly.";
  const html = /<html|<!doctype/i.test(body);
  const detail = html ? "" : body.replace(/\s+/g, " ").trim().slice(0, ERROR_TEXT_MAX);
  return `Codex transcription failed (HTTP ${status})${detail ? `: ${detail}` : ""}`;
}

async function transcribe(
  input: { audioBase64: string; mimeType: string; filename: string; hint: string | null },
  signal: AbortSignal,
): Promise<TranscribeOutput> {
  const authResult = await readCodexAuth();
  if (!authResult.ok) return { ok: false, message: authResult.message };

  const form = new FormData();
  form.set(
    "file",
    new Blob([Buffer.from(input.audioBase64, "base64")], { type: input.mimeType }),
    input.filename,
  );
  if (input.hint) form.set("prompt", input.hint);

  let response: Response;
  try {
    response = await fetch(TRANSCRIBE_URL, {
      method: "POST",
      headers: headersFor(authResult.auth),
      body: form,
      signal,
    });
  } catch (error) {
    if (signal.aborted) return { ok: false, message: "Codex transcription timed out." };
    return {
      ok: false,
      message: `Cannot reach chatgpt.com: ${error instanceof Error ? error.message : String(error)}`.slice(0, 600),
    };
  }

  const length = Number(response.headers.get("content-length") ?? "0");
  if (length > RESPONSE_MAX_BYTES) {
    return { ok: false, message: "Codex transcription response was too large." };
  }
  const body = await response.text();
  if (!response.ok) return { ok: false, message: httpFailure(response.status, body) };
  if (body.length > RESPONSE_MAX_BYTES) {
    return { ok: false, message: "Codex transcription response was too large." };
  }
  try {
    const parsed = JSON.parse(body) as { text?: unknown };
    if (typeof parsed.text === "string") return { ok: true, text: parsed.text };
  } catch {}
  return { ok: false, message: "Codex transcription response had no text." };
}

export default experimental_defineHostEntry({
  contract: hostContract,
  handlers: {
    status: async (): Promise<CodexVoiceStatus> => {
      const result = await readCodexAuth();
      return result.ok ? { ready: true } : { ready: false, message: result.message };
    },
    transcribe: (input, context) => transcribe(input, context.signal),
  },
});
