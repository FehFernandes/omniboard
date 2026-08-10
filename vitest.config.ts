import { defineConfig } from "vitest/config";
import path from "path";

/**
 * Tests for the lib packages (packages/*).
 *
 * The web app has its own configuration (apps/web/vite.config.ts) because it
 * needs jsdom and a different setup; here the environment is `node`, which is
 * faster and incidentally exposes any DOM dependency in the core — the lib has to
 * work on any runtime.
 */
export default defineConfig({
  resolve: {
    alias: {
      "@omniboard/core": path.resolve(__dirname, "packages/core/src/index.ts"),
      "@omniboard/react": path.resolve(__dirname, "packages/react/src/index.ts"),
    },
  },
  test: {
    globals: true,
    environment: "node",
    include: ["packages/*/tests/**/*.test.ts"],
    coverage: {
      provider: "v8",
      include: ["packages/core/src/**/*.ts"],
      // Renderer and icons are drawing/assets: coverage here would measure
      // little. The renderer's visible behavior is tested through geometry
      // invariants (packages/core/tests/render-link-note.test.ts).
      exclude: ["packages/core/src/icons.ts"],
    },
  },
});
