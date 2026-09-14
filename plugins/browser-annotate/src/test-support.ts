import { createFakePluginHost } from "@get-bb/plugin-sdk/testing";
import type {
  Annotation,
  Batch,
  DesignChange,
  Screenshot,
} from "./contracts.js";
import { annotationSchema, batchSchema } from "./contracts.js";

export const TEST_HOST_ID = "host-test";
export const TEST_THREAD_ID = "thread-test";
export const TEST_TAB_ID = "tab-test";
export const TEST_URL = "https://example.test/page";

export function makeAnnotation(
  overrides: Partial<Annotation> = {},
): Annotation {
  return annotationSchema.parse({
    id: "ann_test",
    version: 1,
    kind: "element",
    comment: "Keep this annotation.",
    designChange: null,
    selector: "main > button",
    tag: "button",
    classes: "cta",
    text: "Continue",
    target: "Continue",
    targetRole: "button",
    targetPath: "main > button",
    immediateText: "Continue",
    nearbyText: "Checkout Continue",
    selectedText: null,
    nodePosition: { x: 40, y: 50 },
    theme: "light",
    metadata: { type: "submit" },
    rect: { x: 20, y: 40, width: 100, height: 32 },
    ...overrides,
  });
}

export function makeBatch(
  overrides: Partial<Batch> = {},
): Batch {
  return batchSchema.parse({
    url: TEST_URL,
    title: "Test page",
    viewport: "1000x700",
    dpr: 1,
    annotations: [makeAnnotation()],
    ...overrides,
  });
}

export function makeScreenshot(base64 = "aGVsbG8="): Screenshot {
  return {
    base64,
    width: 1000,
    height: 700,
    mimeType: "image/jpeg",
  };
}

export type FakeHostRpcState = {
  batch: Batch | null;
  revision: number;
  editor: object | null;
  captures: Array<{
    annotationId: string;
    version: number;
    image: Screenshot;
  }>;
  captureFailed: boolean;
  currentUrl: string;
  startRestored: boolean;
  failScreenshotWrites: number;
  readStatus?: "active" | "cancelled" | "missing" | "navigated";
  cleanupDelay?: Promise<void>;
  onCleanupStarted?: () => void;
};

type FakePluginHost = ReturnType<typeof createFakePluginHost>;
type TrackedGeneration = {
  host: FakePluginHost;
};

const trackedGenerations = new Set<TrackedGeneration>();

function trackGeneration(host: FakePluginHost): void {
  const tracked = { host };
  trackedGenerations.add(tracked);
  const originalReload = host.harness.lifecycle.reload.bind(host.harness.lifecycle);
  host.harness.lifecycle.reload = async (factory) => {
    const replacement = await originalReload(factory);
    trackGeneration(replacement);
    return replacement;
  };
}

export async function disposeServerHarnesses(): Promise<void> {
  const errors: unknown[] = [];
  for (const { host } of [...trackedGenerations].reverse()) {
    try {
      await host.harness.lifecycle.dispose();
    } catch (error) {
      errors.push(error);
    }
  }
  trackedGenerations.clear();
  if (errors.length > 0) throw new AggregateError(errors, "Could not dispose server test harnesses");
}

