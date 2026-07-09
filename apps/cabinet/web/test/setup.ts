/// <reference types="vitest/globals" />
// jsdom lacks a few APIs the app and testing-library touch.
if (!('scrollTo' in window)) {
  Object.defineProperty(window, 'scrollTo', { value: () => {}, writable: true });
}
if (!Element.prototype.scrollTo) {
  Element.prototype.scrollTo = () => {};
}
