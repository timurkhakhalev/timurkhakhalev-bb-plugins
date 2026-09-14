export const defaultShortcut = "Mod+Shift+A";
export function matchesShortcut(event: Pick<KeyboardEvent, "code" | "metaKey" | "ctrlKey" | "altKey" | "shiftKey">, shortcut: string, mac: boolean) {
  const parts = shortcut.toLowerCase().split("+").map((part) => part.trim());
  const key = parts.pop();
  const modifiers = new Set(parts);
  return Boolean(key) && event.code.toLowerCase() === (key === "." ? "period" : `key${key}`) &&
    event.metaKey === (modifiers.has("meta") || (mac && modifiers.has("mod"))) &&
    event.ctrlKey === (modifiers.has("ctrl") || (!mac && modifiers.has("mod"))) &&
    event.altKey === modifiers.has("alt") && event.shiftKey === modifiers.has("shift");
}
