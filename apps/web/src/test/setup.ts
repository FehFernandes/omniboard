import { afterEach } from 'vitest';
import { cleanup } from '@testing-library/react';

// ResizeObserver stub: jsdom does not implement it, and components that measure
// their own size (e.g. the expandable area of the board manager, which animates
// the exact height) rely on it. The stub observes nothing — the tests check
// behavior, not geometry.
if (!('ResizeObserver' in globalThis)) {
  (globalThis as unknown as Record<string, unknown>).ResizeObserver = class {
    observe() {}
    unobserve() {}
    disconnect() {}
  };
}

// Storage polyfill for the tests.
// Under Node 26 + vitest/jsdom, window.localStorage may not be exposed (opaque
// origin in jsdom plus an experimental global `localStorage` in Node that stays
// undefined without --localstorage-file). We guarantee an in-memory Storage for
// the tests that depend on persistence (e.g. token-store). It is idempotent: it
// does not overwrite a real Storage when one exists.
function ensureStorage(key: 'localStorage' | 'sessionStorage') {
  const g = globalThis as unknown as Record<string, Storage | undefined>;
  if (g[key]) return;

  let store: Record<string, string> = {};
  const mock: Storage = {
    getItem: (k: string) => (k in store ? store[k] : null),
    setItem: (k: string, v: string) => {
      store[k] = String(v);
    },
    removeItem: (k: string) => {
      delete store[k];
    },
    clear: () => {
      store = {};
    },
    key: (i: number) => Object.keys(store)[i] ?? null,
    get length() {
      return Object.keys(store).length;
    },
  };

  Object.defineProperty(globalThis, key, { value: mock, configurable: true, writable: true });
  const win = (globalThis as { window?: object }).window;
  if (win) {
    Object.defineProperty(win, key, { value: mock, configurable: true, writable: true });
  }
}

ensureStorage('localStorage');
ensureStorage('sessionStorage');

// Unmounts whatever was rendered between tests (avoids elements piling up in
// the document across cases).
afterEach(() => cleanup());
