import { expect, test } from "bun:test";
import { placeEditor } from "./editor-placement.js";

test("maps page coordinates into the scaled BB viewport", () => {
  const result = placeEditor({ x: 700, y: 100, width: 500, height: 600 }, { width: 1000, height: 1200 }, { x: 100, y: 200, width: 200, height: 40 }, false);
  expect(result.target).toEqual({ left: 750, top: 200, width: 100, height: 20 });
  expect(result.popup.top).toBe(230);
});

test("expanded editor stays above a lower element instead of covering it", () => {
  const result = placeEditor({ x: 0, y: 0, width: 500, height: 600 }, { width: 500, height: 600 }, { x: 100, y: 450, width: 200, height: 30 }, true);
  expect(result.popup.top).toBe(440);
  expect(result.popup.transform).toBe("translateY(-100%)");
  expect(result.popup.maxHeight).toBe(432);
});

test("constrains settings to space next to the element", () => {
  const result = placeEditor({ x: 0, y: 0, width: 400, height: 400 }, { width: 400, height: 400 }, { x: 350, y: 150, width: 30, height: 30 }, true);
  expect(result.popup.maxHeight).toBe(202);
  expect(result.popup.top).toBe(190);
  expect(result.popup.left + result.popup.width).toBeLessThanOrEqual(388);
});

test.failing("#4 a viewport-sized element still leaves a visible usable editor", () => {
  const result = placeEditor(
    { x: 0, y: 0, width: 1000, height: 700 },
    { width: 1000, height: 700 },
    { x: 0, y: 0, width: 1000, height: 700 },
    true,
  );
  expect(result.popup.maxHeight).toBeGreaterThanOrEqual(44);
  const top = result.popup.transform === "translateY(-100%)"
    ? result.popup.top - result.popup.maxHeight
    : result.popup.top;
  expect(top).toBeGreaterThanOrEqual(0);
  expect(top + result.popup.maxHeight).toBeLessThanOrEqual(700);
});
