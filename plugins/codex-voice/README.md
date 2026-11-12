# Codex Voice (PoC)

bb voice input through the Codex ChatGPT sign-in, the same `POST https://chatgpt.com/backend-api/transcribe` call the Codex desktop app's dictation makes. Uses the Codex subscription; no API key.

- Registers the AI service **Codex dictation** for the `voice` task.
- `status()` probes every connected bb machine (primary host first) for `$CODEX_HOME/auth.json` (default `~/.codex/auth.json`) with a live ChatGPT token. No machine with Codex → not ready → bb hides the microphone.
- Transcription runs on the machine where Codex is signed in (host entry), so the token never leaves it.

## Use

```sh
bb plugin install <source> --yes
bb settings ai-services show                        # find the service id
bb settings ai-services set voice <id>             # explicit choice: no fallback to bb cloud
```

With an explicit choice, voice input works only while Codex is available. With Automatic, bb cloud is tried first.

## Limits

- No token refresh: an expired token makes the service not ready until Codex refreshes it (open Codex or run any `codex` command; tokens live ~10 days).
- No Cloudflare cookie handling; a challenge from chatgpt.com fails the request.
- bb caps plugin voice uploads at 5 MiB (~5 min of Opus) and waits 10 s.
- Undocumented ChatGPT endpoint; may change.

## Develop

```sh
bun install
bun run check
bun test
```