export function createServerHarness(
  initial: Partial<FakeHostRpcState> = {},
) {
  const files = new Map<string, { content: string; contentEncoding: "utf8" | "base64"; mimeType?: string }>();
  const sent: unknown[] = [];
  const leases: string[] = [];
  const releasedLeases: string[] = [];
  let nextLease = 0;
  const state: FakeHostRpcState = {
    batch: makeBatch(),
    revision: 1,
    editor: null,
    captures: [{ annotationId: "ann_test", version: 1, image: makeScreenshot() }],
    captureFailed: false,
    currentUrl: TEST_URL,
    startRestored: false,
    failScreenshotWrites: 0,
    ...initial,
  };
  const location = {
    hostId: TEST_HOST_ID,
    storageRootPath: "/tmp/browser-annotate-test-storage",
  };

  const fake = createFakePluginHost({
      pluginId: "browser-annotate",
      sdk: {
        hosts: {
          list: async () => [{ id: TEST_HOST_ID }],
        },
        experimental_desktopBrowsers: {
          listInstances: async () => ({ instances: [{ instanceId: "instance-test", generation: "generation-test" }] }),
          listTabs: async () => ({ tabs: [{ tabId: TEST_TAB_ID }, { tabId: "tab-thread-a" }, { tabId: "tab-thread-b" }] }),
          revealTab: async () => ({ ok: true }),
          acquireControl: async () => {
            const leaseId = `lease-${++nextLease}`;
            leases.push(leaseId);
            return { leaseId };
          },
          openConnection: async () => ({ wsEndpoint: "https://example.test/cdp" }),
          releaseControl: async ({ leaseId }: { leaseId: string }) => {
            releasedLeases.push(leaseId);
            return { ok: true };
          },
        },
        threads: {
          storageLocation: async () => location,
          send: async (input: unknown) => {
            sent.push(input);
          },
        },
        files: {
          write: async (input: { path: string; content: string; contentEncoding?: "utf8" | "base64"; mimeType?: string }) => {
            if (input.contentEncoding === "base64" && state.failScreenshotWrites > 0) {
              state.failScreenshotWrites -= 1;
              throw new Error("simulated screenshot write failure");
            }
            files.set(input.path, { content: input.content, contentEncoding: input.contentEncoding ?? "utf8", mimeType: input.mimeType });
            return { ok: true };
          },
          read: async (input: { path: string }) => {
            const value = files.get(input.path);
            if (!value) throw new Error(`missing test file: ${input.path}`);
            return { ...value, sizeBytes: value.content.length };
          },
          remove: async (input: { path: string }) => {
            files.delete(input.path);
            return { ok: true };
          },
        },
      },
      experimental_callHostRpc: async ({ method, input }: { method: string; input: unknown }) => {
        if (method === "startSession") {
          return { started: true, currentUrl: state.currentUrl, restored: state.startRestored };
        }
        if (method === "readSession") {
          return {
            status: state.readStatus ?? "active",
            revision: state.revision,
            currentUrl: state.currentUrl,
            batch: state.batch,
            editor: state.editor,
            captureFailed: state.captureFailed,
            captures: state.captures,
          };
        }
        if (method === "saveEditor") {
          const save = input as { comment: string; designChange: DesignChange | null };
          if (state.batch) {
            const editor = state.editor;
            const editorAnnotationId = editor &&
              typeof editor === "object" &&
              "annotationId" in editor &&
              typeof (editor as { annotationId?: unknown }).annotationId === "string"
              ? (editor as { annotationId: string }).annotationId
              : null;
            const annotationIndex = editorAnnotationId
              ? state.batch.annotations.findIndex((annotation) => annotation.id === editorAnnotationId)
              : 0;
            if (annotationIndex >= 0) {
              const annotations = [...state.batch.annotations];
              annotations[annotationIndex] = {
                ...annotations[annotationIndex],
                comment: save.comment,
                designChange: save.designChange,
              };
              state.batch = { ...state.batch, annotations };
            }
          }
          state.editor = null;
          state.revision += 1;
          return {
            saved: true,
            revision: state.revision,
            batch: state.batch,
            captures: state.captures,
            captureFailed: state.captureFailed,
          };
        }
        if (method === "cleanupSession") {
          state.onCleanupStarted?.();
          await state.cleanupDelay;
          return { cleaned: true };
        }
        if (method === "mutateSession") {
          const mutation = input as { annotationId?: unknown; action?: unknown };
          if (mutation.action === "delete" && state.batch && typeof mutation.annotationId === "string") {
            const annotations = state.batch.annotations.filter(
              (annotation) => annotation.id !== mutation.annotationId,
            );
            if (annotations.length !== state.batch.annotations.length) {
              state.batch = { ...state.batch, annotations };
              state.revision += 1;
              return { changed: true };
            }
            return { changed: false };
          }
          return { changed: true };
        }
        if (method === "previewEditor") return { changed: true };
        if (method === "cancelEditor") return { changed: true };
        throw new Error(`unexpected test host method: ${method}`);
      },
    });
  trackGeneration(fake);

  return {
    ...fake,
    state,
    files,
    sent,
    leases,
    releasedLeases,
    location,
  };
}
