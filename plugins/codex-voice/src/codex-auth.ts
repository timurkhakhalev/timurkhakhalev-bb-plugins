import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

const CHATGPT_AUTH_CLAIM = "https://api.openai.com/auth";

export interface CodexChatGptAuth {
  accessToken: string;
  accountId: string;
  isFedramp: boolean;
}

export type CodexAuthResult =
  | { ok: true; auth: CodexChatGptAuth }
  | { ok: false; message: string };

type Json = null | boolean | number | string | Json[] | { [key: string]: Json };
type JsonObject = { [key: string]: Json };

export function codexAuthPath(env: NodeJS.ProcessEnv = process.env): string {
  const home = env.CODEX_HOME?.trim() || path.join(os.homedir(), ".codex");
  return path.join(home, "auth.json");
}

function asObject(value: Json | undefined): JsonObject | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? value
    : null;
}

function asString(value: Json | undefined): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

function jwtPayload(token: string): JsonObject | null {
  const part = token.split(".")[1];
  if (!part) return null;
  try {
    return asObject(JSON.parse(Buffer.from(part, "base64url").toString("utf8")));
  } catch {
    return null;
  }
}

/** Parse Codex's auth.json. Only a ChatGPT sign-in counts: that is the subscription. */
export function parseCodexAuth(raw: string, nowMs = Date.now()): CodexAuthResult {
  let root: JsonObject | null;
  try {
    root = asObject(JSON.parse(raw));
  } catch {
    return { ok: false, message: "Codex auth.json is not valid JSON. Run `codex login`." };
  }
  if (!root) {
    return { ok: false, message: "Codex auth.json is malformed. Run `codex login`." };
  }
  const tokens = asObject(root.tokens);
  const accessToken = asString(tokens?.access_token);
  if (!tokens || !accessToken) {
    return {
      ok: false,
      message: "Codex is not signed in with ChatGPT. Run `codex login`.",
    };
  }
  const payload = jwtPayload(accessToken);
  const exp = payload?.exp;
  if (typeof exp === "number" && nowMs >= exp * 1000) {
    return {
      ok: false,
      message: "Codex sign-in expired. Open Codex (or run any `codex` command) to refresh it.",
    };
  }
  const claims = asObject(payload?.[CHATGPT_AUTH_CLAIM]);
  const accountId =
    asString(tokens.account_id) ?? asString(claims?.chatgpt_account_id);
  if (!accountId) {
    return { ok: false, message: "Codex sign-in has no ChatGPT account. Run `codex login`." };
  }
  return {
    ok: true,
    auth: {
      accessToken,
      accountId,
      isFedramp: claims?.chatgpt_compute_residency === "fedramp",
    },
  };
}

export async function readCodexAuth(): Promise<CodexAuthResult> {
  let raw: string;
  try {
    raw = await fs.readFile(codexAuthPath(), "utf8");
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    return {
      ok: false,
      message:
        code === "ENOENT"
          ? "Codex is not signed in on this machine. Install Codex and run `codex login`."
          : "Cannot read Codex auth.json.",
    };
  }
  return parseCodexAuth(raw);
}
