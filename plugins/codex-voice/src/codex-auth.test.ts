import { describe, expect, test } from "bun:test";
import { parseCodexAuth } from "./codex-auth.js";

function jwt(payload: object): string {
  const b64 = (o: object) => Buffer.from(JSON.stringify(o)).toString("base64url");
  return `${b64({ alg: "none" })}.${b64(payload)}.sig`;
}

const NOW = 1_800_000_000_000;
const claims = { "https://api.openai.com/auth": { chatgpt_account_id: "acct_1" } };

describe("parseCodexAuth", () => {
  test("accepts a live ChatGPT sign-in", () => {
    const raw = JSON.stringify({
      auth_mode: "chatgpt",
      tokens: { access_token: jwt({ ...claims, exp: NOW / 1000 + 60 }) },
    });
    const result = parseCodexAuth(raw, NOW);
    expect(result.ok && result.auth.accountId).toBe("acct_1");
  });

  test("prefers tokens.account_id", () => {
    const raw = JSON.stringify({
      tokens: { access_token: jwt({ ...claims, exp: NOW / 1000 + 60 }), account_id: "acct_2" },
    });
    const result = parseCodexAuth(raw, NOW);
    expect(result.ok && result.auth.accountId).toBe("acct_2");
  });

  test("rejects an expired token", () => {
    const raw = JSON.stringify({ tokens: { access_token: jwt({ ...claims, exp: NOW / 1000 - 1 }) } });
    const result = parseCodexAuth(raw, NOW);
    expect(result.ok).toBe(false);
    expect(!result.ok && result.message).toContain("expired");
  });

  test("rejects an API-key-only login: no subscription", () => {
    const result = parseCodexAuth(JSON.stringify({ auth_mode: "apikey", OPENAI_API_KEY: "sk-x" }), NOW);
    expect(result.ok).toBe(false);
  });

  test("rejects malformed JSON", () => {
    expect(parseCodexAuth("{", NOW).ok).toBe(false);
  });
});
