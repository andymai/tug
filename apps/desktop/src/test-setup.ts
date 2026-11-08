import "@testing-library/jest-dom/vitest";
import { cleanup } from "@testing-library/react";
import { afterEach } from "vitest";

if (!("showModal" in HTMLDialogElement.prototype)) {
  Object.assign(HTMLDialogElement.prototype, {
    showModal(this: HTMLDialogElement) {
      this.open = true;
      this.querySelector<HTMLElement>("input, textarea, select, button, [tabindex]:not([tabindex='-1'])")?.focus();
    },
    close(this: HTMLDialogElement) {
      this.open = false;
      this.dispatchEvent(new Event("close"));
    },
  });
}

if (!("scrollIntoView" in Element.prototype)) {
  Object.assign(Element.prototype, {
    scrollIntoView() {
      return undefined;
    },
  });
}

afterEach(() => {
  cleanup();
});
