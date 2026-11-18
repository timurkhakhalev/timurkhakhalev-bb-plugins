// node --experimental-strip-types --test type-to-compose.test.ts
import assert from "node:assert/strict";
import test from "node:test";
import { shouldCapture } from "./type-to-compose-policy.ts";

const body = { closest: () => null } as unknown as Element;
const doc = (modal = false) => ({ querySelector: (s: string) => (s === "body" ? body : modal ? body : null) }) as unknown as Document;
const el = (matches: boolean) => ({ closest: () => (matches ? {} : null) }) as unknown as Element;
const key = (k: string, extra: Partial<KeyboardEvent> = {}) =>
  ({ key: k, defaultPrevented: false, isComposing: false, ctrlKey: false, metaKey: false, altKey: false, ...extra }) as KeyboardEvent;

test("printable keys with nothing focused are captured", () => {
  assert.equal(shouldCapture(key("a"), body, doc()), true);
  assert.equal(shouldCapture(key("Я"), null, doc()), true);
  assert.equal(shouldCapture(key("?"), body, doc()), true);
  assert.equal(shouldCapture(key(" "), body, doc()), true);
  assert.equal(shouldCapture(key("😀"), body, doc()), true);
});

test("shortcuts, special keys, IME and claimed keys are left alone", () => {
  for (const extra of [{ metaKey: true }, { ctrlKey: true }, { altKey: true }, { isComposing: true }, { defaultPrevented: true }]) {
    assert.equal(shouldCapture(key("c", extra), body, doc()), false);
  }
  for (const k of ["Enter", "Tab", "Escape", "ArrowUp", "F5", "Dead", "Process"]) {
    assert.equal(shouldCapture(key(k), body, doc()), false);
  }
});

test("focused fields, overlays and modals keep their keys", () => {
  assert.equal(shouldCapture(key("a"), el(true), doc()), false);
  assert.equal(shouldCapture(key("a"), body, doc(true)), false);
  // a focused button: letters go to the composer, space presses the button
  assert.equal(shouldCapture(key("a"), el(false), doc()), true);
  assert.equal(shouldCapture(key(" "), el(false), doc()), false);
});
