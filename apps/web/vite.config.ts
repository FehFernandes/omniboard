/// <reference types="vitest/config" />
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// The lib packages live in this very repository (packages/core and
// packages/react) and are resolved from the build output (`dist`), not from the
// source.
//
// Why point at dist and not at src: the app consumes the lib exactly the way an
// external user would, so a packaging mistake (a missing export, a type that
// does not make it into the .d.ts) shows up here instead of only at publish
// time. Run `pnpm build:lib` after touching the lib. Path built from a URL so we
// do not need @types/node.
const pkg = (p: string) => new URL(`../../packages/${p}`, import.meta.url).pathname;

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      '@omniboard/react': pkg('react/dist/index.js'),
      '@omniboard/core': pkg('core/dist/index.js'),
    },
  },
  server: {
    port: 5173,
  },
  test: {
    environment: 'jsdom',
    // jsdom refuses localStorage on "opaque origins" (about:blank). Setting a
    // concrete URL gives it a real origin and enables window.localStorage —
    // required from Node 21+/26 on (which no longer provides a global
    // localStorage).
    environmentOptions: { jsdom: { url: 'http://localhost' } },
    setupFiles: ['./src/test/setup.ts'],
    // e2e/ belongs to Playwright (real browser); vitest runs only the unit
    // tests.
    exclude: ['e2e/**', 'node_modules/**', 'dist/**'],
  },
});
