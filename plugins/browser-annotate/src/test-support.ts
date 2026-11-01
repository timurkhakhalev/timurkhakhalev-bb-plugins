import { createFakePluginHost } from "@get-bb/plugin-sdk/testing";
import type { Annotation, Batch, Screenshot } from "./contracts.js";
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

export type FakeBrowserState = {
  captureFailures: number;
  captureCalls: number;
  failScreenshotWrites: number;
  screenshot: Screenshot;
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

export function createServerHarness(initial: Partial<FakeBrowserState> = {}) {
  const files = new Map<string, { content: string; contentEncoding: "utf8" | "base64"; mimeType?: string }>();
  const sent: unknown[] = [];
  const state: FakeBrowserState = {
    captureFailures: 0,
    captureCalls: 0,
    failScreenshotWrites: 0,
    screenshot: makeScreenshot(),
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
        captureTab: async () => {
          state.captureCalls += 1;
          if (state.captureFailures > 0) {
            state.captureFailures -= 1;
            throw new Error("simulated capture failure");
          }
          return state.screenshot;
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
  });
  trackGeneration(fake);

  return {
    ...fake,
    state,
    files,
    sent,
    location,
  };
}
