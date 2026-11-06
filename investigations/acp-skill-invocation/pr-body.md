## Human comments

## What was wrong

BB skill chips reached ACP agents as literal `/skill-name` text while their skill metadata was discarded. OpenCode interpreted a leading chip as its own slash command; a bb-only name completed an empty turn without model inference. See #4923.

## What changed

- Keep the names from the session's injected BB skill catalog.
- Translate validated slash skill mentions from that catalog to `Use the bb skill "name"` before building ACP prompt text. The existing catalog still points the agent to the skill's `SKILL.md`.
- Preserve surrounding text and native provider commands, native-only skills, and unmarked slash text. Process multiple mentions from right to left and reject mismatched or overlapping ranges.
- Add eight transport regression/control cases covering skill-only and argument-bearing prompts, UTF-16 offsets, multiple/duplicate mentions, and command/plain-text controls.

No protocol fields, CLI options, dependencies, or installed application artifacts change. This is independent of the model-selection PR #5053.

## How you verified

- `pnpm exec turbo run typecheck test lint --filter=@bb/provider-bridge-acp`: passed; **382 tests passed, 4 skipped, 19 files**.
- On original main bridge code, the four skill-translation regression cases fail while the four preservation controls pass; all eight pass with the fix.
- Real **OpenCode 1.18.34** in a temporary HOME/XDG/workspace, with only a localhost OpenAI-compatible fake backend and synthetic credentials:
  - Raw `/example-skill …`: `end_turn`, zero inference requests, zero assistant message chunks.
  - Known provider `/fixture-command`: reaches the local backend and completes.
  - After a warm-up turn, the same BB skill chip through the bundled fixed bridge reaches the backend as `Use the bb skill …` and produces an assistant response: one inference request.
- Reviewed the focused diff; formatting and `git diff --check` pass. No paid inference, original chat contents, real credentials, or private entity IDs were used or published.

Fixes #4923

> AGENT GENERATED
