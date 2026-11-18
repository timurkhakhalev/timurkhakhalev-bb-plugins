// Which keydowns type-to-compose takes. Pure apart from DOM reads so it can be tested.

type KeyLike = Pick<KeyboardEvent, "key" | "defaultPrevented" | "isComposing" | "ctrlKey" | "metaKey" | "altKey">;
type DocLike = Pick<Document, "querySelector">;

const EDITABLE = 'input, textarea, select, iframe, webview, [contenteditable]:not([contenteditable="false"]), [role="textbox"], [role="combobox"]';
const OVERLAY_SCOPE = '[role="dialog"], [role="alertdialog"], [role="menu"], [role="menubar"], [role="listbox"], [role="grid"], [role="tree"]';
const MODAL_OPEN = '[aria-modal="true"], [role="alertdialog"]';

export function shouldCapture(event: KeyLike, active: Element | null, doc: DocLike): boolean {
  if (event.defaultPrevented || event.isComposing) return false;
  // ⌘/Ctrl are shortcuts; ⌥ types special characters on macOS but also drives
  // shortcuts, so leave it alone. Shift is fine (capitals, symbols).
  if (event.ctrlKey || event.metaKey || event.altKey) return false;
  // One character: rules out Enter, Tab, Escape, arrows, F-keys, "Dead", "Process".
  if ([...event.key].length !== 1) return false;
  const focused = active && active !== doc.querySelector("body") ? active : null;
  // Space on a focused button or link activates it.
  if (event.key === " " && focused) return false;
  if (focused?.closest(EDITABLE) || focused?.closest(OVERLAY_SCOPE)) return false;
  if (doc.querySelector(MODAL_OPEN)) return false;
  return true;
}
