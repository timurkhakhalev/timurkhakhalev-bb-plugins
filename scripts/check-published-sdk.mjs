import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const packageRoot = dirname(dirname(fileURLToPath(import.meta.url)));
const sdkRoot = join(packageRoot, "node_modules", "@get-bb", "plugin-sdk");
const packageJson = JSON.parse(
  await readFile(join(sdkRoot, "package.json"), "utf8"),
);
const declarations = new Map([
  ["root", "bundled-types/bb-plugin-sdk.d.ts"],
  ["app", "bundled-types/bb-plugin-sdk-app.d.ts"],
  ["host", "bundled-types/bb-plugin-sdk-host.d.ts"],
]);
const required = {
  root: [
    {
      label: "experimental_client",
      pattern: /\bexperimental_client\s*</u,
    },
    {
      label: "experimental_desktopBrowsers",
      pattern: /\bexperimental_desktopBrowsers\s*:/u,
    },
    {
      label: "experimental_images",
      pattern: /\bexperimental_images\??\s*:/u,
    },
  ],
  app: [
    {
      label: "experimental_browserToolbarAction",
      pattern: /\bexperimental_browserToolbarAction\s*\(/u,
    },
  ],
  host: [
    {
      label: "experimental_defineHostEntry",
      pattern: /\bexperimental_defineHostEntry\s*</u,
    },
  ],
};
const missing = [];
for (const [surface, relativePath] of declarations) {
  const contents = await readFile(join(sdkRoot, relativePath), "utf8");
  for (const requirement of required[surface]) {
    if (!requirement.pattern.test(contents)) {
      missing.push(`${surface}:${requirement.label}`);
    }
  }
}
if (missing.length > 0) {
  throw new Error(
    `@get-bb/plugin-sdk@${packageJson.version} is missing required published APIs: ${missing.join(", ")}`,
  );
}
console.log(`@get-bb/plugin-sdk@${packageJson.version} contains the required APIs`);
