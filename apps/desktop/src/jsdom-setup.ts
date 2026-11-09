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

if (!("setPointerCapture" in Element.prototype)) {
  Object.assign(Element.prototype, {
    setPointerCapture() {
      return undefined;
    },
    releasePointerCapture() {
      return undefined;
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

Object.assign(window, {
  matchMedia: (media: string) => ({
    media,
    matches: false,
    onchange: null,
    addEventListener: () => undefined,
    removeEventListener: () => undefined,
    addListener: () => undefined,
    removeListener: () => undefined,
    dispatchEvent: () => false,
  }),
});
