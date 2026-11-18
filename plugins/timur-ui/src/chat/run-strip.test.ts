// node --experimental-strip-types --test run-strip.test.ts
import assert from "node:assert/strict";
import test from "node:test";
import { formatTokens, stripFrom } from "./run-strip-model.ts";

const todo = (id: string, status: string, text = id) => ({ id, status, text });

test("nothing worth showing → null", () => {
  assert.equal(stripFrom(null), null);
  assert.equal(stripFrom({ pendingTodos: null, contextWindowUsage: { usedTokens: 10, modelContextWindow: 100 }, modelFallback: null }), null);
  // every to-do done: the plan is over, no row
  assert.equal(stripFrom({ pendingTodos: { items: [todo("a", "completed")] } }), null);
});

test("to-dos: progress, current item, junk dropped", () => {
  const strip = stripFrom({
    pendingTodos: { items: [todo("a", "completed"), todo("b", "in_progress", "Write tests"), todo("c", "pending"), { id: 1 }, todo("d", "weird")] },
  });
  assert.equal(strip?.todos?.items.length, 3);
  assert.equal(strip?.todos?.done, 1);
  assert.equal(strip?.todos?.current?.text, "Write tests");
});

test("context shows only near the limit, clamped, with cost", () => {
  const near = stripFrom({ contextWindowUsage: { usedTokens: 150_000, modelContextWindow: 200_000, cost: { amount: 1.234, currency: "USD" } } });
  assert.equal(near?.context?.ratio, 0.75);
  assert.equal(near?.context?.cost, "$1.23");
  const over = stripFrom({ contextWindowUsage: { usedTokens: 300, modelContextWindow: 200 } });
  assert.equal(over?.context?.ratio, 1);
  assert.equal(over?.context?.cost, null);
  assert.equal(stripFrom({ contextWindowUsage: { usedTokens: 1, modelContextWindow: 0 } }), null);
});

test("model fallback", () => {
  assert.deepEqual(stripFrom({ modelFallback: { originalModel: "opus", fallbackModel: "sonnet" } })?.fallback, { from: "opus", to: "sonnet" });
});

test("formatTokens", () => {
  assert.equal(formatTokens(950), "950");
  assert.equal(formatTokens(182_400), "182k");
  assert.equal(formatTokens(1_000_000), "1M");
  assert.equal(formatTokens(1_250_000), "1.3M");
});
