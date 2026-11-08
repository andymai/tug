export function editable(target: EventTarget | null): boolean {
  return target instanceof HTMLElement && (target.isContentEditable || target.closest("input, textarea, select") !== null);
}

export function focusRow(id: number) {
  const row = document.querySelector<HTMLElement>(`[data-download="${String(id)}"]`);
  (row ?? document.getElementById("list-title"))?.focus();
}
