import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { JSDOM } from "jsdom";
import type { Batch } from "./contracts.js";

type CdpRequest = {
  id: number;
  method: string;
  params?: Record<string, unknown>;
};

type CdpSocket = {
  send(data: string): void;
};

export type CdpFixtureOptions = {
  url?: string;
  html?: string;
  title?: string;
  screenshotBase64?: string;
  failScreenshots?: number;
};

export class CdpFixture {
  readonly dom: JSDOM;
  readonly url: string;
  readonly endpoint: string;
  screenshotCalls = 0;
  private readonly server: ReturnType<typeof Bun.serve>;
  private readonly options: CdpFixtureOptions;

  constructor(options: CdpFixtureOptions = {}) {
    this.options = options;
    this.url = options.url ?? "https://example.test/page";
    this.dom = new JSDOM(
      options.html ?? "<!doctype html><html><head></head><body><main><button>Continue</button></main></body></html>",
      { url: this.url, pretendToBeVisual: true, runScripts: "outside-only" },
    );
    this.installBrowserShims();
    if (options.title !== undefined) this.dom.window.document.title = options.title;

    this.server = Bun.serve({
      hostname: "127.0.0.1",
      port: 0,
      fetch: (request, server) => {
        if (server.upgrade(request, { data: undefined })) return;
        return new Response("CDP fixture", { status: 404 });
      },
      websocket: {
        message: (socket, data) => {
          const request = JSON.parse(String(data)) as CdpRequest;
          void this.handle(request, socket as unknown as CdpSocket);
        },
      },
    });
    this.endpoint = `ws://127.0.0.1:${this.server.port}/devtools/page-test`;
  }

  async close(): Promise<void> {
    this.server.stop(true);
    this.dom.window.close();
  }

  setScreenshotFailures(count: number): void {
    this.options.failScreenshots = count;
    this.screenshotCalls = 0;
  }

  async evaluate(expression: string): Promise<unknown> {
    // JSDOM's own realm is required here: Bun's vm bridge rejects JSDOM's
    // Proxy-backed global prototype chain.
    return await this.dom.window.eval(expression);
  }

  setTime(now: number): Promise<unknown> {
    return this.evaluate(`Date.now = () => ${now}`);
  }

  private installBrowserShims(): void {
    const window = this.dom.window;
    Object.defineProperty(window, "innerWidth", { value: 1000, configurable: true });
    Object.defineProperty(window, "innerHeight", { value: 700, configurable: true });
    Object.defineProperty(window, "devicePixelRatio", { value: 1, configurable: true });
    Object.defineProperty(window, "visualViewport", {
      value: { width: 1000, height: 700 },
      configurable: true,
    });
    Object.defineProperty(window, "CSS", {
      value: {
        supports: () => true,
        escape: (value: string) => value.replace(/[^a-zA-Z0-9_-]/g, "_").replace(/^(?=\d)/, "_") ,
      },
      configurable: true,
    });
    window.matchMedia = () => ({
      matches: false,
      media: "",
      onchange: null,
      addListener: () => undefined,
      removeListener: () => undefined,
      addEventListener: () => undefined,
      removeEventListener: () => undefined,
      dispatchEvent: () => false,
    });
    window.requestAnimationFrame = (callback: FrameRequestCallback) => window.setTimeout(() => callback(Date.now()), 0);
    window.cancelAnimationFrame = (handle: number) => window.clearTimeout(handle);
    if (!window.HTMLElement.prototype.scrollIntoView) {
      window.HTMLElement.prototype.scrollIntoView = () => undefined;
    }
    if (!window.document.elementFromPoint) {
      window.document.elementFromPoint = () => window.document.querySelector("button");
    }
  }

  private async handle(request: CdpRequest, socket: CdpSocket): Promise<void> {
    try {
      const result = await this.resultFor(request);
      socket.send(JSON.stringify({ id: request.id, result }));
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (request.method === "Runtime.evaluate") {
        socket.send(JSON.stringify({
          id: request.id,
          result: {
            exceptionDetails: {
              text: message,
              exception: { description: error instanceof Error ? error.stack : String(error) },
            },
          },
        }));
      } else {
        socket.send(JSON.stringify({
          id: request.id,
          error: { code: -32000, message },
        }));
      }
    }
  }

