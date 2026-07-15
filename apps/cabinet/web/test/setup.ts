/// <reference types="vitest/globals" />
// jsdom lacks a few APIs the app and testing-library touch.
if (!('scrollTo' in window)) {
  Object.defineProperty(window, 'scrollTo', { value: () => {}, writable: true });
}
if (!Element.prototype.scrollTo) {
  Element.prototype.scrollTo = () => {};
}

// jsdom has no EventSource; components subscribe to /api/events for
// out-of-band updates. A silent stub keeps those effects inert in tests.
if (!('EventSource' in globalThis)) {
  class EventSourceStub {
    url: string;
    constructor(url: string) { this.url = url; }
    addEventListener() {}
    removeEventListener() {}
    close() {}
  }
  Object.defineProperty(globalThis, 'EventSource', { value: EventSourceStub, writable: true });
}
