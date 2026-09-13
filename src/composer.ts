export type StructuredMentionRange = {
  from: number;
  to: number;
};

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
