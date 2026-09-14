export type StructuredMentionRange = {
  from: number;
  to: number;
};

export type BrowserMention = StructuredMentionRange & {
  id: string;
  label: string;
};

export type BrowserBatchSummary = {
  id: string;
  label: string;
};

export function planMentionReconciliation(
  mentions: BrowserMention[],
  batches: BrowserBatchSummary[],
  observedIds: ReadonlySet<string>,
  requestedLabels: ReadonlyMap<string, string>,
) {
  const observed = new Set(observedIds);
  const requested = new Map(requestedLabels);
  const batchesById = new Map(batches.map((batch) => [batch.id, batch]));
  const remove = mentions.filter((mention) => !batchesById.has(mention.id));
  const insert: BrowserBatchSummary[] = [];
  const discard: string[] = [];

  for (const batch of batches) {
    const attached = mentions.find((mention) => mention.id === batch.id);
    if (attached) {
      observed.add(batch.id);
      requested.delete(batch.id);
      if (attached.label !== batch.label) {
        requested.set(batch.id, batch.label);
        remove.push(attached);
        insert.push(batch);
      }
    } else if (observed.has(batch.id) && !requested.has(batch.id)) {
      observed.delete(batch.id);
      discard.push(batch.id);
    } else if (requested.get(batch.id) !== batch.label) {
      requested.set(batch.id, batch.label);
      insert.push(batch);
    }
  }

  return { remove, insert, discard, observed, requested };
}

export function removeStructuredMentionText(
  text: string,
  mention: StructuredMentionRange,
): string {
  let start = mention.from;
  let end = mention.to;
  if (text[end] === " ") end += 1;
  else if (start > 0 && text[start - 1] === " ") start -= 1;
  return `${text.slice(0, start)}${text.slice(end)}`;
}
