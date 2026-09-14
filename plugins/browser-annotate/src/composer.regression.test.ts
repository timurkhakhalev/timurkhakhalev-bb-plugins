import { describe, expect, test } from "bun:test";
import { planMentionReconciliation, removeStructuredMentionText } from "./composer.js";

describe("composer mention reconciliation", () => {
  test("delayed live batches insert once and then become stable", () => {
    const batch = { id: "batch-1", label: "1 annotation" };
    const first = planMentionReconciliation([], [batch], new Set(), new Map());
    expect(first.insert).toEqual([batch]);

    const second = planMentionReconciliation(
      [{ ...batch, from: 0, to: batch.label.length }],
      [batch],
      first.observed,
      first.requested,
    );
    expect(second.insert).toEqual([]);
    expect(second.remove).toEqual([]);
    expect(second.discard).toEqual([]);
  });

  test("replaces a changed annotation count without duplicating the mention", () => {
    const current = { id: "batch-1", label: "1 annotation", from: 0, to: 12 };
    const updated = { id: "batch-1", label: "2 annotations" };
    const plan = planMentionReconciliation(
      [current],
      [updated],
      new Set([current.id]),
      new Map(),
    );
    expect(plan.remove).toEqual([current]);
    expect(plan.insert).toEqual([updated]);
    expect(plan.discard).toEqual([]);
  });

  test("removing one structured mention preserves unrelated text and the other mention", () => {
    const text = "Keep 1 annotation and 2 annotations for later";
    const from = text.indexOf("1 annotation");
    const to = from + "1 annotation".length;
    expect(removeStructuredMentionText(text, { from, to })).toBe(
      "Keep and 2 annotations for later",
    );
  });

  test("an observed mention removed by the user discards only that batch", () => {
    const batches = [
      { id: "batch-1", label: "1 annotation" },
      { id: "batch-2", label: "2 annotations" },
    ];
    const observed = new Set(batches.map(({ id }) => id));
    const plan = planMentionReconciliation(
      [{ ...batches[1], from: 0, to: batches[1].label.length }],
      batches,
      observed,
      new Map([["batch-2", batches[1].label]]),
    );
    expect(plan.discard).toEqual(["batch-1"]);
    expect(plan.insert).toEqual([]);
  });
});
