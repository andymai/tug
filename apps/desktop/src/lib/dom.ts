export function editable(target: EventTarget | null): boolean {
  return target instanceof HTMLElement && (target.isContentEditable || target.closest("input, textarea, select") !== null);
}

export function focusRow(id: number) {
  const row = document.querySelector<HTMLElement>(`[data-download="${String(id)}"]`);
  (row ?? document.getElementById("list-title"))?.focus();
}

// The data type of a drag of rows in the queue, which the link drop zone leaves alone.
export const ROW_DRAG = "application/x-tug-downloads";

const TEXT_INPUTS = new Set(["email", "number", "password", "search", "tel", "text", "url"]);

// WebKit's own menu offers Back, Forward and Reload, and Reload resets the window. A text
// field and the text that someone selected keep it, for Cut, Copy and Paste, and Shift keeps
// it for Inspect Element when Vite's dev server serves the window.
export function keepsWebKitMenu(event: MouseEvent): boolean {
  if (event.shiftKey && import.meta.env.DEV) return true;
  const target = event.target;
  if (!(target instanceof Element)) return false;
  const field = target.closest("input, textarea");
  if (field instanceof HTMLInputElement) return TEXT_INPUTS.has(field.type);
  if (field !== null || (target instanceof HTMLElement && target.isContentEditable)) return true;
  const selection = window.getSelection();
  if (selection === null || selection.isCollapsed) return false;
  for (let index = 0; index < selection.rangeCount; index++) {
    for (const box of selection.getRangeAt(index).getClientRects()) {
      if (event.clientX >= box.left && event.clientX <= box.right && event.clientY >= box.top && event.clientY <= box.bottom) return true;
    }
  }
  return false;
}

// Where a right-click opens Tug's menu, or null where WebKit's own menu stays
// or an inner element opened its menu already.
export function menuPoint(event: { nativeEvent: MouseEvent; defaultPrevented: boolean; clientX: number; clientY: number; preventDefault: () => void }): { x: number; y: number } | null {
  if (event.defaultPrevented || keepsWebKitMenu(event.nativeEvent)) return null;
  event.preventDefault();
  return { x: event.clientX, y: event.clientY };
}