  private async resultFor(request: CdpRequest): Promise<Record<string, unknown>> {
    switch (request.method) {
      case "Target.getTargets":
        return { targetInfos: [{ targetId: "target-test", type: "page" }] };
      case "Target.attachToTarget":
        return { sessionId: "session-test" };
      case "Page.getFrameTree":
        return { frameTree: { frame: { id: "frame-test" } } };
      case "Page.createIsolatedWorld":
        return { executionContextId: 1 };
      case "Page.enable":
        return {};
      case "Page.captureScreenshot": {
        this.screenshotCalls += 1;
        if ((this.options.failScreenshots ?? 0) >= this.screenshotCalls) {
          throw new Error("fixture screenshot failure");
        }
        return { data: this.options.screenshotBase64 ?? "aGVsbG8=" };
      }
      case "Runtime.evaluate": {
        const expression = request.params?.expression;
        if (typeof expression !== "string") throw new Error("Runtime.evaluate missing expression");
        const value = await this.evaluate(expression);
        return { result: { value } };
      }
      default:
        throw new Error(`unsupported CDP method: ${request.method}`);
    }
  }
}

export async function loadBundledHostEntry(): Promise<{
  entry: unknown;
  cleanup(): Promise<void>;
}> {
  // Keep the temporary module beneath the package so Bun resolves this
  // package's external SDK import exactly as the checked-in entry does.
  const directory = await mkdtemp(join(process.cwd(), ".bb-browser-annotate-host-"));
  const source = await Bun.file(new URL("./host.ts", import.meta.url)).text();
  const sdkHostPath = fileURLToPath(new URL("../node_modules/@get-bb/plugin-sdk/dist/host.js", import.meta.url));
  const contractsPath = fileURLToPath(new URL("./contracts.ts", import.meta.url));
  // Bun's package-local tsconfig intentionally maps the SDK import to the
  // vendored declarations. Rewrite only those runtime specifiers in this
  // temporary copy; the PAGE_SCRIPT and host handlers remain byte-for-byte
  // the source under test.
  const runtimeSource = source
    .replace("@get-bb/plugin-sdk/host", sdkHostPath)
    .replace("./contracts.js", contractsPath);
  await Bun.write(join(directory, "host.ts"), runtimeSource);
  const build = await Bun.build({
    entrypoints: [join(directory, "host.ts")],
    outdir: directory,
    target: "bun",
    splitting: false,
    external: ["@get-bb/plugin-sdk", "@get-bb/plugin-sdk/app"],
  });
  if (!build.success) {
    await rm(directory, { recursive: true, force: true });
    throw new Error(build.logs.map((log) => log.message).join("\n"));
  }
  let module: { default: unknown };
  try {
    module = await import(`${pathToFileURL(join(directory, "host.js"))}?test=${crypto.randomUUID()}`) as { default: unknown };
  } catch (error) {
    try {
      await rm(directory, { recursive: true, force: true });
    } catch (cleanupError) {
      throw new AggregateError([error, cleanupError], "Host entry import and cleanup both failed");
    }
    throw error;
  }
  return {
    entry: module.default,
    cleanup: () => rm(directory, { recursive: true, force: true }),
  };
}

export function restoredBatch(annotationCount = 1, url = "https://example.test/page"): Batch {
  const annotations = Array.from({ length: annotationCount }, (_, index) => ({
    id: `ann_${index + 1}`,
    version: 1,
    kind: "element" as const,
    comment: `Comment ${index + 1}`,
    designChange: null,
    selector: "main > button",
    tag: "button",
    classes: "cta",
    text: "Continue",
    target: `Continue ${index + 1}`,
    targetRole: "button",
    targetPath: "main > button",
    immediateText: "Continue",
    nearbyText: "Checkout Continue",
    selectedText: null,
    nodePosition: { x: 40, y: 50 },
    theme: "light" as const,
    metadata: {},
    rect: { x: 20, y: 40, width: 100, height: 32 },
  }));
  return {
    url,
    title: "Test page",
    viewport: "1000x700",
    dpr: 1,
    annotations,
  };
}
