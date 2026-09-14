import { expect, test } from "bun:test";
import { matchesShortcut } from "./shortcut.js";
import { rpcContract } from "./contracts.js";

test("Cmd+period is accepted and matches the physical period key", () => {
  expect(rpcContract.setShortcut.input.parse({ shortcut: "Meta+." })).toEqual({ shortcut: "Meta+." });
  expect(matchesShortcut({ code: "Period", metaKey: true, ctrlKey: false, altKey: false, shiftKey: false }, "Meta+.", true)).toBe(true);
});

test("matches exact platform modifiers and physical letter", () => {
  const event = { code: "KeyA", metaKey: true, ctrlKey: false, altKey: false, shiftKey: true };
  expect(matchesShortcut(event, "Mod+Shift+A", true)).toBe(true);
  expect(matchesShortcut(event, "Mod+Shift+A", false)).toBe(false);
  expect(matchesShortcut({ ...event, altKey: true }, "Mod+Shift+A", true)).toBe(false);
  expect(matchesShortcut(event, "", true)).toBe(false);
});
