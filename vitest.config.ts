import { defineConfig } from "vitest/config";
import { svelte } from "@sveltejs/vite-plugin-svelte";
import { svelteTesting } from "@testing-library/svelte/vite";
import { resolve } from "node:path";

export default defineConfig({
  plugins: [svelte(), svelteTesting()],
  test: {
    // Vitest 4 defaults to pool: "forks" with isolate: true, so each test file
    // gets its own process and module registry. lib/sections.svelte.ts relies
    // on that: its `$state` record is a module-level mutable singleton, and
    // tests reset it via loadSections() rather than reimporting the module. If
    // this project ever sets isolate: false or switches to vmThreads for
    // speed, that record becomes shared mutable state across test files and
    // Section's tests will bleed into collapsible.test.ts and vice versa.
    environment: "jsdom",
    globals: true,
    setupFiles: [resolve(__dirname, "test/setup.ts")],
    include: ["test/**/*.test.ts"],
    passWithNoTests: true,
  },
});
