import { beforeEach, vi } from "vitest";

// Unit tests run anywhere: no network, no secrets. A test that needs `fetch` stubs it itself.
beforeEach(() => {
  vi.stubGlobal("fetch", () => {
    throw new Error(
      "Unit tests must not touch the network. Stub fetch with vi.stubGlobal, or move the test to a *.int.test.ts file.",
    );
  });
});
