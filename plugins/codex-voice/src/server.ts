import type { BbPluginApi } from "@get-bb/plugin-sdk";
import { hostContract, type CodexVoiceStatus } from "./contract.js";

const PROBE_TIMEOUT_MS = 4_000;
const CHOICE_TTL_MS = 30_000;

interface HostChoice {
  hostId: string;
  hostName: string;
}

type Resolution =
  | { ok: true; choice: HostChoice }
  | { ok: false; message: string };

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export default function plugin(bb: BbPluginApi) {
  const host = bb.hosts.experimental_client({ contract: hostContract });
  let cached: { at: number; resolution: Resolution } | null = null;

  // Codex keeps its sign-in per machine. Use the primary host when Codex is
  // signed in there, otherwise the first other connected machine where it is.
  async function resolveCodexHost(): Promise<Resolution> {
    if (cached && Date.now() - cached.at < CHOICE_TTL_MS) return cached.resolution;

    const [config, hosts] = await Promise.all([
      bb.sdk.system.config(),
      bb.sdk.hosts.list(),
    ]);
    const candidates = hosts
      .filter((h) => h.status === "connected")
      .sort((a, b) =>
        a.id === config.primaryHostId ? -1 : b.id === config.primaryHostId ? 1 : a.name.localeCompare(b.name),
      );
    if (candidates.length === 0) {
      return { ok: false, message: "No bb machine is connected." };
    }

    const probes = await Promise.all(
      candidates.map(async (h) => {
        try {
          const status = await host.call("status", {}, { hostId: h.id, timeoutMs: PROBE_TIMEOUT_MS });
          return { host: h, status };
        } catch (error) {
          bb.log.warn(`codex probe on ${h.name} failed: ${errorText(error)}`);
          const status: CodexVoiceStatus = { ready: false, message: "Machine did not answer." };
          return { host: h, status };
        }
      }),
    );

    const ready = probes.find((p) => p.status.ready);
    const resolution: Resolution = ready
      ? { ok: true, choice: { hostId: ready.host.id, hostName: ready.host.name } }
      : {
          ok: false,
          // The primary host's reason is the most useful one to show.
          message: probes[0]!.status.ready ? "Codex is unavailable." : probes[0]!.status.message,
        };
    cached = { at: Date.now(), resolution };
    return resolution;
  }

  bb.experimental_aiServices.register({
    id: "codex",
    displayName: "Codex dictation",
    status: async (): Promise<CodexVoiceStatus> => {
      try {
        const resolution = await resolveCodexHost();
        return resolution.ok ? { ready: true } : { ready: false, message: resolution.message };
      } catch (error) {
        bb.log.warn(`status failed: ${errorText(error)}`);
        return { ready: false, message: "Cannot check Codex on bb machines." };
      }
    },
    transcribe: async (audio, { signal, hint }) => {
      const resolution = await resolveCodexHost();
      if (!resolution.ok) throw new Error(resolution.message);
      const audioBase64 = Buffer.from(await audio.arrayBuffer()).toString("base64");
      const result = await host.call(
        "transcribe",
        {
          audioBase64,
          mimeType: audio.type || "audio/webm",
          filename: audio.name || "recording.webm",
          hint,
        },
        { hostId: resolution.choice.hostId, signal, timeoutMs: 15_000 },
      );
      if (!result.ok) {
        cached = null; // sign-in may have changed; re-probe next time
        throw new Error(result.message);
      }
      return result.text;
    },
  });
}
