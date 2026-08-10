// Vitest setup for @testing-library/svelte under Svelte 5.
// globals:true disables svelteTesting()'s auto-cleanup, so register it here.
import "@testing-library/jest-dom/vitest";
import { afterEach } from "vitest";
import { cleanup } from "@testing-library/svelte";

afterEach(() => {
  cleanup();
});
