---
name: codex-voice
description: Codex Voice plugin - bb voice input through the Codex ChatGPT sign-in; use when voice input is missing or failing with Codex selected.
---

# Codex Voice

- Service: `Codex dictation` for the `voice` task. Select: `bb settings ai-services set voice <id>` (id from `bb settings ai-services show`).
- Ready when any connected bb machine has `$CODEX_HOME/auth.json` (default `~/.codex/auth.json`) with an unexpired ChatGPT token. Otherwise bb hides the microphone; the status message says why.
- Fix "not signed in": run `codex login` on that machine. Fix "expired": run any `codex` command there to refresh.
- Test: `bb voice transcribe <file.webm>`.
